# PRD — Painel de Concorrentes · Backend (Mastra)

> **Produto:** Painel de Concorrentes (inteligência competitiva) — Auton Health
> **Escopo deste PRD:** **somente backend** (pipeline de IA + schema de dados + orquestração)
> **Framework de implementação:** [Mastra](https://mastra.ai) (TypeScript)
> **Versão:** 1.0 · **Data:** 2026-05-26 · **Projeto Supabase:** `lnagzhqejoohhbnfffxw`
> **Fontes da verdade:** board Miro — widgets *"Pipeline IA · Painel de Concorrentes (25 agentes · 5 níveis)"* e *"PRD · Schema Completo · Painel de Concorrentes"*
> **Metodologia:** PRD incremental/dinâmico no estilo AIOS/BMAD (briefing → PRD → arquitetura → quebra em unidades executáveis → histórias → desenvolvimento por história com loop de QA).

---

## 1. Contexto e problema

A Auton Health monitora hoje 5 concorrentes (Amigo Tech, VOA Health, LifeUp, Amplimed, HiDoctor) em múltiplos canais digitais. Os dados são coletados por scrapers Apify, mas falta uma **camada de inteligência** que transforme posts/anúncios/reviews crus em decisão estratégica: quem é a maior ameaça, o que está funcionando na comunicação deles, quais lacunas explorar e quais leads captar.

Já existe uma **v1** ("BACKEND AIOX", branch `feat/backend-aiox`, 2026-05-14): 8 agentes + 7 tabelas, orquestrados com Next.js API Routes + um `agent-runner` próprio. A **v2** (especificada no Miro em 2026-05-26) expande para **25 agentes em 5 camadas** e **22 tabelas** numa arquitetura medallion (Bronze → Silver → Gold), alimentando 4 jornadas de produto.

**Decisão deste PRD:** reconstruir o backend da v2 sobre o **Mastra**, substituindo o `agent-runner` custom e as API Routes da v1 por **Agents, Tools e Workflows** do Mastra. Reaproveitamos o **modelo de dados** e as **regras de negócio** da spec do Miro; não reaproveitamos o código de orquestração antigo.

**Por que Mastra:** primitivos de primeira classe para agentes, ferramentas tipadas e workflows duráveis (fan-out/fan-in, branch, foreach, suspend/resume), saída estruturada validada por Zod, storage em Postgres, observabilidade/tracing e scorers de qualidade — exatamente os blocos que o pipeline precisa, sem reinventar orquestração.

**Resultado pretendido:** um backend que, a cada ciclo, produz por concorrente um *threat brief* (score S/A/B/C/D), e alimenta 4 jornadas — **RADAR** (briefing diário), **REFERÊNCIAS** (ranking de criativos/ganchos), **INSIGHTS** (temas/lacunas) e **CAPTAÇÃO** (leads quentes para o SDR).

---

## 2. Objetivo, público-alvo e métricas de sucesso

### 2.1 Objetivo
Entregar um backend de inteligência competitiva que ingere dados de 9 canais, analisa cada item com um especialista de IA, sintetiza por canal, consolida em um *threat brief* por concorrente e gera 4 jornadas acionáveis — de forma idempotente, observável e com custo controlado.

### 2.2 Público-alvo (usuários do backend)
- **Time de estratégia/marketing Auton** — consome RADAR, REFERÊNCIAS e INSIGHTS (via o painel frontend, fora deste escopo).
- **SDR/Comercial** — consome CAPTAÇÃO (leads quentes + abordagem sugerida).
- **Time técnico Auton** — opera e mantém o pipeline (observabilidade, custos, auditoria).

### 2.3 Métricas de sucesso
| Métrica | Alvo |
|---|---|
| Concorrentes monitorados | 5 (escalável a 20) |
| Latência do ciclo diário (síntese→consolidação→RADAR) | < 30 min |
| Custo por concorrente/mês | ~$38 (1) · ~$215 (5) · ~$425 (10) · ~$805 (20) |
| Itens analisados sem erro (taxa de sucesso por run) | ≥ 99% |
| Reprocessamento duplicado (webhooks re-entregues) | 0 (idempotência por `runId`) |
| Cobertura de saída estruturada validada (Zod) | 100% dos agentes |

---

## 3. Escopo

### 3.1 Dentro do escopo
- **Pipeline de 25 agentes** mapeado em Workflows/Agents/Tools do Mastra.
- **Schema de 22 tabelas** (12 migrations) no Supabase Postgres 15 + RLS + índices.
- **Orquestração**: workflows por cadência (webhook, diário, semanal), idempotência, retries, observabilidade, auditoria de custo.
- **Ingestão**: endpoint de webhook Apify → Bronze (`apify_raw`) → parser → Silver.

### 3.2 Fora do escopo (deste PRD)
- **Frontend** do painel (4 abas + Raio-X) — consome as tabelas Gold; será objeto de PRD próprio.
- **Configuração/credenciais dos 9 actors Apify** — dependência externa (os actors já existem na operação).
- **Deploy de produção end-to-end** — descrito como plano (EPIC 10), mas a execução/infra final é etapa posterior.
- **Migração do código da branch v1** `feat/backend-aiox`.

---

## 4. Stack e decisões de arquitetura

| Camada | Tecnologia |
|---|---|
| Orquestração de agentes | **Mastra** (`@mastra/core`) — Agents, Tools, Workflows |
| Modelos LLM | **Azure OpenAI** (deployment `gpt-4.1-mini`) como provider **ATIVO** — deployment-based API via `@ai-sdk/openai` apontado para o endpoint cognitiveservices (ver `src/mastra/llm.ts`, validado 2026-05-26). Fallback: Anthropic via Model Router. Factory `model('fast'|'heavy')` |
| Banco / persistência de negócio | **Supabase Postgres 15** + RLS (22 tabelas) |
| Persistência de estado do Mastra | **`@mastra/pg` `PostgresStore`** (`mastra_workflow_snapshot`, `mastra_traces`, etc.) no mesmo Supabase |
| Coleta | **Apify** (9 actors) → webhook |
| Agendamento | **Vercel Cron** (ou `@mastra/inngest`) acionando endpoints de run — ver §4.2 |
| Validação de I/O | **Zod** (`structuredOutput` + schemas de tools) |
| Testes | **Vitest** |
| Logs/observabilidade | Tracing OTLP + logging estruturado nativos do Mastra + tabela `agent_runs` |
| Runtime | Node.js ≥ 22.13, TypeScript (moduleResolution `Bundler`/`NodeNext`), Zod ^4 |

### 4.1 Princípios herdados da v1 (mantidos)
- **Agent Authority** — cada agente é dono exclusivo de um conjunto de tabelas de saída (ver §6.4).
- **No Invention** — schemas Zod travam input/output de cada agente (via `structuredOutput`).
- **Idempotência** — `runId` determinístico (sha256) + `agent_runs.input_hash` impedem dupla execução.
- **Quality First** — scorers do Mastra + step de QA com gate.

### 4.2 ⚠️ Decisão crítica — agendamento em serverless
O agendador **in-code do Mastra (`schedule` no `createWorkflow`) NÃO dispara em ambientes serverless** (Vercel/Netlify/Lambda/Cloudflare), porque o processo morre após cada request e o scheduler depende de um processo long-lived.

**Recomendação primária (casa com a infra atual do board):** deploy do servidor Mastra + **agendador externo Vercel Cron** chamando os endpoints de run dos workflows (`POST /api/workflows/:id/runs`).
**Alternativas documentadas:**
- **`@mastra/inngest`** — schedules movem para o `cron` do Inngest (cron gerenciado; não aparece no Mastra Studio).
- **Host long-running** (Railway/Render/Fly) — habilita o engine evented + cron nativo do Mastra (requer storage com updates concorrentes).

> A escolha final de host fica para o EPIC 10; o backend é escrito de forma agnóstica (triggers via HTTP), então a decisão não bloqueia o desenvolvimento dos agentes/workflows.

---

## 5. Arquitetura Mastra

### 5.1 Mapa pipeline (Miro) → primitivos Mastra
O pipeline de 5 camadas vira **vários workflows** (não um monolito), porque as cadências diferem.

| Camada | Conteúdo | Mapeamento Mastra | Saída |
|---|---|---|---|
| **0 · Coleta** | 9 actors Apify → webhook | Endpoint webhook → step grava Bronze; **workflow `ingestion`** com parser | `apify_raw` → 13 Silver |
| **1 · Triagem** | AGT-ORGANIZER (9 dimensões) | 1 **Agent** + step com `structuredOutput` | classificação + roteamento |
| **2 · 10 Especialistas** | por tipo/canal | 10 **Agents**; `.foreach(item)` → `.branch()` por `tipo` → especialista | `post_analysis` |
| **3 · 9 Sintetizadores** | por canal | 9 **Agents**; agregação por canal (`.parallel`/`.foreach`) | `channel_synthesis` |
| **4 · Consolidador** | threat score | 1 **Agent**; fan-in das 9 sínteses | `competitor_threat_brief` |
| **5 · 4 Geradores** | RADAR / REFERÊNCIAS / INSIGHTS / CAPTAÇÃO | 4 **Agents**; `.parallel` | `daily_briefings`, `hook_patterns`, `competitor_insights`, `leads_quentes` |

Total = 1 + 10 + 9 + 1 + 4 = **25 agentes** (os 9 actors Apify são scrapers, não agentes LLM).

### 5.2 Workflows por cadência
| Workflow | Trigger | Camadas | Cadência |
|---|---|---|---|
| `ingestion` | Webhook Apify | 0 | Por evento (scrape concluído) |
| `analysis` | Após ingestão / lote | 1 + 2 | Por item/lote |
| `synthesis-consolidation` | Cron | 3 + 4 | Diário |
| `journey-radar` | Cron | 5 (RADAR) | Diário |
| `journey-referencias` | Webhook de novos ads / cron | 5 (REFERÊNCIAS) | Por evento |
| `journey-insights` | Cron | 5 (INSIGHTS) | Semanal |
| `journey-captacao` | Novos leads/reviews / cron | 5 (CAPTAÇÃO) | Por evento/diário |

### 5.3 Fan-out / fan-in / roteamento
- **`.foreach(step, { concurrency: N })`** — mapeia um step sobre o array de itens novos; default é sequencial (1), elevar para paralelizar.
- **`.branch([[cond, stepA], ...])`** — o AGT-ORGANIZER classifica `tipo`/`canal` e o `.branch()` roteia cada item ao especialista correto (só o 1º branch verdadeiro roda).
- **`.parallel([...])`** — sintetizadores e geradores rodam concorrentes; a saída é um objeto **keyed por step-id**; o fan-in é um `.then(step)` cujo `inputSchema` tem uma chave por step paralelo.
- **Resiliência:** cada chamada de especialista/sintetizador roda em `try/catch`, retornando `{ result: null, failed: true }` em caso de erro, para que **1 falha não aborte a camada** inteira.

### 5.4 Estrutura de pastas
```
src/mastra/
  index.ts                      # instância central Mastra (registra agents, workflows, storage)
  agents/
    organizer.ts                # AGT-ORGANIZER (triagem)
    specialists/                # 10 especialistas (image, carousel, short-video, long-video,
                                #   fb-organic, linkedin-organic, meta-ads, google-ads,
                                #   google-reviews, reclame-aqui)
    synthesizers/               # 9 sintetizadores (ig, tiktok, yt, fb, linkedin,
                                #   meta-ads, google-ads, google-reviews, ra)
    consolidator.ts             # consolidador (threat brief)
    generators/                 # radar-writer, referencias-ranker,
                                #   insights-clusterer, captacao-scorer
  tools/
    supabase/                   # read/write por grupo de tabelas
    audit.ts                    # grava agent_runs (wrapper de custo/tokens/status)
    idempotency.ts              # input_hash / runId determinístico
    apify-parser.ts             # Bronze → Silver
  workflows/
    ingestion.ts
    analysis.ts
    synthesis-consolidation.ts
    journeys/                   # radar.ts, referencias.ts, insights.ts, captacao.ts
  scorers/
    qa.ts                       # scorer/gate de qualidade
  schemas/                      # schemas Zod compartilhados (post_analysis, channel_synthesis, threat_brief)
supabase/
  migrations/                   # 0005..0016 (ver §6)
```

### 5.5 Padrões de código (exemplos de referência)

**Agente especialista com saída estruturada:**
```ts
import { Agent } from '@mastra/core/agent'
import { postAnalysisSchema } from '../../schemas/post-analysis'
import { model } from '../llm'   // provider ativo: Azure OpenAI (gpt-4.1-mini)

export const imageSpecialist = new Agent({
  id: 'spec-image',
  name: 'Especialista · Imagem',
  instructions: `Você analisa um post de imagem de um concorrente e extrai
gancho, promessa central, prova mostrada, estrutura e CTA. Não invente dados.`,
  model: model('fast'),   // consolidação/clustering usam model('heavy')
})
// no step: createStep(imageSpecialist, { structuredOutput: { schema: postAnalysisSchema, errorStrategy: 'fallback' } })
```

**Tool de escrita no Supabase (Agent Authority):**
```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const upsertPostAnalysis = createTool({
  id: 'upsert-post-analysis',
  description: 'Grava/atualiza uma linha em post_analysis (idempotente por competitor_id+channel+source_id)',
  inputSchema: postAnalysisSchema,
  outputSchema: z.object({ id: z.string() }),
  execute: async (input) => ({ id: await db.upsertPostAnalysis(input) }),
})
```

**Workflow de análise (foreach + branch por tipo):**
```ts
const analysis = createWorkflow({ id: 'analysis', inputSchema, outputSchema })
  .then(triageStep)                                   // L1: AGT-ORGANIZER classifica os itens
  .foreach(routeAndAnalyzeStep, { concurrency: 8 })   // L2: por item → branch ao especialista → post_analysis
  .then(persistStep)
  .commit()
```

**Instância central + storage:**
```ts
import { Mastra } from '@mastra/core'
import { PostgresStore } from '@mastra/pg'

export const mastra = new Mastra({
  agents: { organizer, ...specialists, ...synthesizers, consolidator, ...generators },
  workflows: { ingestion, analysis, synthesisConsolidation, ...journeys },
  storage: new PostgresStore({ id: 'pg', connectionString: process.env.DATABASE_URL! }),
})
```

**Scorer/QA gate:**
```ts
const synthesisConsolidation = createWorkflow({ id: 'synthesis-consolidation', /* ... */ })
  .then(channelSynthesisStep)
  .then(consolidateStep)
  .then(qaStep)                                       // emite veredicto estruturado
  .branch([
    [({ inputData }) => inputData.qa.passed, persistBriefStep],
    [({ inputData }) => !inputData.qa.passed, remediateStep],
  ])
  .commit()
```

---

## 6. Modelo de dados

> **Fonte da verdade:** widget Miro *"PRD · Schema Completo · Painel de Concorrentes"* (SQL completo, RLS e índices). Esta seção resume e fixa a ordem de execução. O SQL detalhado de cada tabela é replicado nas migrations.

### 6.1 Inventário (22 tabelas, 4 camadas + audit)
| Camada | Tabelas | Status |
|---|---|---|
| **Bronze (1)** | `apify_raw` | **já existe** (shape v1 ≠ alvo — ver §6.1.1) |
| **Silver (13)** | `competitors`, `monitoring_jobs` | existem · **ajustar** (ALTER parcial — ver §6.1.1) |
| | `ig_posts`, `tiktok_videos`, `fb_posts`, `yt_videos`, `google_reviews`, `google_qa`, `google_serp`, `ra_complaints`, `meta_ads`, `google_ads` | existem · não alterar |
| | `linkedin_posts` | **CRIAR** |
| **Gold IA (3)** | `post_analysis`, `channel_synthesis`, `competitor_threat_brief` | **CRIAR** |
| **Gold Jornadas (4)** | `daily_briefings`, `hook_patterns`, `competitor_insights`, `leads_quentes` | existem · **refinar** (ALTER — ver §6.1.1) |
| **Audit (1)** | `agent_runs` | **já existe** (sem `run_id`/`trace_id` — ver §6.1.1) |

### 6.1.1 Estado real do banco — verificado em 2026-05-26 (via PostgREST/service key)

O projeto `lnagzhqejoohhbnfffxw` **expõe hoje 23 tabelas**. O schema-alvo do Miro era idealizado e **diverge da realidade** em nomes de colunas e em quais tabelas já existem. Delta real:

**A) Tabelas a CRIAR (4) — ✅ APLICADAS em 2026-05-26 (banco agora com 27 tabelas):**
`post_analysis`, `channel_synthesis`, `competitor_threat_brief` (Gold IA) e `linkedin_posts` (Silver). → migrations **0005, 0006, 0007, 0010**. Nota: `linkedin_posts.raw_id` é `BIGINT` (FK p/ `apify_raw.id`, que é bigint). ALTERs (0017) e RLS (0018) também aplicados.

