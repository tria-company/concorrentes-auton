/** Jornada CAPTAÇÃO (Camada 5): scora leads de reviews/reclamações → leads_quentes. */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { captacaoScorer } from '../../agents/generators';
import { supabase } from '../../lib/supabase';
import { runAgent } from '../../lib/run-agent';

const input = z.object({ competitor_id: z.string().uuid() });
const output = z.object({ competitor_id: z.string().uuid(), leads: z.number() });

const scorerOut = z.object({
  leads: z
    .array(
      z.object({
        source_table: z.enum(['ra_complaints', 'google_reviews']),
        source_id: z.string(),
        lead_score: z.number().int().min(1).max(10),
        urgencia: z.string().nullable(),
        best_channel: z.string().nullable(),
        sdr_script: z.string(),
        source_url: z.string().nullable(),
      }),
    )
    .default([]),
});

const scoreLeads = createStep({
  id: 'score-leads',
  inputSchema: input,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const sb = supabase();
    // Fontes de leads: reclamações (RA) e avaliações negativas (Google). select('*') é seguro
    // mesmo sem conhecer o schema exato dessas tabelas legadas.
    const { data: complaints } = await sb
      .from('ra_complaints')
      .select('*')
      .eq('competitor_id', inputData.competitor_id)
      .limit(100);
    const { data: reviews } = await sb
      .from('google_reviews')
      .select('*')
      .eq('competitor_id', inputData.competitor_id)
      .limit(100);

    const r = await runAgent<z.infer<typeof scorerOut>>({
      agent: captacaoScorer,
      agentName: 'gen-captacao',
      triggerType: 'journey-captacao',
      competitorId: inputData.competitor_id,
      prompt:
        `Detecte e score leads quentes (clientes insatisfeitos do concorrente, prontos para migrar). ` +
        `Use o campo de id de cada registro como source_id. Não invente contatos. JSON:\n` +
        JSON.stringify({ complaints, reviews }).slice(0, 60000),
      schema: scorerOut,
      temperature: 0.4,
      auditInput: { competitor_id: inputData.competitor_id },
    });
    const out = r.object;
    if (!out || out.leads.length === 0) return { competitor_id: inputData.competitor_id, leads: 0 };

    // Idempotência: pula leads já existentes (não deleta — preserva status/progresso do SDR).
    const { data: existing } = await sb
      .from('leads_quentes')
      .select('source_table,source_id')
      .eq('competitor_id', inputData.competitor_id);
    const seen = new Set((existing ?? []).map((e: any) => `${e.source_table}::${e.source_id}`));
    const novos = out.leads.filter((l) => !seen.has(`${l.source_table}::${l.source_id}`));
    if (novos.length === 0) return { competitor_id: inputData.competitor_id, leads: 0 };

    const now = new Date().toISOString();
    const rows = novos.map((l) => ({
      competitor_id: inputData.competitor_id,
      target_competitor_id: inputData.competitor_id,
      source_table: l.source_table,
      source_id: l.source_id,
      lead_score: l.lead_score,
      urgencia: l.urgencia,
      best_channel: l.best_channel,
      sdr_script: l.sdr_script,
      source_url: l.source_url,
      status: 'new',
      llm_model: process.env.AZURE_OPENAI_DEPLOYMENT ?? null,
      llm_cost_usd: r.cost_usd,
      created_at: now,
      updated_at: now,
    }));
    const { error } = await sb.from('leads_quentes').insert(rows);
    if (error) throw new Error(`leads_quentes insert: ${error.message}`);
    return { competitor_id: inputData.competitor_id, leads: rows.length };
  },
});

export const captacaoWorkflow = createWorkflow({
  id: 'journey-captacao',
  inputSchema: input,
  outputSchema: output,
})
  .then(scoreLeads)
  .commit();
