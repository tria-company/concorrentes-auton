/**
 * Smoke da análise VISUAL: baixa uma imagem real e roda o especialista de imagem
 * com ela anexada, provando que o multimodal funciona no gpt-4.1-mini (Azure).
 * Uso: tsx scripts/smoke-vision.ts
 */
import 'dotenv/config';
import { specialists } from '../src/mastra/agents/specialists';
import { specialistOutputSchema } from '../src/mastra/schemas/specialist-payloads';
import { toImagePart } from '../src/mastra/lib/media';
import { runAgent } from '../src/mastra/lib/run-agent';

const TOKEN = process.env.APIFY_TOKEN;

// Imagem pública estável (fallback caso a URL de CDN do Apify tenha expirado).
const FALLBACK_IMG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/640px-Camponotus_flavomarginatus_ant.jpg';

async function realApifyImage(): Promise<string | null> {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.apify.com/v2/datasets/vnp75HE9eiJWe0pby/items?token=${TOKEN}&limit=5`);
    const items = (await r.json()) as any[];
    return items.map((i) => i.imageUrl).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

(async () => {
  const realUrl = await realApifyImage();
  let part = await toImagePart(realUrl);
  let used = realUrl;
  if (!part) {
    console.log('  (URL real indisponível/expirada — usando imagem pública de fallback)');
    part = await toImagePart(FALLBACK_IMG);
    used = FALLBACK_IMG;
  }
  if (!part) {
    console.log('FALHA: não consegui baixar nenhuma imagem.');
    process.exit(1);
  }
  console.log(`Imagem: ${used}\n  bytes=${part.image.byteLength} mediaType=${part.mediaType}`);

  const res = await runAgent({
    agent: specialists.image,
    agentName: 'spec-image',
    prompt:
      'Analise VISUALMENTE a imagem anexada (criativo de concorrente). Descreva o que aparece, ' +
      'cores, elementos de prova, e o gancho visual. Preencha o schema.',
    imageParts: [part],
    schema: specialistOutputSchema('image'),
    temperature: 0.2,
    triggerType: 'manual',
  });

  console.log('\n=== RESPOSTA DO ESPECIALISTA (visual) ===');
  console.log('tokens_in:', res.tokens_in, '| tokens_out:', res.tokens_out, '| custo USD:', res.cost_usd);
  console.log(JSON.stringify(res.object, null, 2));
})();
