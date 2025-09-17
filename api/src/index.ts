import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { z } from 'zod'
import { Pool, PoolClient } from 'pg'

const PORT = parseInt(process.env.PORT || '8080', 10)
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379'
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:app@db:5432/app'

const TICKET_STATUSES = [
  'DROPPED_OFF',
  'DIAGNOSING',
  'WAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'IN_REPAIR',
  'READY',
  'WAITING_PICKUP',
  'CLOSED'
] as const

const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER'] as const

const pool = new Pool({ connectionString: DATABASE_URL })

const connection = new IORedis(REDIS_URL)
const reminderQueue = new Queue('reminders', { connection })

const app = express()
app.use(cors())
app.use(express.json())

type CustomerRecord = {
  id: number
  name: string
  phone: string
  email: string | null
  createdAt: string
}

type CustomerJson = {
  id: number | null
  name: string | null
  phone: string | null
  email: string | null
}

type CustomerSummary = {
  id: number
  name: string
  phone: string
  email: string | null
}

type TicketQueryRow = {
  id: number
  ticketCode: string
  device: string
  issue: string
  status: string
  estimate: string | number | null
  notes: string
  createdAt: string
  updatedAt: string
  customer: CustomerJson | null
}

type TicketUpdateRow = {
  id: number
  message: string
  createdAt: string
}

type TicketListItem = Omit<TicketQueryRow, 'estimate' | 'customer'> & {
  estimate: number | null
  customer: CustomerSummary | null
}

type TicketWithUpdates = TicketListItem & {
  updates: TicketUpdateRow[]
}

type ProductRow = {
  id: number
  sku: string
  name: string
  price: string | number
  stock: number
  createdAt: string
  updatedAt: string
}

type SaleItemRow = {
  id: number | null
  productId: number | null
  quantity: number
  unitPrice: string | number
  lineTotal: string | number
}

