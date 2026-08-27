import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_VIEWER_TOKENS, RoomManager } from './rooms.js'
import { signToken, verifyToken, type OwnerTokenPayload } from './tokens.js'

const SECRET = 'test-secret'

describe('RoomManager', () => {
  it('exposes MAX_VIEWER_TOKENS', () => {
    assert.equal(MAX_VIEWER_TOKENS, 10)
  })

  it('creates a room with owner + initial viewer tokens', () => {
    const rooms = new RoomManager(SECRET)
    const result = rooms.create()
    assert.ok(result.roomId && result.ownerId)
    const owner = verifyToken<OwnerTokenPayload>(result.ownerToken, SECRET)
    assert.equal(owner?.role, 'owner')
    assert.equal(owner?.roomId, result.roomId)
    assert.equal(result.viewerTokens.length, 1)
    assert.equal(rooms.get(result.roomId)?.state, 'waiting')
  })

  it('applies partial settings on create', () => {
    const rooms = new RoomManager(SECRET)
    const room = rooms.get(rooms.create({ video: { width: 1280, height: 720, frameRate: 60 } }).roomId)
    assert.deepEqual(room?.settings, {
      video: { width: 1280, height: 720, frameRate: 60 },
      audio: true,
    })
  })

  it('verifyOwner accepts only the owner token for the matching room', () => {
    const rooms = new RoomManager(SECRET)
    const a = rooms.create()
    const b = rooms.create()
    assert.equal(rooms.verifyOwner(a.roomId, a.ownerToken)?.id, a.roomId)
    assert.equal(rooms.verifyOwner(a.roomId, b.ownerToken), null)
    assert.equal(rooms.verifyOwner(b.roomId, a.ownerToken), null)
    assert.equal(rooms.verifyOwner(a.roomId, a.viewerTokens[0]), null)
    assert.equal(rooms.verifyOwner(a.roomId, 'garbage'), null)
  })

  it('viewer tokens allow reconnection of same viewerId, prevent cross-room reuse', () => {
    const rooms = new RoomManager(SECRET)
    const a = rooms.create()
    const b = rooms.create()
    const first = rooms.consumeViewerToken(a.roomId, a.viewerTokens[0])
    assert.ok(first?.viewerId)
    // same token again -> allowed (reconnection), returns same viewerId
    const second = rooms.consumeViewerToken(a.roomId, a.viewerTokens[0])
    assert.ok(second?.viewerId)
    assert.equal(second.viewerId, first.viewerId)
    // cross-room reuse -> rejected
    assert.equal(rooms.consumeViewerToken(b.roomId, a.viewerTokens[0]), null)
    assert.ok(rooms.consumeViewerToken(b.roomId, b.viewerTokens[0]))
  })

  it('rejects expired or forged viewer tokens', () => {
    const rooms = new RoomManager(SECRET)
    const { roomId } = rooms.create()
    const expired = signToken(
      { roomId, role: 'viewer', viewerId: 'gone', exp: Date.now() - 1000 },
      SECRET,
    )
    assert.equal(rooms.consumeViewerToken(roomId, expired), null)
    const wrongRoom = signToken(
      { roomId: 'other', role: 'viewer', viewerId: 'x', exp: Date.now() + 60_000 },
      SECRET,
    )
    assert.equal(rooms.consumeViewerToken(roomId, wrongRoom), null)
  })

  it('mintViewerToken issues fresh consumable tokens', () => {
    const rooms = new RoomManager(SECRET)
    const { roomId } = rooms.create()
    const t1 = rooms.mintViewerToken(roomId)
    const t2 = rooms.mintViewerToken(roomId)
    assert.notEqual(t1, t2)
    assert.ok(rooms.consumeViewerToken(roomId, t1))
    assert.ok(rooms.consumeViewerToken(roomId, t2))
  })

  it('updateSettings merges partial settings and rejects unknown rooms', () => {
    const rooms = new RoomManager(SECRET)
    const { roomId } = rooms.create()
    let s = rooms.updateSettings(roomId, { video: { width: 1280, height: 720, frameRate: 30 } })
    assert.deepEqual(s, { video: { width: 1280, height: 720, frameRate: 30 }, audio: true })
    s = rooms.updateSettings(roomId, { audio: false })
    assert.deepEqual(s, { video: { width: 1280, height: 720, frameRate: 30 }, audio: false })
    s = rooms.updateSettings(roomId, { video: { width: 1920, height: 1080, frameRate: 60 }, audio: false })
    assert.deepEqual(s, { video: { width: 1920, height: 1080, frameRate: 60 }, audio: false })
    assert.equal(rooms.updateSettings('nope', { audio: false }), null)
  })

  it('tracks broadcaster socket id and flips state to live', () => {
    const rooms = new RoomManager(SECRET)
    const { roomId } = rooms.create()
    assert.equal(rooms.getBroadcaster(roomId), null)
    assert.ok(rooms.setBroadcaster(roomId, 'sock-1'))
    assert.equal(rooms.getBroadcaster(roomId), 'sock-1')
    assert.equal(rooms.get(roomId)?.state, 'live')
    assert.equal(rooms.setBroadcaster('nope', 'sock-1'), false)
  })

  it('add/removeConnectedViewer', () => {
    const rooms = new RoomManager(SECRET)
    const { roomId } = rooms.create()
    assert.ok(rooms.addConnectedViewer(roomId, 'v1'))
    assert.equal(rooms.get(roomId)?.connectedViewerIds.has('v1'), true)
    rooms.removeConnectedViewer(roomId, 'v1')
    assert.equal(rooms.get(roomId)?.connectedViewerIds.size, 0)
    assert.equal(rooms.addConnectedViewer('nope', 'v1'), false)
  })

  it('end() is idempotent and locks the room down', () => {
    const rooms = new RoomManager(SECRET)
    const created = rooms.create()
    const { roomId } = created
    assert.ok(rooms.end(roomId))
    assert.equal(rooms.end(roomId), false)
    assert.equal(rooms.get(roomId)?.state, 'ended')
    assert.throws(() => rooms.mintViewerToken(roomId), /not available/)
    assert.equal(rooms.consumeViewerToken(roomId, created.viewerTokens[0]), null)
    assert.equal(rooms.setBroadcaster(roomId, 'sock-1'), true)
  })

  it('peekTokenRole reports validity per role and honors ended rooms', () => {
    const rooms = new RoomManager(SECRET)
    const created = rooms.create()
    assert.deepEqual(rooms.peekTokenRole(created.ownerToken), {
      valid: true,
      role: 'owner',
      roomId: created.roomId,
    })
    assert.deepEqual(rooms.peekTokenRole(created.viewerTokens[0]), {
      valid: true,
      role: 'viewer',
      roomId: created.roomId,
    })
    assert.deepEqual(rooms.peekTokenRole('nope'), { valid: false, role: null, roomId: null })
    rooms.end(created.roomId)
    assert.equal(rooms.peekTokenRole(created.ownerToken).valid, false)
  })

  it('cleanup() removes expired and ended rooms, keeps active ones', () => {
    const rooms = new RoomManager(SECRET)
    const expired = rooms.create()
    const ended = rooms.create()
    const active = rooms.create()
    const expiredRoom = rooms.get(expired.roomId)
    assert.ok(expiredRoom)
    expiredRoom.expiresAt = Date.now() - 1
    rooms.end(ended.roomId)
    rooms.cleanup()
    assert.equal(rooms.get(expired.roomId), undefined)
    assert.equal(rooms.get(ended.roomId), undefined)
    assert.ok(rooms.get(active.roomId))
  })

  it('status() exposes room summary', () => {
    const rooms = new RoomManager(SECRET)
    const created = rooms.create()
    const room = rooms.get(created.roomId)
    assert.ok(room)
    rooms.addConnectedViewer(created.roomId, 'v1')
    const status = rooms.status(room)
    assert.deepEqual(Object.keys(status).sort(), [
      'createdAt',
      'expiresAt',
      'id',
      'roomName',
      'settings',
      'state',
      'viewers',
    ])
    assert.equal(status.viewers, 1)
    assert.equal(status.state, 'waiting')
    assert.equal(typeof status.roomName, 'string')
    assert.ok(status.roomName.length > 0)
  })
})
