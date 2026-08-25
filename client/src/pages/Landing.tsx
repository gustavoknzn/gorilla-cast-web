import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRoom } from '../utils/api'

export function Landing() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const room = await createRoom()
      navigate(`/b/${room.roomId}?token=${encodeURIComponent(room.ownerToken)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao criar sala')
      setCreating(false)
    }
  }

  return (
    <main className="landing">
      <h1 className="logo">Gorilla Cast</h1>
      <p className="tagline">
        Compartilhe sua tela com um link privado, direto do navegador — sem instalar nada.
      </p>
      <button type="button" className="btn btn-primary btn-lg" onClick={create} disabled={creating}>
        {creating ? 'Criando sala…' : 'Criar nova transmissão'}
      </button>
      {error && <p className="error-text">{error}</p>}
      <ul className="features">
        <li>Link de convite de uso único para cada espectador</li>
        <li>Conexão P2P (WebRTC): vídeo e áudio direto entre navegadores</li>
        <li>Controles de resolução e FPS ao vivo</li>
      </ul>
    </main>
  )
}
