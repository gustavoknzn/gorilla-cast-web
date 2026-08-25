import crypto from 'node:crypto'

export interface OwnerTokenPayload {
  roomId: string
  role: 'owner'
  exp: number
}

export interface ViewerTokenPayload {
  roomId: string
  viewerId: string
  role: 'viewer'
  exp: number
}

export type TokenPayload = OwnerTokenPayload | ViewerTokenPayload

function hmac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url')
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(secret, body)}`
}

export function verifyToken<T extends TokenPayload>(token: string, secret: string): T | null {
  if (typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(secret, body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
