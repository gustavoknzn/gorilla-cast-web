import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { mintViewerToken } from '../utils/api'

interface SharePanelProps {
  roomId: string
  ownerToken: string
}

export function SharePanel({ roomId, ownerToken }: SharePanelProps) {
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)

  useEffect(() => {
    let cancelled = false
    setGenerating(true)
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
    <section className="share-panel">
      <h3>Convite de espectador</h3>

      {generating ? (
        <p className="muted small">Gerando link…</p>
      ) : needsNewToken ? (
        <p className="muted small">Clique em "Gerar novo link" para criar convite</p>
      ) : (
        <>
          <div className="share-link-row">
            <input
              readOnly
              value={inviteUrl}
              onFocus={e => e.currentTarget.select()}
              title="Link de convite (uso único)"
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={copy}>
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
          {inviteUrl.length < 600 && (
            <div className="qr-wrap">
              <QRCodeSVG value={inviteUrl} size={140} bgColor="#0f1115" fgColor="#e6e6e6" />
            </div>
          )}
        </>
      )}

      {error && <p className="error-text small">{error}</p>}

      <div className="share-actions">
        <button
          type="button"
          className="btn"
          onClick={regenerate}
          disabled={generating}
        >
          {generating ? 'Gerando…' : 'Gerar novo link'}
        </button>
      </div>

      <p className="muted small">Uso único · expira em 24h · máx. 10 links</p>
    </section>
  )
}