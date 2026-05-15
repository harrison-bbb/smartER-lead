import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { blocklist } from '../db/schema.js'
import { requireAuth, auth } from '../middleware/auth.js'

export const blocklistRouter: ExpressRouter = Router()
blocklistRouter.use(requireAuth)

const entrySchema = z.object({
  value: z.string().min(1).toLowerCase().trim(),
  type: z.enum(['email', 'domain']),
})

blocklistRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const rows = await db.select().from(blocklist).where(eq(blocklist.userId, userId))
  res.json({ data: rows })
})

blocklistRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const parse = entrySchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const [entry] = await db
    .insert(blocklist)
    .values({ userId, ...parse.data })
    .onConflictDoNothing()
    .returning()
  res.status(201).json({ data: entry })
})

blocklistRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(blocklist).where(and(eq(blocklist.id, req.params.id), eq(blocklist.userId, userId)))
  res.json({ data: { ok: true } })
})
