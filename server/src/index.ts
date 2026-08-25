import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server as SocketIOServer } from 'socket.io'
import { RoomManager, MAX_VIEWER_TOKENS } from './rooms.js'
import { registerSignaling, endRoom } from './signaling.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'dev-insecure-secret-change-me'
if (!process.env.TOKEN_SECRET) {
  console.warn('[warn] TOKEN_SECRET not set — using insecure dev secret')
}

const app = Fastify({ logger: true, maxParamLength: 1024 })
const rooms = new RoomManager(TOKEN_SECRET)

function getTokenFromRequest(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7)
  const query = req.query as Record<string, unknown> | undefined
  const q = query?.token
  return typeof q === 'string' ? q : null
}

// ---------- REST API ----------

app.post<{ Body: { settings?: unknown } }>('/api/rooms', async (req, reply) => {
  const body = (req.body ?? {}) as { settings?: never }
  const result = rooms.create(body.settings ?? undefined)
  reply.code(201).send(result)
})

app.get<{ Params: { id: string }; Querystring: { token?: string } }>('/api/rooms/:id', async (req, reply) => {
  const token = getTokenFromRequest(req)
  if (!token || !rooms.verifyOwner(req.params.id, token)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  const room = rooms.get(req.params.id)
  if (!room) return reply.code(404).send({ error: 'room not found' })
  return rooms.status(room)
})

app.post<{ Params: { id: string }; Body: { settings?: unknown } }>('/api/rooms/:id/settings', async (req, reply) => {
  const token = getTokenFromRequest(req)
  if (!token || !rooms.verifyOwner(req.params.id, token)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  const settings = rooms.updateSettings(req.params.id, (req.body?.settings ?? req.body) as never)
  if (!settings) return reply.code(404).send({ error: 'room not found' })
  return { settings }
})

app.post<{ Params: { id: string }; Body: { count?: number } }>('/api/rooms/:id/viewer-tokens', async (req, reply) => {
  const token = getTokenFromRequest(req)
  if (!token || !rooms.verifyOwner(req.params.id, token)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  const room = rooms.get(req.params.id)
  if (!room || room.state === 'ended') return reply.code(404).send({ error: 'room not found' })
  try {
    const count = Math.min(Math.max(Number(req.body?.count ?? 1), 1), MAX_VIEWER_TOKENS)
    const viewerTokens: string[] = []
    for (let i = 0; i < count; i++) viewerTokens.push(rooms.mintViewerToken(room))
    return reply.code(201).send({ viewerTokens })
  } catch {
    return reply.code(409).send({ error: 'room not available' })
  }
})

app.post<{ Params: { id: string } }>('/api/rooms/:id/end', async (req, reply) => {
  const token = getTokenFromRequest(req)
  if (!token || !rooms.verifyOwner(req.params.id, token)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  endRoom(io, rooms, req.params.id)
  return { ok: true }
})

app.get<{ Params: { token: string } }>('/api/validate/:token', async (req) => {
  return rooms.peekTokenRole(req.params.token)
})

// ---------- Static files (production SPA) ----------

function resolveClientDist(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
    '/app/public',
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c
  }
  return null
}

const clientDist = resolveClientDist()
if (clientDist) {
  await app.register(fastifyStatic, { root: clientDist })
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' })
    }
    return reply.sendFile('index.html')
  })
  app.log.info(`serving SPA from ${clientDist}`)
} else {
  app.log.info('no client build found — API only')
}

// ---------- Boot ----------

await app.ready()

const io = new SocketIOServer(app.server, {
  path: '/ws',
  cors: { origin: '*' },
})

registerSignaling(io, rooms)

await app.listen({ port: PORT, host: '0.0.0.0' })
