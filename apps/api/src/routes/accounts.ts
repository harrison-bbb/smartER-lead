import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { emailAccounts, warmupAccounts } from '../db/schema.js'
import { requireAuth, auth, type AuthRequest } from '../middleware/auth.js'
import { encrypt } from '../lib/crypto.js'
import { testConnection } from '../lib/mailer.js'
import type { Request } from 'express'

export const accountsRouter: ExpressRouter = Router()
accountsRouter.use(requireAuth)

const createAccountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  provider: z.enum(['smtp', 'gmail', 'outlook']).default('smtp'),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().optional(),
  smtpSecure: z.boolean().default(true),
  imapHost: z.string().optional(),
  imapPort: z.number().int().optional(),
  imapSecure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  dailySendLimit: z.number().int().min(1).max(500).default(50),
})

accountsRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const rows = await db
    .select({
      account: emailAccounts,
      warmup: warmupAccounts,
    })
    .from(emailAccounts)
    .leftJoin(warmupAccounts, eq(warmupAccounts.emailAccountId, emailAccounts.id))
    .where(eq(emailAccounts.userId, userId))

  const safe = rows.map(({ account, warmup }) => {
    const { encryptedPassword, encryptedUsername, ...rest } = account
    let warmupStatus: {
      inPool: boolean
      rampDay: number | null
      dailyTarget: number | null
      healthScore: number | null
      recommendedDailyLimit: number
    }
    if (warmup) {
      const replyRate = warmup.totalSent > 0 ? warmup.totalReplied / warmup.totalSent : 0
      const spamSafety = warmup.totalSent > 0 ? 1 - warmup.spamRescued / warmup.totalSent : 1
      const healthScore = Math.round(
        (Math.min(warmup.rampDay, 30) / 30) * 40 +
        replyRate * 40 +
        spamSafety * 20,
      )
      const recommendedDailyLimit = Math.min(
        account.dailySendLimit,
        Math.round(10 + (healthScore / 100) * 190),
      )
      warmupStatus = { inPool: true, rampDay: warmup.rampDay, dailyTarget: warmup.dailyTarget, healthScore, recommendedDailyLimit }
    } else {
      warmupStatus = { inPool: false, rampDay: null, dailyTarget: null, healthScore: null, recommendedDailyLimit: account.dailySendLimit }
    }
    return { ...rest, warmupStatus }
  })
  res.json({ data: safe })
})

accountsRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const parse = createAccountSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const { username, password, ...rest } = parse.data

  const [account] = await db
    .insert(emailAccounts)
    .values({
      userId,
      ...rest,
      encryptedUsername: encrypt(username),
      encryptedPassword: encrypt(password),
      status: 'testing',
    })
    .returning()

  // Test connection asynchronously and update status
  testConnection(account)
    .then(() =>
      db.update(emailAccounts).set({ status: 'active' }).where(eq(emailAccounts.id, account.id)),
    )
    .catch((err: Error) =>
      db
        .update(emailAccounts)
        .set({ status: 'error', lastError: err.message })
        .where(eq(emailAccounts.id, account.id)),
    )

  const { encryptedPassword, encryptedUsername, ...safe } = account
  res.status(201).json({ data: safe })
})

accountsRouter.post('/:id/test', async (req, res) => {
  const { userId } = auth(req)
  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, req.params.id), eq(emailAccounts.userId, userId)))
    .limit(1)

  if (!account) {
    res.status(404).json({ error: 'Account not found' })
    return
  }

  try {
    await testConnection(account)
    await db.update(emailAccounts).set({ status: 'active', lastError: null }).where(eq(emailAccounts.id, account.id))
    res.json({ data: { ok: true } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await db.update(emailAccounts).set({ status: 'error', lastError: message }).where(eq(emailAccounts.id, account.id))
    res.status(422).json({ error: message })
  }
})

accountsRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const [existing] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, req.params.id), eq(emailAccounts.userId, userId)))
    .limit(1)

  if (!existing) {
    res.status(404).json({ error: 'Account not found' })
    return
  }

  const updates: Partial<typeof emailAccounts.$inferInsert> = {}
  const allowed = ['name', 'senderName', 'dailySendLimit', 'warmupEnabled', 'smtpHost', 'smtpPort', 'smtpSecure', 'imapHost', 'imapPort'] as const
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      ;(updates as Record<string, unknown>)[key] = req.body[key]
    }
  }
  if (req.body.password) updates.encryptedPassword = encrypt(req.body.password as string)
  if (req.body.username) updates.encryptedUsername = encrypt(req.body.username as string)

  const [updated] = await db
    .update(emailAccounts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(emailAccounts.id, existing.id))
    .returning()

  const { encryptedPassword, encryptedUsername, ...safe } = updated
  res.json({ data: safe })
})

accountsRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db
    .delete(emailAccounts)
    .where(and(eq(emailAccounts.id, req.params.id), eq(emailAccounts.userId, userId)))
  res.json({ data: { ok: true } })
})
