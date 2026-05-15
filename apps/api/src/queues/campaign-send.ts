import { Queue, Worker, type Job } from 'bullmq'
import { createHash } from 'crypto'
import sanitizeHtml from 'sanitize-html'
import { db } from '../db/index.js'
import {
  campaigns,
  sequenceSteps,
  campaignLeads,
  leads,
  emailAccounts,
  sentEmails,
  emailEvents,
  linkMap,
  blocklist,
} from '../db/schema.js'
import { sendEmail } from '../lib/mailer.js'
import { eq, and, lte, or, inArray } from 'drizzle-orm'

const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379') }

export const campaignSendQueue = new Queue('campaign-send', { connection })

interface SendJobData {
  campaignLeadId: string
}

interface ScheduleJobData {
  campaignId: string
}

// Replaces {{firstName}}, {{company}}, etc. with lead values
function interpolate(template: string, lead: typeof leads.$inferSelect): string {
  const vars: Record<string, string> = {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    company: lead.company ?? '',
    title: lead.title ?? '',
    email: lead.email,
    ...((lead.customFields as Record<string, string>) ?? {}),
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

// Rewrites all href links to tracking URLs, returns mapping
function rewriteLinks(
  html: string,
  sentEmailId: string,
  trackingDomain: string,
): { html: string; links: Array<{ hash: string; originalUrl: string }> } {
  const links: Array<{ hash: string; originalUrl: string }> = []
  const rewritten = html.replace(/href="([^"]+)"/g, (_, url: string) => {
    if (url.startsWith('mailto:') || url.startsWith('#')) return `href="${url}"`
    const hash = createHash('sha256').update(`${sentEmailId}:${url}`).digest('hex').slice(0, 16)
    links.push({ hash, originalUrl: url })
    return `href="${trackingDomain}/track/click/${sentEmailId}/${hash}"`
  })
  return { html: rewritten, links }
}

function addOpenPixel(html: string, sentEmailId: string, trackingDomain: string): string {
  const pixel = `<img src="${trackingDomain}/track/open/${sentEmailId}" width="1" height="1" style="display:none" alt="" />`
  return html.includes('</body>') ? html.replace('</body>', `${pixel}</body>`) : html + pixel
}

