/**
 * Scorer genérico de qualidade (LLM-as-judge) para a saída dos agentes analistas.
 * Anexado com sampling baixo aos especialistas/sintetizadores → monitoramento contínuo
 * não-bloqueante (resultados em mastra_scorers). Não substitui o QA gate determinístico.
 */
import { createScorer } from '@mastra/core/evals';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { model } from '../llm';

const judge = new Agent({
  id: 'judge-agent-quality',
  name: 'Judge · Qualidade de Análise',
  instructions: `Você avalia a QUALIDADE da saída de um agente analista de inteligência competitiva.
Critérios (peso igual): (1) completude — preencheu os campos pedidos; (2) aterramento — não
inventou, só o que estava no conteúdo; (3) especificidade — concreto e acionável, não genérico.
Dê uma nota de 0 (ruim) a 1 (excelente) e uma razão curta.`,
  model: model('fast'),
});

const judgeOut = z.object({ score: z.number().min(0).max(1), reason: z.string() });

export const agentQualityScorer = createScorer({
  id: 'agent-quality',
  name: 'Agent Quality (LLM-as-judge)',
  description: 'Completude + aterramento + especificidade da saída do agente (0–1).',
}).generateScore(async (ctx: any) => {
  const out = ctx?.run?.output;
  const text = (typeof out === 'string' ? out : JSON.stringify(out ?? '')).slice(0, 12000);
  const res = await judge.generate(`Avalie a qualidade desta saída de agente:\n${text}`, {
    structuredOutput: { schema: judgeOut },
  });
  return (res.object as z.infer<typeof judgeOut> | undefined)?.score ?? 0;
});