type SaleRow = {
  id: number
  invoiceNumber: string
  total: string | number
  paymentMethod: string
  createdAt: string
  customer: CustomerJson | null
  items: SaleItemRow[]
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      ticket_code TEXT UNIQUE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      device TEXT NOT NULL,
      issue TEXT NOT NULL,
      estimate NUMERIC(12,2),
      status TEXT NOT NULL DEFAULT 'DROPPED_OFF',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ticket_updates (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE,
      name TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      invoice_number TEXT UNIQUE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      total NUMERIC(12,2) NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL,
      unit_price NUMERIC(12,2) NOT NULL,
      line_total NUMERIC(12,2) NOT NULL
    );
  `)
}

async function seedInitialData() {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM products')
    if (rows[0]?.count === '0') {
      await client.query(
        `INSERT INTO products (sku, name, price, stock) VALUES
          ('SRV-DIAG', 'Diagnostic Service', 80.00, 100),
          ('PRT-BATT', 'Laptop Battery', 280.00, 20),
          ('PRT-SCRN', '14" IPS Screen', 520.00, 10),
          ('ACC-BAG', 'Waterproof Laptop Bag', 95.00, 35)
        ON CONFLICT (sku) DO NOTHING`
      )
    }
  } finally {
    client.release()
  }
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null
  if (typeof value === 'number') return value
  return Number(value)
}

function padId(prefix: string, value: number): string {
  return `${prefix}-${value.toString().padStart(5, '0')}`
}

function normaliseCustomerSummary(input: CustomerJson | null): CustomerSummary | null {
  if (!input || input.id == null) return null
  return {
    id: input.id,
    name: input.name ?? '',
    phone: input.phone ?? '',
    email: input.email
  }
}

async function upsertCustomer(
  client: PoolClient,
  customer: { name: string; phone: string; email?: string | null }
): Promise<CustomerRecord> {
  const { rows } = await client.query<CustomerRecord>(
    `INSERT INTO customers (name, phone, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET
       name = EXCLUDED.name,
       email = COALESCE(EXCLUDED.email, customers.email)
     RETURNING id, name, phone, email, created_at AS "createdAt"`,
    [customer.name, customer.phone, customer.email ?? null]
  )
  return rows[0]
}

async function getTicketById(client: PoolClient, id: number): Promise<TicketWithUpdates | null> {
  const ticketRes = await client.query<TicketQueryRow>(
    `SELECT
        t.id,
        t.ticket_code AS "ticketCode",
        t.device,
        t.issue,
        t.status,
        t.estimate,
        t.notes,
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        json_build_object(
          'id', c.id,
          'name', c.name,
          'phone', c.phone,
          'email', c.email
        ) AS customer
     FROM tickets t
     LEFT JOIN customers c ON c.id = t.customer_id
     WHERE t.id = $1`,
    [id]
  )

  if (ticketRes.rowCount === 0) {
    return null
  }

  const updatesRes = await client.query<TicketUpdateRow>(
    `SELECT id, message, created_at AS "createdAt"
       FROM ticket_updates
      WHERE ticket_id = $1
      ORDER BY created_at ASC`,
    [id]
  )

  const ticket = ticketRes.rows[0]
  return {
    ...ticket,
    estimate: toNumber(ticket.estimate),
    customer: normaliseCustomerSummary(ticket.customer),
    updates: updatesRes.rows
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    await connection.ping()
    res.json({ ok: true, service: 'api', db: 'ok', redis: 'ok' })
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message })
  }
})

app.get('/customers', async (_req, res) => {
  const { rows } = await pool.query<CustomerRecord>(
    `SELECT id, name, phone, email, created_at AS "createdAt"
       FROM customers
      ORDER BY created_at DESC`
  )
  res.json({ items: rows, total: rows.length })
})

app.get('/tickets', async (req, res) => {
  const status = req.query.status as string | undefined
  const statusFilter = status && TICKET_STATUSES.includes(status as any) ? status : null
  const { rows } = await pool.query<TicketQueryRow>(
    `SELECT
        t.id,
        t.ticket_code AS "ticketCode",
        t.device,
        t.issue,
        t.status,
        t.estimate,
        t.notes,
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        json_build_object(
          'id', c.id,
          'name', c.name,
          'phone', c.phone,
          'email', c.email
        ) AS customer
     FROM tickets t
     LEFT JOIN customers c ON c.id = t.customer_id
     WHERE ($1::text IS NULL OR t.status = $1)
     ORDER BY t.created_at DESC`,
    [statusFilter]
  )

  const items: TicketListItem[] = rows.map((row) => ({
    ...row,
    estimate: toNumber(row.estimate),
    customer: normaliseCustomerSummary(row.customer)
  }))

  res.json({ items, total: items.length })
})

app.get('/tickets/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid ticket id' })

  const client = await pool.connect()
  try {
    const ticket = await getTicketById(client, id)
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
    res.json(ticket)
  } finally {
    client.release()
  }
})

app.post('/tickets', async (req, res) => {
  const schema = z.object({
    customer: z.object({
      name: z.string().min(1),
      phone: z.string().min(3),
      email: z.string().email().optional()
    }),
    device: z.string().min(1),
    issue: z.string().min(1),
    estimate: z.number().nonnegative().optional(),
    notes: z.string().optional()
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })

  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const customer = await upsertCustomer(client, parsed.data.customer)
    const insertTicket = await client.query(
      `INSERT INTO tickets (customer_id, device, issue, estimate, status, notes)
       VALUES ($1, $2, $3, $4, 'DROPPED_OFF', $5)
       RETURNING id`,
      [customer.id, parsed.data.device, parsed.data.issue, parsed.data.estimate ?? null, parsed.data.notes ?? '']
    )

    const ticketId = insertTicket.rows[0].id as number
    const ticketCode = padId('T', ticketId)
    await client.query(`UPDATE tickets SET ticket_code = $1 WHERE id = $2`, [ticketCode, ticketId])
    await client.query('COMMIT')
    committed = true

    await Promise.all([
      reminderQueue.add('reminder-1d', { ticketId }, { delay: 24 * 60 * 60 * 1000 }),
      reminderQueue.add('reminder-20d', { ticketId }, { delay: 20 * 24 * 60 * 60 * 1000 }),
      reminderQueue.add('reminder-30d', { ticketId }, { delay: 30 * 24 * 60 * 60 * 1000 })
    ]).catch((error) => console.error('Failed to schedule reminders', error))

    const ticket = await getTicketById(client, ticketId)
    res.status(201).json(ticket)
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK')
    }
    res.status(500).json({ error: (error as Error).message })
  } finally {
    client.release()
  }
})

app.patch('/tickets/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid ticket id' })

  const schema = z.object({
    status: z.enum(TICKET_STATUSES).optional(),
    estimate: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    addUpdate: z.string().min(1).optional()
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })

  if (!parsed.data.status && parsed.data.estimate === undefined && parsed.data.notes === undefined && !parsed.data.addUpdate) {
    return res.status(400).json({ error: 'No changes provided' })
  }

  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    if (parsed.data.status) {
      fields.push(`status = $${idx++}`)
      values.push(parsed.data.status)
    }
    if (parsed.data.estimate !== undefined) {
      fields.push(`estimate = $${idx++}`)
      values.push(parsed.data.estimate)
    }
    if (parsed.data.notes !== undefined) {
      fields.push(`notes = $${idx++}`)
      values.push(parsed.data.notes)
    }
    fields.push(`updated_at = now()`)

    values.push(id)
    const updateQuery = `UPDATE tickets SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`
    const result = await client.query(updateQuery, values)
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Ticket not found' })
    }

    if (parsed.data.addUpdate) {
      await client.query(
        `INSERT INTO ticket_updates (ticket_id, message) VALUES ($1, $2)`,
        [id, parsed.data.addUpdate]
      )
    }

    await client.query('COMMIT')
    committed = true
    const ticket = await getTicketById(client, id)
    res.json(ticket)
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK')
    }
    res.status(500).json({ error: (error as Error).message })
  } finally {
    client.release()
  }
})

app.get('/products', async (_req, res) => {
  const { rows } = await pool.query<ProductRow>(
    `SELECT id, sku, name, price, stock, created_at AS "createdAt", updated_at AS "updatedAt" FROM products ORDER BY name ASC`
  )
  const items = rows.map((row) => ({
    ...row,
    price: Number(row.price)
  }))
  res.json({ items, total: items.length })
})

app.post('/products', async (req, res) => {
  const schema = z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    price: z.number().nonnegative(),
    stock: z.number().int().nonnegative()
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })

  try {
    const { rows } = await pool.query<ProductRow>(
      `INSERT INTO products (sku, name, price, stock)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO UPDATE SET
         name = EXCLUDED.name,
         price = EXCLUDED.price,
         stock = EXCLUDED.stock,
         updated_at = now()
       RETURNING id, sku, name, price, stock, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [parsed.data.sku, parsed.data.name, parsed.data.price, parsed.data.stock]
    )
    const product = rows[0]
    res.status(201).json({ ...product, price: Number(product.price) })
  } catch (error) {
    res.status(500).json({ error: (error as Error).message })
  }
})

