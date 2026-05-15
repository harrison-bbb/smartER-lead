import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { decrypt } from './crypto.js'
import type { emailAccounts } from '../db/schema.js'

type EmailAccount = typeof emailAccounts.$inferSelect

export interface SendOptions {
  from: string
  to: string
  subject: string
  html: string
  text?: string          // plain text alternative (auto-generated from html if omitted)
  sentEmailId?: string   // used to build List-Unsubscribe URL
  replyTo?: string
  headers?: Record<string, string>
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildTransporter(account: EmailAccount): Transporter {
  if (!account.encryptedPassword || !account.encryptedUsername) {
    throw new Error('Email account credentials not set')
  }
  const user = decrypt(account.encryptedUsername)
  const pass = decrypt(account.encryptedPassword)

  if (account.provider === 'gmail') {
    // OAuth2 refresh tokens are long (>100 chars); app passwords are 16 chars
    const isOAuth = pass.length > 100
    if (isOAuth) {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          refreshToken: pass,
        },
      })
    }
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  }

  return nodemailer.createTransport({
    host: account.smtpHost ?? '',
    port: account.smtpPort ?? 587,
    secure: account.smtpSecure ?? true,
    auth: { user, pass },
  })
}

export async function sendEmail(account: EmailAccount, opts: SendOptions) {
  const transporter = buildTransporter(account)
  const displayName = account.senderName?.trim() || opts.from
  const plainText = opts.text ?? stripHtml(opts.html)

  // Build List-Unsubscribe headers when we have a sentEmailId
  const unsubHeaders: Record<string, string> = {}
  if (opts.sentEmailId) {
    const trackingDomain = process.env.TRACKING_DOMAIN ?? 'http://localhost:3001'
    const unsubUrl = `${trackingDomain}/track/unsub/${opts.sentEmailId}`
    unsubHeaders['List-Unsubscribe'] = `<${unsubUrl}>`
    unsubHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  const wrappedHtml = opts.html.trimStart().startsWith('<html') ? opts.html : `<html><body>${opts.html}</body></html>`

  const info = await transporter.sendMail({
    from: `${displayName} <${account.email}>`,
    to: opts.to,
    subject: opts.subject,
    html: wrappedHtml,
    text: plainText,
    replyTo: opts.replyTo,
    headers: { ...unsubHeaders, ...opts.headers },
  })
  return info
}

export async function testConnection(account: EmailAccount): Promise<void> {
  const transporter = buildTransporter(account)
  await transporter.verify()
}
