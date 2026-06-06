# Deploy — Painel de Concorrentes (backend Mastra)

## 1. Variáveis de ambiente (produção)
Configurar no host (Vercel/Railway/etc.) os valores de `.env.example`:
- **LLM:** `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT` (opcional `AZURE_OPENAI_DEPLOYMENT_HEAVY`).
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Storage do Mastra:** `DATABASE_URL` (Postgres do Supabase). Quando definido, `lib/storage.ts` usa `@mastra/pg`; sem ele, usa LibSQL local (só dev).
- **Triggers:** `APIFY_WEBHOOK_SECRET`, `CRON_SECRET`.

## 2. Build
```
npm install
npm run build        # mastra build
```
Para deploy serverless, adicionar um deployer (ex.: `@mastra/deployer-vercel`) e referenciá-lo no `Mastra({ deployer })`. Alternativa: host long-running (Railway/Render/Fly) rodando `mastra build` + `node .mastra/output`.

## 3. Agendamento (⚠️ cron in-code não roda em serverless)
O scheduler in-code do Mastra **não dispara em Vercel/serverless**. Usamos **Vercel Cron** chamando os endpoints GET `/cron/*` (ver `vercel.json`). O Vercel envia `Authorization: Bearer ${CRON_SECRET}` automaticamente quando `CRON_SECRET` está nas env vars — é o que `routes.ts` valida.

Cadências (em `vercel.json`):
| Workflow | Endpoint | Cadência |
|---|---|---|
| synthesis-consolidation | `/cron/dispatch-all` (fan-out por concorrente) | diária 06:00 |
| journey-radar | `/cron/dispatch` (global) | diária 06:30 |
| journey-referencias | `/cron/dispatch-all` | diária 07:00 |
| journey-captacao | `/cron/dispatch-all` | diária 05:30 |
| journey-insights | `/cron/dispatch-all` | semanal seg 07:00 |

Alternativa a Vercel Cron: `@mastra/inngest` (cron gerenciado) ou host long-running com cron nativo.

## 4. Webhook Apify
Apontar os 9 actors para `POST https://<deploy>/webhooks/apify` com header `x-apify-secret: ${APIFY_WEBHOOK_SECRET}`. O corpo do webhook é gravado em `apify_raw` e o parser (`lib/parser.ts`) popula a Silver correspondente (hoje implementado: `linkedin`; demais sources: TODO).

## 5. Disparo manual (debug)
```
curl -X POST "$URL/cron/dispatch?workflow=journey-radar" -H "Authorization: Bearer $CRON_SECRET"
curl "$URL/cron/dispatch?workflow=synthesis-consolidation&competitor_id=<uuid>" -H "Authorization: Bearer $CRON_SECRET"
```

## 6. Backfill inicial
Após o deploy, rodar `/cron/dispatch-all?workflow=synthesis-consolidation` (gera channel_synthesis + threat brief) e depois as jornadas, contra os concorrentes ativos.
