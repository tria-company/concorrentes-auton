/** Smoke: ponte Silver→analysis. Pega um concorrente e monta WorkItems das tabelas Silver.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-silver.ts  */
import { supabase } from '../src/mastra/lib/supabase';
import { fetchWorkItems } from '../src/mastra/lib/silver';

const { data: comps } = await supabase().from('competitors').select('id,name').limit(1);
if (!comps || comps.length === 0) {
  console.log('Sem concorrentes cadastrados.');
} else {
  const c = comps[0] as { id: string; name: string };
  const items = await fetchWorkItems(c.id, 20);
  const byChannel: Record<string, number> = {};
  for (const it of items) byChannel[it.channel] = (byChannel[it.channel] ?? 0) + 1;
  console.log(`RESULT competitor=${c.name} total=${items.length} byChannel=${JSON.stringify(byChannel)}`);
  if (items[0]) console.log('SAMPLE=', JSON.stringify(items[0]).slice(0, 300));
}
