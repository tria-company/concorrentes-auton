/** Smoke: valida que logAgentRun grava em agent_runs (fix do ON CONFLICT → insert).
 *  Rodar: npx tsx --env-file=.env scripts/smoke-auditlog.ts  */
import { logAgentRun } from '../src/mastra/lib/audit';
import { supabase } from '../src/mastra/lib/supabase';

const runId = `test-audit:${Date.now()}`;
await logAgentRun({
  agent_name: 'test-agent',
  run_id: runId,
  started_at: new Date().toISOString(),
  input_hash: 'deadbeef',
  status: 'success',
  llm_model: 'gpt-4.1-mini',
  llm_cost_usd: 0.0012,
  llm_tokens_in: 1500,
  llm_tokens_out: 120,
  duration_ms: 42,
});
const { data } = await supabase()
  .from('agent_runs')
  .select('run_id,agent_name,llm_cost_usd,llm_tokens_in,status')
  .eq('run_id', runId);
console.log('AGENT_RUNS inserido:', JSON.stringify(data));
