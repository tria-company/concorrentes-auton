/**
 * Workflow `ingestion` (Camada 0): grava o payload Apify em `apify_raw` (Bronze) e roda o
 * parser Bronze→Silver (registry por `source`; ver lib/parser.ts). Marca `processed` na Bronze.
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { parsePayload } from '../lib/parser';

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
