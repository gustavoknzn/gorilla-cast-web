import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mock } from 'node:test'
import type { Server as SocketIOServer } from 'socket.io'
import { registerSignaling, type ClientToServer, type ServerToClient } from './signaling.js'
import { RoomManager, type RoomSettings } from './rooms.js'

const SECRET = 'test-secret'
const GRACE_MS = 30_000

interface OutboxMsg {
  event: string
  payload: unknown
}

class FakeIO {
  private sockets = new Map<string, FakeSocket>()
  private channels = new Map<string, Set<FakeSocket>>()
  private onConnection?: (socket: FakeSocket) => void

  on(event: string, handler: (socket: FakeSocket) => void): void {
    if (event === 'connection') this.onConnection = handler
  }

  to(target: string): { emit(event: string, payload: unknown): void } {
    return {
      emit: (event, payload) => {
        const group = this.channels.get(target)
        if (group) {
          for (const socket of group) socket.emit(event, payload)
        } else {
          this.sockets.get(target)?.emit(event, payload)
        }
      },
    }
  }

  connect(id: string): FakeSocket {
    const socket = new FakeSocket(this, id)
    this.sockets.set(id, socket)
    this.onConnection?.(socket)
    return socket
  }

  joinChannel(name: string, socket: FakeSocket): void {
    const set = this.channels.get(name) ?? new Set<FakeSocket>()
    set.add(socket)
    this.channels.set(name, set)
  }

  channelMembers(name: string): Set<FakeSocket> | undefined {
    return this.channels.get(name)
  }

  removeSocket(socket: FakeSocket): void {
    this.sockets.delete(socket.id)
  }
}

class FakeSocket {
  readonly id: string
  private handlers = new Map<string, Array<(arg?: unknown) => void>>()
  readonly outbox: OutboxMsg[] = []

  constructor(
    private server: FakeIO,
    id: string,
  ) {
    this.id = id
  }

  on(event: string, handler: (arg?: unknown) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  join(room: string): void {
    this.server.joinChannel(room, this)
  }

  to(target: string): { emit(event: string, payload: unknown): void } {
    return {
      emit: (event, payload) => {
        const group = this.server.channelMembers(target)
        if (!group) return
        for (const socket of group) {
          if (socket !== this) socket.emit(event, payload)
        }
      },
    }
  }

  emit(event: string, payload: unknown): void {
    this.outbox.push({ event, payload })
  }

  send(msg: ClientToServer): void {
    for (const handler of this.handlers.get('message') ?? []) handler(msg)
  }

  close(): void {
    for (const handler of this.handlers.get('disconnect') ?? []) handler()
    this.server.removeSocket(this)
  }

  messages(): ServerToClient[] {
    return this.outbox.filter((m) => m.event === 'message').map((m) => m.payload as ServerToClient)
  }

  lastMessage(): ServerToClient | undefined {
    const all = this.messages()
    return all[all.length - 1]
  }

  messagesOfType<T extends ServerToClient['type']>(type: T): Array<Extract<ServerToClient, { type: T }>> {
    return this.messages().filter((m): m is Extract<ServerToClient, { type: T }> => m.type === type)
  }
}

function setup(): { rooms: RoomManager; io: FakeIO } {
  const rooms = new RoomManager(SECRET)
  const io = new FakeIO()
  registerSignaling(io as unknown as SocketIOServer, rooms)
  return { rooms, io }
}

function joinBroadcaster(io: FakeIO, rooms: RoomManager, socketId = 'b1'): { roomId: string; socket: FakeSocket } {
  const created = rooms.create()
  const socket = io.connect(socketId)
  socket.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: created.ownerToken })
  return { roomId: created.roomId, socket }
}