**B) Tabelas que JÁ EXISTEM com shape v1 (reconciliar, não recriar):**
- **`apify_raw`** — tem `apify_run_id`, `apify_actor`, `processed`(bool), `status`, `error_msg`, `cost_usd`. Difere do alvo (`run_id`, `actor_id`, `dataset_id`, `payload_bytes`, `parsed_at`, `parse_status`, `parse_error`, `rows_parsed`). **Decisão:** usar o shape existente (mapear `apify_run_id`→idempotência, `processed`→status de parse); não recriar. ⚠️ **PK `apify_raw.id` é `bigint`** (não uuid) — `linkedin_posts.raw_id` deve ser `BIGINT`. (`competitors.id` é `uuid`, confirmado.)
- **`agent_runs`** — tem `input_hash`, `input/output`, `status`, `trigger_type`, `llm_model`, `llm_cost_usd`, `llm_tokens_in/out`, `started_at/finished_at`. **Faltam `run_id` (UNIQUE) e `trace_id`** para casar com o Mastra. **Decisão:** ALTER adicionando `run_id` + `trace_id` (+ opcional `parent_run_id`, `duration_ms`); idempotência continua por `input_hash` e passa a ter `run_id` determinístico.

**C) ALTERs reais (muitas colunas-alvo já existem):**
| Tabela | Já tem | Falta adicionar | Conflito de nome a reconciliar |
|---|---|---|---|
| `competitors` (39 cols) | `linkedin_url`, `google_ads_*`, `fb_cover_photo_url`, `yt_banner_url`, `last_ranked_at`, `last_briefing_date`, `last_insights_week` | **`last_threat_score`, `last_threat_letter`, `scrape_priority`** | — |
| `monitoring_jobs` | `cron_expression`, `next_run_at` | **`total_runs`, `total_cost_usd`** | usar `cron_expression` (não criar `schedule_cron`) |
| `daily_briefings` | estrutura v1 (headline, top_*) | **`briefing_md`, `sections`** | — |
| `hook_patterns` | pattern_label, hook_text, ad_count… | **`channel`, `formula_estrutural`, `avg_days_running`, `rank_global`** | — |
| `competitor_insights` | `week_of`, `theme_label`, `copy_variations` | **`theme_id`, `affected_competitors`, `rank_global`** | `week_of`≈`generated_week`; `theme_label`≈`theme_name` |
| `leads_quentes` | `source_table`, `source_id`, `lead_score`, `sdr_script` | **`source_url`, `target_competitor_id`, `score_breakdown`, `best_channel`, `urgencia`** | `lead_score`≈`fit_score`; `source_table`≈`source` |

