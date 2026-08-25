# Gorilla Cast Web

Aplicação web standalone de compartilhamento de tela (screen sharing) com WebRTC P2P mesh.

## Funcionalidades

- **Broadcasting**: crie uma sala e gere um link único de convite para **um** espectador
- **Controles do broadcaster**: contador de viewers, seleção de resolução/FPS, encerrar transmissão
- **Salas independentes**: qualquer pessoa que acessar `/` cria uma nova transmissão isolada
- **P2P WebRTC** para vídeo/áudio (mesh: broadcaster → N viewers)
- Tokens HMAC (owner/viewer), tokens de viewer de uso único com expiração de 24h

## Estrutura (monorepo)

```
client/   # React + Vite + TypeScript (SPA)
server/   # Fastify + Socket.io (signaling + REST + static files)
```

## Rotas

| Rota | Função |
|------|--------|
| `/` | Landing page (criar nova sala) |
| `/b/:roomId?token=OWNER_TOKEN` | Painel do broadcaster |
| `/watch/:roomId?token=VIEWER_TOKEN` | Visualizador |

## Desenvolvimento

```bash
# Server
cd server && npm install && npm run dev

# Client (em outro terminal)
cd client && npm install && npm run dev
```

O client espera o server em `VITE_SERVER_URL` (default `http://localhost:8080`).

## Deploy (Fly.io)

```bash
fly launch --name gorilla-cast --region gru
fly secrets set TOKEN_SECRET="$(openssl rand -hex 32)"
fly deploy
```

Ver `fly.toml` e `Dockerfile` na raiz.

### Custos

Specs: `shared-cpu-1x` / 256MB / sempre ligada (`min_machines_running = 1`).

- **Conta Hobby legada (pré-out/2024)**: dentro da free allowance de até 3 VMs `shared-cpu-1x` 256MB → **$0/mês**. A máquina nunca para (`auto_stop_machines = false`), o que também evita a cobrança de rootfs aplicada a máquinas paradas ($0,15/GB por 30 dias).
- **Contas novas (Pay As You Go)**: sem free tier — a mesma spec custa ~$2,43/mês em `gru`. Para reduzir, dá para usar `min_machines_running = 0` + `auto_stop_machines = "stop"` (~$0, mas com cold start e perda das salas em memória quando idle).

O egress é mínimo: o vídeo WebRTC trafega P2P entre navegadores; o servidor só faz signaling e serve o SPA.