describe('signaling', () => {
  it('broadcaster joins with a valid owner token and room goes live', () => {
    const { rooms, io } = setup()
    const created = rooms.create()
    const b1 = io.connect('b1')
    b1.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: created.ownerToken })

    const last = b1.lastMessage()
    assert.equal(last?.type, 'joined')
    if (last?.type !== 'joined') return
    assert.equal(last.role, 'broadcaster')
    assert.equal(last.state, 'live')
    assert.equal((last.settings as RoomSettings | undefined)?.video.width, 1920)
    assert.deepEqual(last.viewers, [])
    assert.equal(rooms.get(created.roomId)?.state, 'live')
    assert.equal(rooms.getBroadcaster(created.roomId), 'b1')
  })

  it('broadcaster is rejected with an invalid token', () => {
    const { rooms, io } = setup()
    const created = rooms.create()
    const b1 = io.connect('b1')
    b1.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: 'nope' })

    assert.equal(b1.lastMessage()?.type, 'join-error')
    assert.equal(rooms.get(created.roomId)?.state, 'waiting')
    assert.equal(rooms.getBroadcaster(created.roomId), null)
  })

  it('viewer join consumes the token, notifies broadcaster and bumps viewer count', () => {
    const { rooms, io } = setup()
    const { roomId, socket: b1 } = joinBroadcaster(io, rooms)
    const viewerToken = rooms.mintViewerToken(roomId)

    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })

    const joined = v1.lastMessage()
    assert.equal(joined?.type, 'joined')
    if (joined?.type !== 'joined') return
    assert.equal(joined.role, 'viewer')
    assert.ok(joined.viewerId)

    const events = b1.messagesOfType('viewer-joined')
    assert.equal(events.length, 1)
    assert.equal(events[0].socketId, 'v1')
    assert.equal(events[0].viewerId, joined.viewerId)
    const counts = b1.messagesOfType('viewer-count')
    assert.deepEqual(counts.map((c) => c.count), [1])
  })

  it('a consumed viewer token cannot join again', () => {
    const { rooms, io } = setup()
    const { roomId, socket: b1 } = joinBroadcaster(io, rooms)
    const viewerToken = rooms.mintViewerToken(roomId)

    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })
    assert.equal(v1.lastMessage()?.type, 'joined')

    const countsBefore = b1.messagesOfType('viewer-count').length
    const v2 = io.connect('v2')
    v2.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })
    const rejected = v2.lastMessage()
    assert.equal(rejected?.type, 'join-error')
    if (rejected?.type === 'join-error') assert.match(rejected.reason, /already used/)
    assert.equal(b1.messagesOfType('viewer-count').length, countsBefore)
  })

  it('relays offer/answer/candidate only between sockets in the same room', () => {
    const { rooms, io } = setup()
    const { roomId, socket: b1 } = joinBroadcaster(io, rooms)
    const viewerToken = rooms.mintViewerToken(roomId)
    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })

    v1.send({ type: 'offer', to: 'b1', sdp: { type: 'offer', sdp: 'sdp-v1' } })
    const offers = b1.messagesOfType('offer')
    assert.equal(offers.length, 1)
    assert.equal(offers[0].from, 'v1')
    assert.equal((offers[0].sdp as { type?: string }).type, 'offer')

    const outsider = io.connect('outsider')
    outsider.send({ type: 'candidate', to: 'v1', candidate: { candidate: 'x' } })
    assert.deepEqual(v1.messagesOfType('candidate'), [])

    b1.send({ type: 'answer', to: 'v1', sdp: { type: 'answer', sdp: 'sdp-b1' } })
    const answers = v1.messagesOfType('answer')
    assert.equal(answers.length, 1)
    assert.equal(answers[0].from, 'b1')
  })

  it('settings-update is broadcaster-only and reaches other room members', () => {
    const { rooms, io } = setup()
    const { roomId, socket: b1 } = joinBroadcaster(io, rooms)
    const viewerToken = rooms.mintViewerToken(roomId)
    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })
    const outboxLenAfterJoin = v1.outbox.length

    v1.send({ type: 'settings-update', settings: { video: { width: 480 }, audio: false } })
    assert.equal(b1.messagesOfType('settings-update').length, 0)

    b1.send({ type: 'settings-update', settings: { video: { width: 1280, height: 720, frameRate: 60 }, audio: false } })
    const updates = v1.messagesOfType('settings-update')
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0].settings, {
      video: { width: 1280, height: 720, frameRate: 60 },
      audio: false,
    })
    assert.equal(rooms.get(roomId)?.settings.video.frameRate, 60)
    assert.equal(v1.outbox.length, outboxLenAfterJoin + 1)
  })

  it('end-stream from the broadcaster ends the room and notifies everyone', () => {
    const { rooms, io } = setup()
    const { roomId, socket: b1 } = joinBroadcaster(io, rooms)
    const viewerToken = rooms.mintViewerToken(roomId)
    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId, role: 'viewer', token: viewerToken })

    b1.send({ type: 'end-stream' })

    assert.equal(v1.lastMessage()?.type, 'room-ended')
    assert.equal(b1.lastMessage()?.type, 'room-ended')
    assert.equal(rooms.get(roomId)?.state, 'ended')
  })

  it('broadcaster reconnect within the grace window cancels teardown', () => {
    const { rooms, io } = setup()
    const created = rooms.create()
    const b1 = io.connect('b1')
    b1.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: created.ownerToken })
    const viewerToken = rooms.mintViewerToken(created.roomId)
    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId: created.roomId, role: 'viewer', token: viewerToken })

    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      b1.close()
      mock.timers.tick(GRACE_MS / 2)

      const b2 = io.connect('b2')
      b2.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: created.ownerToken })
      assert.equal(b2.lastMessage()?.type, 'joined')

      mock.timers.tick(GRACE_MS * 10)
      assert.equal(rooms.get(created.roomId)?.state, 'live')
      assert.equal(rooms.getBroadcaster(created.roomId), 'b2')
      assert.deepEqual(v1.messagesOfType('room-ended'), [])
    } finally {
      mock.timers.reset()
    }
  })

  it('broadcaster disconnect ends the room after the grace window', () => {
    const { rooms, io } = setup()
    const created = rooms.create()
    const b1 = io.connect('b1')
    b1.send({ type: 'join', roomId: created.roomId, role: 'broadcaster', token: created.ownerToken })
    const viewerToken = rooms.mintViewerToken(created.roomId)
    const v1 = io.connect('v1')
    v1.send({ type: 'join', roomId: created.roomId, role: 'viewer', token: viewerToken })

    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      b1.close()
      mock.timers.tick(GRACE_MS - 1)
      assert.deepEqual(v1.messagesOfType('room-ended'), [])
      assert.equal(rooms.get(created.roomId)?.state, 'live')

      mock.timers.tick(1)
      assert.equal(v1.lastMessage()?.type, 'room-ended')
      assert.equal(rooms.get(created.roomId)?.state, 'ended')
    } finally {
      mock.timers.reset()
    }
  })
})
