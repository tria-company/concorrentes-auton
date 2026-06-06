/** Jornada INSIGHTS (Camada 5): clusteriza temas/lacunas da semana → competitor_insights. */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { insightsClusterer } from '../../agents/generators';
import { supabase } from '../../lib/supabase';
import { runAgent } from '../../lib/run-agent';

const input = z.object({ competitor_id: z.string().uuid() });
const output = z.object({ competitor_id: z.string().uuid(), themes: z.number() });

const clustererOut = z.object({
  themes: z
    .array(
      z.object({
        theme_id: z.string(),
        theme_name: z.string(),
        theme_label: z.string(),
        copy_variations: z.array(z.string()).default([]),
        severity_score: z.number().nullable(),
        rank_global: z.number().int(),
      }),
    )
    .default([]),
});

/** Segunda-feira (UTC) da semana corrente em YYYY-MM-DD. */
function weekOf(): string {
  const d = new Date();
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

const clusterInsights = createStep({
  id: 'cluster-insights',
  inputSchema: input,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const sb = supabase();
    const { data: analyses } = await sb
      .from('post_analysis')
      .select('channel,tema_principal,temas_secund,padrao:tipo_gancho,promessa_central')
      .eq('competitor_id', inputData.competitor_id)
      .limit(400);
    const { data: syntheses } = await sb
      .from('channel_synthesis')
      .select('channel,padroes_dor,assuntos_novos,padroes_comerciais')
      .eq('competitor_id', inputData.competitor_id);

    const r = await runAgent<z.infer<typeof clustererOut>>({
      agent: insightsClusterer,
      agentName: 'gen-insights',
      triggerType: 'journey-insights',
      competitorId: inputData.competitor_id,
      prompt:
        `Clusterize temas/lacunas da semana a partir das análises e sínteses (JSON):\n` +
        JSON.stringify({ analyses, syntheses }).slice(0, 60000),
      schema: clustererOut,
      temperature: 0.4,
      auditInput: { competitor_id: inputData.competitor_id, week: weekOf() },
    });
    const out = r.object;
    if (!out || out.themes.length === 0) return { competitor_id: inputData.competitor_id, themes: 0 };

    const now = new Date().toISOString();
    const week = weekOf();
    // Idempotência: substitui os temas da semana corrente deste concorrente.
    await sb.from('competitor_insights').delete().eq('competitor_id', inputData.competitor_id).eq('week_of', week);

    const rows = out.themes.map((t) => ({
      competitor_id: inputData.competitor_id,
      week_of: week,
      theme_id: t.theme_id,
      theme_name: t.theme_name,
      theme_label: t.theme_label,
      copy_variations: t.copy_variations,
      severity_score: t.severity_score,
      rank_global: t.rank_global,
      llm_model: process.env.AZURE_OPENAI_DEPLOYMENT ?? null,
      llm_cost_usd: r.cost_usd,
      computed_at: now,
    }));
    const { error } = await sb.from('competitor_insights').insert(rows);
    if (error) throw new Error(`competitor_insights insert: ${error.message}`);
    return { competitor_id: inputData.competitor_id, themes: rows.length };
  },
});

export const insightsWorkflow = createWorkflow({
  id: 'journey-insights',
  inputSchema: input,
  outputSchema: output,
})
  .then(clusterInsights)
  .commit();
