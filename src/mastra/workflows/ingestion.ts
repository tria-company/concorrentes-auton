/**
 * Workflow `ingestion` (Camada 0): grava o payload Apify em `apify_raw` (Bronze) e roda o
 * parser Bronze→Silver (registry por `source`; ver lib/parser.ts). Marca `processed` na Bronze.
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { parsePayload } from '../lib/parser';
import { archiveUrl, extOf, minioEnabled } from '../lib/minio';

// Tabelas Silver com mídia arquivável → (canal MinIO, campos com URL, chave natural).
// Se MINIO_* env não estiver setado, archive é skipado e o pipeline usa URLs CDN externos.
const ARCHIVE_MAP: Record<string, { channel: string; fields: string[]; key: string }> = {
  ig_posts: { channel: 'ig', fields: ['media_url', 'video_url'], key: 'post_short_code' },
  tiktok_videos: { channel: 'tt', fields: ['video_url', 'cover_url'], key: 'video_id' },
  fb_posts: { channel: 'fb', fields: ['media_url', 'video_url'], key: 'post_id' },
  meta_ads: { channel: 'meta_ads', fields: ['creative_url', 'video_url'], key: 'ad_archive_id' },
};

/** Lê handle do concorrente (cached) e normaliza pra slug do bucket (ex.: '@voa.health' → 'voa.health'). */
async function competitorSlug(sb: ReturnType<typeof supabase>, id: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(id)) return cache.get(id)!;
  const { data } = await sb.from('competitors').select('handle').eq('id', id).maybeSingle();
  const slug = String(data?.handle ?? id).replace(/^@/, '').toLowerCase();
  cache.set(id, slug);
  return slug;
}

/** Arquiva URLs de mídia da row no MinIO e substitui in-place pelo URL público do MinIO. Best-effort. */
async function archiveRowMedia(
  sb: ReturnType<typeof supabase>,
  table: string,
  row: Record<string, any>,
  slugCache: Map<string, string>,
): Promise<void> {
  const spec = ARCHIVE_MAP[table];
  if (!spec) return;
  const cid = row.competitor_id;
  const nk = row[spec.key];
  if (!cid || !nk) return;
  const slug = await competitorSlug(sb, cid, slugCache);
  for (const field of spec.fields) {
    const url = row[field];
    if (!url || typeof url !== 'string' || url.startsWith(process.env.MINIO_ENDPOINT ?? '__NOPE__')) continue;
    const ext = extOf(url, field.includes('video') ? '.mp4' : '.jpg');
    const key = `${slug}/${spec.channel}/${nk}${ext}`;
    try {
      row[field] = await archiveUrl(url, key);
    } catch (e) {
      // Falha de 1 mídia não derruba a row — só loga e segue com URL CDN original.
      console.warn(`[minio] archive ${table}/${field}/${nk}: ${(e as Error).message}`);
    }
  }
}

const input = z.object({
  source: z.string(),
  apify_actor: z.string().nullable().optional(),
  apify_run_id: z.string().nullable().optional(),
  competitor_id: z.string().uuid().nullable().optional(),
  payload: z.any(),
});

const afterStore = input.extend({ raw_id: z.number().nullable() });
const output = z.object({
  raw_id: z.number().nullable(),
  source: z.string(),
  parsed: z.number(),
  table: z.string().nullable(),
});

const storeRaw = createStep({
  id: 'store-raw',
  inputSchema: input,
  outputSchema: afterStore,
  execute: async ({ inputData }) => {
    const sb = supabase();
    // Idempotência: re-entrega do mesmo apify_run_id reusa a linha Bronze existente.
    if (inputData.apify_run_id) {
      const { data: ex } = await sb
        .from('apify_raw')
        .select('id')
        .eq('apify_run_id', inputData.apify_run_id)
        .limit(1);
      if (ex && ex.length > 0) return { ...inputData, raw_id: (ex[0].id as number) ?? null };
    }
    const { data, error } = await sb
      .from('apify_raw')
      .insert({
        source: inputData.source,
        apify_actor: inputData.apify_actor ?? null,
        apify_run_id: inputData.apify_run_id ?? null,
        competitor_id: inputData.competitor_id ?? null,
        payload: inputData.payload,
        status: 'received',
        processed: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`apify_raw insert: ${error.message}`);
    return { ...inputData, raw_id: (data?.id as number) ?? null };
  },
});

const parseToSilver = createStep({
  id: 'parse-to-silver',
  inputSchema: afterStore,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const silver = parsePayload(inputData.source, inputData.payload, inputData.competitor_id ?? null);
    if (!silver || silver.rows.length === 0) {
      return { raw_id: inputData.raw_id, source: inputData.source, parsed: 0, table: null };
    }
    const sb = supabase();

    // Idempotência: filtra linhas já existentes pela chave natural da tabela.
    const keyVals = silver.rows.map((r) => r[silver.key]).filter((v) => v != null);
    let fresh = silver.rows;
    if (keyVals.length > 0) {
      const { data: existing } = await sb.from(silver.table).select(silver.key).in(silver.key, keyVals as any[]);
      const seen = new Set((existing ?? []).map((e: any) => String(e[silver.key])));
      fresh = silver.rows.filter((r) => !seen.has(String(r[silver.key])));
    }

    // (a) Arquiva mídia das rows novas no MinIO ANTES do insert, trocando URLs CDN externos pelo
    // URL público do MinIO. Idempotente (HEAD antes do PUT). Se MinIO não estiver configurado, no-op.
    if (fresh.length > 0 && minioEnabled() && ARCHIVE_MAP[silver.table]) {
      const slugCache = new Map<string, string>();
      const CONC = Number(process.env.MINIO_CONCURRENCY ?? 4);
      for (let i = 0; i < fresh.length; i += CONC) {
        await Promise.all(fresh.slice(i, i + CONC).map((r) => archiveRowMedia(sb, silver.table, r, slugCache)));
      }
    }

    if (fresh.length > 0) {
      const { error } = await sb.from(silver.table).insert(fresh);
      if (error) throw new Error(`${silver.table} insert: ${error.message}`);
    }
    if (inputData.raw_id != null) {
      await sb.from('apify_raw').update({ processed: true, status: 'parsed' }).eq('id', inputData.raw_id);
    }
    return { raw_id: inputData.raw_id, source: inputData.source, parsed: fresh.length, table: silver.table };
  },
});

export const ingestionWorkflow = createWorkflow({
  id: 'ingestion',
  inputSchema: input,
  outputSchema: output,
})
  .then(storeRaw)
  .then(parseToSilver)
  .commit();
