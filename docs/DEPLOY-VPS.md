# Deploy "auton-painel" — Concorrentes + Batalhão num só container, VPS compartilhada

**Por que VPS (e não Vercel):** a análise de 1 concorrente leva **minutos** (centenas de itens
+ download de vídeo + Gemini). Funções serverless têm **timeout** e cortariam o job no meio.
Numa VPS (processo persistente) não há timeout, o agendamento nativo funciona, e webhook +
scheduler + workflows rodam no mesmo processo.

**O que vai pro ar:** 1 container `auton-painel` com **2 serviços** controlados por `supervisord`:
- `concorrentes` (Mastra) na porta **4111** — rotas `/webhooks/apify`, `/cron/dispatch[-all]`.
- `batalhao` (Hono + CLI) na porta **4112** — rotas `/webhooks/apify`, `/cron/run-pipeline`, `/cron/scrape-youtube`, `/healthz`.

O reverse proxy existente na VPS (Caddy ou nginx, já cuidando dos outros projetos) ganha **2
vhosts** novos roteando pra `127.0.0.1:4111` e `:4112`.

## 0. Pré-requisitos
- VPS Linux (Ubuntu 22.04+) com **Docker + Docker Compose v2.17+** (`additional_contexts` é usado).
- 2 subdomínios apontando pra VPS — ex.: `painel.<dom>` e `batalhao.<dom>`.
- Os **2 repos clonados side-by-side**:
  ```bash
  mkdir -p /opt/projetos && cd /opt/projetos
  git clone https://github.com/tria-company/concorrentes-auton.git Agent_concorrentes_auton
  git clone <url-do-batalhao>.git Agent_batalhao_auton
  ```
  Resultado:
  ```
  /opt/projetos/Agent_concorrentes_auton/   (este; contém Dockerfile, compose, supervisord.conf)
  /opt/projetos/Agent_batalhao_auton/       (irmão; vem via additional_contexts no compose)
  ```
- 2 arquivos **`.env` separados** em `/opt/painel/` (NÃO commitar):
  - `concorrentes.env` — Azure, Supabase (Concorrentes), Apify, Gemini, secrets, `DATABASE_URL` (Postgres Session pooler do Supabase **obrigatório** — senão o Mastra cai em LibSQL `:memory:` e perde estado).
  - `batalhao.env` — Azure/OpenAI, Supabase (Batalhão = projeto diferente), Apify, secrets.
- **NÃO** definir `DEPLOY_TARGET=vercel` em nenhum dos .env — o `mastra build` gera o servidor Node padrão sem o deployer da Vercel.

## 1. Build + subir o container
```bash
cd /opt/projetos/Agent_concorrentes_auton
docker compose -f compose.painel.yml build      # multi-stage; usa ../Agent_batalhao_auton via additional_contexts
docker compose -f compose.painel.yml up -d
docker logs -f auton-painel                     # supervisord mostra os 2 serviços subindo
```

O container faz:
- Build do Concorrentes (`mastra build` → `.mastra/output/index.mjs`).
- Build do Batalhão (npm ci; rodado com `npx tsx`).
- Runtime: instala `supervisor`, `yt-dlp` (Python), `ffmpeg`, `curl`.
- `supervisord` (PID 1) sobe os 2 serviços, cada um com seu CWD → cada um lê seu próprio `.env` (montado via volume).

Re-deploy: `docker compose -f compose.painel.yml up -d --build` (rebuild + restart).

## 3. Reverse proxy + TLS (2 vhosts no proxy existente)
**Não substitua** o reverse proxy que já cuida dos outros projetos — só adicione 2 blocos.

### Caddy
`/etc/caddy/Caddyfile`:
```
painel.<dom>    { reverse_proxy 127.0.0.1:4111 }
batalhao.<dom> { reverse_proxy 127.0.0.1:4112 }
```
`sudo systemctl reload caddy`. TLS automático (ACME).

### nginx
2 arquivos em `/etc/nginx/sites-available/`:
```nginx
server {
    server_name painel.<dom>;
    location / { proxy_pass http://127.0.0.1:4111; proxy_set_header Host $host; }
}
server {
    server_name batalhao.<dom>;
    location / { proxy_pass http://127.0.0.1:4112; proxy_set_header Host $host; }
}
```
`ln -s` em `sites-enabled/`, `nginx -t && systemctl reload nginx`, `certbot --nginx -d painel.<dom> -d batalhao.<dom>` pra TLS.

**Validação:**
- `curl https://painel.<dom>/cron/dispatch` → `401` (esperado, sem Bearer).
- `curl https://batalhao.<dom>/healthz` → `200 ok`.

