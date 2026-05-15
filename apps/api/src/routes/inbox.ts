import { Router, type Router as ExpressRouter } from 'express'
import { eq, and, desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { db } from '../db/index.js'
import { replies, campaignLeads, campaigns, sentEmails, sequenceSteps, emailAccounts } from '../db/schema.js'
import { requireAuth, auth } from '../middleware/auth.js'
import { replyDetectQueue } from '../queues/reply-detect.js'
import { sendEmail } from '../lib/mailer.js'

// Allowed tags/attributes for rendering inbound email HTML safely
const SAFE_EMAIL_HTML: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'width', 'height'],
    a: ['href', 'name', 'target'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https', 'cid'] },
}

export const inboxRouter: ExpressRouter = Router()
inboxRouter.use(requireAuth)

const VALID_TAGS = ['interested', 'not_interested', 'meeting_booked', 'out_of_office', 'not_now'] as const

// GET /inbox — paginated list of all replies across user's campaigns
inboxRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const page = parseInt(req.query.page as string ?? '1')
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string ?? '30'))
  const unreadOnly = req.query.unread === 'true'
  const tagFilter = req.query.tag as string | undefined
  const offset = (page - 1) * pageSize

  const conditions = [
    eq(campaigns.userId, userId),
    unreadOnly ? eq(replies.read, false) : undefined,
    tagFilter ? eq(replies.tag, tagFilter) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const where = and(...conditions)

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: replies.id,
        fromEmail: replies.fromEmail,
        fromName: replies.fromName,
        subject: replies.subject,
        bodySnippet: replies.bodySnippet,
        read: replies.read,
        tag: replies.tag,
        repliedAt: replies.repliedAt,
        receivedAt: replies.receivedAt,
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        campaignLeadId: replies.campaignLeadId,
      })
      .from(replies)
      .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
      .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
      .where(where)
      .orderBy(desc(replies.receivedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(replies)
      .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
      .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
      .where(where),
  ])

  const unreadCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(campaigns.userId, userId), eq(replies.read, false)))

  res.json({ data: rows, total: count, page, pageSize, unread: unreadCount[0].count })
})

// POST /inbox/scan — manually trigger reply scan (must be before /:id routes)
inboxRouter.post('/scan', async (req, res) => {
  try {
    await replyDetectQueue.add('scan', {}, { jobId: `manual-${Date.now()}` })
    res.json({ data: { ok: true, message: 'Reply scan queued' } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to queue scan — is the worker running?' })
  }
})

// GET /inbox/:id — full reply with body
inboxRouter.get('/:id', async (req, res) => {
  const { userId } = auth(req)

  const [row] = await db
    .select({
      reply: replies,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      emailAccountId: campaigns.emailAccountId,
    })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(replies.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Reply not found' })
    return
  }

  // Mark as read
  if (!row.reply.read) {
    await db.update(replies).set({ read: true }).where(eq(replies.id, row.reply.id))
  }

  const safeBody = row.reply.bodyFull ? sanitizeHtml(row.reply.bodyFull, SAFE_EMAIL_HTML) : null
  res.json({ data: { ...row.reply, bodyFull: safeBody, read: true, campaignId: row.campaignId, campaignName: row.campaignName } })
})

// PATCH /inbox/:id — update tag and/or read status
inboxRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const parse = z.object({
    read: z.boolean().optional(),
    tag: z.enum(VALID_TAGS).nullable().optional(),
  }).safeParse(req.body)

  if (!parse.success) {
    res.status(400).json({ error: 'Invalid fields', details: parse.error.flatten() })
    return
  }

  const [row] = await db
    .select({ id: replies.id })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(replies.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Reply not found' })
    return
  }

  const updates: Record<string, unknown> = {}
  if (parse.data.read !== undefined) updates.read = parse.data.read
  if (parse.data.tag !== undefined) updates.tag = parse.data.tag

  const [updated] = await db
    .update(replies)
    .set(updates)
    .where(eq(replies.id, req.params.id))
    .returning()

  res.json({ data: updated })
})

