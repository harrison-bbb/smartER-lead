import { Router, type Router as ExpressRouter } from 'express'
import { z } from 'zod'
import { eq, and, sql, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { campaigns, sequenceSteps, campaignLeads, leads, listLeads, lists, sentEmails, emailEvents, warmupAccounts } from '../db/schema.js'
import { requireAuth, auth, type AuthRequest } from '../middleware/auth.js'
import { campaignSendQueue } from '../queues/campaign-send.js'

export const campaignsRouter: ExpressRouter = Router()
campaignsRouter.use(requireAuth)

const campaignSchema = z.object({
  name: z.string().min(1),
  emailAccountId: z.string().uuid(),
  listId: z.string().uuid().optional(),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(true),
  dailyLimit: z.number().int().min(1).max(500).default(50),
  sendingStartHour: z.number().int().min(0).max(23).default(8),
  sendingEndHour: z.number().int().min(0).max(23).default(18),
  sendingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  timezone: z.string().default('America/New_York'),
})

const stepSchema = z.object({
  stepNumber: z.number().int().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  delayDays: z.number().int().min(0).default(0),
})

// ─── Campaigns CRUD ───────────────────────────────────────────────────────────

campaignsRouter.get('/', async (req, res) => {
  const { userId } = auth(req)
  const rows = await db
    .select({
      id: campaigns.id,
      userId: campaigns.userId,
      name: campaigns.name,
      status: campaigns.status,
      emailAccountId: campaigns.emailAccountId,
      listId: campaigns.listId,
      dailyLimit: campaigns.dailyLimit,
      trackOpens: campaigns.trackOpens,
      trackClicks: campaigns.trackClicks,
      createdAt: campaigns.createdAt,
      updatedAt: campaigns.updatedAt,
      totalLeads: sql<number>`count(distinct ${campaignLeads.id})::int`,
    })
    .from(campaigns)
    .leftJoin(campaignLeads, eq(campaignLeads.campaignId, campaigns.id))
    .where(eq(campaigns.userId, userId))
    .groupBy(campaigns.id)
  res.json({ data: rows })
})

campaignsRouter.post('/', async (req, res) => {
  const { userId } = auth(req)
  const parse = campaignSchema.safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }
  const [campaign] = await db.insert(campaigns).values({ userId, ...parse.data }).returning()
  res.status(201).json({ data: campaign })
})

campaignsRouter.get('/:id', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, campaign.id))
    .orderBy(sequenceSteps.stepNumber)
  res.json({ data: { ...campaign, steps } })
})

campaignsRouter.patch('/:id', async (req, res) => {
  const { userId } = auth(req)
  const parse = campaignSchema.partial().safeParse(req.body)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }

  // If listId is being set, verify it belongs to this user
  if (parse.data.listId) {
    const [list] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.id, parse.data.listId), eq(lists.userId, userId)))
      .limit(1)
    if (!list) {
      res.status(404).json({ error: 'List not found' })
      return
    }
  }

  const [campaign] = await db
    .update(campaigns)
    .set({ ...parse.data, updatedAt: new Date() })
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .returning()
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  res.json({ data: campaign })
})

campaignsRouter.delete('/:id', async (req, res) => {
  const { userId } = auth(req)
  await db.delete(campaigns).where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
  res.json({ data: { ok: true } })
})

// ─── Sequence Steps ───────────────────────────────────────────────────────────

campaignsRouter.get('/:id/steps', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, campaign.id))
    .orderBy(sequenceSteps.stepNumber)
  res.json({ data: steps })
})

// Replace all steps atomically
campaignsRouter.put('/:id/steps', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const parse = z.array(stepSchema).safeParse(req.body.steps)
  if (!parse.success) {
    res.status(400).json({ error: 'Validation failed', details: parse.error.flatten() })
    return
  }

  await db.delete(sequenceSteps).where(eq(sequenceSteps.campaignId, campaign.id))
  const steps =
    parse.data.length > 0
      ? await db
          .insert(sequenceSteps)
          .values(parse.data.map((s) => ({ ...s, campaignId: campaign.id })))
          .returning()
      : []

  res.json({ data: steps })
})

