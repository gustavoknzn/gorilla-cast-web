import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { VideoPlayer } from '../components/VideoPlayer'
import { useRoom } from '../hooks/useRoom'
import { useViewer } from '../hooks/useWebRTC'

const STORAGE_KEY = 'gorilla-cast-viewer-name'

export function Viewer() {
  const { roomId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [showNameModal, setShowNameModal] = useState(true)
  const [viewerName, setViewerName] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setViewerName(saved)
      setShowNameModal(false)
    }
  }, [])

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = viewerName.trim().slice(0, 30)
    if (name) {
      localStorage.setItem(STORAGE_KEY, name)
      setShowNameModal(false)
    }
  }

  const handleSkipName = () => {
    setShowNameModal(false)
  }

  const handleChangeName = () => {
    setShowNameModal(true)
  }

  const room = useRoom({ roomId, role: 'viewer', token, name: showNameModal ? undefined : viewerName, enabled: !showNameModal })
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

  if (showNameModal) {
    return (
      <main className="page page-viewer">
        <div className="modal-overlay" onClick={handleSkipName}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Como você quer ser identificado?</h2>
            <form onSubmit={handleNameSubmit}>
              <input
                type="text"
                value={viewerName}
                onChange={e => setViewerName(e.target.value)}
                placeholder="Seu nome (máx. 30 caracteres)"
                maxLength={30}
                autoFocus
              />
              <div className="modal-actions">
                <button type="button" className="btn" onClick={handleSkipName}>
                  Entrar sem nome
                </button>
                <button type="submit" className="btn btn-primary">
                  Entrar
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="page page-viewer">
      <header className="page-header">
        <Link to="/" className="logo logo-sm">
          Gorilla Cast
        </Link>
        {room.roomName && <span className="muted small"> · Sala {room.roomName}</span>}
        {room.status === 'connecting' && <span className="muted small">conectando…</span>}
        {viewerName && (
          <button type="button" className="btn btn-sm" onClick={handleChangeName}>
            Alterar nome
          </button>
        )}
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