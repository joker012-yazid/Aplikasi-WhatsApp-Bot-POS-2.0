import React, { FormEvent, useEffect, useMemo, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const BOT_URL = import.meta.env.VITE_BOT_URL || 'http://localhost:8081'

type Customer = {
  id: number
  name: string
  phone: string
  email?: string | null
}

type Ticket = {
  id: number
  ticketCode: string
  status: string
  device: string
  issue: string
  estimate: number | null
  notes: string
  createdAt: string
  updatedAt: string
  customer: Customer | null
}

type Product = {
  id: number
  sku: string
  name: string
  price: number
  stock: number
}

type SaleItem = {
  id?: number
  productId: number | null
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
}

type Sale = {
  id: number
  invoiceNumber: string
  paymentMethod: string
  total: number
  createdAt: string
  customer: Customer | null
  items: SaleItem[]
}

type Flash = { type: 'success' | 'error'; message: string }

const statusLabels: Record<string, string> = {
  DROPPED_OFF: 'Dropped-off',
  DIAGNOSING: 'Diagnosing',
  WAITING_APPROVAL: 'Waiting Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  IN_REPAIR: 'In Repair',
  READY: 'Ready for Pickup',
  WAITING_PICKUP: 'Waiting Pickup',
  CLOSED: 'Closed'
}

const paymentLabels: Record<string, string> = {
  CASH: 'Tunai',
  CARD: 'Kad',
  TRANSFER: 'Transfer'
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ms-MY')
}

function buildErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Unknown error'
}

