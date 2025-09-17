import React, { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const BOT_URL = import.meta.env.VITE_BOT_URL || 'http://localhost:8081'

export default function App() {
  const [apiHealth, setApiHealth] = useState<string>('checking...')
  const [qrStatus, setQrStatus] = useState<'pending'|'scan'|'connected'|'error'>('pending')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  useEffect(() => {
    fetch(`${API_URL}/health`).then(r => r.json()).then(d => {
      setApiHealth(d.ok ? 'ok' : 'error')
    }).catch(() => setApiHealth('error'))
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${BOT_URL}/qr`)
        const d = await r.json()
        if (d.status === 'scan') { setQrStatus('scan'); setQrDataUrl(d.qrDataUrl) }
        else if (d.status === 'connected') { setQrStatus('connected') }
        else { setQrStatus('pending') }
      } catch {
        setQrStatus('error')
      }
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>📊 LaptopPro Dashboard (Skeleton)</h1>
      <p>API health: <b>{apiHealth}</b></p>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
        <h2>🤝 WhatsApp Pairing</h2>
        {qrStatus === 'scan' && (
          <div>
            <p>Imbas QR di bawah menggunakan WhatsApp (Linked Devices):</p>
            <img src={qrDataUrl} style={{ width: 280, height: 280 }} />
          </div>
        )}
        {qrStatus === 'connected' && <p>Status: <b style={{ color: 'green' }}>Connected</b></p>}
        {qrStatus === 'pending' && <p>Sedia untuk pairing... (menunggu QR)</p>}
        {qrStatus === 'error' && <p style={{ color: 'crimson' }}>Tidak dapat capai servis bot.</p>}
      </section>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
        <h2>🧾 Quick Links</h2>
        <ul>
          <li><a href={`${API_URL}/health`} target="_blank">/api/health</a></li>
          <li><a href={`${BOT_URL}/health`} target="_blank">/bot/health</a></li>
          <li><a href={`${BOT_URL}/qr`} target="_blank">/bot/qr</a></li>
        </ul>
      </section>

      <footer style={{ marginTop: 32, color: '#666' }}>
        <small>Skeleton UI • React + Vite</small>
      </footer>
    </div>
  )
}
