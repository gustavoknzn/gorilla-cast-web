import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BroadcasterPanel } from '../components/BroadcasterPanel'
import { ShareModal } from '../components/ShareModal'
import { useMediaConstraints } from '../hooks/useMediaConstraints'
import { useRoom } from '../hooks/useRoom'
import { useBroadcaster } from '../hooks/useWebRTC'
import type { RoomSettings } from '../types'

export function Broadcaster() {
  const { roomId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const room = useRoom({ roomId, role: 'broadcaster', token })
  const broadcaster = useBroadcaster(room)
  const [shareOpen, setShareOpen] = useState(false)

  const constraints = useMediaConstraints(
    room.settings ?? {
      video: { width: 1920, height: 1080, frameRate: 30 },
      audio: true,
    },
  )

  // keep local constraints in sync when server state arrives
  useEffect(() => {
    if (room.settings) constraints.setResolution(room.settings.video.width, room.settings.video.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.settings?.video.width, room.settings?.video.height])

  const handleSettingsChange = useCallback(
    (s: RoomSettings) => {
      void broadcaster.applyConstraints(s)
      room.send({ type: 'settings-update', settings: s })
      constraints.setResolution(s.video.width, s.video.height)
      if (constraints.settings.video.frameRate !== s.video.frameRate) constraints.setFrameRate(s.video.frameRate)
      if (constraints.settings.audio !== s.audio) constraints.toggleAudio()
    },
    [broadcaster, room, constraints],
  )

  const handleKickViewer = useCallback(
    (viewerId: string) => {
      room.send({ type: 'kick-viewer', viewerId })
    },
    [room],
  )

  if (!token) {
    return (
      <ScreenMessage title="Acesso restrito">
        Esta é uma sala de transmissão. Use o link com token recebido ao criar a sala.
      </ScreenMessage>
    )
  }

  if (room.status === 'error') {
    return (
      <ScreenMessage title="Não foi possível entrar na sala">
        Token inválido ou sala encerrada.{' '}
        <Link to="/">Criar uma nova transmissão</Link>
      </ScreenMessage>
    )
  }

  if (room.ended) {
    return (
      <ScreenMessage title="Transmissão encerrada">
        A sala foi fechada. <Link to="/">Criar nova transmissão</Link>
      </ScreenMessage>
    )
  }

  return (
    <main className="page">
      <header className="page-header">
        <Link to="/" className="logo logo-sm">
          Gorilla Cast
        </Link>
        <span className="muted small">Sala {roomId.slice(0, 8)}</span>
      </header>

      {room.status === 'connecting' ? (
        <p className="muted">Conectando ao servidor…</p>
      ) : (
        <BroadcasterPanel
          settings={constraints.settings}
          localStream={broadcaster.localStream}
          live={broadcaster.live}
          viewerCount={room.viewers.length}
          viewers={room.viewers}
          roomState={room.roomState}
          onSettingsChange={handleSettingsChange}
          onStart={() => void broadcaster.startSharing().catch(err => alert(err.message))}
          onStop={broadcaster.stopSharing}
          onEnd={() => room.send({ type: 'end-stream' })}
          onShare={() => setShareOpen(true)}
          onKickViewer={handleKickViewer}
        />
      )}

      {shareOpen && (
        <ShareModal roomId={roomId} ownerToken={token} onClose={() => setShareOpen(false)} />
      )}
    </main>
  )
}

function ScreenMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="screen-message">
      <h1>{title}</h1>
      <p>{children}</p>
    </main>
  )
}
