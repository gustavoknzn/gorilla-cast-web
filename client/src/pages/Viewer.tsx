import { Link, useParams, useSearchParams } from 'react-router-dom'
import { VideoPlayer } from '../components/VideoPlayer'
import { useRoom } from '../hooks/useRoom'
import { useViewer } from '../hooks/useWebRTC'

export function Viewer() {
  const { roomId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const room = useRoom({ roomId, role: 'viewer', token })
  const viewer = useViewer(room)

  if (!token) {
    return (
      <ScreenMessage title="Link inválido">
        Este link está incompleto. Peça um novo link de convite.
      </ScreenMessage>
    )
  }

  if (room.status === 'error') {
    return (
      <ScreenMessage title="Link inválido ou já utilizado">
        Cada link de convite funciona para um único espectador.{' '}
        <Link to="/">Criar minha própria transmissão</Link>
      </ScreenMessage>
    )
  }

  if (room.ended) {
    return (
      <ScreenMessage title="Transmissão encerrada">
        O broadcaster encerrou a transmissão. <Link to="/">Criar nova transmissão</Link>
      </ScreenMessage>
    )
  }

  return (
    <main className="page page-viewer">
      <header className="page-header">
        <Link to="/" className="logo logo-sm">
          Gorilla Cast
        </Link>
        {room.status === 'connecting' && <span className="muted small">conectando…</span>}
      </header>

      {room.status === 'connecting' ? (
        <p className="muted">Entrando na sala…</p>
      ) : viewer.remoteStream ? (
        <VideoPlayer stream={viewer.remoteStream} className="viewer-video" controls />
      ) : (
        <div className="waiting-screen">
          <div className="spinner" />
          <p>Aguardando o broadcaster iniciar a transmissão…</p>
        </div>
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
