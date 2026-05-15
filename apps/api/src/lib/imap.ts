import { ImapFlow } from 'imapflow'
import { decrypt } from './crypto.js'
import { getOAuthClient } from './google-oauth.js'
import type { emailAccounts } from '../db/schema.js'

type EmailAccount = typeof emailAccounts.$inferSelect

export interface ImapMessage {
  uid: number
  messageId?: string
  subject?: string
  from?: string
  date?: Date
  flags: Set<string>
  mailbox: string
}

async function getLiveAccessToken(refreshToken: string): Promise<string> {
  const client = getOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await client.refreshAccessToken()
  if (!credentials.access_token) throw new Error('Failed to refresh Gmail access token')
  return credentials.access_token
}

export async function buildImapClient(account: EmailAccount): Promise<ImapFlow> {
  if (!account.encryptedPassword || !account.encryptedUsername) {
    throw new Error('Email account credentials not set')
  }
  const user = decrypt(account.encryptedUsername)
  const pass = decrypt(account.encryptedPassword)

  const host = account.imapHost ?? (account.provider === 'gmail' ? 'imap.gmail.com' : account.smtpHost ?? '')
  const port = account.imapPort ?? 993
  const secure = account.imapSecure ?? true

  // OAuth2 Gmail: refresh token is long (>100 chars); app passwords are 16 chars
  const isOAuth = account.provider === 'gmail' && pass.length > 100
  if (isOAuth) {
    const accessToken = await getLiveAccessToken(pass)
    return new ImapFlow({
      host,
      port,
      secure,
      auth: { user, accessToken },
      logger: false,
    })
  }

  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  })
}

export async function fetchUnreadMessages(
  account: EmailAccount,
  mailbox = 'INBOX',
  limit = 50,
): Promise<ImapMessage[]> {
  const client = await buildImapClient(account)
  const messages: ImapMessage[] = []

  await client.connect()
  try {
    await client.mailboxOpen(mailbox)
    for await (const msg of client.fetch('1:*', { envelope: true, flags: true }, { uid: true })) {
      messages.push({
        uid: msg.uid,
        messageId: msg.envelope?.messageId,
        subject: msg.envelope?.subject,
        from: msg.envelope?.from?.[0]?.address,
        date: msg.envelope?.date,
        flags: msg.flags ?? new Set<string>(),
        mailbox,
      })
      if (messages.length >= limit) break
    }
  } finally {
    await client.logout()
  }
  return messages
}

export async function fetchAllMailboxes(account: EmailAccount): Promise<string[]> {
  const client = await buildImapClient(account)
  const names: string[] = []
  await client.connect()
  try {
    const mailboxes = await client.list()
    for (const mailbox of mailboxes) {
      names.push(mailbox.path)
    }
  } finally {
    await client.logout()
  }
  return names
}

export async function replyToMessage(
  account: EmailAccount,
  originalMessageId: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const { buildTransporter } = await import('./mailer.js')
  const transporter = buildTransporter(account)
  await transporter.sendMail({
    from: account.email,
    to,
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    html,
    inReplyTo: originalMessageId,
    references: originalMessageId,
  })
}

export async function moveToInbox(account: EmailAccount, uid: number, fromMailbox: string): Promise<void> {
  const client = await buildImapClient(account)
  await client.connect()
  try {
    await client.mailboxOpen(fromMailbox)
    await client.messageMove([uid], 'INBOX', { uid: true })
  } finally {
    await client.logout()
  }
}

export async function markNotSpam(account: EmailAccount, uid: number, spamMailbox: string): Promise<void> {
  const client = await buildImapClient(account)
  await client.connect()
  try {
    await client.mailboxOpen(spamMailbox)
    await client.messageFlagsRemove([uid], ['\\Junk'], { uid: true })
    await client.messageMove([uid], 'INBOX', { uid: true })
  } finally {
    await client.logout()
  }
}
