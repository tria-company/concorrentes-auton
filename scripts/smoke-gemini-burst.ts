/**
 * Teste de capacidade do Gemini: dispara N análises de vídeo concorrentes e reporta
 * quantas passam (OK) vs falham (NULL = cota/erro). Use p/ aferir se o tier/cota aguenta.
 * Uso: GEMINI_MAX_CONCURRENCY=6 N=6 tsx scripts/smoke-gemini-burst.ts
 */
import 'dotenv/config';
import { runVideoAgent } from '../src/mastra/lib/gemini';
import { specialistOutputSchema } from '../src/mastra/schemas/specialist-payloads';

const N = Number(process.env.N ?? 6);
const VID = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

(async () => {
  console.log(`burst: ${N} análises de vídeo | conc=${process.env.GEMINI_MAX_CONCURRENCY ?? 2} interval=${process.env.GEMINI_MIN_INTERVAL_MS ?? 4000}`);
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      runVideoAgent({
        agentName: 'burst-test',
        videoUrl: VID,
        prompt: 'Analise este vídeo e preencha o schema.',
        schema: specialistOutputSchema('short_video'),
        temperature: 0.2,
        triggerType: 'manual',
      })
        .then((r) => (r ? 'OK' : 'NULL(cota/erro)'))
        .catch((e) => 'ERR:' + (e as Error).message.slice(0, 60)),
    ),
  );
  const ok = results.filter((r) => r === 'OK').length;
  console.log(`tempo ${((Date.now() - t0) / 1000).toFixed(0)}s | OK=${ok}/${N}`);
  results.forEach((r, i) => console.log(`  ${i}: ${r}`));
  process.exit(0);
})();
