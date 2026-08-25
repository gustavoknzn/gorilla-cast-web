import { VideoPlayer } from './VideoPlayer'
import { FPS_OPTIONS, RESOLUTIONS, type RoomSettings } from '../types'

interface BroadcasterPanelProps {
  settings: RoomSettings
  localStream: MediaStream | null
  live: boolean
  viewerCount: number
  roomState: string | null
  onSettingsChange: (s: RoomSettings) => void
  onStart: () => void
  onStop: () => void
  onEnd: () => void
  onShare: () => void
}

export function BroadcasterPanel({
  settings,
  localStream,
  live,
  viewerCount,
  roomState,
  onSettingsChange,
  onStart,
  onStop,
  onEnd,
  onShare,
}: BroadcasterPanelProps) {
  return (
    <div className="broadcaster-layout">
      <div className="preview-area">
        <VideoPlayer stream={localStream} muted />
        <div className="preview-badges">
          <span className={`badge ${live ? 'badge-live' : 'badge-waiting'}`}>
            {live ? '● AO VIVO' : 'aguardando'}
          </span>
          {live && <span className="badge">{viewerCount} {viewerCount === 1 ? 'espectador' : 'espectadores'}</span>}
        </div>
      </div>

      <aside className="controls">
        <h2>Controles</h2>

        <label className="field">
          Resolução
          <select
            value={`${settings.video.width}x${settings.video.height}`}
            onChange={e => {
              const [width, height] = e.target.value.split('x').map(Number)
              onSettingsChange({ ...settings, video: { ...settings.video, width, height } })
            }}
          >
            {RESOLUTIONS.map(r => (
              <option key={r.label} value={`${r.width}x${r.height}`}>
                {r.label} ({r.width}×{r.height})
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          FPS
          <select
            value={settings.video.frameRate}
            onChange={e => onSettingsChange({ ...settings, video: { ...settings.video, frameRate: Number(e.target.value) } })}
          >
            {FPS_OPTIONS.map(fps => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </label>

        <label className="field field-checkbox">
          <input
            type="checkbox"
            checked={settings.audio}
            onChange={() => onSettingsChange({ ...settings, audio: !settings.audio })}
          />
          Capturar áudio do sistema
        </label>

        <div className="controls-buttons">
          {!localStream ? (
            <button type="button" className="btn btn-primary" onClick={onStart}>
              Compartilhar tela
            </button>
          ) : (
            <button type="button" className="btn" onClick={onStop}>
              Parar compartilhamento
            </button>
          )}
          <button type="button" className="btn" onClick={onShare}>
            Copiar link de convite
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onEnd}
            disabled={roomState === 'ended'}
          >
            Encerrar transmissão
          </button>
        </div>
      </aside>
    </div>
  )
}
