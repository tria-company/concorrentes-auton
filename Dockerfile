# Container único do "auton-painel": Concorrentes (Mastra) + Batalhão (Hono+CLI) lado-a-lado.
# Build com `docker compose -f compose.painel.yml build` (usa additional_contexts pra trazer
# o Batalhão — sibling no FS — sem precisar reorganizar repos).
# syntax=docker/dockerfile:1.7

ARG NODE_VER=24-slim

# ---------- Stage 1: build do Concorrentes (Mastra → .mastra/output/index.mjs) ----------
FROM node:${NODE_VER} AS concorrentes-build
WORKDIR /app/concorrentes
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Sem DEPLOY_TARGET=vercel → mastra build gera servidor Node padrão.
RUN npm run build

# ---------- Stage 2: build do Batalhão (TS rodado via tsx — sem compilação extra) ----------
FROM node:${NODE_VER} AS batalhao-build
WORKDIR /app/batalhao
# Named context "batalhao" vem do compose (additional_contexts: ../Agent_batalhao_auton).
COPY --from=batalhao package.json package-lock.json* tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY --from=batalhao src ./src

# ---------- Stage 3: runtime (supervisord + yt-dlp + ffmpeg) ----------
FROM node:${NODE_VER} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      supervisor python3 python3-pip ffmpeg ca-certificates curl \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=concorrentes-build /app/concorrentes /app/concorrentes
COPY --from=batalhao-build /app/batalhao /app/batalhao
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV NODE_ENV=production
# Portas internas (bindadas a 127.0.0.1 no compose; reverse proxy expõe externamente).
EXPOSE 4111 4112

# `-n` mantém supervisord no foreground (PID 1) — necessário pro Docker enxergar como vivo.
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf", "-n"]
