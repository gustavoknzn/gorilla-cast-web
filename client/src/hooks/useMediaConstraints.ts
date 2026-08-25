import { useCallback, useState } from 'react'
import type { RoomSettings } from '../types'

export function useMediaConstraints(initial: RoomSettings) {
  const [settings, setSettings] = useState<RoomSettings>(initial)

  const setResolution = useCallback((width: number, height: number) => {
    setSettings(s => ({ ...s, video: { ...s.video, width, height } }))
  }, [])

  const setFrameRate = useCallback((frameRate: number) => {
    setSettings(s => ({ ...s, video: { ...s.video, frameRate } }))
  }, [])

  const toggleAudio = useCallback(() => {
    setSettings(s => ({ ...s, audio: !s.audio }))
  }, [])

  const displayConstraints = useCallback(() => {
    return {
      video: {
        width: { ideal: settings.video.width },
        height: { ideal: settings.video.height },
        frameRate: { ideal: settings.video.frameRate },
      },
      audio: settings.audio,
    } as DisplayMediaStreamOptions
  }, [settings])

  return { settings, setResolution, setFrameRate, toggleAudio, displayConstraints }
}
