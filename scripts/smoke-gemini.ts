/**
 * Smoke da análise de VÍDEO via Gemini: roda o lib/gemini.ts real sobre um vídeo do
 * YouTube (suporte nativo por URL) com a saída estruturada do especialista de vídeo.
 * Prova que o Gemini "vê e ouve" o vídeo e devolve o schema.
 *
 * Uso: tsx scripts/smoke-gemini.ts [url-do-video]
 *   default = "Me at the zoo" (1º vídeo do YouTube, 19s, estável).
 */
import 'dotenv/config';
import { runVideoAgent } from '../src/mastra/lib/gemini';
import { specialistOutputSchema } from '../src/mastra/schemas/specialist-payloads';

const url = process.argv[2] ?? 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

(async () => {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.log('GEMINI_API_KEY ausente no .env — não dá pra validar o caminho feliz.');
    process.exit(1);
  }
  console.log('modelo:', process.env.GEMINI_MODEL ?? 'gemini-2.5-flash');
  console.log('vídeo :', url, '\n');

  const r = await runVideoAgent({
    agentName: 'spec-short_video-gemini',
    videoUrl: url,
    triggerType: 'manual',
    prompt:
      'Analise este VÍDEO de um concorrente. Descreva o que aparece na tela e o que é falado, ' +
      'identifique o gancho de abertura e preencha o schema.',
    schema: specialistOutputSchema('short_video'),
    temperature: 0.2,
  });

  if (!r) {
    console.log('runVideoAgent retornou null (ver guard/erro de download/chave).');
    process.exit(1);
  }
  console.log('tokens_in:', r.tokens_in, '| tokens_out:', r.tokens_out, '| custo USD:', r.cost_usd);
  console.log(JSON.stringify(r.object, null, 2));
})();
