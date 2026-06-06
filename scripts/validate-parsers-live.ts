/**
 * Validação #7 — roda os parsers Bronze→Silver contra PAYLOADS REAIS do Apify.
 * Busca datasets reais da conta (via APIFY_TOKEN) e passa pelos `parsePayload`,
 * reportando: nº de linhas geradas + cobertura de colunas (não-nulas vs nulas) da 1ª linha.
 *
 * Uso: tsx scripts/validate-parsers-live.ts
 */
import 'dotenv/config';
import { parsePayload, type SilverInsert } from '../src/mastra/lib/parser';

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) throw new Error('APIFY_TOKEN ausente no .env');

/** source canônico → datasetId real descoberto na conta (2026-05-27). */
const CASES: { source: string; dataset: string; actor: string }[] = [
  { source: 'instagram', dataset: 'EgCY0d33Nls7FnsJh', actor: 'apify/instagram-scraper' },
  { source: 'instagram', dataset: '1lX6VK2geQSPxwY31', actor: 'apify/instagram-reel-scraper' },
  { source: 'facebook', dataset: 'BzaOQEy9NmVhCic6I', actor: 'apify/facebook-posts-scraper' },
  { source: 'google_ads', dataset: 'vnp75HE9eiJWe0pby', actor: 'solidcode/ads-transparency-scraper' },
  { source: 'meta_ads', dataset: '7svKHhG9ca2L58ZPV', actor: 'apify/facebook-ads-scraper' },
  { source: 'youtube', dataset: 'gEQ529ab3kuDGtmrt', actor: 'streamers/youtube-channel-scraper' },
];

const CID = '00000000-0000-0000-0000-000000000000'; // dummy competitor_id

async function fetchItems(dataset: string, limit = 25): Promise<unknown[]> {
  const r = await fetch(`https://api.apify.com/v2/datasets/${dataset}/items?token=${TOKEN}&limit=${limit}`);
  if (!r.ok) throw new Error(`dataset ${dataset}: HTTP ${r.status}`);
  return (await r.json()) as unknown[];
}

function coverage(ins: SilverInsert | null): string {
  if (!ins) return 'parser retornou null (source não reconhecido)';
  if (ins.rows.length === 0) return `0 linhas geradas (table=${ins.table})`;
  const row = ins.rows[0];
  const cols = Object.keys(row).filter((k) => k !== 'competitor_id');
  const filled = cols.filter((k) => row[k] != null);
  const empty = cols.filter((k) => row[k] == null);
  return [
    `table=${ins.table} key=${ins.key} rows=${ins.rows.length}`,
    `  PREENCHIDAS (${filled.length}/${cols.length}): ${filled.join(', ')}`,
    empty.length ? `  NULAS: ${empty.join(', ')}` : '  NULAS: (nenhuma)',
  ].join('\n');
}

(async () => {
  for (const { source, dataset, actor } of CASES) {
    console.log(`\n=== ${source}  ←  ${actor}  (dataset ${dataset}) ===`);
    try {
      const items = await fetchItems(dataset);
      console.log(`  itens no dataset (página): ${items.length}`);
      const ins = parsePayload(source, items, CID);
      console.log(coverage(ins));
    } catch (e) {
      console.log('  ERRO:', (e as Error).message);
    }
  }
})();