export function startCampaignWorker() {
  const worker = new Worker<SendJobData | ScheduleJobData>(
    'campaign-send',
    async (job: Job) => {
      if (job.name === 'schedule') {
        await handleSchedule(job as Job<ScheduleJobData>)
      } else {
        await handleSend(job as Job<SendJobData>)
      }
    },
    { connection, concurrency: 5 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[campaign-send] job ${job?.id} failed:`, err.message)
  })

  return worker
}

async function handleSchedule(job: Job<ScheduleJobData>) {
  const { campaignId } = job.data
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'active')))
    .limit(1)
  if (!campaign) return

  const now = new Date()
  const due = await db
    .select()
    .from(campaignLeads)
    .where(
      and(
        eq(campaignLeads.campaignId, campaignId),
        inArray(campaignLeads.status, ['enrolled', 'in_progress']),
        lte(campaignLeads.nextSendAt, now),
      ),
    )
    .limit(campaign.dailyLimit)

  for (const cl of due) {
    await campaignSendQueue.add(
      'send',
      { campaignLeadId: cl.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
    )
  }
}

async function handleSend(job: Job<SendJobData>) {
  const { campaignLeadId } = job.data
  const [cl] = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.id, campaignLeadId))
    .limit(1)

  if (!cl || (cl.status !== 'enrolled' && cl.status !== 'in_progress')) return

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, cl.campaignId)).limit(1)
  if (!campaign || campaign.status !== 'active') return

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.campaignId, campaign.id))
    .orderBy(sequenceSteps.stepNumber)

  const stepIndex = cl.currentStep
  if (stepIndex >= steps.length) {
    await db.update(campaignLeads).set({ status: 'completed' }).where(eq(campaignLeads.id, cl.id))
    return
  }

  const step = steps[stepIndex]
  const [lead] = await db.select().from(leads).where(eq(leads.id, cl.leadId)).limit(1)
  if (!lead || lead.status !== 'active') return

  // Blocklist check — skip if lead's email or domain is blocked
  const domain = lead.email.split('@')[1] ?? ''
  const blocked = await db
    .select()
    .from(blocklist)
    .where(
      and(
        eq(blocklist.userId, campaign.userId),
        or(eq(blocklist.value, lead.email.toLowerCase()), eq(blocklist.value, domain.toLowerCase())),
      ),
    )
    .limit(1)
  if (blocked.length > 0) {
    await db.update(campaignLeads).set({ status: 'unsubscribed' }).where(eq(campaignLeads.id, cl.id))
    return
  }

  const [account] = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.id, campaign.emailAccountId!))
    .limit(1)
  if (!account || account.status !== 'active') return

  // Check daily send limit
  const today = new Date().toISOString().split('T')[0]
  if (account.sentTodayDate === today && account.sentTodayCount >= account.dailySendLimit) {
    // Re-queue for tomorrow
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(campaign.sendingStartHour, 0, 0, 0)
    await db.update(campaignLeads).set({ nextSendAt: tomorrow }).where(eq(campaignLeads.id, cl.id))
    return
  }

  const trackingDomain = process.env.TRACKING_DOMAIN ?? ''
  // Only track when TRACKING_DOMAIN is a real HTTPS URL — localhost pixels trigger spam filters
  const canTrack = trackingDomain.startsWith('https://')

  const subject = interpolate(step.subject, lead)
  let body = interpolate(step.body, lead)
  body = sanitizeHtml(body, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']) })

  // Plain text version derived from body before link rewriting (cleaner text)
  const plainText = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Generate a placeholder ID for tracking URLs before we persist anything.
  const { randomUUID } = await import('crypto')
  const sentEmailId = randomUUID()

  // Rewrite links & add pixel only when we have a real tracking domain
  let processedHtml = body
  const links: Array<{ hash: string; originalUrl: string }> = []
  if (campaign.trackClicks && canTrack) {
    const result = rewriteLinks(body, sentEmailId, trackingDomain)
    processedHtml = result.html
    links.push(...result.links)
  }
  if (campaign.trackOpens && canTrack) {
    processedHtml = addOpenPixel(processedHtml, sentEmailId, trackingDomain)
  }

  // ── SEND FIRST — if this throws, BullMQ retries cleanly (no DB state written yet) ──
  const info = await sendEmail(account, {
    from: account.name,
    to: lead.email,
    subject,
    html: processedHtml,
    text: plainText,
    sentEmailId,   // used to build List-Unsubscribe header
  })

  // ── Only write to DB after a successful send ──

  const [sentEmail] = await db
    .insert(sentEmails)
    .values({ id: sentEmailId, campaignLeadId: cl.id, stepId: step.id, subject, messageId: info.messageId })
    .returning()

  if (links.length > 0) {
    await db.insert(linkMap).values(links.map((l) => ({ ...l, sentEmailId: sentEmail.id }))).onConflictDoNothing()
  }

  await db.insert(emailEvents).values({ sentEmailId: sentEmail.id, type: 'sent' })

  await db
    .update(emailAccounts)
    .set({
      sentTodayCount: account.sentTodayDate === today ? account.sentTodayCount + 1 : 1,
      sentTodayDate: today,
    })
    .where(eq(emailAccounts.id, account.id))

  // Advance campaign lead to next step
  const nextStepIndex = stepIndex + 1
  if (nextStepIndex >= steps.length) {
    await db.update(campaignLeads).set({ status: 'completed', currentStep: nextStepIndex }).where(eq(campaignLeads.id, cl.id))
  } else {
    const nextStep = steps[nextStepIndex]
    const nextSendAt = new Date()
    nextSendAt.setDate(nextSendAt.getDate() + nextStep.delayDays)
    nextSendAt.setHours(campaign.sendingStartHour, Math.floor(Math.random() * 60), 0, 0)
    await db
      .update(campaignLeads)
      .set({ currentStep: nextStepIndex, nextSendAt, status: 'in_progress' })
      .where(eq(campaignLeads.id, cl.id))
  }
}
