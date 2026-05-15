import { Queue, Worker, type Job } from 'bullmq'
import { db } from '../db/index.js'
import {
  warmupPools,
  warmupAccounts,
  warmupEmails,
  emailAccounts,
} from '../db/schema.js'
import { sendEmail } from '../lib/mailer.js'
import { buildImapClient } from '../lib/imap.js'
import { eq, and, inArray } from 'drizzle-orm'

const connection = { host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379') }

export const warmupQueue = new Queue('warmup', { connection })

// 50+ generic warmup message snippets to rotate through
const WARMUP_SUBJECTS = [
  'Following up on our earlier conversation',
  'Quick question about your workflow',
  'Checking in',
  'Thoughts on the proposal',
  'Re: our last discussion',
  'Any updates on your end?',
  'Circling back',
  'Just wanted to touch base',
  'Let me know your thoughts',
  'Wanted to share this with you',
]

const WARMUP_BODIES = [
  '<p>Hey, just wanted to follow up from our earlier conversation. Do you have any updates to share?</p><p>Looking forward to hearing from you.</p>',
  '<p>Hope you\'re having a great week! I wanted to check in and see if you had a chance to review the information I sent over.</p>',
  '<p>Hi there, just circling back on this. Let me know if you need anything else from my end.</p>',
  '<p>Quick check-in — are we still on track? Please let me know if anything has changed.</p>',
  '<p>Thanks again for your time earlier. I wanted to make sure you received everything okay.</p>',
  '<p>Just a friendly follow-up. No rush, but let me know when you get a chance.</p>',
  '<p>Hope this finds you well. I wanted to touch base and see how things are progressing on your end.</p>',
  '<p>Hi, checking in to see if you had any questions or needed clarification on anything.</p>',
  '<p>Just wanted to make sure this didn\'t get buried. Let me know your thoughts when you have a moment.</p>',
  '<p>Hope your week is going well! Just following up to see if you\'ve had a chance to look things over.</p>',
]

const WARMUP_REPLIES = [
  '<p>Thanks for the follow-up! I\'ll get back to you shortly.</p>',
  '<p>Appreciate you reaching out. I\'ll review and respond soon.</p>',
  '<p>Got it, thanks! I\'ll circle back with more details shortly.</p>',
  '<p>Thanks! This is very helpful. Will follow up soon.</p>',
  '<p>Received, thank you! I\'ll be in touch.</p>',
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function startWarmupWorker() {
  const worker = new Worker<{ poolId?: string; accountId?: string }>(
    'warmup',
    async (job: Job) => {
      if (job.name === 'send') await handleWarmupSend()
      if (job.name === 'reply') await handleWarmupReply()
      if (job.name === 'ramp') await handleRamp()
    },
    { connection, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[warmup] job ${job?.id} failed:`, err.message)
  })

  return worker
}

async function handleWarmupSend() {
  const activeAccounts = await db
    .select({
      warmup: warmupAccounts,
      account: emailAccounts,
    })
    .from(warmupAccounts)
    .innerJoin(emailAccounts, eq(emailAccounts.id, warmupAccounts.emailAccountId))
    .where(and(eq(warmupAccounts.status, 'active'), eq(emailAccounts.status, 'active')))

  // Group by pool
  const byPool = new Map<string, typeof activeAccounts>()
  for (const row of activeAccounts) {
    const pool = row.warmup.poolId
    if (!byPool.has(pool)) byPool.set(pool, [])
    byPool.get(pool)!.push(row)
  }

  for (const [, members] of byPool) {
    if (members.length < 2) continue

    // Shuffle for random pairing
    const shuffled = [...members].sort(() => Math.random() - 0.5)

    for (let i = 0; i < shuffled.length; i++) {
      const sender = shuffled[i]
      const receiver = shuffled[(i + 1) % shuffled.length]

      const target = sender.warmup.dailyTarget
      for (let j = 0; j < target; j++) {
        try {
          const subject = randomFrom(WARMUP_SUBJECTS)
          const body = randomFrom(WARMUP_BODIES)

          const info = await sendEmail(sender.account, {
            from: sender.account.name,
            to: receiver.account.email,
            subject,
            html: body,
            text: body.replace(/<[^>]+>/g, '').trim(),
            headers: { 'X-Warmup': '1' },
          })

          await db.insert(warmupEmails).values({
            fromAccountId: sender.warmup.id,
            toAccountId: receiver.warmup.id,
            messageId: info.messageId,
            subject,
          })

          await db
            .update(warmupAccounts)
            .set({ totalSent: sender.warmup.totalSent + j + 1 })
            .where(eq(warmupAccounts.id, sender.warmup.id))

          // Small delay between sends to look natural
          await new Promise((r) => setTimeout(r, 2_000 + Math.random() * 3_000))
        } catch (err) {
          console.error(`[warmup] send error for ${sender.account.email}:`, err)
        }
      }
    }
  }
}

async function handleWarmupReply() {
  const activeAccounts = await db
    .select({
      warmup: warmupAccounts,
      account: emailAccounts,
    })
    .from(warmupAccounts)
    .innerJoin(emailAccounts, eq(emailAccounts.id, warmupAccounts.emailAccountId))
    .where(and(eq(warmupAccounts.status, 'active'), eq(emailAccounts.status, 'active')))

  for (const { warmup, account } of activeAccounts) {
    try {
      const client = await buildImapClient(account)
      await client.connect()

      // Check INBOX for warmup emails to reply to
      await client.mailboxOpen('INBOX')
      const toReply: Array<{ uid: number; from: string; subject: string; messageId: string }> = []

      for await (const msg of client.fetch('1:*', { envelope: true, flags: true }, { uid: true })) {
        const isWarmup = msg.envelope?.subject && WARMUP_SUBJECTS.some((s) => msg.envelope?.subject?.includes(s))
        const alreadyReplied = (msg.flags ?? new Set<string>()).has('\\Answered')
        if (isWarmup && !alreadyReplied && Math.random() < 0.4) {
          toReply.push({
            uid: msg.uid,
            from: msg.envelope?.from?.[0]?.address ?? '',
            subject: msg.envelope?.subject ?? '',
            messageId: msg.envelope?.messageId ?? '',
          })
        }
      }

      // Check Spam/Junk and rescue warmup emails
      const mailboxes = ['[Gmail]/Spam', 'Spam', 'Junk', 'Junk Email']
      for (const mailboxName of mailboxes) {
        try {
          await client.mailboxOpen(mailboxName)
          const spamUids: number[] = []
          for await (const msg of client.fetch('1:*', { envelope: true, flags: true }, { uid: true })) {
            const isWarmup = msg.envelope?.subject && WARMUP_SUBJECTS.some((s) => msg.envelope?.subject?.includes(s))
            if (isWarmup) {
              spamUids.push(msg.uid)
            }
          }
          if (spamUids.length > 0) {
            await client.messageMove(spamUids, 'INBOX', { uid: true })
            await db
              .update(warmupAccounts)
              .set({ spamRescued: warmup.spamRescued + spamUids.length })
              .where(eq(warmupAccounts.id, warmup.id))
          }
        } catch {
          // Mailbox doesn't exist, skip
        }
      }

      await client.logout()

      // Send replies via nodemailer
      for (const msg of toReply) {
        if (!msg.from) continue
        try {
          const replyBody = randomFrom(WARMUP_REPLIES)
          await sendEmail(account, {
            from: account.name,
            to: msg.from,
            subject: `Re: ${msg.subject}`,
            html: replyBody,
            headers: {
              'In-Reply-To': msg.messageId,
              References: msg.messageId,
              'X-Warmup': '1',
            },
          })
          await db
            .update(warmupAccounts)
            .set({ totalReplied: warmup.totalReplied + 1 })
            .where(eq(warmupAccounts.id, warmup.id))

          await new Promise((r) => setTimeout(r, 3_000 + Math.random() * 5_000))
        } catch (err) {
          console.error(`[warmup] reply error:`, err)
        }
      }
    } catch (err) {
      console.error(`[warmup] IMAP error for ${account.email}:`, err)
    }
  }
}

// Increases daily targets every day (ramp schedule)
async function handleRamp() {
  const accounts = await db
    .select()
    .from(warmupAccounts)
    .where(eq(warmupAccounts.status, 'active'))

  for (const wa of accounts) {
    const newTarget = Math.min(wa.dailyTarget + 2, wa.maxDailyTarget)
    await db
      .update(warmupAccounts)
      .set({ rampDay: wa.rampDay + 1, dailyTarget: newTarget, updatedAt: new Date() })
      .where(eq(warmupAccounts.id, wa.id))
  }
}
