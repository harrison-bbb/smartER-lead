import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and, ilike, sql } from 'drizzle-orm'
import multer from 'multer'
import { parse } from 'csv-parse/sync'
import { db } from '../db/index.js'
import { leads } from '../db/schema.js'
import { requireAuth, auth, type AuthRequest } from '../middleware/auth.js'

export const leadsRouter: ExpressRouter = Router()
leadsRouter.use(requireAuth)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const leadSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  customFields: z.record(z.string()).optional().default({}),
})

leadsRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const page = parseInt(req.query.page as string ?? '1')
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string ?? '50'))
  const search = req.query.search as string | undefined

  const offset = (page - 1) * pageSize
  const where = search
    ? and(eq(leads.userId, userId), ilike(leads.email, `%${search}%`))
    : eq(leads.userId, userId)

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(leads).where(where).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(leads).where(where),
  ])

  res.json({ data: rows, total: count, page, pageSize })
})

leadsRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const parse2 = leadSchema.safeParse(req.body)
  if (!parse2.success) {
    res.status(400).json({ error: 'Validation failed', details: parse2.error.flatten() })
    return
  }
  const [lead] = await db.insert(leads).values({ userId, ...parse2.data }).returning()
  res.status(201).json({ data: lead })
})

leadsRouter.get('/:id', async (req, res) => {
  const { userId } = auth(req)
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, req.params.id), eq(leads.userId, userId)))
    .limit(1)
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' })
    return
  }
  res.json({ data: lead })
})

leadsRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const parse2 = leadSchema.partial().safeParse(req.body)
  if (!parse2.success) {
    res.status(400).json({ error: 'Validation failed', details: parse2.error.flatten() })
    return
  }
  const [lead] = await db
    .update(leads)
    .set({ ...parse2.data, updatedAt: new Date() })
    .where(and(eq(leads.id, req.params.id), eq(leads.userId, userId)))
    .returning()
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' })
    return
  }
  res.json({ data: lead })
})

leadsRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(leads).where(and(eq(leads.id, req.params.id), eq(leads.userId, userId)))
  res.json({ data: { ok: true } })
})

// ─── CSV Import ───────────────────────────────────────────────────────────────

const importSchema = z.object({
  // JSON stringified column mapping: { csvHeader: leadField }
  mapping: z.string(),
  listId: z.string().uuid().optional(),
})

leadsRouter.post('/import', upload.single('file'), async (req, res) => {
  const { userId } = auth(req)

  if (!req.file) {
    res.status(400).json({ error: 'CSV file required' })
    return
  }

  const parse2 = importSchema.safeParse(req.body)
  if (!parse2.success) {
    res.status(400).json({ error: 'mapping field required' })
    return
  }

  let mapping: Record<string, string>
  try {
    mapping = JSON.parse(parse2.data.mapping) as Record<string, string>
  } catch {
    res.status(400).json({ error: 'mapping must be valid JSON' })
    return
  }

  const records = parse(req.file.buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  const LEAD_FIELDS = new Set(['email', 'firstName', 'lastName', 'company', 'title', 'phone', 'website'])
  const toInsert: (typeof leads.$inferInsert)[] = []

  for (const row of records) {
    const leadData: Record<string, string> = {}
    const customFields: Record<string, string> = {}

    for (const [csvCol, leadField] of Object.entries(mapping)) {
      if (row[csvCol] === undefined) continue
      if (LEAD_FIELDS.has(leadField)) {
        leadData[leadField] = row[csvCol]
      } else {
        customFields[leadField] = row[csvCol]
      }
    }

    if (!leadData.email) continue

    toInsert.push({
      userId,
      email: leadData.email,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      company: leadData.company,
      title: leadData.title,
      phone: leadData.phone,
      website: leadData.website,
      customFields,
    })
  }

  // Upsert in batches of 500, skip duplicates
  let imported = 0
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500)
    const result = await db
      .insert(leads)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: leads.id })
    imported += result.length
  }

  // Optionally add to list — only the leads from this import batch, not all user leads
  if (parse2.data.listId) {
    const { listLeads } = await import('../db/schema.js')
    const importedIds: string[] = []
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500)
      const rows = await db.select({ id: leads.id }).from(leads)
        .where(and(eq(leads.userId, userId), sql`${leads.email} = ANY(ARRAY[${sql.join(batch.map(l => sql`${l.email}`), sql`, `)}])`))
      importedIds.push(...rows.map(r => r.id))
    }

    const listEntries = importedIds.map((id) => ({
      listId: parse2.data.listId!,
      leadId: id,
    }))

    for (let i = 0; i < listEntries.length; i += 500) {
      await db.insert(listLeads).values(listEntries.slice(i, i + 500)).onConflictDoNothing()
    }
  }

  res.json({ data: { imported, total: records.length } })
})

// Preview CSV headers without importing
leadsRouter.post('/import/preview', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'CSV file required' })
    return
  }

  const records = parse(req.file.buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    to: 3,
  }) as Record<string, string>[]

  const headers = records.length > 0 ? Object.keys(records[0]) : []
  res.json({ data: { headers, preview: records } })
})
