import { useCallback, useEffect, useRef, useState } from 'react'
import { ICE_SERVERS, type RoomSettings, type ServerMessage } from '../types'

function estimateBitrate(width: number, height: number, fps: number): number {
  const pixelsPerSec = width * height * fps
  // ~0.12 bits per pixel, clamped to 1–12 Mbps
  return Math.round(Math.min(Math.max(pixelsPerSec * 0.12, 1_000_000), 12_000_000))
}

// ---------- Broadcaster ----------

export function useBroadcaster(signaling: {
  subscribe: (fn: (msg: ServerMessage) => void) => () => void
  send: (msg: import('../types').ClientMessage) => void
}) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [live, setLive] = useState(false)
  const [peerCount, setPeerCount] = useState(0)
  const [uploadBitrate, setUploadBitrate] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const pendingViewersRef = useRef<string[]>([])
  const settingsRef = useRef<RoomSettings | null>(null)
  const endedHandlerRef = useRef<(() => void) | null>(null)
  const endedSentRef = useRef(false)
  const signalingRef = useRef(signaling)
  useEffect(() => {
    signalingRef.current = signaling
  }, [signaling])

  const updatePeerCount = useCallback(() => {
    setPeerCount(peersRef.current.size)
  }, [])

  const closePeer = useCallback(
    (socketId: string) => {
      const pc = peersRef.current.get(socketId)
      if (pc) {
        pc.onicecandidate = null
        pc.close()
        peersRef.current.delete(socketId)
      }
      pendingViewersRef.current = pendingViewersRef.current.filter(id => id !== socketId)
      updatePeerCount()
    },
    [updatePeerCount],
  )

  function buildEncodings(width: number, fps: number, maxBitrate: number): RTCRtpEncodingParameters[] {
    const isHighRes = width >= 2560
    if (isHighRes) {
      return [
        { rid: 'h', scaleResolutionDownBy: 1, maxBitrate, maxFramerate: fps },
        { rid: 'm', scaleResolutionDownBy: 2, maxBitrate: Math.round(maxBitrate * 0.5), maxFramerate: fps },
        { rid: 'l', scaleResolutionDownBy: 4, maxBitrate: Math.round(maxBitrate * 0.25), maxFramerate: Math.max(15, Math.round(fps / 2)) },
      ]
    }
    return [{ rid: 'h', maxBitrate, maxFramerate: fps }]
  }

  const createOfferTo = useCallback(async (viewerSocketId: string) => {
    const stream = streamRef.current
    if (!stream) return

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peersRef.current.set(viewerSocketId, pc)
    setPeerCount(peersRef.current.size)

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream)
    }

    const settings = settingsRef.current
    if (settings?.video) {
      const maxBitrate = estimateBitrate(settings.video.width, settings.video.height, settings.video.frameRate)
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        const params = sender.getParameters()
        params.encodings = buildEncodings(settings.video.width, settings.video.frameRate, maxBitrate)
        try {
          await sender.setParameters(params)
        } catch {
          // simulcast not supported, fall back to single encoding
        }
      }
    }

    pc.onicecandidate = e => {
      if (e.candidate) {
        signalingRef.current.send({ type: 'candidate', to: viewerSocketId, candidate: e.candidate.toJSON() })
      }
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        if (peersRef.current.get(viewerSocketId) === pc) closePeer(viewerSocketId)
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    signalingRef.current.send({
      type: 'offer',
      to: viewerSocketId,
      sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp },
    })
  }, [closePeer])

  const stopSharing = useCallback(() => {
    // detach listeners first so our own teardown doesn't count as source loss
    const handler = endedHandlerRef.current
    if (handler && streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.removeEventListener('ended', handler)
      }
    }
    endedHandlerRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setLocalStream(null)
    setLive(false)
    for (const socketId of [...peersRef.current.keys()]) closePeer(socketId)
  }, [closePeer])

  /** capture source disappeared (game/app closed or browser-native stop) */
  const handleSourceEnded = useCallback(() => {
    if (endedSentRef.current) return
    endedSentRef.current = true
    // closing the source ends the broadcast for everyone: server tears down
    // the room and viewers land on the "transmissão encerrada" screen
    signalingRef.current.send({ type: 'end-stream' })
    stopSharing()
  }, [stopSharing])

  const startSharing = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Este navegador não suporta compartilhamento de tela')
    const constraints = settingsRef.current
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: constraints
        ? {
            width: { ideal: constraints.video.width },
            height: { ideal: constraints.video.height },
            frameRate: { ideal: constraints.video.frameRate },
          }
        : true,
      audio: constraints?.audio ?? true,
      // chromium-only hints (not in the TS DOM lib): show the system-audio
      // checkbox when picking a whole screen and hide this page from the list.
      // The dialog decides the actual audio source (tab/window = that source
      // only, whole screen = all system audio on Windows).
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions)
    streamRef.current = stream
    setLocalStream(stream)
    setLive(true)
    endedSentRef.current = false

    const onEnded = () => handleSourceEnded()
    endedHandlerRef.current = onEnded
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', onEnded)
    }

    // offer to everyone already waiting
    for (const socketId of [...pendingViewersRef.current]) {
      void createOfferTo(socketId)
    }
  }, [createOfferTo, handleSourceEnded])

  /** Apply new resolution/fps to the live track; falls back to re-acquiring the stream. */
  const applyConstraints = useCallback(
    async (settings: RoomSettings): Promise<'applied' | 'restarted'> => {
      settingsRef.current = settings
      const track = streamRef.current?.getVideoTracks()[0]
      if (track) {
        try {
          await track.applyConstraints({
            width: { ideal: settings.video.width },
            height: { ideal: settings.video.height },
            frameRate: { ideal: settings.video.frameRate },
          })
        } catch {
          return 'restarted'
        }
      } else {
        return 'restarted'
      }
      // adjust live bitrate on all senders (simulcast encodings)
      const maxBitrate = estimateBitrate(settings.video.width, settings.video.height, settings.video.frameRate)
      for (const pc of peersRef.current.values()) {
        for (const sender of pc.getSenders()) {
          if (sender.track?.kind !== 'video') continue
          const params = sender.getParameters()
params.encodings = buildEncodings(settings.video.width, settings.video.frameRate, maxBitrate)
          try {
            await sender.setParameters(params)
          } catch {
            // ignore — some browsers restrict encoding mutations
          }
        }
      }
      return 'applied'
    },
    [],
  )

  useEffect(() => {
    const unsubscribe = signaling.subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'joined':
          if (msg.viewers) {
            pendingViewersRef.current = msg.viewers.map(v => v.socketId)
            // after a broadcaster reconnect, offer to viewers that joined
            // during the disconnect window and have no peer connection yet
            if (streamRef.current) {
              for (const socketId of pendingViewersRef.current) {
                if (!peersRef.current.has(socketId)) void createOfferTo(socketId)
              }
            }
          }
          break
        case 'viewer-joined': {
          if (!peersRef.current.has(msg.socketId)) {
            pendingViewersRef.current.push(msg.socketId)
            if (streamRef.current) void createOfferTo(msg.socketId)
          }
          break
        }
        case 'viewer-left':
          closePeer(msg.socketId)
          break
        case 'answer': {
          const pc = peersRef.current.get(msg.from)
          if (pc) void pc.setRemoteDescription(msg.sdp).catch(() => closePeer(msg.from))
          break
        }
        case 'candidate': {
          const pc = peersRef.current.get(msg.from)
          if (pc) void pc.addIceCandidate(msg.candidate).catch(() => undefined)
          break
        }
        case 'room-ended':
          stopSharing()
          break
      }
    })
    return unsubscribe
  }, [signaling, createOfferTo, closePeer, stopSharing])

  useEffect(() => {
    let lastBytes = 0
    let lastTime = performance.now()

    const interval = setInterval(async () => {
      if (!live || peersRef.current.size === 0) return

      let totalBytes = 0
      for (const pc of peersRef.current.values()) {
        try {
          const stats = await pc.getStats()
          stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              totalBytes += report.bytesSent ?? 0
            }
          })
        } catch {
          // ignore stats errors
        }
      }

      const now = performance.now()
      const deltaSec = (now - lastTime) / 1000
      if (deltaSec > 0) {
        const mbps = ((totalBytes - lastBytes) * 8) / 1_000_000 / deltaSec
        setUploadBitrate(Math.round(mbps * 10) / 10)
      }
      lastBytes = totalBytes
      lastTime = now
    }, 2000)

    return () => clearInterval(interval)
  }, [live])

  useEffect(() => () => stopSharing(), [stopSharing])

  return { localStream, live, peerCount, uploadBitrate, startSharing, stopSharing, applyConstraints }
}

