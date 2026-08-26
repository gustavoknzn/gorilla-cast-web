import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  signToken,
  verifyToken,
  type OwnerTokenPayload,
  type TokenPayload,
  type ViewerTokenPayload,
} from './tokens.js'

const SECRET = 'test-secret'
const FUTURE_EXP = Date.now() + 60_000

describe('signToken/verifyToken', () => {
  it('round-trips an owner payload', () => {
    const payload: OwnerTokenPayload = { roomId: 'room-1', role: 'owner', exp: FUTURE_EXP }
    const token = signToken(payload, SECRET)
    assert.equal(token.split('.').length, 2)
    assert.deepEqual(verifyToken<OwnerTokenPayload>(token, SECRET), payload)
  })

  it('round-trips a viewer payload', () => {
    const payload: ViewerTokenPayload = { roomId: 'room-1', viewerId: 'v-1', role: 'viewer', exp: FUTURE_EXP }
    const token = signToken(payload, SECRET)
    assert.deepEqual(verifyToken<ViewerTokenPayload>(token, SECRET), payload)
  })

  it('rejects a token signed with a different secret', () => {
    const payload: OwnerTokenPayload = { roomId: 'room-1', role: 'owner', exp: FUTURE_EXP }
    const token = signToken(payload, SECRET)
    assert.equal(verifyToken<OwnerTokenPayload>(token, 'other-secret'), null)
  })

  it('rejects a tampered payload', () => {
    const payload: OwnerTokenPayload = { roomId: 'room-1', role: 'owner', exp: FUTURE_EXP }
    const token = signToken(payload, SECRET)
    const sig = token.slice(token.lastIndexOf('.') + 1)
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, roomId: 'room-2' }),
    ).toString('base64url')
    assert.equal(verifyToken<OwnerTokenPayload>(`${forgedBody}.${sig}`, SECRET), null)
  })

  it('rejects a signature tampered with valid base64url chars', () => {
    const payload: OwnerTokenPayload = { roomId: 'room-1', role: 'owner', exp: FUTURE_EXP }
    const token = signToken(payload, SECRET)
    const body = token.slice(0, token.lastIndexOf('.'))
    const flipped = (token[token.lastIndexOf('.') + 1] === 'A' ? 'B' : 'A') + token.slice(token.lastIndexOf('.') + 2)
    assert.equal(verifyToken<OwnerTokenPayload>(`${body}.${flipped}`, SECRET), null)
  })

  it('rejects an expired token', () => {
    const payload: OwnerTokenPayload = { roomId: 'room-1', role: 'owner', exp: Date.now() - 1000 }
    assert.equal(verifyToken<OwnerTokenPayload>(signToken(payload, SECRET), SECRET), null)
  })

  it('rejects payloads without a numeric exp', () => {
    const bad = { roomId: 'room-1', role: 'owner', exp: 'soon' } as unknown as TokenPayload
    assert.equal(verifyToken(signToken(bad, SECRET), SECRET), null)
  })

  it('rejects malformed tokens', () => {
    for (const token of ['', '.', '..', 'abc', 'a.b', `${Buffer.from('{"exp":1}').toString('base64url')}.`]) {
      assert.equal(verifyToken(token, SECRET), null)
    }
  })
})
