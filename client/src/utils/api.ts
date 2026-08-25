import type { CreateRoomResponse, RoomSettings } from '../types'

const API_BASE: string = import.meta.env.VITE_SERVER_URL ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

export async function createRoom(settings?: Partial<RoomSettings>): Promise<CreateRoomResponse> {
  const res = await fetch(apiUrl('/api/rooms'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
  })
  if (!res.ok) throw new Error(`falha ao criar sala (${res.status})`)
  return res.json() as Promise<CreateRoomResponse>
}

export async function mintViewerToken(roomId: string, ownerToken: string, count = 1): Promise<string[]> {
  const res = await fetch(apiUrl(`/api/rooms/${roomId}/viewer-tokens`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ count }),
  })
  if (!res.ok) throw new Error(`falha ao gerar token (${res.status})`)
  const data = (await res.json()) as { viewerTokens: string[] }
  return data.viewerTokens
}
