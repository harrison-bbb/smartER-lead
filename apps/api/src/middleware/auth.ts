import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/jwt.js'

export interface AuthRequest extends Request {
  userId: string
}

export function auth(req: Request): AuthRequest {
  return req as unknown as AuthRequest
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' })
    return
  }
  const token = header.slice(7)
  try {
    const userId = await verifyAccessToken(token)
    ;(req as unknown as AuthRequest).userId = userId
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
