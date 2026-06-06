-- 0005_create_post_analysis.sql
-- Gold IA · análise individual por item (output dos 10 especialistas)
-- Fonte: Miro "PRD · Schema Completo · Painel de Concorrentes" §3.1

CREATE TABLE IF NOT EXISTS post_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,
  source_table    TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  specialist_used TEXT NOT NULL,
  -- Camada 1 (Organizer) · 9 dimensões universais
  tipo            TEXT,
  tema_principal  TEXT,
  temas_secund    TEXT[],
  perfil_alvo     TEXT,
  nivel_tecnico   TEXT,
  tom             TEXT,
  tem_prova       BOOLEAN,
  tem_cta         BOOLEAN,
  qualidade_leg   TEXT,
  -- Camada 2 (Especialista) · 6 campos universais
  gancho_texto         TEXT,
  tipo_gancho          TEXT,
  promessa_central     TEXT,
  prova_mostrada       TEXT,
  estrutura            TEXT,
  cta                  TEXT,
  -- Payload específico do especialista
  specialist_payload   JSONB,
  -- Engajamento snapshot
  likes               INTEGER,
  comments            INTEGER,
  shares              INTEGER,
  views               INTEGER,
  eng_rate            NUMERIC(6,3),
  -- Metadata
  posted_at           TIMESTAMPTZ,
  analyzed_at         TIMESTAMPTZ DEFAULT now(),
  model               TEXT,
  cost_usd            NUMERIC(8,4),
  tokens_in           INTEGER,
  tokens_out          INTEGER,
  UNIQUE (competitor_id, channel, source_id)
);

CREATE INDEX IF NOT EXISTS idx_pa_competitor_channel ON post_analysis(competitor_id, channel, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_tema ON post_analysis(tema_principal);
CREATE INDEX IF NOT EXISTS idx_pa_specialist ON post_analysis(specialist_used);
CREATE INDEX IF NOT EXISTS idx_pa_eng_rate ON post_analysis(competitor_id, channel, eng_rate DESC);
