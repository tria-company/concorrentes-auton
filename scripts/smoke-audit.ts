/** Smoke: valida auditoria (agent_runs) + custo/tokens (post_analysis) após o analysis.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-audit.ts  */
import { mastra } from '../src/mastra/index';
import { fetchWorkItems } from '../src/mastra/lib/silver';
import { supabase } from '../src/mastra/lib/supabase';

const sb = supabase();
const { data: comps } = await sb.from('competitors').select('id,name').limit(1);
const c = (comps ?? [])[0] as { id: string; name: string };
// Item sintético (burla o dedup) — força os agentes a rodarem p/ validar a auditoria.
const items = [
  {
    competitor_id: c.id,
    channel: 'meta_ads' as const,
    source_table: 'manual',
    source_id: `audit-test-${Date.now()}`,
    posted_at: null,
    text: 'Anúncio: software de gestão clínica nº 1, agenda online e teleconsulta. Teste grátis 7 dias.',
    media_url: null,
    metrics: {},
  },
];
const before = (await supabase().from('agent_runs').select('*', { count: 'exact', head: true })).count ?? 0;

const wf = mastra.getWorkflowById('analysis');
const run = await wf.createRun();
const res: any = await run.start({ inputData: { competitor_id: c.id, items } });
console.log('ANALYSIS:', JSON.stringify(res?.result ?? res?.output ?? res));

const { count: after } = await sb.from('agent_runs').select('*', { count: 'exact', head: true });
const { data: pa } = await sb
  .from('post_analysis')
  .select('specialist_used,cost_usd,tokens_in,tokens_out')
  .eq('competitor_id', c.id)
  .order('analyzed_at', { ascending: false })
  .limit(1);
console.log(`AGENT_RUNS total: antes=${before} depois=${after}`);
console.log('POST_ANALYSIS sample:', JSON.stringify(pa?.[0]));
