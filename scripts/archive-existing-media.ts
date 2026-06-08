/**
 * Backfill MinIO: para cada row em ig_posts/tiktok_videos/fb_posts/meta_ads cujo
 * media/video URL ainda NÃO aponta pro MinIO, baixa do CDN externo e sobe pro MinIO,
 * depois faz UPDATE da row trocando a URL.
 *
 * Idempotente (HEAD antes do PUT no MinIO + filtro `not.like.MinIO_URL%` na query).
 * URLs CDN expirados (404/expired-token) são logados e ignorados — não bloqueia o resto.
 *
 * Env (no .env local do dev):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET (default: concorrentes-auton)
 *   DRY_RUN=1 (opcional)
 *
 * Uso: tsx scripts/archive-existing-media.ts [tabela]   (sem arg = todas)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { archiveUrl, extOf, minioEnabled } from '../src/mastra/lib/minio';

const SUPABASE_URL = required('SUPABASE_URL');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const MINIO_ENDPOINT = required('MINIO_ENDPOINT');
const DRY = process.env.DRY_RUN === '1';
const PAGE_SIZE = 100;
const CONCURRENCY = Number(process.env.MINIO_CONCURRENCY ?? 4);

function required(k: string): string {
  const v = process.env[k];
  if (!v || !v.trim()) throw new Error(`env ausente: ${k}`);
  return v.trim();
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

interface TableSpec {
  table: string;
  channel: string;
  key: string;        // chave natural (PK candidata)
  fields: string[];   // colunas de URL pra arquivar
}

const TABLES: TableSpec[] = [
  { table: 'ig_posts',       channel: 'ig',       key: 'post_short_code', fields: ['media_url', 'video_url'] },
  { table: 'tiktok_videos',  channel: 'tt',       key: 'video_id',        fields: ['video_url', 'cover_url'] },
  { table: 'fb_posts',       channel: 'fb',       key: 'post_id',         fields: ['media_url', 'video_url'] },
  { table: 'meta_ads',       channel: 'meta_ads', key: 'ad_archive_id',   fields: ['creative_url', 'video_url'] },
];

const slugCache = new Map<string, string>();
async function competitorSlug(competitorId: string): Promise<string | null> {
  if (slugCache.has(competitorId)) return slugCache.get(competitorId)!;
  const { data } = await sb.from('competitors').select('handle').eq('id', competitorId).maybeSingle();
  if (!data?.handle) return null;
  const slug = String(data.handle).replace(/^@/, '').toLowerCase();
  slugCache.set(competitorId, slug);
  return slug;
}

async function processTable(spec: TableSpec): Promise<{ scanned: number; archived: number; skipped: number; failed: number }> {
  console.log(`\n== ${spec.table} ==`);
  let scanned = 0, archived = 0, skipped = 0, failed = 0;
  let offset = 0;

  for (;;) {
    // Pega só rows cujas URLs NÃO apontam pro MinIO ainda (em qualquer um dos campos)
    const cols = ['competitor_id', spec.key, ...spec.fields].join(',');
    const orFilter = spec.fields.map((f) => `${f}.not.like.${MINIO_ENDPOINT}%`).join(',');
    const { data: rows, error } = await sb
      .from(spec.table)
      .select(cols)
      .or(orFilter)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) { console.warn(`  ! query erro: ${error.message}`); break; }
    if (!rows || rows.length === 0) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (row: any) => {
        scanned++;
        const cid = row.competitor_id;
        const nk = row[spec.key];
        if (!cid || !nk) { skipped++; return; }
        const slug = await competitorSlug(cid);
        if (!slug) { skipped++; return; }

        const updates: Record<string, string> = {};
        for (const field of spec.fields) {
          const url = row[field];
          if (!url || typeof url !== 'string') continue;
          if (url.startsWith(MINIO_ENDPOINT)) continue;
          const ext = extOf(url, field.includes('video') ? '.mp4' : '.jpg');
          const key = `${slug}/${spec.channel}/${nk}${ext}`;
          if (DRY) { updates[field] = `[DRY ${key}]`; continue; }
          try {
            updates[field] = await archiveUrl(url, key);
          } catch (e) {
            // URL morta (404, expired token, etc.) — não trava o resto
            console.warn(`  ! ${spec.table}/${field}/${nk}: ${(e as Error).message.slice(0, 100)}`);
            failed++;
          }
        }

        if (Object.keys(updates).length === 0) { skipped++; return; }
        if (DRY) { archived++; return; }
        const { error: upErr } = await sb.from(spec.table).update(updates).eq(spec.key, nk);
        if (upErr) { console.warn(`  ! update ${spec.table}/${nk}: ${upErr.message}`); failed++; }
        else archived++;
      }));
    }

    process.stdout.write(`  page=${offset / PAGE_SIZE} scanned=${scanned} archived=${archived} skipped=${skipped} failed=${failed}\r`);
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  console.log(`\n  → final: scanned=${scanned} archived=${archived} skipped=${skipped} failed=${failed}`);
  return { scanned, archived, skipped, failed };
}

(async () => {
  if (!minioEnabled()) { console.error('FAIL: MINIO_* env não setado'); process.exit(1); }
  const onlyTable = process.argv[2];
  const targets = onlyTable ? TABLES.filter((t) => t.table === onlyTable) : TABLES;
  if (targets.length === 0) { console.error(`tabela "${onlyTable}" desconhecida. Opções: ${TABLES.map((t) => t.table).join(', ')}`); process.exit(1); }

  console.log(`Backfill MinIO ${DRY ? '[DRY-RUN]' : ''} — bucket ${process.env.MINIO_BUCKET ?? 'concorrentes-auton'}`);
  console.log(`Tabelas: ${targets.map((t) => t.table).join(', ')}\n`);

  const totals = { scanned: 0, archived: 0, skipped: 0, failed: 0 };
  for (const t of targets) {
    const r = await processTable(t);
    totals.scanned += r.scanned; totals.archived += r.archived; totals.skipped += r.skipped; totals.failed += r.failed;
  }

  console.log(`\n=== TOTAL === scanned=${totals.scanned} archived=${totals.archived} skipped=${totals.skipped} failed=${totals.failed}`);
  if (DRY) console.log('(DRY_RUN — nada foi gravado)');
})().catch((e) => { console.error('FALHA:', e); process.exit(1); });
