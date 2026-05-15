import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { lists, listLeads, leads } from '../db/schema.js'
import { requireAuth, auth, type AuthRequest } from '../middleware/auth.js'

export const listsRouter: ExpressRouter = Router()
listsRouter.use(requireAuth)

listsRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const rows = await db
    .select({
      id: lists.id,
      userId: lists.userId,
      name: lists.name,
      createdAt: lists.createdAt,
      leadCount: sql<number>`count(${listLeads.id})::int`,
    })
    .from(lists)
    .leftJoin(listLeads, eq(listLeads.listId, lists.id))
    .where(eq(lists.userId, userId))
    .groupBy(lists.id)
  res.json({ data: rows })
})

listsRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
  const [list] = await db.insert(lists).values({ userId, name }).returning()
  res.status(201).json({ data: { ...list, leadCount: 0 } })
})

listsRouter.get('/:id/leads', async (req, res) => {
  const { userId } = auth(req)
  const page = parseInt(req.query.page as string ?? '1')
  const pageSize = parseInt(req.query.pageSize as string ?? '50')

  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, req.params.id), eq(lists.userId, userId)))
    .limit(1)
  if (!list) {
    res.status(404).json({ error: 'List not found' })
    return
  }

  const offset = (page - 1) * pageSize
  const rows = await db
    .select({ lead: leads })
    .from(listLeads)
    .innerJoin(leads, eq(leads.id, listLeads.leadId))
    .where(eq(listLeads.listId, req.params.id))
    .limit(pageSize)
    .offset(offset)

  res.json({ data: rows.map((r) => r.lead), page, pageSize })
})

listsRouter.post('/:id/leads', async (req, res) => {
  const { userId } = auth(req)
  const { leadIds } = z.object({ leadIds: z.array(z.string().uuid()) }).parse(req.body)

  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, req.params.id), eq(lists.userId, userId)))
    .limit(1)
  if (!list) {
    res.status(404).json({ error: 'List not found' })
    return
  }

  // Verify all leadIds belong to this user before inserting
  const ownedLeads = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.userId, userId), inArray(leads.id, leadIds)))
  const ownedIds = ownedLeads.map((l) => l.id)

  if (ownedIds.length > 0) {
    await db
      .insert(listLeads)
      .values(ownedIds.map((leadId) => ({ listId: list.id, leadId })))
      .onConflictDoNothing()
  }

  res.json({ data: { ok: true } })
})

listsRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(lists).where(and(eq(lists.id, req.params.id), eq(lists.userId, userId)))
  res.json({ data: { ok: true } })
})

listsRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
  const [list] = await db
    .update(lists)
    .set({ name })
    .where(and(eq(lists.id, req.params.id), eq(lists.userId, userId)))
    .returning()
  if (!list) {
    res.status(404).json({ error: 'List not found' })
    return
  }
  res.json({ data: list })
})
