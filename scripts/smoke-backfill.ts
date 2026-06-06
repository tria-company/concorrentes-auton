/** Backfill e2e: synthesis-consolidation + 4 jornadas para o 1º concorrente.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-backfill.ts  */
import { mastra } from '../src/mastra/index';
import { supabase } from '../src/mastra/lib/supabase';

const sb = supabase();
const { data: comps } = await sb.from('competitors').select('id,name').ilike('name', '%Amigo%').limit(1);
const c = (comps ?? [])[0] as { id: string; name: string };
console.log('BACKFILL:', c.name, c.id);

async function run(wfId: string, inputData: Record<string, unknown>) {
  const wf = mastra.getWorkflowById(wfId);
  const r: any = await (await wf.createRun()).start({ inputData: inputData as any });
  console.log(`${wfId}: ${r?.status} ${JSON.stringify(r?.result ?? r?.output ?? {})}`);
}

await run('synthesis-consolidation', { competitor_id: c.id });
await run('journey-referencias', { competitor_id: c.id });
await run('journey-insights', { competitor_id: c.id });
await run('journey-captacao', { competitor_id: c.id });
await run('journey-radar', {});

const { data: tb } = await sb
  .from('competitor_threat_brief')
  .select('threat_score,threat_letter,categoria_ameaca,justificativa')
  .eq('competitor_id', c.id)
  .limit(1);
console.log('THREAT_BRIEF:', JSON.stringify(tb?.[0]));
const { count: cs } = await sb.from('channel_synthesis').select('*', { count: 'exact', head: true }).eq('competitor_id', c.id);
const { count: hp } = await sb.from('hook_patterns').select('*', { count: 'exact', head: true }).eq('competitor_id', c.id);
const { count: ci } = await sb.from('competitor_insights').select('*', { count: 'exact', head: true }).eq('competitor_id', c.id);
const { count: lq } = await sb.from('leads_quentes').select('*', { count: 'exact', head: true }).eq('competitor_id', c.id);
const { data: db } = await sb.from('daily_briefings').select('briefing_date,headline').order('briefing_date', { ascending: false }).limit(1);
console.log(`COUNTS: channel_synthesis=${cs} hook_patterns=${hp} insights=${ci} leads=${lq}`);
console.log('RADAR:', JSON.stringify(db?.[0]));