**D) Tabelas legadas v1 fora do modelo v2 (5)** — decidir manter/depreciar:
`competitor_alerts`, `competitor_kpis_daily`, `competitor_rankings`, `post_metrics_history` (do BACKEND AIOX v1) e `aulas` (aparentemente não relacionada ao painel).

**⚠️ Convenção de nomes:** o banco vivo usa nomes v1 (`llm_cost_usd`, `llm_model`, `llm_tokens_in/out`, `cron_expression`, `lead_score`, `week_of`, `theme_label`, `apify_run_id`). **Diretriz:** nas tabelas existentes, **reutilizar as colunas v1** equivalentes em vez de renomear/duplicar; nas 4 tabelas novas, usar os nomes do schema do Miro. As tools/schemas Zod do Mastra mapeiam para os nomes reais das colunas.

### 6.2 Ordem das 12 migrations
```
supabase/migrations/
├── 0005_create_post_analysis.sql
├── 0006_create_channel_synthesis.sql
├── 0007_create_competitor_threat_brief.sql
├── 0008_alter_competitors_extra_columns.sql
├── 0009_alter_monitoring_jobs.sql
├── 0010_create_linkedin_posts.sql
├── 0011_alter_daily_briefings.sql
├── 0012_alter_hook_patterns.sql
├── 0013_alter_competitor_insights.sql
├── 0014_alter_leads_quentes.sql
├── 0015_create_agent_runs_if_missing.sql
└── 0016_rls_policies_all.sql
```

