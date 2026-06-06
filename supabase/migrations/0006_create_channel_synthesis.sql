-- 0006_create_channel_synthesis.sql
-- Gold IA · síntese por canal (9 rows por concorrente)
-- Fonte: Miro "PRD · Schema Completo · Painel de Concorrentes" §3.2

CREATE TABLE IF NOT EXISTS channel_synthesis (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id       UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  generated_at        DATE NOT NULL,
  posicionamento      TEXT,
  promessa_principal  TEXT,
  voz_tom             TEXT,
  publico_alvo        TEXT,
  diferencial         TEXT,
  padroes_fortes      JSONB,
  padroes_fracos      JSONB,
  evolucao_narrativa  JSONB,
  assuntos_novos      JSONB,
  padroes_comerciais  JSONB,
  padroes_dor         JSONB,
  resumo_executivo    TEXT,
  n_items_analisados  INTEGER,
  cost_usd            NUMERIC(8,4),
  UNIQUE (competitor_id, channel, generated_at)
);

CREATE INDEX IF NOT EXISTS idx_cs_competitor_date ON channel_synthesis(competitor_id, generated_at DESC);
