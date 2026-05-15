import { google, type Auth } from 'googleapis'

const SCOPES = [
  'https://mail.google.com/', // Full Gmail access (needed for SMTP + IMAP)
]

export function getOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/auth/google/callback',
  )
}

export function getAuthUrl(state: string): string {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent screen so we always get a refresh_token
    state,
  })
}

export async function exchangeCode(code: string): Promise<Auth.Credentials> {
  const client = getOAuthClient()
  const { tokens } = await client.getToken(code)
  return tokens
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const client = getOAuthClient()
  client.setCredentials({ access_token: accessToken })
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  return profile.data.emailAddress ?? ''
}
