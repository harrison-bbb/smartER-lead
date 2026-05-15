import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { templates } from '../db/schema.js'
import { requireAuth, auth } from '../middleware/auth.js'

export const templatesRouter: ExpressRouter = Router()
templatesRouter.use(requireAuth)

const templateSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
})

templatesRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const rows = await db.select().from(templates).where(eq(templates.userId, userId))
  res.json({ data: rows })
})

templatesRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const parse = templateSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const [tmpl] = await db.insert(templates).values({ userId, ...parse.data }).returning()
  res.status(201).json({ data: tmpl })
})

templatesRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const parse = templateSchema.partial().safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const [tmpl] = await db
    .update(templates)
    .set({ ...parse.data, updatedAt: new Date() })
    .where(and(eq(templates.id, req.params.id), eq(templates.userId, userId)))
    .returning()
  if (!tmpl) {
    res.status(404).json({ error: 'Template not found' })
    return
  }
  res.json({ data: tmpl })
})

templatesRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(templates).where(and(eq(templates.id, req.params.id), eq(templates.userId, userId)))
  res.json({ data: { ok: true } })
})
