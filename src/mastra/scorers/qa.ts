/**
 * QA gate (Quality First) — validação determinística do threat brief antes de persistir.
 * Complementa scorers do Mastra (LLM-as-judge, que podem ser adicionados depois como
 * monitoramento amostrado não-bloqueante). Aqui é um gate código-only (barato e confiável).
 */
import type { ThreatBriefOutput } from '../schemas/threat-brief';

export interface QaResult {
  passed: boolean;
  issues: string[];
}

export function validateThreatBrief(b: ThreatBriefOutput): QaResult {
  const issues: string[] = [];
  if (b.threat_score < 0 || b.threat_score > 100) issues.push('threat_score fora de 0–100');
  if (!['S', 'A', 'B', 'C', 'D'].includes(b.threat_letter)) issues.push('threat_letter inválida');
  if (!b.justificativa || b.justificativa.trim().length < 20) issues.push('justificativa muito curta');
  if (b.recomendacao_acao.length === 0) issues.push('sem recomendações de ação');
  if (!b.posicionamento_dominante?.trim()) issues.push('posicionamento_dominante vazio');
  return { passed: issues.length === 0, issues };
}
