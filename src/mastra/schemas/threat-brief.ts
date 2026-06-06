/** Schemas da tabela Gold IA `competitor_threat_brief` (saída do consolidador). */
import { z } from 'zod';

/** Saída do LLM consolidador (threat score + recomendações). */
export const threatBriefOutputSchema = z.object({
  threat_score: z.number().int().min(0).max(100),
  threat_letter: z.enum(['S', 'A', 'B', 'C', 'D']),
  categoria_ameaca: z.string(),
  posicionamento_dominante: z.string(),
  promessas_diferenciais: z.array(z.string()).default([]),
  fraquezas_exploraveis: z.array(z.string()).default([]),
  canais_dominantes: z.array(z.string()).default([]),
  canais_ausentes: z.array(z.string()).default([]),
  // Arrays (não z.record): o structured-output estrito do Azure rejeita dicts abertos.
  investimento_paid: z.array(z.string()).default([]),
  velocidade_inovacao: z.array(z.string()).default([]),
  recomendacao_acao: z.array(z.string()).default([]),
  justificativa: z.string(),
});
export type ThreatBriefOutput = z.infer<typeof threatBriefOutputSchema>;

/** Linha completa para UPSERT em competitor_threat_brief. */
export const threatBriefRowSchema = threatBriefOutputSchema.extend({
  competitor_id: z.string().uuid(),
  cost_usd: z.number().nullable().optional(),
});
export type ThreatBriefRow = z.infer<typeof threatBriefRowSchema>;