> **Ajuste pós-verificação (§6.1.1):** na prática, **0005/0006/0007/0010 são os únicos CREATE reais**; 0008–0009 e 0011–0014 viram ALTERs reduzidos (só as colunas faltantes da tabela C); 0015 vira ALTER em `agent_runs` (add `run_id`/`trace_id`, pois a tabela já existe). Renumerar conforme a última migration já aplicada no projeto.

### 6.3 Estruturas-chave (resumo)
- **`post_analysis`** (saída dos 10 especialistas): 9 dimensões universais da Camada 1 (`tipo`, `tema_principal`, `temas_secund[]`, `perfil_alvo`, `nivel_tecnico`, `tom`, `tem_prova`, `tem_cta`, `qualidade_leg`) + 6 campos universais da Camada 2 (`gancho_texto`, `tipo_gancho`, `promessa_central`, `prova_mostrada`, `estrutura`, `cta`) + `specialist_payload JSONB` + engajamento + metadata de custo. `UNIQUE (competitor_id, channel, source_id)`.
- **`channel_synthesis`** (9 linhas/concorrente): posicionamento, promessa, voz/tom, público, diferencial, `padroes_fortes/fracos`, `evolucao_narrativa`, `padroes_comerciais/dor` (JSONB). `UNIQUE (competitor_id, channel, generated_at)`.
- **`competitor_threat_brief`** (1 linha/concorrente, UPSERT): `threat_score` (0–100), `threat_letter` (S/A/B/C/D), `fraquezas_exploraveis`, `recomendacao_acao` (JSONB).
- **`agent_runs`** (audit): `run_id UNIQUE`, `input_hash`, tokens, `cost_usd`, `status`, `trace_id` — base de idempotência e custo.

### 6.4 Agent Authority (dono de tabela por agente)
| Agente | Tabela(s) que escreve |
|---|---|
| Ingestão/parser | `apify_raw` + 13 Silver |
| AGT-ORGANIZER | (classifica; alimenta especialistas) |
| 10 Especialistas | `post_analysis` |
| 9 Sintetizadores | `channel_synthesis` |
| Consolidador | `competitor_threat_brief` |
| RADAR-WRITER | `daily_briefings` |
| REFERÊNCIAS-RANKER | `hook_patterns` |
| INSIGHTS-CLUSTERER | `competitor_insights` |
| CAPTAÇÃO-SCORER | `leads_quentes` |
| Todos (wrapper) | `agent_runs` (audit) |

