import { FPS_OPTIONS, RESOLUTIONS, type RoomSettings } from '../types'
import { SharePanel } from './SharePanel'

interface BroadcasterPanelProps {
  settings: RoomSettings
  localStream: MediaStream | null
  roomState: string | null
  onSettingsChange: (s: RoomSettings) => void
  onStart: () => void
  onStop: () => void
  onEnd: () => void
  roomId: string
  ownerToken: string
  viewerCount?: number
}

function getMaxViewers(width: number): number {
  return width >= 2560 ? 3 : 10
}

export function BroadcasterPanel({
  settings,
  localStream,
  roomState,
  onSettingsChange,
  onStart,
  onStop,
  onEnd,
  roomId,
  ownerToken,
  viewerCount = 0,
}: BroadcasterPanelProps) {
  const maxViewers = getMaxViewers(settings.video.width)
  const isHighRes = settings.video.width >= 2560
  const atLimit = viewerCount >= maxViewers

  return (
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
            <option
              key={r.label}
              value={`${r.width}x${r.height}`}
              disabled={r.width >= 2560 && atLimit && settings.video.width < 2560}
            >
              {r.label} ({r.width}×{r.height}){r.width >= 2560 ? ' · máx. 3 viewers' : ''}
            </option>
          ))}
        </select>
      </label>

      {isHighRes && (
        <p className={`hint ${atLimit ? 'warning' : ''}`}>
          {atLimit
            ? `⚠ Limite de ${maxViewers} espectadores atingido. Reduza a resolução para permitir mais.`
            : `Resolução alta: máx. ${maxViewers} espectadores simultâneos ({viewerCount}/${maxViewers})`}
        </p>
      )}

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
      <p className="hint">
        O áudio segue o que você marcar na janela de compartilhamento do navegador: aba ou janela
        captura só o som dela; tela inteira captura o áudio do sistema todo.
      </p>

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
        <SharePanel roomId={roomId} ownerToken={ownerToken} />
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
  )
}