import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { mintViewerToken } from '../utils/api'

interface ShareModalProps {
  roomId: string
  ownerToken: string
  onClose: () => void
}

export function ShareModal({ roomId, ownerToken, onClose }: ShareModalProps) {
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)

  useEffect(() => {
    let cancelled = false
    mintViewerToken(roomId, ownerToken, 1)
      .then(([newToken]) => {
        if (!cancelled) setToken(newToken)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'erro ao gerar link')
      })
      .finally(() => {
        if (!cancelled) setGenerating(false)
      })
    return () => {
      cancelled = true
    }
  }, [roomId, ownerToken])

  const activeToken = token ?? ''
  const inviteUrl = `${window.location.origin}/watch/${roomId}?token=${encodeURIComponent(activeToken)}`
  const needsNewToken = !activeToken

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Não foi possível copiar — copie manualmente')
    }
  }

  const regenerate = async () => {
    setError(null)
    setGenerating(true)
    try {
      const [newToken] = await mintViewerToken(roomId, ownerToken, 1)
      setToken(newToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao gerar link')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Convidar espectador</h2>
          <button type="button" className="btn-icon" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>

        {generating ? (
          <p className="muted">Gerando link de convite…</p>
        ) : needsNewToken ? (
          <p className="muted">
            Cada link funciona para um único espectador. Gere um novo link de convite.
          </p>
        ) : (
          <>
            <div className="share-link-row">
              <input readOnly value={inviteUrl} onFocus={e => e.currentTarget.select()} />
              <button type="button" className="btn btn-primary" onClick={copy}>
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            {inviteUrl.length < 600 && (
              <div className="qr-wrap">
                <QRCodeSVG value={inviteUrl} size={160} bgColor="#0f1115" fgColor="#e6e6e6" />
              </div>
            )}
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={regenerate} disabled={generating}>
            Gerar novo link
          </button>
        </div>

        <p className="muted small">Uso único · expira em 24h</p>
      </div>
    </div>
  )
}
