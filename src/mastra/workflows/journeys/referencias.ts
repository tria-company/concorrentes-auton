/** Jornada REFERÊNCIAS (Camada 5): ranqueia ganchos/criativos → hook_patterns. */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { referenciasRanker } from '../../agents/generators';
import { supabase } from '../../lib/supabase';
import { runAgent } from '../../lib/run-agent';

const input = z.object({ competitor_id: z.string().uuid() });
const output = z.object({ competitor_id: z.string().uuid(), patterns: z.number() });

const rankerOut = z.object({
  patterns: z
    .array(
      z.object({
        pattern_label: z.string(),
        hook_text: z.string(),
        channel: z.string().nullable(),
        formula_estrutural: z.string().nullable(),
        rank_global: z.number().int(),
      }),
    )
    .default([]),
});

const rankReferences = createStep({
  id: 'rank-references',
  inputSchema: input,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const sb = supabase();
    const { data: hooks, error } = await sb
      .from('post_analysis')
      .select('channel,gancho_texto,tipo_gancho,promessa_central,eng_rate')
      .eq('competitor_id', inputData.competitor_id)
      .not('gancho_texto', 'is', null)
      .limit(300);
    if (error) throw new Error(`post_analysis read: ${error.message}`);
    if (!hooks || hooks.length === 0) return { competitor_id: inputData.competitor_id, patterns: 0 };

    const r = await runAgent<z.infer<typeof rankerOut>>({
      agent: referenciasRanker,
      agentName: 'gen-referencias',
      triggerType: 'journey-referencias',
      competitorId: inputData.competitor_id,
      prompt:
        `Ranqueie os ganchos/criativos por eficácia e extraia o padrão estrutural (JSON):\n` +
        JSON.stringify(hooks).slice(0, 60000),
      schema: rankerOut,
      temperature: 0.5,
      auditInput: { competitor_id: inputData.competitor_id },
    });
    const out = r.object;
    if (!out || out.patterns.length === 0) return { competitor_id: inputData.competitor_id, patterns: 0 };

    // Idempotência: substitui o ranking anterior deste concorrente.
    await sb.from('hook_patterns').delete().eq('competitor_id', inputData.competitor_id);

    const now = new Date().toISOString();
    const rows = out.patterns.map((p) => ({
      competitor_id: inputData.competitor_id,
      pattern_label: p.pattern_label,
      hook_text: p.hook_text,
      channel: p.channel,
      formula_estrutural: p.formula_estrutural,
      rank_global: p.rank_global,
      ad_count: 1,
      llm_model: process.env.AZURE_OPENAI_DEPLOYMENT ?? null,
      computed_at: now,
    }));
    const { error: insErr } = await sb.from('hook_patterns').insert(rows);
    if (insErr) throw new Error(`hook_patterns insert: ${insErr.message}`);
    return { competitor_id: inputData.competitor_id, patterns: rows.length };
  },
});

export const referenciasWorkflow = createWorkflow({
  id: 'journey-referencias',
  inputSchema: input,
  outputSchema: output,
})
  .then(rankReferences)
  .commit();
