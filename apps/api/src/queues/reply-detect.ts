import { Queue, Worker, type Job } from 'bullmq'
import { ImapFlow } from 'imapflow'
import { db } from '../db/index.js'
import {
  emailAccounts,
  sentEmails,
  campaignLeads,
  campaigns,
  replies,
  emailEvents,
} from '../db/schema.js'
import { buildImapClient } from '../lib/imap.js'
import { eq, and, isNotNull, inArray } from 'drizzle-orm'

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
}

export const replyDetectQueue = new Queue('reply-detect', { connection })

export function startReplyDetectWorker() {
  const worker = new Worker(
    'reply-detect',
    async (_job: Job) => {
      await detectReplies()
    },
    { connection, concurrency: 1 },
  )

  worker.on('failed', (_job, err) => {
    console.error('[reply-detect] job failed:', err.message)
  })

  return worker
}

async function detectReplies() {
  // Get all active email accounts that have sent campaign emails
  const activeAccounts = await db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.status, 'active'))

  for (const account of activeAccounts) {
    try {
      await scanAccountForReplies(account)
    } catch (err) {
      console.error(`[reply-detect] error scanning ${account.email}:`, err)
    }
  }
}

async function scanAccountForReplies(account: typeof emailAccounts.$inferSelect) {
  if (!account.encryptedPassword || !account.encryptedUsername) return

  // Get all message IDs sent from this account in the last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const sentFromAccount = await db
    .select({
      id: sentEmails.id,
      messageId: sentEmails.messageId,
      campaignLeadId: sentEmails.campaignLeadId,
    })
    .from(sentEmails)
    .innerJoin(campaignLeads, eq(campaignLeads.id, sentEmails.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(
      and(
        eq(campaigns.emailAccountId, account.id),
        isNotNull(sentEmails.messageId),
      ),
    )

  if (sentFromAccount.length === 0) return

  const messageIdMap = new Map(
    sentFromAccount
      .filter((s) => s.messageId)
      .map((s) => [s.messageId!, s]),
  )

  // Get already-recorded reply messageIds to avoid duplicates
  const existingReplies = await db
    .select({ messageId: replies.messageId })
    .from(replies)
    .innerJoin(campaignLeads, eq(campaignLeads.id, replies.campaignLeadId))
    .innerJoin(campaigns, eq(campaigns.id, campaignLeads.campaignId))
    .where(eq(campaigns.emailAccountId, account.id))

  const knownMessageIds = new Set(existingReplies.map((r) => r.messageId).filter(Boolean))

  let client: ImapFlow
  try {
    client = await buildImapClient(account)
    await client.connect()
  } catch (err) {
    console.error(`[reply-detect] IMAP connect failed for ${account.email}:`, err)
    return
  }

  try {
    await client.mailboxOpen('INBOX')

    // Search for messages received in the last 30 days
    const uids = await client.search({ since: thirtyDaysAgo }, { uid: true })
    if (!uids || uids.length === 0) return

    for await (const msg of client.fetch(
      uids.slice(0, 200), // cap at 200 per scan
      { envelope: true, source: true, bodyStructure: true },
      { uid: true },
    )) {
      const inReplyTo = (msg.envelope as Record<string, unknown>)?.inReplyTo as string | undefined
      const msgId = msg.envelope?.messageId

      if (!msgId || knownMessageIds.has(msgId)) continue

      // Check if this message is a reply to one of our sent emails
      const matchedSent = inReplyTo ? messageIdMap.get(inReplyTo) : undefined

      if (!matchedSent) continue

      // Extract text body
      let bodyFull = ''
      try {
        const raw = msg.source?.toString('utf8') ?? ''
        // Strip headers, keep body (naive but works for plain/html)
        const bodyStart = raw.indexOf('\r\n\r\n')
        bodyFull = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw
      } catch {
        bodyFull = ''
      }

      const bodySnippet = bodyFull.replace(/<[^>]+>/g, '').slice(0, 500).trim()
      const fromAddr = msg.envelope?.from?.[0]
      const fromEmail = fromAddr?.address ?? ''
      const fromName = fromAddr?.name || fromEmail

      // Insert reply
      await db.insert(replies).values({
        campaignLeadId: matchedSent.campaignLeadId,
        sentEmailId: matchedSent.id,
        fromEmail,
        fromName,
        subject: msg.envelope?.subject ?? '',
        bodySnippet,
        bodyFull,
        messageId: msgId,
        receivedAt: msg.envelope?.date ?? new Date(),
      })

      knownMessageIds.add(msgId)

      // Mark campaign lead as replied
      await db
        .update(campaignLeads)
        .set({ status: 'replied' })
        .where(eq(campaignLeads.id, matchedSent.campaignLeadId))

      // Log email event
      await db.insert(emailEvents).values({
        sentEmailId: matchedSent.id,
        type: 'replied',
        metadata: { fromEmail },
      })

      console.log(`[reply-detect] New reply from ${fromEmail} for lead ${matchedSent.campaignLeadId}`)
    }
  } finally {
    await client.logout()
  }
}
