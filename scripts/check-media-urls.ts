/**
 * Verifica se as URLs de IMAGEM (media_url) e VÍDEO (video_url) realmente vêm nos
 * payloads REAIS do Apify, após o parser — é o que alimenta a análise multimodal.
 * Uso: tsx scripts/check-media-urls.ts
 */
import 'dotenv/config';
import { parsePayload } from '../src/mastra/lib/parser';

const TOKEN = process.env.APIFY_TOKEN!;
const CID = '00000000-0000-0000-0000-000000000000';

// imgCol/vidCol = nome da coluna Silver que carrega a URL (varia por fonte, ver silver.ts).
const CASES: { source: string; dataset: string; actor: string; imgCol: string; vidCol?: string }[] = [
  { source: 'instagram', dataset: 'EgCY0d33Nls7FnsJh', actor: 'instagram-scraper', imgCol: 'media_url', vidCol: 'video_url' },
  { source: 'instagram', dataset: '1lX6VK2geQSPxwY31', actor: 'instagram-reel-scraper', imgCol: 'media_url', vidCol: 'video_url' },
  { source: 'facebook', dataset: 'BzaOQEy9NmVhCic6I', actor: 'facebook-posts-scraper', imgCol: 'media_url', vidCol: 'video_url' },
  { source: 'google_ads', dataset: 'vnp75HE9eiJWe0pby', actor: 'ads-transparency (solidcode)', imgCol: 'image_url' },
];

async function items(ds: string) {
  const r = await fetch(`https://api.apify.com/v2/datasets/${ds}/items?token=${TOKEN}&limit=30`);
  return (await r.json()) as unknown[];
}

/** HEAD numa URL p/ ver se ainda está viva (CDN expira). */
async function alive(url: string): Promise<string> {
  try {
    const r = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-0' } });
    return `HTTP ${r.status} ${r.headers.get('content-type') ?? ''}`.trim();
  } catch (e) {
    return `ERRO ${(e as Error).message}`;
  }
}

(async () => {
  for (const { source, dataset, actor, imgCol, vidCol } of CASES) {
    const ins = parsePayload(source, await items(dataset), CID);
    console.log(`\n=== ${source} (${actor}) ===`);
    if (!ins || !ins.rows.length) { console.log('  0 linhas'); continue; }
    const n = ins.rows.length;
    const withImg = ins.rows.filter((r) => r[imgCol]).length;
    const withVid = vidCol ? ins.rows.filter((r) => r[vidCol]).length : 0;
    console.log(`  linhas=${n} | com imagem(${imgCol})=${withImg} | com vídeo(${vidCol ?? '—'})=${withVid}`);
    const img = ins.rows.find((r) => r[imgCol])?.[imgCol] as string | undefined;
    const vid = vidCol ? (ins.rows.find((r) => r[vidCol])?.[vidCol] as string | undefined) : undefined;
    if (img) console.log(`  imagem ex.: ${img.slice(0, 90)}\n           → ${await alive(img)}`);
    if (vid) console.log(`  vídeo  ex.: ${vid.slice(0, 90)}\n           → ${await alive(vid)}`);
  }
})();