// ---------- Viewer ----------

export function useViewer(signaling: {
  subscribe: (fn: (msg: ServerMessage) => void) => () => void
  send: (msg: import('../types').ClientMessage) => void
}) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const signalingRef = useRef(signaling)
  useEffect(() => {
    signalingRef.current = signaling
  }, [signaling])

  useEffect(() => {
    const unsubscribe = signaling.subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'offer': {
          pcRef.current?.close()
          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
          pcRef.current = pc

          pc.ontrack = e => {
            setRemoteStream(e.streams[0] ?? null)
            setConnected(true)
          }
          pc.onicecandidate = e => {
            if (e.candidate) {
              signalingRef.current.send({ type: 'candidate', to: msg.from, candidate: e.candidate.toJSON() })
            }
          }
          pc.onconnectionstatechange = () => {
            if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
              setConnected(false)
            }
          }

          void pc
            .setRemoteDescription(msg.sdp)
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
              if (pc.localDescription && pcRef.current === pc) {
                signalingRef.current.send({
                  type: 'answer',
                  to: msg.from,
                  sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
                })
              }
            })
            .catch(() => undefined)
          break
        }
        case 'candidate':
          void pcRef.current?.addIceCandidate(msg.candidate).catch(() => undefined)
          break
        case 'room-ended':
          pcRef.current?.close()
          pcRef.current = null
          setRemoteStream(null)
          setConnected(false)
          break
      }
    })
    return unsubscribe
  }, [signaling])

  useEffect(
    () => () => {
      pcRef.current?.close()
      pcRef.current = null
    },
    [],
  )

  return { remoteStream, connected }
}
