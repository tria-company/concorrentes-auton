-- 0010_create_linkedin_posts.sql
-- Silver · canal LinkedIn (novo)
-- Fonte: Miro "PRD · Schema Completo · Painel de Concorrentes" §2.13

CREATE TABLE IF NOT EXISTS linkedin_posts (
  post_id            TEXT PRIMARY KEY,
  competitor_id      UUID NOT NULL REFERENCES competitors(id),
  text               TEXT,
  post_type          TEXT,
  media_url          TEXT,
  video_url          TEXT,
  post_url           TEXT,
  author_name        TEXT,
  is_company_post    BOOLEAN DEFAULT true,
  likes              INTEGER,
  comments_count     INTEGER,
  shares             INTEGER,
  reactions          JSONB,
  hashtags           TEXT[],
  mentions_companies TEXT[],
  posted_at          TIMESTAMPTZ,
  scraped_at         TIMESTAMPTZ DEFAULT now(),
  raw_id             BIGINT REFERENCES apify_raw(id)   -- apify_raw.id é bigint (shape v1), não uuid
);

CREATE INDEX IF NOT EXISTS idx_li_competitor_posted ON linkedin_posts(competitor_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_hashtags ON linkedin_posts USING GIN(hashtags);
