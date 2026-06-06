/**
 * Re-scrape do Instagram (URLs de reel frescas) + análise de vídeo via Gemini, SEM tocar na
 * Silver. As URLs de CDN do IG expiram em dias, então: scrapeia agora → parseia → monta
 * WorkItems com a video_url FRESCA em memória → roda o workflow `analysis` (que roteia
 * video_url p/ o Gemini) → upsert em post_analysis (sobrescreve a classificação antiga).
 *
 * Uso: tsx scripts/rescrape-and-analyze-reels.ts   (env REEL_LIMIT=100, GEMINI_* p/ taxa)
 */
import 'dotenv/config';
import { mastra } from '../src/mastra';
import { supabase } from '../src/mastra/lib/supabase';
import { parsePayload } from '../src/mastra/lib/parser';
import type { WorkItem } from '../src/mastra/schemas/common';

const TOKEN = process.env.APIFY_TOKEN;
const REEL_ACTOR = 'xMc5Ga1oCONPmWJIa'; // apify/instagram-reel-scraper
const LIMIT = Number(process.env.REEL_LIMIT ?? 100);
const ts = () => new Date().toISOString().slice(11, 19);

async function scrapeReels(handle: string): Promise<unknown[]> {
  const u = `https://api.apify.com/v2/acts/${REEL_ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: [handle], resultsLimit: LIMIT }),
  });
  if (!r.ok) throw new Error(`scrape HTTP ${r.status}`);
  return (await r.json()) as unknown[];
}

/** Parseia o payload e monta WorkItems só dos reels (com video_url fresca). */
function toReelWorkItems(cid: string, items: unknown[]): WorkItem[] {
  const silver = parsePayload('instagram', items, cid);
  if (!silver) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return silver.rows
    .filter((r: any) => r.video_url)
    .map((r: any) => {
      const metrics: Record<string, number> = {};
      for (const [k, v] of Object.entries({ likes: r.likes, comments: r.comments_count, views: r.video_views })) {
        const n = num(v);
        if (n != null) metrics[k] = n;
      }
      return {
        competitor_id: cid,
        channel: 'instagram' as const,
        source_table: 'ig_posts',
        source_id: String(r.post_short_code),
        posted_at: (r.posted_at as string) ?? null,
        text: (r.caption as string) ?? null,
        media_url: (r.media_url as string) ?? null,
        video_url: (r.video_url as string) ?? null,
        metrics,
      };
    });
}

(async () => {
  if (!TOKEN) throw new Error('APIFY_TOKEN ausente');
  const { data } = await supabase().from('competitors').select('id,name,ig_handle').eq('active', true).order('name');
  const comps = (data ?? []) as { id: string; name: string; ig_handle: string | null }[];
  console.log(`[${ts()}] re-scrape IG + análise de reels — ${comps.length} concorrentes (limit ${LIMIT}/perfil)\n`);
  const wf = mastra.getWorkflowById('analysis');

  for (const c of comps) {
    const handle = (c.ig_handle ?? '').replace(/^@/, '').trim();
    if (!handle) { console.log(`  ${c.name}: sem ig_handle — pulado`); continue; }
    try {
      console.log(`  [${ts()}] ${c.name} (@${handle}): scraping...`);
      const items = await scrapeReels(handle);
      const reels = toReelWorkItems(c.id, items);
      // Pula reels já analisados pelo Gemini (evita re-gastar cota em re-runs com limite maior).
      const { data: done } = await supabase()
        .from('post_analysis').select('source_id')
        .eq('competitor_id', c.id).eq('channel', 'instagram').ilike('specialist_used', '%gemini%');
      const doneSet = new Set((done ?? []).map((d: any) => String(d.source_id)));
      const fresh = reels.filter((r) => !doneSet.has(r.source_id));
      console.log(`  ${c.name}: scraped ${items.length}, ${reels.length} reels, ${fresh.length} novos (não-gemini)`);
      if (!fresh.length) continue;
      const run = await wf.createRun({ runId: `reels-${c.id}-${Date.now()}` });
      const t0 = Date.now();
      const res: any = await run.start({ inputData: { competitor_id: c.id, items: fresh } });
      console.log(`  ${c.name}: análise ${res?.status} (${((Date.now() - t0) / 1000).toFixed(0)}s) | ${JSON.stringify(res?.result ?? null)}`);
    } catch (e) {
      console.log(`  ${c.name}: ERRO — ${(e as Error).message}`);
    }
  }
  console.log(`\n[${ts()}] FIM.`);
  process.exit(0);
})();
