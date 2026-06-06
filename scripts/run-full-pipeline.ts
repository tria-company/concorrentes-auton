/**
 * RUN COMPLETO sobre o que já está no banco: para cada concorrente ATIVO roda
 * análise (multimodal) → síntese+consolidação → jornadas; e o RADAR global no fim.
 * Pesado/demorado (~30-60min) — rodar em background. Resiliente: 1 concorrente que
 * falhe não aborta os demais.
 * Uso: tsx scripts/run-full-pipeline.ts
 */
import 'dotenv/config';
import { mastra } from '../src/mastra';
import { supabase } from '../src/mastra/lib/supabase';

const ts = () => new Date().toISOString().slice(11, 19);

async function runWf(id: string, inputData: any): Promise<any> {
  const wf = mastra.getWorkflowById(id);
  const run = await wf.createRun({ runId: `full-${id}-${Date.now()}` });
  const t0 = Date.now();
  try {
    const res: any = await run.start({ inputData });
    const dt = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`    [${ts()}] ${id} → ${res?.status} (${dt}s) | ${JSON.stringify(res?.result ?? null)?.slice(0, 200)}`);
    return res;
  } catch (e) {
    console.log(`    [${ts()}] ${id} → ERRO: ${(e as Error).message}`);
    return null;
  }
}

(async () => {
  const { data: comps } = await supabase()
    .from('competitors').select('id,name').eq('active', true).order('name');
  const list = comps ?? [];
  console.log(`[${ts()}] INÍCIO — ${list.length} concorrentes ativos\n`);

  for (const c of list as { id: string; name: string }[]) {
    console.log(`\n===== ${c.name} (${c.id}) =====`);
    await runWf('analysis', { competitor_id: c.id }); // fetchWorkItems da Silver (cap 50/tabela)
    await runWf('synthesis-consolidation', { competitor_id: c.id });
    await runWf('journey-referencias', { competitor_id: c.id });
    await runWf('journey-insights', { competitor_id: c.id });
    await runWf('journey-captacao', { competitor_id: c.id });
  }

  console.log(`\n===== RADAR (global) =====`);
  await runWf('journey-radar', {});

  console.log(`\n[${ts()}] === PIPELINE COMPLETO FINALIZADO ===`);
  process.exit(0);
})();
