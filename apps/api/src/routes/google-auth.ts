import { Router, type Router as ExpressRouter } from 'express'
import { eq } from 'drizzle-orm'
import { createHmac } from 'crypto'
import { db } from '../db/index.js'
import { emailAccounts } from '../db/schema.js'
import { getAuthUrl, exchangeCode, getUserEmail } from '../lib/google-oauth.js'
import { encrypt } from '../lib/crypto.js'
import { verifyAccessToken } from '../lib/jwt.js'

export const googleAuthRouter: ExpressRouter = Router()

function signState(payload: object): string {
  const json = JSON.stringify(payload)
  const hmac = createHmac('sha256', process.env.JWT_SECRET!).update(json).digest('hex')
  return Buffer.from(JSON.stringify({ ...payload, _hmac: hmac })).toString('base64url')
}

function verifyState(state: string): { userId: string; name: string } {
  const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
    userId: string
    name: string
    _hmac: string
  }
  const { _hmac, ...payload } = decoded
  const expected = createHmac('sha256', process.env.JWT_SECRET!).update(JSON.stringify(payload)).digest('hex')
  if (_hmac !== expected) throw new Error('Invalid state signature')
  return payload
}

// Step 1 — redirect user to Google's consent screen
// Called from frontend: GET /auth/google/start?token=<access_token>&name=<account_name>
googleAuthRouter.get('/start', async (req, res) => {
  const token = req.query.token as string
  const name = (req.query.name as string) || 'Gmail Account'

  if (!token) {
    res.status(400).send('Missing token')
    return
  }

  let userId: string
  try {
    userId = await verifyAccessToken(token)
  } catch {
    res.status(401).send('Invalid token')
    return
  }

  // HMAC-signed state prevents CSRF account-linking attacks
  const state = signState({ userId, name })
  const url = getAuthUrl(state)
  res.redirect(url)
})

// Step 2 — Google redirects here after user approves
googleAuthRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>

  const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'

  if (error || !code || !state) {
    res.redirect(`${webUrl}/accounts?error=google_denied`)
    return
  }

  let userId: string
  let name: string
  try {
    const decoded = verifyState(state)
    userId = decoded.userId
    name = decoded.name
  } catch {
    res.redirect(`${webUrl}/accounts?error=invalid_state`)
    return
  }

  try {
    const tokens = await exchangeCode(code)

    if (!tokens.refresh_token) {
      // This happens if the user already approved once and didn't revoke.
      // We can't store without a refresh token — ask them to revoke and retry.
      res.redirect(`${webUrl}/accounts?error=no_refresh_token`)
      return
    }

    const email = await getUserEmail(tokens.access_token!)

    // Upsert — if this Gmail is already connected, update its tokens
    const existing = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.email, email))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(emailAccounts)
        .set({
          encryptedPassword: encrypt(tokens.refresh_token),
          encryptedUsername: encrypt(email),
          status: 'active',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing[0].id))
    } else {
      await db.insert(emailAccounts).values({
        userId,
        name,
        email,
        provider: 'gmail',
        encryptedUsername: encrypt(email),
        encryptedPassword: encrypt(tokens.refresh_token),
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        status: 'active',
        dailySendLimit: 50,
      })
    }

    res.redirect(`${webUrl}/accounts?connected=gmail`)
  } catch (err) {
    console.error('[google-oauth] callback error:', err)
    res.redirect(`${webUrl}/accounts?error=exchange_failed`)
  }
})
