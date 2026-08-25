import { useEffect, useRef, useState } from 'react'

interface VideoPlayerProps {
  stream: MediaStream | null
  muted?: boolean
  className?: string
}

export function VideoPlayer({ stream, muted = true, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [needsInteraction, setNeedsInteraction] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    if (video.srcObject !== stream) {
      video.srcObject = stream
    }
    video.play().then(() => setNeedsInteraction(false)).catch(() => setNeedsInteraction(true))
  }, [stream])

  return (
    <div className={`video-player ${className ?? ''}`}>
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
    </div>
  )
}
