/**
 * Scorer LLM-as-judge (Mastra) para o threat brief — complementa o QA gate determinístico
 * (qa.ts). Use com sampling para monitorar qualidade sem bloquear:
 *   threatBriefScorer.run({ output: brief })   // manual
 * ou anexe a um step/agente com { scorer, sampling } em produção.
 */
import { createScorer } from '@mastra/core/evals';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { model } from '../llm';

const judge = new Agent({
  id: 'judge-threat-brief',
  name: 'Judge · Threat Brief',
  instructions: `Você avalia a QUALIDADE de um threat brief de inteligência competitiva.
Critérios: consistência do score com a justificativa, especificidade das fraquezas/recomendações,
ausência de invenção. Dê uma nota de 0 (ruim) a 1 (excelente) e uma razão curta.`,
  model: model('fast'),
});

const judgeOut = z.object({ score: z.number().min(0).max(1), reason: z.string() });

export const threatBriefScorer = createScorer({
  id: 'threat-brief-qa',
  name: 'Threat Brief QA (LLM-as-judge)',
  description: 'Avalia completude/consistência do threat brief (0–1) via LLM.',
}).generateScore(async (context: any) => {
  const brief = context?.run?.output;
  if (!brief) return 0;
  const res = await judge.generate(
    'Avalie a qualidade deste threat brief (JSON):\n' + JSON.stringify(brief).slice(0, 20000),
    { structuredOutput: { schema: judgeOut } },
  );
  return (res.object as z.infer<typeof judgeOut> | undefined)?.score ?? 0;
});