### 6.5 RLS (resumo)
- **Leitura pública (anon/auth SELECT):** `competitors`, tabelas sociais (`ig_posts`…`linkedin_posts`), `google_*`, `ra_complaints`, `meta_ads`, `google_ads`, `post_analysis`, `channel_synthesis`, `competitor_threat_brief`, `daily_briefings`, `hook_patterns`, `competitor_insights`.
- **Apenas `service_role`:** `leads_quentes` (dados SDR), `agent_runs` (prompts+custos), `apify_raw`, `monitoring_jobs`.
- **`service_role` tem `ALL`** em todas. Backend acessa via service role.

> **✅ Verificado em 2026-05-26** (via PostgREST + service key): o projeto expõe 23 tabelas; o delta real está em **§6.1.1**. Antes de aplicar ALTERs, conferir as policies RLS já existentes (várias tabelas v1 já têm RLS). Recomenda-se rodar `get_advisors` após as migrations.

---

## 7. Requisitos funcionais (RF)

**Camada 0 — Coleta/Ingestão**
- RF-01: Endpoint `POST /webhooks/apify` autenticado por `x-apify-secret` recebe o payload do scrape.
- RF-02: O payload bruto é gravado em `apify_raw` (Bronze) com `run_id UNIQUE`; re-entregas não duplicam.
- RF-03: Um parser transforma o Bronze nas tabelas Silver corretas conforme o `source`/actor (`ACTOR_TO_SOURCE`), incluindo o novo canal `linkedin_posts`.

**Camada 1 — Triagem**
- RF-04: AGT-ORGANIZER classifica cada item novo nas 9 dimensões universais e define o `tipo`/`canal` para roteamento.

**Camada 2 — Especialistas**
- RF-05: Cada item é roteado (branch) ao especialista correto (10 tipos) que produz a análise (6 campos universais + `specialist_payload`) e grava em `post_analysis` (UPSERT idempotente).

**Camada 3 — Sintetizadores**
- RF-06: Por canal (9), um sintetizador agrega as `post_analysis` do concorrente e grava `channel_synthesis` (1 linha/canal/data).

**Camada 4 — Consolidador**
- RF-07: O consolidador recebe as 9 sínteses e produz `competitor_threat_brief` (UPSERT) com `threat_score` e `threat_letter`.

**Camada 5 — Geradores de jornada**
- RF-08 (RADAR): gerar `daily_briefings` (briefing diário denso) por concorrente/dia.
- RF-09 (REFERÊNCIAS): ranquear ganchos/criativos em `hook_patterns` (`rank_global`).
- RF-10 (INSIGHTS): clusterizar temas/lacunas em `competitor_insights` (`generated_week`, `rank_global`).
- RF-11 (CAPTAÇÃO): scorar leads em `leads_quentes` (`fit_score`, `urgencia`, abordagem SDR).

**Transversais**
- RF-12: Toda execução de agente grava auditoria em `agent_runs` (tokens, `cost_usd`, `status`, `trace_id`).
- RF-13: Disparo manual de qualquer workflow via endpoint interno autenticado (`x-internal-secret`).

---

## 8. Requisitos não-funcionais (RNF)

- **RNF-01 Idempotência:** `runId` determinístico (sha256 do payload/source) reaproveita o mesmo run em re-entregas; dedupe na 1ª etapa contra a tabela alvo. Steps `execute` idempotentes.
- **RNF-02 Durabilidade:** snapshots de workflow persistidos (`mastra_workflow_snapshot`) permitem resume após falha/redeploy.
- **RNF-03 Resiliência:** retries com backoff exponencial (3 tentativas: 1s/4s/16s); falha de 1 item não derruba a camada.
- **RNF-04 Custo:** saída estruturada enxuta; modelo barato (Haiku/4o-mini) por padrão; Sonnet só na consolidação/clustering. Alvo de custo conforme §2.3, rastreado em `agent_runs.cost_usd`.
- **RNF-05 Observabilidade:** tracing OTLP + logs estruturados; cada run correlacionado por `trace_id`.
- **RNF-06 Segurança:** RLS habilitado em todas as tabelas; segredos em env vars; backend usa `service_role`; tabelas sensíveis sem acesso anon.
- **RNF-07 Qualidade:** scorers amostrados (não-bloqueantes) + step de QA com gate antes de persistir o threat brief / jornadas.
- **RNF-08 Performance:** ciclo diário < 30 min para 5 concorrentes (concorrência ajustável no `.foreach`).

### Variáveis de ambiente
```
AZURE_OPENAI_ENDPOINT         # provider ATIVO (cognitiveservices.azure.com)
AZURE_OPENAI_API_KEY
AZURE_OPENAI_API_VERSION      # 2025-01-01-preview
AZURE_OPENAI_DEPLOYMENT       # gpt-4.1-mini
# AZURE_OPENAI_DEPLOYMENT_HEAVY # opcional: deployment forte p/ tier 'heavy'
# ANTHROPIC_API_KEY           # fallback (só se AZURE_OPENAI_ENDPOINT ausente)
DATABASE_URL                  # Supabase (pooler) — para @mastra/pg
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY     # acesso de negócio (service_role)
SUPABASE_PUBLISHABLE_KEY      # anon/público
APIFY_WEBHOOK_SECRET
CRON_SECRET                   # autentica o agendador externo
INTERNAL_API_SECRET           # disparo manual
```

---

## 9. Épicos e histórias de usuário

> Cada história segue o template AIOS: **"Como `<papel>`, quero `<capacidade>` para `<valor>`"** + critérios de aceitação verificáveis. Desenvolvimento **por história**, com loop de QA (dev → review → QA → próxima história).

### EPIC 0 — Fundação Mastra
- **H0.1** Como dev, quero o projeto Mastra scaffoldado (`create-mastra`) com a estrutura de `src/mastra/{agents,tools,workflows,scorers,schemas}` para começar com base limpa.
  - *Aceite:* `mastra dev` sobe o servidor (porta 4111) e o Studio; Node ≥22.13; TS com `moduleResolution` moderno; Vitest e lint configurados.