// ─── Campaign Actions ─────────────────────────────────────────────────────────

campaignsRouter.post('/:id/start', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  if (!campaign.listId) {
    res.status(422).json({ error: 'Campaign must have a list before starting' })
    return
  }

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, campaign.id))
    .limit(1)
  if (steps.length === 0) {
    res.status(422).json({ error: 'Campaign must have at least one sequence step' })
    return
  }

  // Verify the list belongs to this user before enrolling
  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, campaign.listId), eq(lists.userId, userId)))
    .limit(1)
  if (!list) {
    res.status(422).json({ error: 'Campaign list not found or does not belong to you' })
    return
  }

  // Enroll leads from the list that aren't already enrolled
  const listLeadRows = await db
    .select({ leadId: listLeads.leadId })
    .from(listLeads)
    .where(eq(listLeads.listId, campaign.listId))

  const alreadyEnrolled = await db
    .select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaign.id))

  const enrolledSet = new Set(alreadyEnrolled.map((r) => r.leadId))
  const toEnroll = listLeadRows.filter((r) => !enrolledSet.has(r.leadId))

  if (toEnroll.length > 0) {
    await db.insert(campaignLeads).values(
      toEnroll.map((r) => ({
        campaignId: campaign.id,
        leadId: r.leadId,
        status: 'enrolled' as const,
        currentStep: 0,
        nextSendAt: new Date(),
      })),
    )
  }

  await db
    .update(campaigns)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id))

  // Trigger the scheduler to pick up new jobs
  await campaignSendQueue.add('schedule', { campaignId: campaign.id }, { jobId: `schedule-${campaign.id}` })

  // Check warmup health — warn (don't block) if account is cold
  let warning: string | undefined
  if (campaign.emailAccountId) {
    const [wa] = await db
      .select()
      .from(warmupAccounts)
      .where(eq(warmupAccounts.emailAccountId, campaign.emailAccountId))
      .limit(1)
    if (wa) {
      const replyRate = wa.totalSent > 0 ? wa.totalReplied / wa.totalSent : 0
      const spamSafety = wa.totalSent > 0 ? 1 - wa.spamRescued / wa.totalSent : 1
      const healthScore = Math.round(
        (Math.min(wa.rampDay, 30) / 30) * 40 +
        replyRate * 40 +
        spamSafety * 20,
      )
      if (healthScore < 40) {
        warning = `Your email account has a warmup health score of ${healthScore}/100 (Day ${wa.rampDay}). Consider warming it up longer before sending campaigns to avoid spam filters.`
      }
    } else {
      warning = 'This email account is not in a warmup pool. Your emails may land in spam. Go to /warmup to set up warmup.'
    }
  }

  res.json({ data: { enrolled: toEnroll.length }, warning })
})

campaignsRouter.post('/:id/pause', async (req, res) => {
  const { userId } = auth(req)
  await db
    .update(campaigns)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
  res.json({ data: { ok: true } })
})

campaignsRouter.post('/:id/resume', async (req, res) => {
  const { userId } = auth(req)
  await db
    .update(campaigns)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
  res.json({ data: { ok: true } })
})

// ─── Analytics ────────────────────────────────────────────────────────────────

