import { Router, type Router as ExpressRouter } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js'
import { eq, and, gt } from 'drizzle-orm'

export const authRouter: ExpressRouter = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

authRouter.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const { email, password, name } = parse.data

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing.length > 0) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const [user] = await db.insert(users).values({ email, passwordHash, name }).returning()

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.id),
    signRefreshToken(user.id),
  ])

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.insert(refreshTokens).values({ userId: user.id, token: refreshToken, expiresAt })

  res.status(201).json({
    data: {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    },
  })
})

authRouter.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const { email, password } = parse.data

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.id),
    signRefreshToken(user.id),
  ])

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.insert(refreshTokens).values({ userId: user.id, token: refreshToken, expiresAt })

  res.json({
    data: {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
      refreshToken,
    },
  })
})

authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string }
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken required' })
    return
  }

  let userId: string
  try {
    userId = await verifyRefreshToken(refreshToken)
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' })
    return
  }

  const [stored] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.token, refreshToken),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)

  if (!stored) {
    res.status(401).json({ error: 'Refresh token not found or expired' })
    return
  }

  // Rotate
  await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id))
  const [newAccess, newRefresh] = await Promise.all([
    signAccessToken(userId),
    signRefreshToken(userId),
  ])
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.insert(refreshTokens).values({ userId, token: newRefresh, expiresAt })

  res.json({ data: { accessToken: newAccess, refreshToken: newRefresh } })
})

authRouter.post('/logout', async (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string }
  if (refreshToken) {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken))
  }
  res.json({ data: { ok: true } })
})