- **H0.2** Como dev, quero `@mastra/pg` apontando para o Supabase para persistir estado/tracing do Mastra.
  - *Aceite:* tabelas `mastra_*` criadas; uma run de teste aparece em `mastra_workflow_snapshot`/`mastra_traces`.

### EPIC 1 — Camada de dados (migrations)
- **H1.1** Como dev, quero **criar as 4 tabelas faltantes** (`post_analysis`, `channel_synthesis`, `competitor_threat_brief`, `linkedin_posts`) para completar o modelo v2 (ver §6.1.1).
  - *Aceite:* 4 tabelas criadas com FKs `ON DELETE CASCADE`, CHECKs (`threat_letter`, `fit_score`) e índices; `get_advisors` sem warnings críticos.
- **H1.2** Como dev, quero **aplicar os ALTERs reduzidos** nas tabelas existentes (só colunas faltantes da tabela C em §6.1.1) e adicionar `run_id`/`trace_id` em `agent_runs`, reutilizando colunas v1 (sem renomear/duplicar).
  - *Aceite:* colunas faltantes adicionadas; nenhuma coluna duplicada criada; RLS conferido nas tabelas alteradas.
- **H1.3** Como dev, quero **decidir manter ou depreciar** as 5 tabelas legadas v1 (§6.1.1-D).
  - *Aceite:* decisão registrada; tabelas mantidas não interferem no pipeline v2.

### EPIC 2 — Tools de dados
- **H2.1** Como agente, quero tools tipadas (Zod) de read/write por grupo de tabelas para gravar minhas saídas respeitando Agent Authority.
- **H2.2** Como sistema, quero uma tool de auditoria que grava `agent_runs` (tokens/custo/status/trace) em todo run.
- **H2.3** Como sistema, quero uma tool de idempotência (`input_hash`/`runId`) para evitar reprocessamento.
  - *Aceite:* UPSERTs idempotentes; re-entrega do mesmo payload não cria linha nova; auditoria registrada.

### EPIC 3 — Coleta (Camada 0)
- **H3.1** Como Apify, quero um webhook seguro que grava o payload em `apify_raw`.
- **H3.2** Como sistema, quero um parser Bronze→Silver por `source`/actor (inclui `linkedin_posts`).
  - *Aceite:* webhook valida `x-apify-secret`; `run_id` único; parser preenche a tabela Silver correta; `parse_status` atualizado.

### EPIC 4 — Análise (Camadas 1+2)
- **H4.1** Como sistema, quero o AGT-ORGANIZER classificando itens nas 9 dimensões e roteando por `tipo`.
- **H4.2** Como sistema, quero o workflow `analysis` com `.foreach`→`.branch`→especialista, gravando `post_analysis`.
- **H4.3..H4.12** (uma por especialista) — Image, Carousel, Short Video, Long Video, FB Organic, LinkedIn Organic, Meta Ads, Google Ads, Google Reviews, Reclame Aqui.
  - *Aceite (por especialista):* saída validada pelo `postAnalysisSchema`; UPSERT idempotente; custo registrado; 1 falha não aborta o lote.

### EPIC 5 — Síntese (Camada 3)
- **H5.1..H5.9** (uma por canal) — sintetizador agrega `post_analysis` do canal → `channel_synthesis`.
  - *Aceite:* 9 linhas/concorrente/data; JSONB de padrões preenchido; `n_items_analisados` coerente.

### EPIC 6 — Consolidação (Camada 4)
- **H6.1** Como estrategista, quero um `competitor_threat_brief` por concorrente com `threat_score` e `threat_letter`.
  - *Aceite:* fan-in das 9 sínteses; UPSERT 1 linha/concorrente; `threat_letter ∈ {S,A,B,C,D}`.

### EPIC 7 — Geradores de jornada (Camada 5)
- **H7.1 RADAR** → `daily_briefings` (diário). **H7.2 REFERÊNCIAS** → `hook_patterns` (rank). **H7.3 INSIGHTS** → `competitor_insights` (semanal). **H7.4 CAPTAÇÃO** → `leads_quentes` (fit_score/urgência/abordagem SDR).
  - *Aceite:* cada gerador grava sua tabela respeitando os campos do mapeamento §8 do PRD de schema.

### EPIC 8 — Orquestração & agendamento
- **H8.1** Como operador, quero workflows acionáveis por webhook e por agendador externo (Vercel Cron/Inngest) com `runId` determinístico.
  - *Aceite:* cron diário dispara `synthesis-consolidation` + `journey-radar`; semanal dispara `journey-insights`; webhooks disparam `ingestion`/`journey-referencias`.

### EPIC 9 — Qualidade & observabilidade
- **H9.1** Como time técnico, quero scorers amostrados + step de QA com `.branch()` (gate passa/refaz) antes de persistir brief/jornadas.
- **H9.2** Como time técnico, quero tracing + auditoria de custo por agente/run em `agent_runs`.
  - *Aceite:* QA reprovado dispara remediação/suspend; custos por run visíveis; traces correlacionados.

### EPIC 10 — Deploy
- **H10.1** Como operador, quero o backend deployado com o deployer escolhido, env vars configuradas e endpoints expostos.
- **H10.2** Como operador, quero um backfill inicial contra **Amigo Tech** para validar o pipeline ponta a ponta (custo ~$0,70).
  - *Aceite:* endpoints de run respondem; backfill produz `post_analysis`→`channel_synthesis`→`threat_brief`→4 jornadas para Amigo Tech.

### 9.1 Template de especificação por agente (os 25 agentes)
Cada agente é documentado/implementado com: **instructions** (papel + regras "no invention") · **modelo** (Azure `gpt-4.1-mini`) · **inputSchema** · **outputSchema (Zod)** · **tabela alvo** · **custo-alvo/run** · **critério de QA**.