campaignsRouter.get('/:id/analytics', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const { sentEmails, emailEvents } = await import('../db/schema.js')
  const { inArray } = await import('drizzle-orm')

  const [totals] = await db
    .select({
      totalLeads: sql<number>`count(distinct ${campaignLeads.id})::int`,
      completed: sql<number>`count(distinct case when ${campaignLeads.status} = 'completed' then ${campaignLeads.id} end)::int`,
      replied: sql<number>`count(distinct case when ${campaignLeads.status} = 'replied' then ${campaignLeads.id} end)::int`,
      bounced: sql<number>`count(distinct case when ${campaignLeads.status} = 'bounced' then ${campaignLeads.id} end)::int`,
    })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaign.id))

  const eventCounts = await db
    .select({
      type: emailEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(emailEvents)
    .innerJoin(sentEmails, eq(sentEmails.id, emailEvents.sentEmailId))
    .innerJoin(campaignLeads, eq(campaignLeads.id, sentEmails.campaignLeadId))
    .where(eq(campaignLeads.campaignId, campaign.id))
    .groupBy(emailEvents.type)

  const counts = Object.fromEntries(eventCounts.map((r) => [r.type, r.count]))
  const sent = counts.sent ?? 0
  const opened = counts.opened ?? 0
  const clicked = counts.clicked ?? 0

  res.json({
    data: {
      campaignId: campaign.id,
      totalLeads: totals.totalLeads,
      sent,
      opened,
      clicked,
      replied: totals.replied,
      bounced: totals.bounced,
      unsubscribed: counts.unsubscribed ?? 0,
      openRate: sent > 0 ? Math.round((opened / sent) * 100 * 10) / 10 : 0,
      clickRate: sent > 0 ? Math.round((clicked / sent) * 100 * 10) / 10 : 0,
      replyRate: sent > 0 ? Math.round((totals.replied / sent) * 100 * 10) / 10 : 0,
      bounceRate: sent > 0 ? Math.round((totals.bounced / sent) * 100 * 10) / 10 : 0,
    },
  })
})

// ─── Sending Log ──────────────────────────────────────────────────────────────

const PRIORITY_TO_STATUS: Record<number, string> = {
  6: 'replied', 5: 'clicked', 4: 'opened', 3: 'bounced', 2: 'unsubscribed', 1: 'sent',
}

campaignsRouter.get('/:id/sends', async (req, res) => {
  const { userId } = auth(req)
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, req.params.id), eq(campaigns.userId, userId)))
    .limit(1)
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, parseInt(req.query.limit as string) || 50)
  const offset = (page - 1) * limit

  const statusPriority = sql<number>`
    COALESCE(MAX(CASE ${emailEvents.type}
      WHEN 'replied' THEN 6
      WHEN 'clicked' THEN 5
      WHEN 'opened' THEN 4
      WHEN 'bounced' THEN 3
      WHEN 'unsubscribed' THEN 2
      ELSE 1
    END), 1)`

  const rows = await db
    .select({
      id: sentEmails.id,
      sentAt: sentEmails.sentAt,
      leadEmail: leads.email,
      firstName: leads.firstName,
      lastName: leads.lastName,
      company: leads.company,
      stepNumber: sequenceSteps.stepNumber,
      subject: sentEmails.subject,
      statusPriority,
    })
    .from(sentEmails)
    .innerJoin(campaignLeads, eq(campaignLeads.id, sentEmails.campaignLeadId))
    .innerJoin(leads, eq(leads.id, campaignLeads.leadId))
    .innerJoin(sequenceSteps, eq(sequenceSteps.id, sentEmails.stepId))
    .leftJoin(emailEvents, eq(emailEvents.sentEmailId, sentEmails.id))
    .where(eq(campaignLeads.campaignId, campaign.id))
    .groupBy(sentEmails.id, leads.email, leads.firstName, leads.lastName, leads.company, sequenceSteps.stepNumber)
    .orderBy(desc(sentEmails.sentAt))
    .limit(limit)
    .offset(offset)

  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${sentEmails.id})::int` })
    .from(sentEmails)
    .innerJoin(campaignLeads, eq(campaignLeads.id, sentEmails.campaignLeadId))
    .where(eq(campaignLeads.campaignId, campaign.id))

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      sentAt: r.sentAt,
      leadEmail: r.leadEmail,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      stepNumber: r.stepNumber,
      subject: r.subject,
      status: PRIORITY_TO_STATUS[r.statusPriority] ?? 'sent',
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  })
})
