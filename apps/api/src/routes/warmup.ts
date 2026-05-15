import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { warmupPools, warmupAccounts, emailAccounts, warmupEmails } from '../db/schema.js'
import { requireAuth, auth, type AuthRequest } from '../middleware/auth.js'
import { warmupQueue } from '../queues/warmup.js'

export const warmupRouter: ExpressRouter = Router()
warmupRouter.use(requireAuth)

warmupRouter.get('/pools', async (req, res) => {
  const { userId } = auth(req)
  const pools = await db
    .select({
      id: warmupPools.id,
      name: warmupPools.name,
      createdAt: warmupPools.createdAt,
      accountCount: sql<number>`count(${warmupAccounts.id})::int`,
    })
    .from(warmupPools)
    .leftJoin(warmupAccounts, eq(warmupAccounts.poolId, warmupPools.id))
    .where(eq(warmupPools.userId, userId))
    .groupBy(warmupPools.id)
  res.json({ data: pools })
})

warmupRouter.post('/pools', async (req, res) => {
  const { userId } = auth(req)
  const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
  const [pool] = await db.insert(warmupPools).values({ userId, name }).returning()
  res.status(201).json({ data: { ...pool, accountCount: 0 } })
})

warmupRouter.delete('/pools/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(warmupPools).where(and(eq(warmupPools.id, req.params.id), eq(warmupPools.userId, userId)))
  res.json({ data: { ok: true } })
})

// Add an email account to a warmup pool
warmupRouter.post('/pools/:poolId/accounts', async (req, res) => {
  const { userId } = auth(req)
  const { emailAccountId, maxDailyTarget } = z.object({
    emailAccountId: z.string().uuid(),
    maxDailyTarget: z.number().int().min(5).max(100).default(40),
  }).parse(req.body)

  const [pool] = await db
    .select()
    .from(warmupPools)
    .where(and(eq(warmupPools.id, req.params.poolId), eq(warmupPools.userId, userId)))
    .limit(1)
  if (!pool) {
    res.status(404).json({ error: 'Pool not found' })
    return
  }

  // Verify the email account belongs to this user
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, emailAccountId), eq(emailAccounts.userId, userId)))
    .limit(1)
  if (!account) {
    res.status(404).json({ error: 'Email account not found' })
    return
  }

  const [wa] = await db
    .insert(warmupAccounts)
    .values({ emailAccountId, poolId: pool.id, maxDailyTarget })
    .returning()

  // Enable warmup flag on the email account
  await db.update(emailAccounts).set({ warmupEnabled: true }).where(eq(emailAccounts.id, emailAccountId))

  res.status(201).json({ data: wa })
})

warmupRouter.get('/pools/:poolId/accounts', async (req, res) => {
  const { userId } = auth(req)
  const [pool] = await db
    .select()
    .from(warmupPools)
    .where(and(eq(warmupPools.id, req.params.poolId), eq(warmupPools.userId, userId)))
    .limit(1)
  if (!pool) {
    res.status(404).json({ error: 'Pool not found' })
    return
  }

  const accounts = await db
    .select({
      warmup: warmupAccounts,
      email: emailAccounts.email,
      accountName: emailAccounts.name,
    })
    .from(warmupAccounts)
    .innerJoin(emailAccounts, eq(emailAccounts.id, warmupAccounts.emailAccountId))
    .where(eq(warmupAccounts.poolId, pool.id))

  res.json({ data: accounts })
})

warmupRouter.delete('/pools/:poolId/accounts/:accountId', async (req, res) => {
  const { userId } = auth(req)
  const [pool] = await db
    .select()
    .from(warmupPools)
    .where(and(eq(warmupPools.id, req.params.poolId), eq(warmupPools.userId, userId)))
    .limit(1)
  if (!pool) {
    res.status(404).json({ error: 'Pool not found' })
    return
  }
  await db
    .delete(warmupAccounts)
    .where(and(eq(warmupAccounts.id, req.params.accountId), eq(warmupAccounts.poolId, pool.id)))
  res.json({ data: { ok: true } })
})

warmupRouter.patch('/pools/:poolId/accounts/:accountId', async (req, res) => {
  const { userId } = auth(req)
  const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body)
  const [pool] = await db
    .select()
    .from(warmupPools)
    .where(and(eq(warmupPools.id, req.params.poolId), eq(warmupPools.userId, userId)))
    .limit(1)
  if (!pool) {
    res.status(404).json({ error: 'Pool not found' })
    return
  }
  const [wa] = await db
    .update(warmupAccounts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(warmupAccounts.id, req.params.accountId), eq(warmupAccounts.poolId, pool.id)))
    .returning()
  res.json({ data: wa })
})

warmupRouter.get('/stats', async (req, res) => {
  const { userId } = auth(req)
  const accounts = await db
    .select({
      warmupAccountId: warmupAccounts.id,
      email: emailAccounts.email,
      accountName: emailAccounts.name,
      rampDay: warmupAccounts.rampDay,
      dailyTarget: warmupAccounts.dailyTarget,
      maxDailyTarget: warmupAccounts.maxDailyTarget,
      totalSent: warmupAccounts.totalSent,
      totalReplied: warmupAccounts.totalReplied,
      spamRescued: warmupAccounts.spamRescued,
      status: warmupAccounts.status,
    })
    .from(warmupAccounts)
    .innerJoin(emailAccounts, eq(emailAccounts.id, warmupAccounts.emailAccountId))
    .where(eq(emailAccounts.userId, userId))

  res.json({
    data: accounts.map((a) => ({
      ...a,
      replyRate:
        a.totalSent > 0 ? Math.round((a.totalReplied / a.totalSent) * 100 * 10) / 10 : 0,
      healthScore: Math.min(
        100,
        Math.round(
          (a.rampDay / 30) * 40 +
            (a.totalReplied / Math.max(a.totalSent, 1)) * 40 +
            (a.spamRescued === 0 ? 20 : 10),
        ),
      ),
    })),
  })
})

// Manually trigger warmup (for testing)
warmupRouter.post('/trigger', async (req, res) => {
  await warmupQueue.add('send', {})
  res.json({ data: { ok: true, message: 'Warmup job queued' } })
})
