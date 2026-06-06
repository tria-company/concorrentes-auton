/**
 * Jornada RADAR (Camada 5): briefing diário denso a partir dos threat briefs + concorrentes.
 * Grava em `daily_briefings`. Cadência: diária. (REFERÊNCIAS/INSIGHTS/CAPTAÇÃO: próximos.)
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { radarWriter } from '../../agents/generators';
import { supabase } from '../../lib/supabase';
import { runAgent } from '../../lib/run-agent';

const output = z.object({ briefing_date: z.string(), ok: z.boolean() });

const radarOut = z.object({
  headline: z.string(),
  briefing_md: z.string(),
  sections: z.array(z.object({ titulo: z.string(), conteudo: z.string() })).default([]),
});

const writeRadar = createStep({
  id: 'write-radar',
  inputSchema: z.object({}),
  outputSchema: output,
  execute: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const sb = supabase();
    const { data: briefs } = await sb.from('competitor_threat_brief').select('*');
    const { data: comps } = await sb
      .from('competitors')
      .select('id,name,handle,last_threat_letter,last_threat_score');

    const out = await runAgent<z.infer<typeof radarOut>>({
      agent: radarWriter,
      agentName: 'gen-radar',
      triggerType: 'journey-radar',
      prompt:
        `Gere o briefing diário (RADAR) em Markdown a partir dos threat briefs e concorrentes (JSON):\n` +
        JSON.stringify({ briefs, comps }).slice(0, 60000),
      schema: radarOut,
      temperature: 0.5,
      auditInput: { date: today },
    });
    const rb = out.object;
    if (!rb) throw new Error('RADAR não retornou briefing');

    const { error } = await sb.from('daily_briefings').upsert(
      {
        briefing_date: today,
        period_start: today,
        period_end: today,
        headline: rb.headline,
        briefing_md: rb.briefing_md,
        sections: rb.sections,
        computed_at: new Date().toISOString(),
        llm_model: process.env.AZURE_OPENAI_DEPLOYMENT ?? null,
        llm_cost_usd: out.cost_usd,
      },
      { onConflict: 'briefing_date' },
    );
    if (error) throw new Error(`daily_briefings insert: ${error.message}`);
    return { briefing_date: today, ok: true };
  },
});

export const radarWorkflow = createWorkflow({
  id: 'journey-radar',
  inputSchema: z.object({}),
  outputSchema: output,
})
  .then(writeRadar)
  .commit();
