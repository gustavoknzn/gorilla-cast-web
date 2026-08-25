import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ClientMessage, RoomSettings, ServerMessage } from '../types'

export type RoomStatus = 'connecting' | 'connected' | 'error'

interface UseRoomParams {
  roomId: string
  role: 'broadcaster' | 'viewer'
  token: string
}

const WS_PATH = '/ws'

export function useRoom({ roomId, role, token }: UseRoomParams) {
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [roomState, setRoomState] = useState<string | null>(null)
  const [settings, setSettings] = useState<RoomSettings | null>(null)
  const [viewerCount, setViewerCount] = useState(0)
  const [ended, setEnded] = useState(false)
  const [initialViewers, setInitialViewers] = useState<{ socketId: string; viewerId: string }[]>([])

  const socketRef = useRef<Socket | null>(null)
  const listenersRef = useRef(new Set<(msg: ServerMessage) => void>())
  const joinedRef = useRef(false)

  useEffect(() => {
    const serverUrl: string | undefined = import.meta.env.VITE_SERVER_URL || undefined
    const socket: Socket = io(serverUrl, { path: WS_PATH })
    socketRef.current = socket

    socket.on('connect', () => {
      joinedRef.current = false
      setStatus('connected')
      setError(null)
      socket.emit('message', { type: 'join', roomId, role, token } satisfies ClientMessage)
    })

    socket.on('disconnect', () => {
      if (!joinedRef.current) return
      // transient drop; server will reject rejoin for single-use tokens
      setStatus('error')
      setError('Conexão perdida. Atualize a página ou solicite um novo link.')
    })

    socket.on('message', (msg: ServerMessage) => {
      switch (msg.type) {
        case 'joined':
          joinedRef.current = true
          setRoomState(msg.state)
          if (msg.settings) setSettings(msg.settings)
          if (msg.viewers) setInitialViewers(msg.viewers)
          break
        case 'join-error':
          setStatus('error')
          setError(msg.reason)
          break
        case 'viewer-count':
          setViewerCount(msg.count)
          break
        case 'settings-update':
          setSettings(msg.settings)
          break
        case 'room-ended':
          setEnded(true)
          break
      }
      for (const fn of listenersRef.current) fn(msg)
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, role, token])

  const subscribe = (fn: (msg: ServerMessage) => void) => {
    listenersRef.current.add(fn)
    return () => {
      listenersRef.current.delete(fn)
    }
  }

  const send = (msg: ClientMessage) => {
    socketRef.current?.emit('message', msg)
  }

  return { status, error, roomState, settings, viewerCount, ended, initialViewers, subscribe, send }
}
