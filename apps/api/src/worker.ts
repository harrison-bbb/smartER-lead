import 'dotenv/config'
import cron from 'node-cron'
import { startCampaignWorker, campaignSendQueue } from './queues/campaign-send.js'
import { startWarmupWorker, warmupQueue } from './queues/warmup.js'
import { startReplyDetectWorker, replyDetectQueue } from './queues/reply-detect.js'
import { db } from './db/index.js'
import { campaigns } from './db/schema.js'
import { eq } from 'drizzle-orm'

console.log('[worker] Starting BullMQ workers...')

const campaignWorker = startCampaignWorker()
const warmupWorker = startWarmupWorker()
const replyWorker = startReplyDetectWorker()

// Every day at 7 AM: schedule campaign sends for all active campaigns
cron.schedule('0 7 * * *', async () => {
  console.log('[cron] Scheduling campaign sends...')
  const active = await db.select().from(campaigns).where(eq(campaigns.status, 'active'))
  for (const c of active) {
    await campaignSendQueue.add('schedule', { campaignId: c.id })
  }
  console.log(`[cron] Scheduled ${active.length} campaigns`)
})

// Every day at 8 AM: trigger warmup sends
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Starting warmup sends...')
  await warmupQueue.add('send', {})
})

// Every day at midnight: ramp up warmup accounts
cron.schedule('0 0 * * *', async () => {
  console.log('[cron] Ramping warmup accounts...')
  await warmupQueue.add('ramp', {})
})

// Every 30 minutes: warmup reply detection
cron.schedule('*/30 * * * *', async () => {
  await warmupQueue.add('reply', {}, { jobId: `reply-${Date.now()}` })
})

// Every 15 minutes: campaign reply detection
cron.schedule('*/15 * * * *', async () => {
  await replyDetectQueue.add('scan', {}, { jobId: `scan-${Date.now()}` })
})

console.log('[worker] All workers and cron jobs active')

process.on('SIGTERM', async () => {
  console.log('[worker] Shutting down...')
  await campaignWorker.close()
  await warmupWorker.close()
  await replyWorker.close()
  process.exit(0)
})
