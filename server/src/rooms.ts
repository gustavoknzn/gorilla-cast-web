import crypto from 'node:crypto'
import { signToken, verifyToken, type OwnerTokenPayload, type ViewerTokenPayload } from './tokens.js'

export interface RoomSettings {
  video: { width: number; height: number; frameRate: number }
  audio: boolean
}

export type RoomState = 'waiting' | 'live' | 'ended'

const DEFAULT_SETTINGS: RoomSettings = {
  video: { width: 1920, height: 1080, frameRate: 30 },
  audio: true,
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000 // 24h
export const MAX_VIEWER_TOKENS = 10

const MONKEY_NAMES = [
  'Gorila',
  'Chimpanzé',
  'Orangotango',
  'Gibão',
  'Mandrill',
  'Babuíno',
  'Macaco-aranha',
  'Uacari',
  'Sagui',
  'Mico',
  'Cebus',
  'Macaco-prego',
  'Bugio',
  'Guariba',
  'Sauá',
  'Cuxiú',
  'Macaco-da-noite',
  'Saimiri',
  'Titi',
  'Macaque',
]

function randomMonkeyName(): string {
  return MONKEY_NAMES[Math.floor(Math.random() * MONKEY_NAMES.length)]
}

interface Room {
  id: string
  ownerId: string
  createdAt: number
  expiresAt: number
  settings: RoomSettings
  state: RoomState
  broadcasterSocketId: string | null
  connectedViewerIds: Set<string>
  usedViewerIds: Set<string>
  roomName: string
}

export interface CreateRoomResult {
  roomId: string
  ownerId: string
  ownerToken: string
  viewerTokens: string[]
}

function shortId(): string {
  return crypto.randomUUID()
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private secret: string

  constructor(secret: string) {
    this.secret = secret
    // unref so the cleanup timer alone never keeps the process alive
    setInterval(() => this.cleanup(), 60_000).unref()
  }

  create(settings?: Partial<RoomSettings>): CreateRoomResult {
    const roomId = shortId()
    const ownerId = shortId()
    const now = Date.now()

    const room: Room = {
      id: roomId,
      ownerId,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      settings: {
        video: { ...DEFAULT_SETTINGS.video, ...settings?.video },
        audio: settings?.audio ?? DEFAULT_SETTINGS.audio,
      },
      state: 'waiting',
      broadcasterSocketId: null,
      connectedViewerIds: new Set(),
      usedViewerIds: new Set(),
      roomName: randomMonkeyName(),
    }
    this.rooms.set(roomId, room)

    const ownerToken = this.signOwnerToken(room)
    const viewerTokens = [this.mintViewerToken(room)]

    return { roomId, ownerId, ownerToken, viewerTokens }
  }

  private signOwnerToken(room: Room): string {
    const payload: OwnerTokenPayload = { roomId: room.id, role: 'owner', exp: room.expiresAt }
    return signToken(payload, this.secret)
  }

  mintViewerToken(roomOrId: Room | string): string {
    const room = typeof roomOrId === 'string' ? this.get(roomOrId) : roomOrId
    if (!room || room.state === 'ended') throw new Error('room not available')
    const payload: ViewerTokenPayload = {
      roomId: room.id,
      role: 'viewer',
      viewerId: shortId(),
      exp: Math.min(Date.now() + ROOM_TTL_MS, room.expiresAt),
    }
    return signToken(payload, this.secret)
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  verifyOwner(roomId: string, token: string): Room | null {
    const payload = verifyToken<OwnerTokenPayload>(token, this.secret)
    if (!payload || payload.role !== 'owner') return null
    const room = this.rooms.get(roomId)
    if (!room || payload.roomId !== roomId) return null
    return room
  }

  consumeViewerToken(roomId: string, token: string): { viewerId: string } | null {
    const payload = verifyToken<ViewerTokenPayload>(token, this.secret)
    if (!payload || payload.role !== 'viewer' || payload.roomId !== roomId) return null
    if (payload.exp < Date.now()) return null
    const room = this.rooms.get(roomId)
    if (!room || room.state === 'ended') return null
    if (!room.usedViewerIds.has(payload.viewerId)) {
      room.usedViewerIds.add(payload.viewerId)
    }
    return { viewerId: payload.viewerId }
  }

  peekTokenRole(token: string): { valid: boolean; role: 'owner' | 'viewer' | null; roomId: string | null } {
    for (const role of ['owner', 'viewer'] as const) {
      const payload =
        role === 'owner'
          ? verifyToken<OwnerTokenPayload>(token, this.secret)
          : verifyToken<ViewerTokenPayload>(token, this.secret)
      const room = payload ? this.rooms.get(payload.roomId) : undefined
      if (payload && payload.role === role && room && room.state !== 'ended') {
        return { valid: true, role, roomId: payload.roomId }
      }
    }
    return { valid: false, role: null, roomId: null }
  }

  setBroadcaster(roomId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.broadcasterSocketId = socketId
    if (room.state !== 'ended') room.state = 'live'
    return true
  }

  getBroadcaster(roomId: string): string | null {
    return this.rooms.get(roomId)?.broadcasterSocketId ?? null
  }

  addConnectedViewer(roomId: string, viewerId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.connectedViewerIds.add(viewerId)
    return true
  }

  removeConnectedViewer(roomId: string, viewerId: string): void {
    this.rooms.get(roomId)?.connectedViewerIds.delete(viewerId)
  }

  updateSettings(roomId: string, settings: Partial<RoomSettings>): RoomSettings | null {
    const room = this.rooms.get(roomId)
    if (!room) return null
    room.settings = {
      video: { ...room.settings.video, ...settings.video },
      audio: settings.audio ?? room.settings.audio,
    }
    return room.settings
  }

  end(roomId: string): boolean {
    const room = this.rooms.get(roomId)
    if (!room || room.state === 'ended') return false
    room.state = 'ended'
    return true
  }

  cleanup(): void {
    const now = Date.now()
    for (const [id, room] of this.rooms) {
      if (room.expiresAt < now || room.state === 'ended') this.rooms.delete(id)
    }
  }

  status(room: Room) {
    return {
      id: room.id,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      settings: room.settings,
      state: room.state,
      viewers: room.connectedViewerIds.size,
      roomName: room.roomName,
    }
  }
}
