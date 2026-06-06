/**
 * Wrapper para chamadas de agente: executa generate com saída estruturada, captura
 * tokens/custo (usage) e grava auditoria em `agent_runs` (RF-12). Resolve os gaps de
 * auditoria + custo + runId determinístico num só lugar.
 */
import type { Agent } from '@mastra/core/agent';
import { logAgentRun } from './audit';
import { inputHash, makeRunId } from './idempotency';
import { estimateCost } from './cost';

export interface AgentRunResult<T> {
  object: T | undefined;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
}

export async function runAgent<T = unknown>(params: {
  agent: Agent;
  agentName: string;
  prompt: string;
  schema: unknown;
  temperature?: number;
  competitorId?: string | null;
  triggerType?: string;
  /** Partes de imagem (multimodal) anexadas ao prompt do usuário — análise visual. */
  imageParts?: unknown[];
  /** Dado canônico para input_hash/runId determinístico (default: o prompt). */
  auditInput?: unknown;
}): Promise<AgentRunResult<T>> {
  const startedAt = Date.now();
  const ih = inputHash(params.auditInput ?? params.prompt);
  // run_id único por execução (deterministc prefix p/ rastreio + timestamp p/ unicidade);
  // o dedup de processamento é por input_hash (ih).
  const runId = `${makeRunId(params.agentName, params.auditInput ?? params.prompt)}:${startedAt}`;
  // Com imagem(ns), monta uma mensagem multimodal; senão, prompt texto puro.
  const imgs = (params.imageParts ?? []).filter(Boolean);
  const input: any = imgs.length
    ? [{ role: 'user', content: [{ type: 'text', text: params.prompt }, ...imgs] }]
    : params.prompt;
  try {
    const res: any = await params.agent.generate(input, {
      structuredOutput: { schema: params.schema as any },
      ...(params.temperature != null ? { modelSettings: { temperature: params.temperature } } : {}),
    });
    const tin = res?.usage?.inputTokens ?? 0;
    const tout = res?.usage?.outputTokens ?? 0;
    const cost = estimateCost(tin, tout);
    await logAgentRun({
      agent_name: params.agentName,
      run_id: runId,
      started_at: new Date(startedAt).toISOString(),
      input_hash: ih,
      competitor_id: params.competitorId ?? null,
      trigger_type: params.triggerType && ['cron', 'webhook', 'manual'].includes(params.triggerType) ? params.triggerType : 'cron',
      status: 'success',
      output: res?.object,
      llm_model: process.env.AZURE_OPENAI_DEPLOYMENT ?? null,
      llm_cost_usd: cost,
      llm_tokens_in: tin,
      llm_tokens_out: tout,
      duration_ms: Date.now() - startedAt,
    });
    return { object: res?.object as T | undefined, cost_usd: cost, tokens_in: tin, tokens_out: tout };
  } catch (err) {
    await logAgentRun({
      agent_name: params.agentName,
      run_id: runId,
      started_at: new Date(startedAt).toISOString(),
      input_hash: ih,
      competitor_id: params.competitorId ?? null,
      trigger_type: params.triggerType && ['cron', 'webhook', 'manual'].includes(params.triggerType) ? params.triggerType : 'cron',
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    });
    throw err;
  }
}
