import { SignJWT, jwtVerify } from 'jose'

const jwtSecret = process.env.JWT_SECRET
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET
if (!jwtSecret || jwtSecret.startsWith('change_me')) throw new Error('JWT_SECRET env var must be set to a secure value')
if (!jwtRefreshSecret || jwtRefreshSecret.startsWith('change_me')) throw new Error('JWT_REFRESH_SECRET env var must be set to a secure value')

const ACCESS_SECRET = new TextEncoder().encode(jwtSecret)
const REFRESH_SECRET = new TextEncoder().encode(jwtRefreshSecret)

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(ACCESS_SECRET)
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(REFRESH_SECRET)
}

export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, ACCESS_SECRET)
  return payload.sub as string
}

export async function verifyRefreshToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, REFRESH_SECRET)
  return payload.sub as string
}