## 4. Agendamento interno (crontab — os 2 painéis)
`crontab -e` (com o `CRON_SECRET` que está nos `.env`):
```cron
CRON=Bearer SEU_CRON_SECRET
P=http://127.0.0.1:4111
B=http://127.0.0.1:4112

# --- Concorrentes (mesma cadência da vercel.json original) ---
0  5 * * *  curl -s -H "Authorization: $CRON" "$P/cron/dispatch-all?workflow=analysis"
30 5 * * *  curl -s -H "Authorization: $CRON" "$P/cron/dispatch-all?workflow=journey-captacao"
0  6 * * *  curl -s -H "Authorization: $CRON" "$P/cron/dispatch-all?workflow=synthesis-consolidation"
30 6 * * *  curl -s -H "Authorization: $CRON" "$P/cron/dispatch?workflow=journey-radar"
0  7 * * *  curl -s -H "Authorization: $CRON" "$P/cron/dispatch-all?workflow=journey-referencias"
0  7 * * 1  curl -s -H "Authorization: $CRON" "$P/cron/dispatch-all?workflow=journey-insights"

# --- Batalhão (depois do scrape Apify das 3h) ---
0  4 * * *  curl -s -H "Authorization: $CRON" "$B/cron/scrape-youtube"   # yt-dlp local
30 4 * * *  curl -s -H "Authorization: $CRON" "$B/cron/run-pipeline"     # análise de tudo
```
> `dispatch-all` faz fan-out por concorrente com `startAsync` (não bloqueia). Como a VPS é persistente,
> os workflows **terminam** em background. Pra evitar pico de rate-limit do Azure/Gemini, dá pra
> trocar por `dispatch?workflow=...&competitor_id=<id>` escalonado, ou rodar `scripts/run-full-pipeline.ts`.

## 5. Apify — extração automática (1 script faz tudo)
**Não precisa clicar no console.** O script `scripts/setup-apify-schedules.ts` cria/atualiza
programaticamente **tasks + schedules + webhooks** dos 2 projetos, idempotente (pode rodar quantas
vezes quiser; usa nomes determinísticos `auton-<projeto>-<perfil>-<canal>` pra detectar existente).

### 5.1 Configurar env e rodar (local — não na VPS)
No `.env` da máquina do dev, complete:
```
APIFY_TOKEN=...
APIFY_WEBHOOK_SECRET=...
SUPABASE_URL=https://lnagzhqejoohhbnfffxw.supabase.co            # Concorrentes
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_URL_BATALHAO=https://lasobiogakvjokomhsib.supabase.co   # Batalhão (projeto diferente)
SUPABASE_SERVICE_ROLE_KEY_BATALHAO=sb_secret_...
WEBHOOK_URL_CONCORRENTES=https://painel.<dom>/webhooks/apify
WEBHOOK_URL_BATALHAO=https://batalhao.<dom>/webhooks/apify
```

Dry-run primeiro (não grava nada):
```bash
DRY_RUN=1 npx tsx scripts/setup-apify-schedules.ts
```
Sai com a tabela do que faria. Quando estiver feliz, roda sem `DRY_RUN`.

### 5.2 O que o script configura
- **Concorrentes** (5 ativos): 1 task por (concorrente × canal) — IG reels/posts, TikTok, FB posts/ads, Google Ads, Google Reviews, Reclame Aqui, YouTube — só onde o concorrente tem o handle do canal (gated por `ig_handle`/`yt_channel_id`/etc.).
- **Batalhão** (~32 embaixadores em `reference_profiles`): 1 task por (perfil × IG/TikTok). **YouTube não usa Apify** (yt-dlp local — disparado pelo cron `/cron/scrape-youtube`).
- **Schedules** escalonados em UTC (IG 3h, TikTok 3:15h, FB 3:30h, Ads 4h, Reviews 5h, Reclame Aqui semanal).
- **Webhooks**: `ACTOR.RUN.SUCCEEDED` → URL do projeto correspondente, com header `x-apify-secret`.

### 5.3 Como o webhook fecha o ciclo
1. Apify roda o scrape no horário agendado.
2. Ao terminar, dispara webhook em `painel.<dom>/webhooks/apify` (Concorrentes) ou `batalhao.<dom>/webhooks/apify` (Batalhão).
3. **Concorrentes:** workflow `ingestion` → grava `apify_raw` + parser atualiza Silver.
4. **Batalhão:** server.ts → busca items do dataset → `mapPost*` → `upsertScrapedPost` em `scrappers_contents`.
5. Crontab interno (passo 4) dispara `analysis`/`synthesis`/jornadas (Concorrentes) e `/cron/run-pipeline` (Batalhão).

## 6. Operação
- **Logs:** `docker logs -f auton-painel` — supervisord interleva `concorrentes` e `batalhao` (cada linha tem prefixo do programa).
- **Restart de 1 serviço só:** `docker exec auton-painel supervisorctl restart concorrentes` (ou `batalhao`).
- **Custo Gemini:** vídeo longo de YouTube é caro (~$0,03/vídeo). Monitorar `agent_runs.llm_cost_usd` no Supabase do Concorrentes.
- **Atualizar:** `git pull` nos 2 repos + `docker compose -f compose.painel.yml up -d --build`.
- **Backup/estado:** dados de negócio nos 2 Supabase; estado do Mastra no Postgres do Concorrentes via `DATABASE_URL`.
- **Verificação D+1:** novo `daily_briefings` (Concorrentes) + novos `profile_cross_brief` (Batalhão).