**Profundidade dos agentes (2026-05-26):** todos compartilham um **contexto de domínio** (`agents/context.ts` — Auton, medicina integrativa, objetivo de inteligência competitiva, regra "no invention"). Os 10 especialistas têm **payloads específicos por tipo** (`schemas/specialist-payloads.ts`): cada `tipo` extrai os 6 campos universais + campos próprios do formato (ex.: meta_ads → ângulo/oferta/urgência/prova social/público; reclame_aqui → gravidade/risco reputacional/sinal de lead). O organizer tem rubrica das 9 dimensões; o consolidador tem rubrica de faixas S/A/B/C/D; os geradores têm instruções por jornada. Validado e2e via Azure (organizer→especialista meta_ads com payload tipado; scorer LLM-judge score 0.9). **Tuning:** `temperature` por chamada (0.2 nas extrações → 0.3 síntese/consolidação → 0.4–0.5 geradores) e **scorer de qualidade LLM-judge amostrado** (`agent-quality`, `scorers/agent-quality.ts`) anexado a especialistas (15%) e sintetizadores (20%); organizer com few-shot.

---

## 10. Critérios de aceitação globais
- [ ] 22 tabelas criadas; RLS habilitado em todas; policies aplicadas (anon read nas públicas; service_role nas sensíveis).
- [ ] ≥ 15 índices; FKs `ON DELETE CASCADE`; CHECKs em domínios fechados; 12 migrations aplicadas em sequência.
- [ ] `get_advisors` sem warnings críticos; backup automático (Supabase Pro) habilitado.
- [ ] 25 agentes implementados com saída estruturada validada (Zod) — 100%.
- [ ] Workflows por cadência operam com idempotência (0 duplicações) e durabilidade (resume).
- [ ] Pipeline produz, para ≥1 concorrente, as 4 jornadas (RADAR, REFERÊNCIAS, INSIGHTS, CAPTAÇÃO) + threat brief.
- [ ] Auditoria de custo por run em `agent_runs`; custo/concorrente dentro do alvo (§2.3).
- [ ] Suíte Vitest passando (unit + integração dos workflows).

---

## 11. Riscos e restrições
| Risco | Impacto | Mitigação |
|---|---|---|
| Cron in-code do Mastra não roda em serverless | Agendamento não dispara | Vercel Cron externo (primário) / Inngest / host long-running (§4.2) |
| Custo de tokens cresce com nº de concorrentes/itens | Custo mensal | Modelos baratos por padrão; Sonnet só onde necessário; `cost_usd` monitorado |
| Limites/custos do Apify (9 actors) | Coleta incompleta | Dependência externa; `monitoring_jobs` com `schedule_cron`/`next_run_at`; alertas de custo |
| Qualidade variável do LLM | Saídas ruins | Scorers + QA gate; `errorStrategy: 'fallback'`; prompts com "no invention" |
| Deriva de schema v1↔alvo (nomes de coluna divergem) | Migrations/queries quebram | Verificado em §6.1.1; reutilizar colunas v1, ALTERs reduzidos, schemas Zod mapeiam para nomes reais |
| Caminhos de endpoint do Mastra variam por versão | Integração de trigger | Confirmar via Swagger UI da versão instalada |
| Endpoints de webhook/trigger expostos | Segurança | Segredos por header (`x-apify-secret`, `CRON_SECRET`, `x-internal-secret`); RLS |

---

## 12. Plano de execução incremental
Ordem recomendada (cada fase = um épico; desenvolvimento por história com QA):
1. **EPIC 0** — Fundação Mastra (scaffold + `@mastra/pg`).
2. **EPIC 1** — Migrations (22 tabelas + RLS + índices) — *após verificar `list_tables`*.
3. **EPIC 2** — Tools de dados (Agent Authority + audit + idempotência).
4. **EPIC 3** — Coleta (webhook + parser Bronze→Silver).
5. **EPIC 4** — Análise (triagem + 10 especialistas).
6. **EPIC 5** — Síntese (9 sintetizadores).
7. **EPIC 6** — Consolidação (threat brief).
8. **EPIC 7** — Geradores de jornada (4).
9. **EPIC 8** — Orquestração & agendamento.
10. **EPIC 9** — Qualidade & observabilidade.
11. **EPIC 10** — Deploy + backfill (Amigo Tech).

