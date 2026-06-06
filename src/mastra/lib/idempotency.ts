/** Idempotência: input_hash (sha256) + runId determinístico (RNF-01). */
import { createHash } from 'node:crypto';

export function inputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
}

/** runId determinístico → re-entregas reusam o mesmo run em vez de duplicar. */
export function makeRunId(agent: string, input: unknown): string {
  return `${agent}:${inputHash(input).slice(0, 32)}`;
}
