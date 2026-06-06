/** Smoke ponta-a-ponta: roda o workflow `analysis` sobre 3 itens reais da Silver.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-pipeline.ts  */
import { mastra } from '../src/mastra/index';
import { fetchWorkItems } from '../src/mastra/lib/silver';
import { supabase } from '../src/mastra/lib/supabase';

const { data: comps } = await supabase().from('competitors').select('id,name').limit(1);
const c = (comps ?? [])[0] as { id: string; name: string } | undefined;
if (!c) {
  console.log('Sem concorrentes.');
} else {
  const items = (await fetchWorkItems(c.id, 1)).slice(0, 3);
  console.log(`Rodando analysis · ${c.name} · ${items.length} itens`);
  const wf = mastra.getWorkflowById('analysis');
  const run = await wf.createRun();
  const res: any = await run.start({ inputData: { competitor_id: c.id, items } });
  console.log('STATUS:', res?.status, '| RESULT:', JSON.stringify(res?.result ?? res?.output ?? res));
  const { count } = await supabase()
    .from('post_analysis')
    .select('*', { count: 'exact', head: true })
    .eq('competitor_id', c.id);
  console.log('post_analysis rows (competitor):', count);
}
