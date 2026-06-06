-- 0007_create_competitor_threat_brief.sql
-- Gold IA · consolidação por concorrente (1 row · UPSERT)
-- Fonte: Miro "PRD · Schema Completo · Painel de Concorrentes" §3.3

CREATE TABLE IF NOT EXISTS competitor_threat_brief (
  competitor_id            UUID PRIMARY KEY REFERENCES competitors(id) ON DELETE CASCADE,
  generated_at             TIMESTAMPTZ DEFAULT now(),
  threat_score             INTEGER CHECK (threat_score BETWEEN 0 AND 100),
  threat_letter            TEXT CHECK (threat_letter IN ('S','A','B','C','D')),
  categoria_ameaca         TEXT,
  posicionamento_dominante TEXT,
  promessas_diferenciais   JSONB,
  fraquezas_exploraveis    JSONB,
  canais_dominantes        TEXT[],
  canais_ausentes          TEXT[],
  investimento_paid        JSONB,
  velocidade_inovacao      JSONB,
  recomendacao_acao        JSONB,
  justificativa            TEXT,
  cost_usd                 NUMERIC(8,4)
);
