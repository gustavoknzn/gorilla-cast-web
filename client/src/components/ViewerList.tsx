import { type ViewerRef } from '../types'

interface ViewerListProps {
  viewers: ViewerRef[]
  onKickViewer: (viewerId: string) => void
}

function formatViewerId(id: string): string {
  return id.slice(0, 8) + '…'
}

export function ViewerList({ viewers, onKickViewer }: ViewerListProps) {
  return (
    <aside className="viewers-sidebar">
      <section className="viewers-list">
        <div className="viewers-header">
          <h3>Espectadores ({viewers.length})</h3>
        </div>
        {viewers.length === 0 ? (
          <p className="muted small">Nenhum espectador conectado</p>
        ) : (
          <ul>
            {viewers.map(v => (
              <li key={v.socketId} className="viewer-item">
                <span className="viewer-name">
                  {v.name ? v.name : formatViewerId(v.viewerId)}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => onKickViewer(v.viewerId)}
                  title="Remover espectador"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}