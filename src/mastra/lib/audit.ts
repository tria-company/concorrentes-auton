/** Auditoria de runs de agente → tabela `agent_runs` (RF-12). Best-effort. */
import { supabase } from './supabase';

export interface AgentRunLog {
  agent_name: string;
  run_id: string;
  trigger_type?: string;
  competitor_id?: string | null;
  input_hash: string;
  input?: unknown;
  output?: unknown;
  status: 'success' | 'failed' | 'running';
  error_message?: string | null;
  llm_model?: string | null;
  llm_cost_usd?: number | null;
  llm_tokens_in?: number | null;
  llm_tokens_out?: number | null;
  duration_ms?: number | null;
  trace_id?: string | null;
  started_at?: string | null;
}

/** Grava auditoria com idempotência via UNIQUE (agent_name, input_hash) — `agent_runs_idempotency_uk`.
 *  Re-execução do mesmo agente+input atualiza a linha em vez de duplicar. */
export async function logAgentRun(run: AgentRunLog): Promise<void> {
  const { error } = await supabase()
    .from('agent_runs')
    .upsert(
      { ...run, trigger_type: run.trigger_type ?? 'cron', finished_at: new Date().toISOString() },
      { onConflict: 'agent_name,input_hash' },
    );
  if (error) console.error('[audit] falha ao gravar agent_runs:', error.message);
}

/** Wrapper: mede duração, grava sucesso/erro e re-lança em caso de falha. */
export async function withAudit<T>(
  meta: Pick<AgentRunLog, 'agent_name' | 'competitor_id' | 'trigger_type' | 'llm_model'>,
  input: unknown,
  runId: string,
  inputHashValue: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const output = await fn();
    await logAgentRun({
      ...meta,
      run_id: runId,
      input_hash: inputHashValue,
      input,
      output,
      status: 'success',
      duration_ms: Date.now() - startedAt,
    });
    return output;
  } catch (err) {
    await logAgentRun({
      ...meta,
      run_id: runId,
      input_hash: inputHashValue,
      input,
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    });
    throw err;
  }
}
