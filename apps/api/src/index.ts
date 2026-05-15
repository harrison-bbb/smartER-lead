import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

import { authRouter } from './routes/auth.js'
import { googleAuthRouter } from './routes/google-auth.js'
import { accountsRouter } from './routes/accounts.js'
import { leadsRouter } from './routes/leads.js'
import { listsRouter } from './routes/lists.js'
import { campaignsRouter } from './routes/campaigns.js'
import { trackingRouter } from './routes/tracking.js'
import { warmupRouter } from './routes/warmup.js'
import { inboxRouter } from './routes/inbox.js'
import { templatesRouter } from './routes/templates.js'
import { blocklistRouter } from './routes/blocklist.js'

const app = express()

app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)

// Tighter limit on auth endpoints to prevent brute-force
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false })
app.use('/auth/login', authLimiter)
app.use('/auth/register', authLimiter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.use('/auth', authRouter)
app.use('/auth/google', googleAuthRouter)
app.use('/accounts', accountsRouter)
app.use('/leads', leadsRouter)
app.use('/lists', listsRouter)
app.use('/campaigns', campaignsRouter)
app.use('/track', trackingRouter)
app.use('/warmup', warmupRouter)
app.use('/inbox', inboxRouter)
app.use('/templates', templatesRouter)
app.use('/blocklist', blocklistRouter)

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = parseInt(process.env.PORT ?? '3001')
app.listen(PORT, () => console.log(`API listening on :${PORT}`))
