/**
 * Workflow `synthesis-consolidation` (Camadas 3+4):
 *   synthesize-channels (9 sintetizadores em paralelo via Promise.all) → consolidate (threat brief).
 * Cadência: diária. Lê post_analysis → grava channel_synthesis e competitor_threat_brief.
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { CHANNELS } from '../schemas/common';
import { synthesizers } from '../agents/synthesizers';
import { consolidator } from '../agents/consolidator';
import { channelSynthesisOutputSchema, type ChannelSynthesisOutput } from '../schemas/channel-synthesis';
import { threatBriefOutputSchema, type ThreatBriefOutput } from '../schemas/threat-brief';
import {
  fetchAnalysisForChannel,
  fetchChannelSyntheses,
  upsertChannelSynthesis,
  upsertThreatBrief,
} from '../lib/repo';
import { supabase } from '../lib/supabase';
import { validateThreatBrief } from '../scorers/qa';
import { runAgent } from '../lib/run-agent';

const input = z.object({ competitor_id: z.string().uuid() });
const afterSynth = z.object({
  competitor_id: z.string().uuid(),
  channels_done: z.array(z.string()),
});
const output = z.object({
  competitor_id: z.string().uuid(),
  threat_score: z.number(),
  threat_letter: z.string(),
  channels_done: z.array(z.string()),
});

const synthesizeChannels = createStep({
  id: 'synthesize-channels',
  inputSchema: input,
  outputSchema: afterSynth,
  execute: async ({ inputData }) => {
    const today = new Date().toISOString().slice(0, 10);
    const done: string[] = [];
    await Promise.all(
      CHANNELS.map(async (ch) => {
        const items = await fetchAnalysisForChannel(inputData.competitor_id, ch);
        if (items.length === 0) return;
        const r = await runAgent<ChannelSynthesisOutput>({
          agent: synthesizers[ch],
          agentName: `synth-${ch}`,
          triggerType: 'synthesis',
          competitorId: inputData.competitor_id,
          prompt:
            `Sintetize o canal ${ch} a partir destas ${items.length} análises (JSON):\n` +
            JSON.stringify(items).slice(0, 60000),
          schema: channelSynthesisOutputSchema,
          temperature: 0.3,
          auditInput: { competitor_id: inputData.competitor_id, channel: ch },
        });
        const synth = r.object;
        if (!synth) return;
        await upsertChannelSynthesis({
          ...synth,
          competitor_id: inputData.competitor_id,
          channel: ch,
          generated_at: today,
          n_items_analisados: items.length,
          cost_usd: r.cost_usd,
        });
        done.push(ch);
      }),
    );
    return { competitor_id: inputData.competitor_id, channels_done: done };
  },
});

const consolidate = createStep({
  id: 'consolidate',
  inputSchema: afterSynth,
  outputSchema: output,
  execute: async ({ inputData }) => {
    const syntheses = await fetchChannelSyntheses(inputData.competitor_id);
    const r = await runAgent<ThreatBriefOutput>({
      agent: consolidator,
      agentName: 'agt-consolidator',
      triggerType: 'consolidation',
      competitorId: inputData.competitor_id,
      prompt:
        `Consolide o threat brief deste concorrente a partir das sínteses de canal (JSON):\n` +
        JSON.stringify(syntheses).slice(0, 60000),
      schema: threatBriefOutputSchema,
      temperature: 0.3,
      auditInput: { competitor_id: inputData.competitor_id },
    });
    const brief = r.object;
    if (!brief) throw new Error('consolidador não retornou threat brief');

    // QA gate (Quality First) — bloqueia persistência se o brief não passar.
    const qa = validateThreatBrief(brief);
    if (!qa.passed) throw new Error(`QA reprovou o threat brief: ${qa.issues.join('; ')}`);

    await upsertThreatBrief({ ...brief, competitor_id: inputData.competitor_id, cost_usd: r.cost_usd });
    await supabase()
      .from('competitors')
      .update({
        last_threat_score: brief.threat_score,
        last_threat_letter: brief.threat_letter,
        last_ranked_at: new Date().toISOString(),
      })
      .eq('id', inputData.competitor_id);

    return {
      competitor_id: inputData.competitor_id,
      threat_score: brief.threat_score,
      threat_letter: brief.threat_letter,
      channels_done: inputData.channels_done,
    };
  },
});

export const synthesisConsolidationWorkflow = createWorkflow({
  id: 'synthesis-consolidation',
  inputSchema: input,
  outputSchema: output,
})
  .then(synthesizeChannels)
  .then(consolidate)
  .commit();