### Checklist de verificação ponta a ponta
- [x] Estado real verificado em 2026-05-26 (§6.1.1): 23 tabelas; 4 a criar; ALTERs reduzidos; tabelas legadas v1 identificadas.
- [x] **Implementação (2026-05-26):** scaffold Mastra 1.36 + AI SDK v6; Azure OpenAI (`gpt-4.1-mini`) provider ativo (`src/mastra/llm.ts`); **25 agentes + 7 workflows** (ingestion c/ parser, analysis, synthesis-consolidation c/ QA gate, journey-radar/referencias/insights/captacao); triggers HTTP (`/webhooks/apify`, `/cron/dispatch`, `/cron/dispatch-all`); storage condicional `@mastra/pg`↔LibSQL; **typecheck EXIT 0**, **9 testes Vitest OK**, e2e organizer via Azure OK, 7/7 workflows registrados.
- [x] **Restante implementado (2026-05-26):** 10 parsers Bronze→Silver (9 canais + linkedin); scorer **LLM-as-judge** (`threat-brief-qa`, validado via Azure: score 0.9) + QA gate code-only; **VercelDeployer** wirado; storage condicional `@mastra/pg`↔LibSQL. Typecheck EXIT 0, 9 testes OK.
- [x] **Ponte Silver→analysis (2026-05-26):** `lib/silver.ts` lê as 10 tabelas Silver → `WorkItem[]` (dedup contra post_analysis); `analysis` aceita `items` opcional (busca da Silver) → cron `analysis` no vercel.json. **Validado em dados reais:** Amigo Tech rendeu 123 WorkItems; o workflow `analysis` rodou (status success) e gravou 3 linhas em `post_analysis`. Pipeline autônomo ponta a ponta funcionando.
- [x] **Robustez de produção (2026-05-26):** auditoria `agent_runs` (upsert idempotente em `agent_name`+`input_hash`, `trigger_type='cron'`, `status='success'`) + custo/tokens em `post_analysis` e tabelas Gold (via `lib/run-agent.ts` + `lib/cost.ts`); `runId` determinístico nos `createRun`; idempotência de inserts (parser dedup-por-key, `apify_raw` por `apify_run_id`, jornadas delete/dedup). Validado e2e (agent_runs +2/item, custo gravado); 13 testes Vitest.
- [x] **Pipeline COMPLETO validado e2e em dados reais (2026-05-27, Amigo Tech):** synthesis-consolidation (threat_score 78/A, 7 canais), referencias (10), insights (9), captacao (18 leads), radar (briefing do dia). Todos os CHECKs/constraints v1 reconciliados (status `success`/`failed`, `trigger_type` cron, `source_table` enum, leads `status='new'`, daily_briefings upsert por `briefing_date` + period_start/end, threat brief sem `z.record`). Secrets gerados no `.env`.
- [x] **Parsers validados contra payloads REAIS do Apify (2026-05-27):** via `scripts/validate-parsers-live.ts` (token na conta). **instagram** (scraper+reels) 13/14 colunas, **facebook posts** 8/12, **google_ads** (solidcode) 9/14 — únicas nulas são campos que o actor não emite. **2 bugs corrigidos** em `lib/parser.ts`: google_ads lia `format`/`daysServed` mas o actor envia `adFormat`/`approxDaysShown`; o `facebook-ads-scraper` agrupa anúncios em `{results:[...]}` por URL — `metaAds` agora achata o wrapper. Locked em `tests/parser.test.ts` (6 testes). **Não validável nesta conta:** meta_ads (todos os runs vieram com `results` vazio — sem anúncio ativo) e youtube (run foi channel-only, sem linhas de vídeo) — mapeamento de campos desses dois fica não-confirmado até haver run populado.
- [x] **Análise MULTIMODAL — imagem + áudio (2026-05-27):** os especialistas agora "leem" a mídia, não só o texto. **Imagem**: `lib/media.ts` baixa a imagem como bytes inline e `lib/run-agent.ts` monta mensagem multimodal → o especialista vê o criativo. Validado e2e (`scripts/smoke-vision.ts`): gpt-4.1-mini leu um anúncio real (Google Ads "Life Up"), extraiu texto da arte + logo + cores (~US$0,0006/img). **Áudio de vídeo**: `lib/transcribe.ts` transcreve via Azure `/audio/transcriptions` (deployment `gpt-4o-transcribe-diarize`, api-version `2025-03-01-preview`; validado via `scripts/smoke-transcribe.ts`). `WorkItem`+Silver ganharam `video_url`. **Superado para vídeo pelo Gemini (ver abaixo) — transcribe.ts vira fallback latente.**
- [x] **VÍDEO via Gemini 2.5 Flash (2026-05-27):** decisão do usuário — em vez de transcrever áudio, o **Gemini entende vídeo nativamente** (frames + áudio). `lib/gemini.ts` `runVideoAgent` (`@ai-sdk/google` + `generateObject`, saída Zod, auditoria+custo). YouTube → URL nativa (`fileData.fileUri`); IG/TikTok/FB/Meta → baixa bytes (guard p/ pular watch-page) e manda inline. `analysis.ts` roteia `short_video`/`long_video` c/ `video_url` → Gemini, com fallback p/ especialista Azure. Imagem segue no Azure. Implementado, typecheck OK, 24 testes. **VALIDADO e2e (2026-05-27)** via `scripts/smoke-gemini.ts` num vídeo real do YouTube: Gemini transcreveu a fala E descreveu os frames, preenchendo o schema do especialista (~US$0,0055/vídeo de 19s).
- [x] **Cadeia multimodal completa com mídia VIVA (2026-05-27):** scrape FRESCO (instagram-reel-scraper, HiDoctor) → parser extraiu `media_url`+`video_url` vivas (HTTP 206) → Azure leu a capa ($0,0013) E Gemini assistiu o reel ($0,0121). `scripts/smoke-live-chain.ts`. Confirma: as URLs vêm em 100% dos itens (`scripts/check-media-urls.ts`) e funcionam com scrape recente (CDN social expira em dias → análise roda via webhook logo após o scrape). **Bug do parser FB corrigido:** imagem vem de `media[*].image.uri`, não do permalink `media[0].url`.
- [ ] **Dependências externas (não-código):** deploy na Vercel + `DATABASE_URL`; rotacionar chaves (Azure, Supabase service, **Apify token**); `get_advisors`; validar campos de meta_ads/youtube quando houver run populado; (opcional) etapa de extração de áudio p/ cobrir TikTok/YouTube (watch-page não é mídia direta).
- [x] Migrations aplicadas (2026-05-26: 4 CREATEs + 0017 ALTERs + 0018 RLS; 27 tabelas). `get_advisors` pendente (MCP sem acesso — rodar pelo dono do projeto).
- [ ] `mastra dev` sobe; agentes/workflows aparecem no Studio.
- [ ] Webhook Apify → `apify_raw` → Silver funciona (teste com 1 payload real).
- [ ] `analysis` gera `post_analysis` para um lote (com 1 item forçado a falhar, sem abortar o lote).
- [ ] `synthesis-consolidation` gera `channel_synthesis` (9) + `competitor_threat_brief` (1).
- [ ] 4 workflows de jornada gravam suas tabelas.
- [ ] `agent_runs` registra custo/tokens/status de cada run; re-entrega não duplica.

---

> **Nota AIOS:** este PRD é **incremental/dinâmico**. À medida que a arquitetura/QA revelarem ajustes (ex.: um especialista pedir campo novo no schema), volte ao requisito correspondente, ajuste e revalide — não trate este documento como imutável.
