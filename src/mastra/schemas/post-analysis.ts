/** Schemas da tabela Gold IA `post_analysis` (saída dos 10 especialistas). */
import { z } from 'zod';
import { dimensionsSchema, channelEnum } from './common';

/** Camada 2 (Especialista) · 6 campos universais + payload específico. Saída do LLM. */
export const specialistAnalysisSchema = z.object({
  gancho_texto: z.string().nullable(),
  tipo_gancho: z.string().nullable(),
  promessa_central: z.string().nullable(),
  prova_mostrada: z.string().nullable(),
  estrutura: z.string().nullable(),
  cta: z.string().nullable(),
  /** Campos específicos do especialista (ex.: roteiro de vídeo, copy do ad). */
  specialist_payload: z.record(z.string(), z.any()).default({}),
});
export type SpecialistAnalysis = z.infer<typeof specialistAnalysisSchema>;

/** Linha completa para UPSERT em post_analysis (contexto + dimensões + análise). */
export const postAnalysisRowSchema = z.object({
  competitor_id: z.string().uuid(),
  channel: channelEnum,
  source_table: z.string(),
  source_id: z.string(),
  specialist_used: z.string(),
  // Camada 1 (Organizer)
  tipo: z.string().nullable().optional(),
  tema_principal: z.string().nullable().optional(),
  temas_secund: z.array(z.string()).nullable().optional(),
  perfil_alvo: z.string().nullable().optional(),
  nivel_tecnico: z.string().nullable().optional(),
  tom: z.string().nullable().optional(),
  tem_prova: z.boolean().nullable().optional(),
  tem_cta: z.boolean().nullable().optional(),
  qualidade_leg: z.string().nullable().optional(),
  // Camada 2 (Especialista)
  gancho_texto: z.string().nullable().optional(),
  tipo_gancho: z.string().nullable().optional(),
  promessa_central: z.string().nullable().optional(),
  prova_mostrada: z.string().nullable().optional(),
  estrutura: z.string().nullable().optional(),
  cta: z.string().nullable().optional(),
  specialist_payload: z.record(z.string(), z.any()).nullable().optional(),
  // Engajamento
  likes: z.number().int().nullable().optional(),
  comments: z.number().int().nullable().optional(),
  shares: z.number().int().nullable().optional(),
  views: z.number().int().nullable().optional(),
  eng_rate: z.number().nullable().optional(),
  // Metadata
  posted_at: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  cost_usd: z.number().nullable().optional(),
  tokens_in: z.number().int().nullable().optional(),
  tokens_out: z.number().int().nullable().optional(),
});
export type PostAnalysisRow = z.infer<typeof postAnalysisRowSchema>;

export { dimensionsSchema };
