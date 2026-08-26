# AGENTS.md

## Project Overview

Gorilla Cast Web — standalone screen-sharing app with WebRTC P2P mesh
(one broadcaster → N viewers). Rooms live in memory; access is granted via
HMAC-signed single-use tokens (owner/viewer).

## Monorepo Layout

- `client/`   React 19 + Vite + TypeScript SPA (react-router-dom v7,
              socket.io-client, qrcode.react), linted with oxlint
- `server/`   Fastify 5 + Socket.io (signaling at `/ws`) + REST API (`/api/*`),
              serves the built SPA in production

## Commands

Root:

- `npm run dev:server`      # server dev (tsx watch)
- `npm run dev:client`      # Vite dev server
- `npm run build`           # build client then server
- `npm run typecheck`       # tsc in both workspaces
- `npm start`               # run built server

Client (`npm --prefix client run ...`): `dev`, `build`, `lint`, `typecheck`
Server (`npm --prefix server run ...`): `dev`, `build`, `start`, `typecheck`,
`test`

Server tests run with the built-in node:test runner via tsx (`node
--import tsx --test`), colocated in `src/*.test.ts`; there is no linter for
the server and no tests for the client.

## Architecture

REST API:

- `POST /api/rooms` — create room, returns owner token + initial viewer tokens
- `GET /api/rooms/:id` — owner-only status
- `POST /api/rooms/:id/settings` — owner-only settings update
- `POST /api/rooms/:id/viewer-tokens` — mint up to 10 viewer tokens
- `POST /api/rooms/:id/end` — end room
- `GET /api/validate/:token` — peek token role/validity

Signaling (Socket.io, path `/ws`, all messages on a single `message` event):

- Client→server: `join`, `offer`, `answer`, `candidate`, `settings-update`,
  `end-stream`
- Server→client: `joined`, `join-error`, `viewer-joined`, `viewer-left`,
  `viewer-count`, `settings-update`, `room-ended`, `offer`, `answer`,
  `candidate`
- Message shapes are discriminated unions defined in `client/src/types.ts`,
  mirrored in `server/src/signaling.ts`

Tokens: HMAC-SHA256 signed payloads in `server/src/tokens.ts`
(`base64url(payload).base64url(hmac)`); owner token lives as long as the
room, viewer tokens are single-use with expiry. Rooms TTL 24h, cleaned up
every 60s.

Routes: `/` (landing), `/b/:roomId` (broadcaster), `/watch/:roomId` (viewer).

## Technical Decisions

- **In-memory rooms, no database** — `RoomManager` keeps everything in a
  `Map`; rooms/state are lost on restart or deploy. Accepted trade-off for
  a tiny single-VM deployment.
- **Custom HMAC tokens instead of a JWT library** — minimal dependency-free
  implementation with timing-safe signature comparison; payloads carry
  `roomId`, `role`, optional `viewerId`, `exp`.
- **Single-use viewer tokens** — consumed into a `usedViewerIds` set on
  first WebSocket join, so invite links cannot be reused or shared.
- **WebRTC P2P mesh instead of SFU** — video/audio flows directly between
  browsers; server only relays SDP/ICE. Keeps server egress near zero but
  limits scale (broadcaster uploads once per viewer; max 10 viewer tokens).
- **STUN only, no TURN** — public Google/Twilio STUN servers in
  `client/src/types.ts`; connections behind restrictive NATs may fail.
  Accepted trade-off to avoid TURN bandwidth costs.
- **Broadcaster grace window** — abrupt broadcaster disconnect schedules
  room teardown after `BROADCASTER_GRACE_MS` (default 30s) so reloads and
  network blips don't invalidate viewer links.
- **Socket.io over raw ws** — automatic reconnect, rooms/channels
  (`room:<roomId>`), typed envelope on one event.
- **Single process serves API + WS + SPA** — `@fastify/static` serves
  `client/dist` with an `index.html` fallback for SPA routes; fits the
  cheapest Fly.io VM.
- **Fastify over Express** — schema-friendly typed route handlers
  (`app.post<{ Body, Params }>`), built-in logger.
- **oxlint over ESLint** (client only) — fast Rust-based linter; configured
  in `client/.oxlintrc.json`.
- **tsx for server dev** — no build step during development;
  `tsc` only for typecheck/build.
- **node:test + tsx for server tests** — zero extra test dependencies;
  `tsconfig.build.json` excludes `*.test.ts` from the emitted build.
- **Auth token accepted from query string or `Authorization: Bearer`** —
  query param needed for browser navigation links (`/b/:roomId?token=...`);
  WS CORS is open (`origin: '*'`) because auth relies on tokens, not origin.
- **Duplicated shared types** — `RoomSettings` and message types exist in
  both workspaces (`client/src/types.ts`, `server/src/rooms.ts`) rather than
  a shared package; keep them in sync when editing.

## Code Conventions

- ESM everywhere (`"type": "module"`); relative imports on the server use
  the `.js` suffix
- No semicolons, single quotes
- Named exports for pages/hooks/components; default export only for
  `App.tsx`/`main.tsx`
- Discriminated unions (`type` field) for all socket messages; use
  `satisfies ServerToClient` when emitting on the server
- Shared types duplicated between `client/src/types.ts` and
  `server/src/rooms.ts`

## Environment Variables

- `PORT` (default `8080`)
- `TOKEN_SECRET` (required in prod; falls back to insecure dev secret)
- `BROADCASTER_GRACE_MS` (default `30000`)
- `VITE_SERVER_URL` (client → server URL, default `http://localhost:8080`)

See `.env.example`.

## Verification Before Committing

- `npm run typecheck`
- `npm --prefix client run lint`
- `npm --prefix server run test`

## Deployment

Fly.io (`fly.toml` + `Dockerfile` at repo root). Video traffic is P2P;
the server only does signaling and serves the SPA.