app.patch('/products/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid product id' })

  const schema = z.object({
    name: z.string().min(1).optional(),
    price: z.number().nonnegative().optional(),
    stock: z.number().int().nonnegative().optional()
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })

  if (parsed.data.name === undefined && parsed.data.price === undefined && parsed.data.stock === undefined) {
    return res.status(400).json({ error: 'No changes provided' })
  }

  const fields: string[] = []
  const values: any[] = []
  let idx = 1
  if (parsed.data.name !== undefined) {
    fields.push(`name = $${idx++}`)
    values.push(parsed.data.name)
  }
  if (parsed.data.price !== undefined) {
    fields.push(`price = $${idx++}`)
    values.push(parsed.data.price)
  }
  if (parsed.data.stock !== undefined) {
    fields.push(`stock = $${idx++}`)
    values.push(parsed.data.stock)
  }
  fields.push(`updated_at = now()`)
  values.push(id)

  const updateQuery = `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, sku, name, price, stock, created_at AS "createdAt", updated_at AS "updatedAt"`
  const { rowCount, rows } = await pool.query<ProductRow>(updateQuery, values)
  if (rowCount === 0) return res.status(404).json({ error: 'Product not found' })

  const product = rows[0]
  res.json({ ...product, price: Number(product.price) })
})

