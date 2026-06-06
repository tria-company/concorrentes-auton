/**
 * Smoke da transcrição de áudio: roda a função real lib/transcribe.ts (download + guard +
 * POST ao Azure + parse) contra um áudio de fala público. Prova o caminho de "ler o áudio".
 * Uso: tsx scripts/smoke-transcribe.ts
 */
import 'dotenv/config';
import { transcribeAudio } from '../src/mastra/lib/transcribe';

// Áudio de fala público estável (Wikimedia). Em produção seria o video_url do Silver.
const SPEECH = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';
// URL "watch page" (HTML) — deve ser PULADA pelo guard (retorna null), como TikTok/YouTube.
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

(async () => {
  console.log('deployment:', process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT ?? '(não configurado)');

  console.log('\n[1] áudio de fala direto →');
  const t = await transcribeAudio(SPEECH);
  console.log('  transcript:', t ?? '(null)');

  console.log('\n[2] watch page (HTML) → deve ser null (guard) →');
  const w = await transcribeAudio(WATCH);
  console.log('  resultado:', w ?? '(null) ✓ pulado como esperado');
})();
