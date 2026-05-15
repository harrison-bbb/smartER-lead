import { Router, type Router as ExpressRouter } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { sentEmails, emailEvents, linkMap } from '../db/schema.js'

export const trackingRouter: ExpressRouter = Router()

// 1×1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

trackingRouter.get('/open/:emailId', async (req, res) => {
  const { emailId } = req.params

  // Verify it exists, then fire-and-forget the event
  const [email] = await db.select().from(sentEmails).where(eq(sentEmails.id, emailId)).limit(1)
  if (email) {
    db.insert(emailEvents)
      .values({
        sentEmailId: emailId,
        type: 'opened',
        metadata: {
          ip: req.ip ?? '',
          userAgent: req.headers['user-agent'] ?? '',
        },
      })
      .catch(() => {})
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(TRANSPARENT_GIF.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  })
  res.end(TRANSPARENT_GIF)
})

trackingRouter.get('/click/:emailId/:hash', async (req, res) => {
  const { emailId, hash } = req.params

  const [link] = await db
    .select()
    .from(linkMap)
    .where(eq(linkMap.hash, hash))
    .limit(1)

  if (link) {
    db.insert(emailEvents)
      .values({
        sentEmailId: emailId,
        type: 'clicked',
        metadata: { url: link.originalUrl, ip: req.ip ?? '' },
      })
      .catch(() => {})
    res.redirect(302, link.originalUrl)
  } else {
    res.status(404).send('Link not found')
  }
})

// Unsubscribe page
trackingRouter.get('/unsub/:emailId', async (req, res) => {
  const { emailId } = req.params
  const [email] = await db.select().from(sentEmails).where(eq(sentEmails.id, emailId)).limit(1)
  if (email) {
    await db.insert(emailEvents).values({ sentEmailId: emailId, type: 'unsubscribed', metadata: {} })

    // Mark the lead as unsubscribed via campaignLead
    const { campaignLeads, leads } = await import('../db/schema.js')
    const [cl] = await db
      .select()
      .from(campaignLeads)
      .where(eq(campaignLeads.id, email.campaignLeadId))
      .limit(1)
    if (cl) {
      await db.update(campaignLeads).set({ status: 'unsubscribed' }).where(eq(campaignLeads.id, cl.id))
      await db.update(leads).set({ status: 'unsubscribed' }).where(eq(leads.id, cl.leadId))
    }
  }
  res.send('<html><body><h2>You have been unsubscribed.</h2><p>You will no longer receive emails from this sender.</p></body></html>')
})
