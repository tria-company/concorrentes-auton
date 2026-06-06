/**
 * Cadeia COMPLETA com mídia VIVA (scrape fresco): parser → análise de imagem (Azure)
 * + análise de vídeo (Gemini). Prova que, com URL fresca, tudo funciona ponta a ponta.
 * Lê fresh-reels.json (saída do instagram-reel-scraper rodado agora).
 * Uso: tsx scripts/smoke-live-chain.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parsePayload } from '../src/mastra/lib/parser';
import { toImagePart } from '../src/mastra/lib/media';
import { runAgent } from '../src/mastra/lib/run-agent';
import { runVideoAgent } from '../src/mastra/lib/gemini';
import { specialists } from '../src/mastra/agents/specialists';
import { specialistOutputSchema } from '../src/mastra/schemas/specialist-payloads';

const CID = '00000000-0000-0000-0000-000000000000';

async function head(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { range: 'bytes=0-0' } });
    return `HTTP ${r.status} ${r.headers.get('content-type') ?? ''}`.trim();
  } catch (e) { return `ERRO ${(e as Error).message}`; }
}

(async () => {
  const items = JSON.parse(readFileSync('fresh-reels.json', 'utf8'));
  const ins = parsePayload('instagram', items, CID);
  const row = ins?.rows.find((r) => r.media_url && r.video_url);
  if (!row) { console.log('Nenhuma linha com media_url + video_url.'); process.exit(1); }

  const img = row.media_url as string;
  const vid = row.video_url as string;
  console.log('post:', row.post_short_code);
  console.log('imagem:', img.slice(0, 80), '→', await head(img));
  console.log('vídeo :', vid.slice(0, 80), '→', await head(vid));

  // 1) IMAGEM via Azure (especialista vê a thumbnail/capa)
  console.log('\n=== [1] ANÁLISE DE IMAGEM (Azure gpt-4.1-mini) ===');
  const part = await toImagePart(img);
  if (!part) {
    console.log('  toImagePart=null (URL não é imagem viva?).');
  } else {
    const r = await runAgent({
      agent: specialists.image, agentName: 'spec-image',
      prompt: `Analise VISUALMENTE a capa deste reel do concorrente. Legenda: ${row.caption ?? ''}`,
      imageParts: [part], schema: specialistOutputSchema('image'), temperature: 0.2, triggerType: 'manual',
    });
    console.log(`  tokens=${r.tokens_in}/${r.tokens_out} custo=$${r.cost_usd}`);
    console.log(JSON.stringify(r.object, null, 2));
  }

  // 2) VÍDEO via Gemini (vê frames + ouve áudio)
  console.log('\n=== [2] ANÁLISE DE VÍDEO (Gemini 2.5 Flash) ===');
  const g = await runVideoAgent({
    agentName: 'spec-short_video-gemini', videoUrl: vid, triggerType: 'manual',
    prompt: `Analise este VÍDEO (reel) do concorrente — o que aparece, o que é falado, e o gancho.`,
    schema: specialistOutputSchema('short_video'), temperature: 0.2,
  });
  if (!g) { console.log('  runVideoAgent=null (download/guard/chave).'); }
  else {
    console.log(`  tokens=${g.tokens_in}/${g.tokens_out} custo=$${g.cost_usd}`);
    console.log(JSON.stringify(g.object, null, 2));
  }
})();
