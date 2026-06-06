/**
 * Re-analisa SÓ os itens de vídeo que caíram no fallback de texto (Azure) por causa da cota
 * do Gemini — sem refazer texto/imagem. Rode DEPOIS de ativar o billing do Gemini.
 *
 * Acha em post_analysis os itens `tipo in (short_video,long_video)` com `specialist_used`
 * SEM `-gemini`, reconstrói os WorkItems (com video_url) e re-roda o workflow `analysis`
 * só sobre eles (upsert sobrescreve a linha de fallback pela análise de vídeo do Gemini).
 *
 * Uso: tsx scripts/reanalyze-videos.ts [competitor_id]   (sem arg = todos os ativos)
 */
import 'dotenv/config';
import { mastra } from '../src/mastra';
import { supabase } from '../src/mastra/lib/supabase';
import { fetchVideoWorkItems } from '../src/mastra/lib/silver';

const ts = () => new Date().toISOString().slice(11, 19);

// URL estável = YouTube (watch, nunca expira) ou Supabase Storage (TikTok baixado).
// CDN de IG/FB expira em dias → pular (precisa de re-scrape fresco). `ALL=1` força tudo.
const STABLE = /youtube\.com|supabase\.co\/storage/i;

async function reanalyze(cid: string, name: string) {
  const all = await fetchVideoWorkItems(cid); // TODO vídeo ainda sem Gemini (reels + excedente)
  const items = process.env.ALL === '1' ? all : all.filter((i) => STABLE.test(i.video_url ?? ''));
  const skipped = all.length - items.length;
  if (!items.length) {
    console.log(`  ${name}: 0 vídeos com URL estável (${skipped} reels IG/FB c/ CDN expirado — precisam de re-scrape).`);
    return;
  }
  console.log(`  ${name}: ${items.length} vídeos (URL estável) p/ Gemini${skipped ? ` | ${skipped} reels IG/FB pulados (CDN expirado)` : ''}`);
  const wf = mastra.getWorkflowById('analysis');
  const run = await wf.createRun({ runId: `reanalyze-${cid}-${Date.now()}` });
  const t0 = Date.now();
  const res: any = await run.start({ inputData: { competitor_id: cid, items } });
  console.log(`  ${name}: ${res?.status} (${((Date.now() - t0) / 1000).toFixed(0)}s) | ${JSON.stringify(res?.result ?? null)}`);
}

(async () => {
  const arg = process.argv[2];
  let targets: { id: string; name: string }[];
  if (arg) {
    targets = [{ id: arg, name: arg }];
  } else {
    const { data } = await supabase().from('competitors').select('id,name').eq('active', true).order('name');
    targets = (data ?? []) as { id: string; name: string }[];
  }
  console.log(`[${ts()}] re-análise de vídeos — ${targets.length} concorrente(s)\n`);
  for (const t of targets) await reanalyze(t.id, t.name);
  console.log(`\n[${ts()}] FIM. (Se quiser refletir nos briefs/jornadas, re-rode synthesis-consolidation + jornadas.)`);
  process.exit(0);
})();
