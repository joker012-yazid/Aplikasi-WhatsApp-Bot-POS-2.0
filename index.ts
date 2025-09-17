import 'dotenv/config'
import Pino from 'pino'
import express from 'express'
import QRCode from 'qrcode'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from '@whiskeysockets/baileys'

const logger = Pino({ level: 'warn' })
const WA_STORE_PATH = process.env.WA_STORE_PATH || '/app/.wa_store'
const BOT_PORT = parseInt(process.env.BOT_PORT || '8081', 10)

let latestQR: string | null = null
let isConnected = false
let sock: ReturnType<typeof makeWASocket> | null = null

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(WA_STORE_PATH)
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger
  })

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      latestQR = qr
      isConnected = false
      logger.warn('QR updated; scan using WhatsApp on your phone')
    }
    if (connection === 'open') {
      isConnected = true
      latestQR = null
      logger.warn('WhatsApp connection OPEN')
    } else if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
      logger.warn({ shouldReconnect }, 'WhatsApp connection CLOSED')
      if (shouldReconnect) startBot()
    }
  })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('messages.upsert', (m) => {
    logger.info({ count: m.messages.length, type: m.type }, 'messages.upsert')
  })
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bot', connected: isConnected })
})

app.get('/qr', async (_req, res) => {
  if (isConnected) return res.json({ status: 'connected' })
  if (!latestQR) return res.json({ status: 'pending' })
  const dataUrl = await QRCode.toDataURL(latestQR, { margin: 1, scale: 6 })
  res.json({ status: 'scan', qrDataUrl: dataUrl })
})

app.post('/send', async (req, res) => {
  try {
    const { to, text } = req.body as { to: string; text: string }
    if (!sock) return res.status(503).json({ ok: false, error: 'socket not ready' })
    await sock.sendMessage(to, { text })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message })
  }
})

startBot().catch((e) => logger.error(e, 'failed to start bot'))

app.listen(BOT_PORT, () => {
  console.log(`[bot] running on :${BOT_PORT}`)
})