export default function App() {
  const [apiHealth, setApiHealth] = useState<string>('checking...')
  const [qrStatus, setQrStatus] = useState<'pending' | 'scan' | 'connected' | 'error'>('pending')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [flash, setFlash] = useState<Flash | null>(null)
  const [ticketForm, setTicketForm] = useState({
    name: '',
    phone: '',
    email: '',
    device: '',
    issue: '',
    estimate: '',
    notes: ''
  })
  const [productForm, setProductForm] = useState({ sku: '', name: '', price: '', stock: '' })
  const [saleForm, setSaleForm] = useState({ paymentMethod: 'CASH', customerName: '', customerPhone: '', customerEmail: '' })
  const [saleItems, setSaleItems] = useState<Array<{ productId: string; quantity: number }>>([
    { productId: '', quantity: 1 }
  ])
  const currency = useMemo(() => new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' }), [])

  function showFlash(message: string, type: Flash['type'] = 'success') {
    setFlash({ type, message })
    window.setTimeout(() => setFlash(null), 4000)
  }

  async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init)
    let data: any = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const message = data?.error || res.statusText || 'Request failed'
      throw new Error(message)
    }
    return data as T
  }

  useEffect(() => {
    fetchJson<{ ok: boolean }>(`${API_URL}/health`)
      .then((d) => setApiHealth(d.ok ? 'ok' : 'error'))
      .catch(() => setApiHealth('error'))
  }, [])

  useEffect(() => {
    const poll = async () => {
      try {
        const d = await fetchJson<{ status: string; qrDataUrl?: string }>(`${BOT_URL}/qr`)
        if (d.status === 'scan') {
          setQrStatus('scan')
          setQrDataUrl(d.qrDataUrl || '')
        } else if (d.status === 'connected') {
          setQrStatus('connected')
        } else {
          setQrStatus('pending')
        }
      } catch {
        setQrStatus('error')
      }
    }
    poll()
    const id = window.setInterval(poll, 5000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    loadTickets()
    loadProducts()
    loadSales()
  }, [])

  async function loadTickets() {
    try {
      const data = await fetchJson<{ items: Ticket[] }>(`${API_URL}/tickets`)
      setTickets(data.items ?? [])
    } catch (error) {
      showFlash(`Gagal memuat tiket: ${buildErrorMessage(error)}`, 'error')
    }
  }

  async function loadProducts() {
    try {
      const data = await fetchJson<{ items: Product[] }>(`${API_URL}/products`)
      setProducts(data.items ?? [])
    } catch (error) {
      showFlash(`Gagal memuat produk: ${buildErrorMessage(error)}`, 'error')
    }
  }

  async function loadSales() {
    try {
      const data = await fetchJson<{ items: Sale[] }>(`${API_URL}/sales`)
      setSales(data.items ?? [])
    } catch (error) {
      showFlash(`Gagal memuat jualan: ${buildErrorMessage(error)}`, 'error')
    }
  }

  async function submitTicket(e: FormEvent) {
    e.preventDefault()
    try {
      const payload = {
        customer: {
          name: ticketForm.name.trim(),
          phone: ticketForm.phone.trim(),
          email: ticketForm.email.trim() || undefined
        },
        device: ticketForm.device.trim(),
        issue: ticketForm.issue.trim(),
        estimate: ticketForm.estimate ? Number(ticketForm.estimate) : undefined,
        notes: ticketForm.notes.trim() || undefined
      }
      await fetchJson(`${API_URL}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      showFlash('Tiket baharu berjaya dicipta.')
      setTicketForm({ name: '', phone: '', email: '', device: '', issue: '', estimate: '', notes: '' })
      loadTickets()
    } catch (error) {
      showFlash(`Gagal cipta tiket: ${buildErrorMessage(error)}`, 'error')
    }
  }

  async function submitProduct(e: FormEvent) {
    e.preventDefault()
    try {
      const payload = {
        sku: productForm.sku.trim(),
        name: productForm.name.trim(),
        price: Number(productForm.price || 0),
        stock: Number(productForm.stock || 0)
      }
      await fetchJson(`${API_URL}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      showFlash('Produk dikemaskini.')
      setProductForm({ sku: '', name: '', price: '', stock: '' })
      loadProducts()
    } catch (error) {
      showFlash(`Gagal simpan produk: ${buildErrorMessage(error)}`, 'error')
    }
  }

  async function submitSale(e: FormEvent) {
    e.preventDefault()
    const validItems = saleItems.filter((item) => item.productId && item.quantity > 0)
    if (validItems.length === 0) {
      showFlash('Sila tambah sekurang-kurangnya satu item jualan.', 'error')
      return
    }
    try {
      const payload: any = {
        paymentMethod: saleForm.paymentMethod,
        items: validItems.map((item) => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity)
        }))
      }
      if (saleForm.customerName && saleForm.customerPhone) {
        payload.customer = {
          name: saleForm.customerName.trim(),
          phone: saleForm.customerPhone.trim(),
          email: saleForm.customerEmail.trim() || undefined
        }
      }
      await fetchJson(`${API_URL}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      showFlash('Transaksi POS direkodkan.')
      setSaleForm({ paymentMethod: 'CASH', customerName: '', customerPhone: '', customerEmail: '' })
      setSaleItems([{ productId: '', quantity: 1 }])
      loadProducts()
      loadSales()
    } catch (error) {
      showFlash(`Gagal rekod jualan: ${buildErrorMessage(error)}`, 'error')
    }
  }

  const salePreviewTotal = useMemo(() => {
    return saleItems.reduce((total, item) => {
      const product = products.find((p) => p.id === Number(item.productId))
      if (!product) return total
      return total + product.price * item.quantity
    }, 0)
  }, [saleItems, products])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>📊 LaptopPro Control Center</h1>
      <p>API health: <b>{apiHealth}</b></p>

      {flash && (
        <div
          style={{
            marginTop: 12,
            padding: '12px 16px',
            borderRadius: 12,
            background: flash.type === 'success' ? '#e7f7ef' : '#fdecea',
            color: flash.type === 'success' ? '#065f46' : '#b91c1c'
          }}
        >
          {flash.message}
        </div>
      )}

      <div style={{ display: 'grid', gap: 24, marginTop: 24 }}>
        <section style={{ padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
          <h2>🤝 WhatsApp Pairing</h2>
          {qrStatus === 'scan' && (
            <div>
              <p>Imbas QR di bawah menggunakan WhatsApp (Linked Devices):</p>
              <img src={qrDataUrl} style={{ width: 260, height: 260 }} />
            </div>
          )}
          {qrStatus === 'connected' && <p>Status: <b style={{ color: 'green' }}>Connected</b></p>}
          {qrStatus === 'pending' && <p>Sedia untuk pairing... (menunggu QR)</p>}
          {qrStatus === 'error' && <p style={{ color: 'crimson' }}>Tidak dapat capai servis bot.</p>}
        </section>

        <section style={{ padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
          <h2>🧾 Quick Links</h2>
          <ul>
            <li><a href={`${API_URL}/health`} target="_blank" rel="noreferrer">/api/health</a></li>
            <li><a href={`${BOT_URL}/health`} target="_blank" rel="noreferrer">/bot/health</a></li>
            <li><a href={`${BOT_URL}/qr`} target="_blank" rel="noreferrer">/bot/qr</a></li>
          </ul>
        </section>

        <section style={{ padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
          <h2>🎫 Tiket Servis</h2>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <form onSubmit={submitTicket} style={{ display: 'grid', gap: 8 }}>
              <h3>Cipta Tiket Baharu</h3>
              <label>
                Nama Pelanggan
                <input
                  value={ticketForm.name}
                  onChange={(e) => setTicketForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Telefon
                <input
                  value={ticketForm.phone}
                  onChange={(e) => setTicketForm((f) => ({ ...f, phone: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Emel (opsyenal)
                <input
                  type="email"
                  value={ticketForm.email}
                  onChange={(e) => setTicketForm((f) => ({ ...f, email: e.target.value }))}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Peranti
                <input
                  value={ticketForm.device}
                  onChange={(e) => setTicketForm((f) => ({ ...f, device: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Isu / Aduan
                <textarea
                  value={ticketForm.issue}
                  onChange={(e) => setTicketForm((f) => ({ ...f, issue: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4, minHeight: 60 }}
                />
              </label>
              <label>
                Anggaran (RM)
                <input
                  type="number"
                  min={0}
                  value={ticketForm.estimate}
                  onChange={(e) => setTicketForm((f) => ({ ...f, estimate: e.target.value }))}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Nota dalaman
                <textarea
                  value={ticketForm.notes}
                  onChange={(e) => setTicketForm((f) => ({ ...f, notes: e.target.value }))}
                  style={{ width: '100%', marginTop: 4, minHeight: 60 }}
                />
              </label>
              <button type="submit" style={{ marginTop: 8, padding: '10px 16px', borderRadius: 8, background: '#2563eb', color: 'white', border: 'none' }}>
                Simpan Tiket
              </button>
            </form>

            <div style={{ overflowX: 'auto' }}>
              <h3>Senarai Terkini</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                <thead>
                  <tr>
                    <th style={tableHeadStyle}>Kod</th>
                    <th style={tableHeadStyle}>Pelanggan</th>
                    <th style={tableHeadStyle}>Peranti</th>
                    <th style={tableHeadStyle}>Status</th>
                    <th style={tableHeadStyle}>Anggaran</th>
                    <th style={tableHeadStyle}>Kemaskini</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                        Tiada tiket direkodkan lagi.
                      </td>
                    </tr>
                  )}
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={tableCellStyle}>{ticket.ticketCode}</td>
                      <td style={tableCellStyle}>
                        {ticket.customer ? (
                          <div>
                            <div>{ticket.customer.name}</div>
                            <small style={{ color: '#6b7280' }}>{ticket.customer.phone}</small>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={tableCellStyle}>{ticket.device}</td>
                      <td style={tableCellStyle}>{statusLabels[ticket.status] ?? ticket.status}</td>
                      <td style={tableCellStyle}>{ticket.estimate != null ? currency.format(ticket.estimate) : '—'}</td>
                      <td style={tableCellStyle}>{formatDate(ticket.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
          <h2>📦 Produk & Inventori</h2>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <form onSubmit={submitProduct} style={{ display: 'grid', gap: 8 }}>
              <h3>Tambah / Kemaskini Produk</h3>
              <label>
                SKU
                <input
                  value={productForm.sku}
                  onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Nama
                <input
                  value={productForm.name}
                  onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Harga (RM)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={productForm.price}
                  onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <label>
                Stok
                <input
                  type="number"
                  min={0}
                  value={productForm.stock}
                  onChange={(e) => setProductForm((f) => ({ ...f, stock: e.target.value }))}
                  required
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <button type="submit" style={{ marginTop: 8, padding: '10px 16px', borderRadius: 8, background: '#2563eb', color: 'white', border: 'none' }}>
                Simpan Produk
              </button>
            </form>

            <div style={{ overflowX: 'auto' }}>
              <h3>Inventori Semasa</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                <thead>
                  <tr>
                    <th style={tableHeadStyle}>SKU</th>
                    <th style={tableHeadStyle}>Nama</th>
                    <th style={tableHeadStyle}>Harga</th>
                    <th style={tableHeadStyle}>Stok</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                        Tiada produk.
                      </td>
                    </tr>
                  )}
                  {products.map((product) => (
                    <tr key={product.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={tableCellStyle}>{product.sku}</td>
                      <td style={tableCellStyle}>{product.name}</td>
                      <td style={tableCellStyle}>{currency.format(product.price)}</td>
                      <td style={tableCellStyle}>{product.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid #ddd', borderRadius: 12 }}>
          <h2>💳 POS & Invois</h2>
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <form onSubmit={submitSale} style={{ display: 'grid', gap: 8 }}>
              <h3>Rekod Jualan</h3>
              <label>
                Cara Bayaran
                <select
                  value={saleForm.paymentMethod}
                  onChange={(e) => setSaleForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  style={{ width: '100%', marginTop: 4 }}
                >
                  <option value="CASH">Tunai</option>
                  <option value="CARD">Kad</option>
                  <option value="TRANSFER">FPX/Transfer</option>
                </select>
              </label>

              <details>
                <summary>Butiran pelanggan (opsyenal)</summary>
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  <label>
                    Nama
                    <input
                      value={saleForm.customerName}
                      onChange={(e) => setSaleForm((f) => ({ ...f, customerName: e.target.value }))}
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </label>
                  <label>
                    Telefon
                    <input
                      value={saleForm.customerPhone}
                      onChange={(e) => setSaleForm((f) => ({ ...f, customerPhone: e.target.value }))}
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </label>
                  <label>
                    Emel
                    <input
                      type="email"
                      value={saleForm.customerEmail}
                      onChange={(e) => setSaleForm((f) => ({ ...f, customerEmail: e.target.value }))}
                      style={{ width: '100%', marginTop: 4 }}
                    />
                  </label>
                </div>
              </details>

              <div>
                <h4 style={{ margin: '12px 0 4px' }}>Item</h4>
                {saleItems.map((item, index) => (
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 8, marginBottom: 8 }}>
                    <select
                      value={item.productId}
                      onChange={(e) =>
                        setSaleItems((items) =>
                          items.map((row, i) => (i === index ? { ...row, productId: e.target.value } : row))
                        )
                      }
                    >
                      <option value="">Pilih produk...</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({currency.format(product.price)})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setSaleItems((items) =>
                          items.map((row, i) =>
                            i === index ? { ...row, quantity: Number(e.target.value) || 1 } : row
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setSaleItems((items) => items.filter((_, i) => i !== index || items.length === 1))
                      }
                      style={{ border: '1px solid #ddd', borderRadius: 6, background: '#f3f4f6', padding: '4px 8px' }}
                    >
                      Buang
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSaleItems((items) => [...items, { productId: '', quantity: 1 }])}
                  style={{ border: '1px solid #ddd', borderRadius: 8, background: '#f9fafb', padding: '8px 12px' }}
                >
                  + Tambah Item
                </button>
              </div>

              <p style={{ marginTop: 12 }}>Jumlah anggaran: <strong>{currency.format(salePreviewTotal)}</strong></p>

              <button type="submit" style={{ marginTop: 8, padding: '10px 16px', borderRadius: 8, background: '#2563eb', color: 'white', border: 'none' }}>
                Simpan Transaksi
              </button>
            </form>

            <div style={{ overflowX: 'auto' }}>
              <h3>Rekod Jualan</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={tableHeadStyle}>Invois</th>
                    <th style={tableHeadStyle}>Pelanggan</th>
                    <th style={tableHeadStyle}>Tarikh</th>
                    <th style={tableHeadStyle}>Kaedah</th>
                    <th style={tableHeadStyle}>Jumlah</th>
                    <th style={tableHeadStyle}>Item</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#6b7280' }}>
                        Tiada transaksi lagi.
                      </td>
                    </tr>
                  )}
                  {sales.map((sale) => (
                    <tr key={sale.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={tableCellStyle}>{sale.invoiceNumber}</td>
                      <td style={tableCellStyle}>
                        {sale.customer ? (
                          <div>
                            <div>{sale.customer.name}</div>
                            <small style={{ color: '#6b7280' }}>{sale.customer.phone}</small>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={tableCellStyle}>{formatDate(sale.createdAt)}</td>
                      <td style={tableCellStyle}>{paymentLabels[sale.paymentMethod] ?? sale.paymentMethod}</td>
                      <td style={tableCellStyle}>{currency.format(sale.total)}</td>
                      <td style={tableCellStyle}>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {sale.items.map((item, index) => {
                            const product = products.find((p) => p.id === item.productId)
                            const fallback = item.productId ? `Produk #${item.productId}` : 'Produk tidak diketahui'
                            return (
                              <li key={index}>
                                {product ? product.name : fallback} × {item.quantity}
                              </li>
                            )
                          })}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 40, color: '#666', textAlign: 'center' }}>
        <small>POS + Tiket + Bot • React + Vite</small>
      </footer>
    </div>
  )
}

const tableHeadStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 13,
  color: '#4b5563',
  borderBottom: '1px solid #e5e7eb',
  background: '#f9fafb',
  fontWeight: 600
}

const tableCellStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'top',
  fontSize: 14
}
