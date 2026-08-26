export interface RoomSettings {
  video: { width: number; height: number; frameRate: number }
  audio: boolean
}

export interface ViewerRef {
  socketId: string
  viewerId: string
  name?: string
}

export interface CreateRoomResponse {
  roomId: string
  ownerId: string
  ownerToken: string
  viewerTokens: string[]
}

export type ServerMessage =
  | {
      type: 'joined'
      role: 'broadcaster' | 'viewer'
      viewerId?: string
      state: string
      settings?: RoomSettings
      viewers?: ViewerRef[]
    }
  | { type: 'join-error'; reason: string }
  | { type: 'viewer-joined'; viewerId: string; socketId: string; name?: string }
  | { type: 'viewer-left'; viewerId: string; socketId: string }
  | { type: 'viewer-count'; count: number }
  | { type: 'settings-update'; settings: RoomSettings }
  | { type: 'room-ended' }
  | { type: 'offer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; from: string; candidate: RTCIceCandidateInit }

export type ClientMessage =
  | { type: 'join'; roomId: string; role: 'broadcaster' | 'viewer'; token: string; name?: string }
  | { type: 'offer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; to: string; candidate: RTCIceCandidateInit }
  | { type: 'settings-update'; settings: RoomSettings }
  | { type: 'end-stream' }
  | { type: 'kick-viewer'; viewerId: string }

export const RESOLUTIONS = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: '480p', width: 854, height: 480 },
] as const

export const FPS_OPTIONS = [15, 24, 30, 60] as const

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
]
