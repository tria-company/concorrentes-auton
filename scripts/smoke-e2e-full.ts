/**
 * Teste E2E do funcionamento COMPLETO da aplicação, num concorrente real (HiDoctor),
 * passando por todas as camadas: análise (multimodal: imagem Azure + vídeo Gemini) →
 * síntese → consolidação → 4 jornadas. Bounded (poucos itens) p/ custo/tempo controlados.
 * Uso: tsx scripts/smoke-e2e-full.ts
 */
import 'dotenv/config';
import { mastra } from '../src/mastra';
import { fetchWorkItems } from '../src/mastra/lib/silver';

const CID = '1368889f-6cce-45b6-8126-b5304f379f99'; // HiDoctor

async function runWf(id: string, inputData: any): Promise<any> {
  const wf = mastra.getWorkflowById(id);
  const run = await wf.createRun({ runId: `e2e-${id}-${Date.now()}` });
  const t0 = Date.now();
  const res: any = await run.start({ inputData }); // start() BLOQUEIA até concluir (≠ startAsync)
  const tag = res?.status ?? '?';
  const payload = res?.result ?? res?.error ?? null;
  console.log(`    → status=${tag} (${((Date.now() - t0) / 1000).toFixed(1)}s) | ${JSON.stringify(payload)?.slice(0, 260)}`);
  return res;
}

(async () => {
  console.log('=== E2E · HiDoctor (' + CID + ') ===\n');

  // 1) ANÁLISE — bounded, garantindo 1 vídeo TikTok (Gemini) + variedade de canais
  const all = await fetchWorkItems(CID, 2);
  const tt = all.filter((i) => i.channel === 'tiktok').slice(0, 1);
  const rest = all.filter((i) => i.channel !== 'tiktok').slice(0, 5);
  const items = [...tt, ...rest];
  console.log('[1] ANÁLISE (Camadas 1+2, multimodal)');
  console.log('    itens:', items.map((i) => `${i.channel}/${i.source_id}`).join(', ') || '(nenhum novo — já analisados?)');
  if (items.length) await runWf('analysis', { competitor_id: CID, items });
  else console.log('    (pulando — sem itens novos da Silver)');

  // 2) SÍNTESE + CONSOLIDAÇÃO (Camadas 3+4)
  console.log('\n[2] SÍNTESE + CONSOLIDAÇÃO (channel_synthesis + threat_brief)');
  await runWf('synthesis-consolidation', { competitor_id: CID });

  // 3) JORNADAS (Camada 5)
  console.log('\n[3] JORNADAS');
  for (const id of ['journey-referencias', 'journey-insights', 'journey-captacao']) {
    console.log(`  ${id}:`);
    await runWf(id, { competitor_id: CID });
  }
  console.log('  journey-radar (global):');
  await runWf('journey-radar', {});

  console.log('\n=== fim — verifique as contagens nas tabelas Gold ===');
  process.exit(0);
})();