// Keep legacy read endpoint for backwards compat
inboxRouter.patch('/:id/read', async (req, res) => {
  const { userId } = auth(req)
  const { read } = z.object({ read: z.boolean() }).parse(req.body)

  const [row] = await db
    .select({ id: replies.id })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(replies.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Reply not found' })
    return
  }

  await db.update(replies).set({ read }).where(eq(replies.id, req.params.id))
  res.json({ data: { ok: true } })
})

// POST /inbox/:id/draft — generate an AI reply draft using Claude
inboxRouter.post('/:id/draft', async (req, res) => {
  const { userId } = auth(req)

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(422).json({ error: 'ANTHROPIC_API_KEY not configured' })
    return
  }

  const [row] = await db
    .select({
      reply: replies,
      sentEmailId: replies.sentEmailId,
    })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(replies.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'Reply not found' })
    return
  }

  // Fetch original email for context
  let originalSubject = ''
  let originalBody = ''
  if (row.sentEmailId) {
    const [sent] = await db
      .select({ subject: sentEmails.subject, stepId: sentEmails.stepId })
      .from(sentEmails)
      .where(eq(sentEmails.id, row.sentEmailId))
      .limit(1)
    if (sent) {
      originalSubject = sent.subject ?? ''
      if (sent.stepId) {
        const [step] = await db
          .select({ body: sequenceSteps.body })
          .from(sequenceSteps)
          .where(eq(sequenceSteps.id, sent.stepId))
          .limit(1)
        originalBody = step?.body ?? ''
      }
    }
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = [
    'You are a sales rep drafting a reply to a prospect who responded to your cold email.',
    '',
    originalSubject ? `Original email subject: "${originalSubject}"` : '',
    originalBody ? `Original email body:\n${originalBody.replace(/<[^>]+>/g, '').trim()}` : '',
    '',
    `Prospect's reply:\n${(row.reply.bodyFull ?? row.reply.bodySnippet ?? '').replace(/<[^>]+>/g, '').trim()}`,
    '',
    'Write a concise, natural follow-up reply (2-4 sentences max). Sound like a real human, not a robot. No fluff. Match the tone of their reply. If they\'re interested, move toward booking a call. If they need more info, give one clear value point. Return only the reply text, no subject line.',
  ].filter(Boolean).join('\n')

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const draft = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  res.json({ data: { draft } })
})

// POST /inbox/:id/reply — send a response
inboxRouter.post('/:id/reply', async (req, res) => {
  const { userId } = auth(req)
  const { body } = z.object({ body: z.string().min(1) }).parse(req.body)

  const [row] = await db
    .select({
      reply: replies,
      emailAccountId: campaigns.emailAccountId,
    })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(and(eq(replies.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)

  if (!row || !row.emailAccountId) {
    res.status(404).json({ error: 'Reply not found' })
    return
  }

  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, row.emailAccountId))
    .limit(1)

  if (!account) {
    res.status(422).json({ error: 'Email account not found' })
    return
  }

  // Strip CR/LF from inbound-derived header values to prevent header injection
  const sanitizeHeader = (s: string) => s.replace(/[\r\n]/g, '')

  const rawSubject = row.reply.subject?.startsWith('Re:')
    ? row.reply.subject
    : `Re: ${row.reply.subject ?? ''}`
  const replySubject = sanitizeHeader(rawSubject)
  const replyTo = sanitizeHeader(row.reply.fromEmail)

  await sendEmail(account, {
    from: account.senderName ?? account.name,
    to: replyTo,
    subject: replySubject,
    html: body,
    headers: row.reply.messageId
      ? { 'In-Reply-To': row.reply.messageId, References: row.reply.messageId }
      : undefined,
  })

  await db
    .update(replies)
    .set({ repliedAt: new Date(), read: true })
    .where(eq(replies.id, req.params.id))

  res.json({ data: { ok: true } })
})