app.get('/sales', async (_req, res) => {
  const { rows } = await pool.query<SaleRow>(
    `SELECT
        s.id,
        s.invoice_number AS "invoiceNumber",
        s.total,
        s.payment_method AS "paymentMethod",
        s.created_at AS "createdAt",
        json_build_object(
          'id', c.id,
          'name', c.name,
          'phone', c.phone,
          'email', c.email
        ) AS customer,
        COALESCE(
          json_agg(
            json_build_object(
              'id', si.id,
              'productId', si.product_id,
              'quantity', si.quantity,
              'unitPrice', si.unit_price,
              'lineTotal', si.line_total
            )
            ORDER BY si.id
          ) FILTER (WHERE si.id IS NOT NULL),
          '[]'::json
        ) AS items
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN sale_items si ON si.sale_id = s.id
     GROUP BY s.id, c.id
     ORDER BY s.created_at DESC`
  )

  const items = rows.map((row) => {
    const rawItems: SaleItemRow[] = Array.isArray(row.items) ? row.items : []
    return {
      ...row,
      total: toNumber(row.total),
      customer: normaliseCustomerSummary(row.customer),
      items: rawItems.map((item) => ({
        ...item,
        unitPrice: toNumber(item.unitPrice),
        lineTotal: toNumber(item.lineTotal)
      }))
    }
  })

  res.json({ items, total: items.length })
})

app.post('/sales', async (req, res) => {
  const schema = z.object({
    paymentMethod: z.enum(PAYMENT_METHODS),
    customer: z
      .object({
        name: z.string().min(1),
        phone: z.string().min(3),
        email: z.string().email().optional()
      })
      .optional(),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().positive()
        })
      )
      .min(1)
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })

  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')

    let customerRecord: CustomerRecord | null = null
    if (parsed.data.customer) {
      customerRecord = await upsertCustomer(client, parsed.data.customer)
    }

    const itemDetails: { productId: number; quantity: number; unitPrice: number; lineTotal: number }[] = []
    let total = 0

    for (const item of parsed.data.items) {
      const productRes = await client.query(
        `SELECT id, price, stock FROM products WHERE id = $1 FOR UPDATE`,
        [item.productId]
      )
      if (productRes.rowCount === 0) {
        throw new Error(`Product ${item.productId} not found`)
      }

      const product = productRes.rows[0]
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`)
      }

      const unitPrice = Number(product.price)
      const lineTotal = unitPrice * item.quantity
      total += lineTotal

      itemDetails.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        lineTotal
      })

      await client.query(`UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2`, [item.quantity, item.productId])
    }

    const saleRes = await client.query(
      `INSERT INTO sales (customer_id, total, payment_method)
       VALUES ($1, $2, $3)
       RETURNING id, created_at AS "createdAt"`,
      [customerRecord ? customerRecord.id : null, total, parsed.data.paymentMethod]
    )

    const saleId = saleRes.rows[0].id as number
    const invoiceNumber = padId(`INV-${new Date().getFullYear()}`, saleId)
    await client.query(`UPDATE sales SET invoice_number = $1 WHERE id = $2`, [invoiceNumber, saleId])

    for (const detail of itemDetails) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [saleId, detail.productId, detail.quantity, detail.unitPrice, detail.lineTotal]
      )
    }

    await client.query('COMMIT')
    committed = true

    const sale = {
      id: saleId,
      invoiceNumber,
      paymentMethod: parsed.data.paymentMethod,
      total,
      createdAt: saleRes.rows[0].createdAt,
      customer: customerRecord,
      items: itemDetails
    }

    res.status(201).json(sale)
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK')
    }
    res.status(400).json({ error: (error as Error).message })
  } finally {
    client.release()
  }
})

app.post('/jobs/reminders', async (req, res) => {
  const schema = z.object({ ticketId: z.number().int().positive() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.format() })
  const { ticketId } = parsed.data
  await reminderQueue.add('reminder-1d', { ticketId }, { delay: 24 * 60 * 60 * 1000 })
  await reminderQueue.add('reminder-20d', { ticketId }, { delay: 20 * 24 * 60 * 60 * 1000 })
  await reminderQueue.add('reminder-30d', { ticketId }, { delay: 30 * 24 * 60 * 60 * 1000 })
  res.json({ ok: true })
})

async function bootstrap() {
  await initDb()
  await seedInitialData()
  app.listen(PORT, () => {
    console.log(`[api] running on :${PORT}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap API', error)
  process.exit(1)
})
