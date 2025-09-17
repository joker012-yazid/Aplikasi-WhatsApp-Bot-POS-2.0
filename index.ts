import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { z } from 'zod'
import { Pool } from 'pg'

const PORT = parseInt(process.env.PORT || '8080', 10)
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:app@db:5432/app'

// Optional: init DB pool (not strictly used in skeleton)
const pool = new Pool({ connectionString: DATABASE_URL })

// Jobs (reminders)
const connection = new IORedis(REDIS_URL)
const reminderQueue = new Queue('reminders', { connection })

const app = express()
app.use(cors())
app.use(express.json())

// Health
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    await connection.ping()
    res.json({ ok: true, service: 'api', db: 'ok', redis: 'ok' })
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message })
  }
})

// Tickets (stubs)
app.get('/tickets', async (_req, res) => {
  res.json({ items: [], total: 0 })
})

app.post('/tickets', async (req, res) => {
  const schema = z.object({
    customerPhone: z.string(),
    device: z.string(),
    issue: z.string(),
    estimate: z.number().optional()
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })
  // TODO: insert into DB
  res.status(201).json({ id: 'TICKET-001', ...parsed.data, status: 'DROPPED_OFF' })
})

// Sales (stubs)
app.get('/sales', async (_req, res) => {
  res.json({ items: [], total: 0 })
})

// Jobs: schedule SOP reminders 1/20/30 days (stub)
app.post('/jobs/reminders', async (req, res) => {
  const schema = z.object({ ticketId: z.string() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })
  const { ticketId } = parsed.data
  await reminderQueue.add('reminder-1d', { ticketId }, { delay: 24 * 60 * 60 * 1000 })
  await reminderQueue.add('reminder-20d', { ticketId }, { delay: 20 * 24 * 60 * 60 * 1000 })
  await reminderQueue.add('reminder-30d', { ticketId }, { delay: 30 * 24 * 60 * 60 * 1000 })
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`[api] running on :${PORT}`)
})
