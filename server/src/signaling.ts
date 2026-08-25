import type { Server, Socket } from 'socket.io'
import type { RoomManager } from './rooms.js'

export interface JoinMessage {
  roomId: string
  role: 'broadcaster' | 'viewer'
  token: string
}

export type ClientToServer =
  | JoinMessage & { type: 'join' }
  | { type: 'offer'; to: string; sdp: unknown }
  | { type: 'answer'; to: string; sdp: unknown }
  | { type: 'candidate'; to: string; candidate: unknown }
  | { type: 'settings-update'; settings: unknown }
  | { type: 'end-stream' }

export interface ViewerRef {
  socketId: string
  viewerId: string
}

export type ServerToClient =
  | { type: 'joined'; role: 'broadcaster' | 'viewer'; viewerId?: string; state: string; settings?: unknown; viewers?: ViewerRef[] }
  | { type: 'join-error'; reason: string }
  | { type: 'viewer-joined'; viewerId: string; socketId: string }
  | { type: 'viewer-left'; viewerId: string }
  | { type: 'viewer-count'; count: number }
  | { type: 'settings-update'; settings: unknown }
  | { type: 'room-ended' }
  | { type: 'offer'; from: string; sdp: unknown }
  | { type: 'answer'; from: string; sdp: unknown }
  | { type: 'candidate'; from: string; candidate: unknown }

interface SocketMeta {
  roomId?: string
  role?: 'broadcaster' | 'viewer'
  viewerId?: string
}

const meta = new Map<string, SocketMeta>()
const roomSockets = new Map<string, Map<string, SocketMeta>>()

function roomChannel(roomId: string): string {
  return `room:${roomId}`
}

function joinRegistry(roomId: string, socketId: string, m: SocketMeta): void {
  let set = roomSockets.get(roomId)
  if (!set) {
    set = new Map()
    roomSockets.set(roomId, set)
  }
  set.set(socketId, m)
}

function leaveRegistry(roomId: string, socketId: string): void {
  const set = roomSockets.get(roomId)
  if (!set) return
  set.delete(socketId)
  if (set.size === 0) roomSockets.delete(roomId)
}

function listViewers(roomId: string): ViewerRef[] {
  const set = roomSockets.get(roomId)
  if (!set) return []
  const out: ViewerRef[] = []
  for (const [socketId, m] of set) {
    if (m.role === 'viewer' && m.viewerId) out.push({ socketId, viewerId: m.viewerId })
  }
  return out
}

function broadcastViewerCount(io: Server, rooms: RoomManager, roomId: string): void {
  const room = rooms.get(roomId)
  if (!room) return
  const broadcaster = rooms.getBroadcaster(roomId)
  const msg: ServerToClient = { type: 'viewer-count', count: room.connectedViewerIds.size }
  io.to(broadcaster ?? `nope:${roomId}`).emit('message', msg)
}

export function registerSignaling(io: Server, rooms: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    meta.set(socket.id, {})

    socket.on('message', (msg: ClientToServer) => {
      const m = meta.get(socket.id) ?? {}

      switch (msg.type) {
        case 'join': {
          if (m.roomId) return
          if (msg.role === 'broadcaster') {
            const room = rooms.verifyOwner(msg.roomId, msg.token)
            if (!room || room.state === 'ended') {
              socket.emit('message', { type: 'join-error', reason: 'invalid owner token or room ended' } satisfies ServerToClient)
              return
            }
            rooms.setBroadcaster(room.id, socket.id)
            m.roomId = room.id
            m.role = 'broadcaster'
            meta.set(socket.id, m)
            joinRegistry(room.id, socket.id, m)
            socket.join(roomChannel(room.id))
            socket.emit('message', {
              type: 'joined',
              role: 'broadcaster',
              state: room.state,
              settings: room.settings,
              viewers: listViewers(room.id),
            } satisfies ServerToClient)
          } else {
            const result = rooms.consumeViewerToken(msg.roomId, msg.token)
            if (!result) {
              socket.emit('message', { type: 'join-error', reason: 'invalid or already used viewer token' } satisfies ServerToClient)
              return
            }
            rooms.addConnectedViewer(msg.roomId, result.viewerId)
            m.roomId = msg.roomId
            m.role = 'viewer'
            m.viewerId = result.viewerId
            meta.set(socket.id, m)
            joinRegistry(msg.roomId, socket.id, m)
            socket.join(roomChannel(msg.roomId))
            socket.emit('message', {
              type: 'joined',
              role: 'viewer',
              viewerId: result.viewerId,
              state: rooms.get(msg.roomId)?.state ?? 'waiting',
            } satisfies ServerToClient)

            const broadcaster = rooms.getBroadcaster(msg.roomId)
            if (broadcaster) {
              io.to(broadcaster).emit('message', {
                type: 'viewer-joined',
                viewerId: result.viewerId,
                socketId: socket.id,
              } satisfies ServerToClient)
            }
            broadcastViewerCount(io, rooms, msg.roomId)
          }
          break
        }

        case 'offer':
        case 'answer':
        case 'candidate': {
          // relay only inside same room
          if (!m.roomId) return
          const relay: ServerToClient =
            msg.type === 'candidate'
              ? { type: 'candidate', from: socket.id, candidate: msg.candidate }
              : { type: msg.type, from: socket.id, sdp: msg.sdp }
          io.to(msg.to).emit('message', relay)
          break
        }

        case 'settings-update': {
          if (!m.roomId || m.role !== 'broadcaster') return
          const settings = rooms.updateSettings(m.roomId, msg.settings as never)
          if (!settings) return
          socket.to(roomChannel(m.roomId)).emit('message', { type: 'settings-update', settings } satisfies ServerToClient)
          break
        }

        case 'end-stream': {
          if (!m.roomId || m.role !== 'broadcaster') return
          endRoom(io, rooms, m.roomId)
          break
        }
      }
    })

    socket.on('disconnect', () => {
      const m = meta.get(socket.id)
      meta.delete(socket.id)
      if (!m?.roomId) return

      if (m.role === 'viewer' && m.viewerId) {
        leaveRegistry(m.roomId, socket.id)
        rooms.removeConnectedViewer(m.roomId, m.viewerId)
        const broadcaster = rooms.getBroadcaster(m.roomId)
        if (broadcaster) {
          io.to(broadcaster).emit('message', { type: 'viewer-left', viewerId: m.viewerId } satisfies ServerToClient)
        }
        broadcastViewerCount(io, rooms, m.roomId)
      } else if (m.role === 'broadcaster') {
        // broadcaster left abruptly → close the room
        endRoom(io, rooms, m.roomId)
      }
    })
  })
}

export function endRoom(io: Server, rooms: RoomManager, roomId: string): void {
  if (!rooms.end(roomId)) return
  io.to(roomChannel(roomId)).emit('message', { type: 'room-ended' } satisfies ServerToClient)
  const room = rooms.get(roomId)
  if (room) {
    room.connectedViewerIds.clear()
  }
  roomSockets.delete(roomId)
}
