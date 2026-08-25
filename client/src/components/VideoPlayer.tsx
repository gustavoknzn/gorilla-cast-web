import { useEffect, useRef, useState } from 'react'

interface VideoPlayerProps {
  stream: MediaStream | null
  muted?: boolean
  className?: string
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export function VideoPlayer({ stream, muted = true, className }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    video.play().then(() => setNeedsInteraction(false)).catch(() => setNeedsInteraction(true))
  }, [stream])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {
        // iOS Safari only allows fullscreen on the video element itself
        ;(videoRef.current as FullscreenVideo | null)?.webkitEnterFullscreen?.()
      })
      return
    }
    ;(videoRef.current as FullscreenVideo | null)?.webkitEnterFullscreen?.()
  }

  return (
    <div ref={containerRef} className={`video-player ${className ?? ''}`}>
      <video ref={videoRef} autoPlay playsInline muted={muted} />
      {!stream && <div className="video-placeholder">Sem sinal</div>}
      {needsInteraction && (
        <button
          type="button"
          className="video-play-overlay"
          onClick={() => {
            videoRef.current?.play().then(() => setNeedsInteraction(false)).catch(() => undefined)
          }}
        >
          Clique para reproduzir
        </button>
      )}
      {stream && (
        <button type="button" className="vbtn fs-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}
