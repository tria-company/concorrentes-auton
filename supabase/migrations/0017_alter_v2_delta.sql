-- 0017_alter_v2_delta.sql
-- ALTERs reduzidos (só colunas faltantes — ver PRD §6.1.1). Aditivo e idempotente.
-- Reutiliza colunas v1 existentes (cron_expression, lead_score, week_of, theme_label) — não renomeia/duplica.

-- competitors: faltam só estas 3 (as demais colunas v2 já existem)
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS last_threat_score  INTEGER,
  ADD COLUMN IF NOT EXISTS last_threat_letter TEXT,
  ADD COLUMN IF NOT EXISTS scrape_priority    INTEGER DEFAULT 5;

-- monitoring_jobs: reutiliza cron_expression existente
ALTER TABLE monitoring_jobs
  ADD COLUMN IF NOT EXISTS total_runs     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(10,4) DEFAULT 0;

-- daily_briefings
ALTER TABLE daily_briefings
  ADD COLUMN IF NOT EXISTS briefing_md TEXT,
  ADD COLUMN IF NOT EXISTS sections    JSONB;

-- hook_patterns
ALTER TABLE hook_patterns
  ADD COLUMN IF NOT EXISTS channel            TEXT,
  ADD COLUMN IF NOT EXISTS formula_estrutural TEXT,
  ADD COLUMN IF NOT EXISTS avg_days_running   NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS rank_global        INTEGER;
CREATE INDEX IF NOT EXISTS idx_hp_rank    ON hook_patterns(rank_global);
CREATE INDEX IF NOT EXISTS idx_hp_channel ON hook_patterns(channel, ad_count DESC);

-- competitor_insights: reutiliza week_of (semana) e theme_label
ALTER TABLE competitor_insights
  ADD COLUMN IF NOT EXISTS theme_id             TEXT,
  ADD COLUMN IF NOT EXISTS theme_name           TEXT,
  ADD COLUMN IF NOT EXISTS affected_competitors UUID[],
  ADD COLUMN IF NOT EXISTS rank_global          INTEGER;
CREATE INDEX IF NOT EXISTS idx_ci_rank ON competitor_insights(week_of DESC, rank_global);

-- leads_quentes: reutiliza lead_score (fit) e source_table (source)
ALTER TABLE leads_quentes
  ADD COLUMN IF NOT EXISTS source_url           TEXT,
  ADD COLUMN IF NOT EXISTS target_competitor_id UUID REFERENCES competitors(id),
  ADD COLUMN IF NOT EXISTS score_breakdown      JSONB,
  ADD COLUMN IF NOT EXISTS best_channel         TEXT,
  ADD COLUMN IF NOT EXISTS urgencia             TEXT;

-- agent_runs: adiciona run_id/trace_id para casar com o Mastra (idempotência continua por input_hash)
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS run_id        TEXT,
  ADD COLUMN IF NOT EXISTS parent_run_id TEXT,
  ADD COLUMN IF NOT EXISTS trace_id      TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms   INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_run_id ON agent_runs(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_trace ON agent_runs(trace_id);
