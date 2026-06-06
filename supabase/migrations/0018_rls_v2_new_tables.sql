-- 0018_rls_v2_new_tables.sql
-- RLS das 4 tabelas novas: leitura pública (anon/auth) + service_role ALL.
-- Idempotente (DROP POLICY IF EXISTS antes de CREATE).

-- post_analysis
ALTER TABLE post_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read"    ON post_analysis;
DROP POLICY IF EXISTS "auth read"    ON post_analysis;
DROP POLICY IF EXISTS "service all"  ON post_analysis;
CREATE POLICY "anon read"   ON post_analysis FOR SELECT TO anon          USING (true);
CREATE POLICY "auth read"   ON post_analysis FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all" ON post_analysis FOR ALL    TO service_role  USING (true) WITH CHECK (true);

-- channel_synthesis
ALTER TABLE channel_synthesis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read"    ON channel_synthesis;
DROP POLICY IF EXISTS "auth read"    ON channel_synthesis;
DROP POLICY IF EXISTS "service all"  ON channel_synthesis;
CREATE POLICY "anon read"   ON channel_synthesis FOR SELECT TO anon          USING (true);
CREATE POLICY "auth read"   ON channel_synthesis FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all" ON channel_synthesis FOR ALL    TO service_role  USING (true) WITH CHECK (true);

-- competitor_threat_brief
ALTER TABLE competitor_threat_brief ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read"    ON competitor_threat_brief;
DROP POLICY IF EXISTS "auth read"    ON competitor_threat_brief;
DROP POLICY IF EXISTS "service all"  ON competitor_threat_brief;
CREATE POLICY "anon read"   ON competitor_threat_brief FOR SELECT TO anon          USING (true);
CREATE POLICY "auth read"   ON competitor_threat_brief FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all" ON competitor_threat_brief FOR ALL    TO service_role  USING (true) WITH CHECK (true);

-- linkedin_posts
ALTER TABLE linkedin_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read"    ON linkedin_posts;
DROP POLICY IF EXISTS "auth read"    ON linkedin_posts;
DROP POLICY IF EXISTS "service all"  ON linkedin_posts;
CREATE POLICY "anon read"   ON linkedin_posts FOR SELECT TO anon          USING (true);
CREATE POLICY "auth read"   ON linkedin_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all" ON linkedin_posts FOR ALL    TO service_role  USING (true) WITH CHECK (true);
