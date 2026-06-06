/** Schemas da tabela Gold IA `channel_synthesis` (saída dos 9 sintetizadores). */
import { z } from 'zod';
import { channelEnum } from './common';

/** Saída do LLM sintetizador para um canal. */
export const channelSynthesisOutputSchema = z.object({
  posicionamento: z.string(),
  promessa_principal: z.string(),
  voz_tom: z.string(),
  publico_alvo: z.string(),
  diferencial: z.string(),
  padroes_fortes: z.array(z.string()).default([]),
  padroes_fracos: z.array(z.string()).default([]),
  evolucao_narrativa: z.string().nullable(),
  assuntos_novos: z.array(z.string()).default([]),
  padroes_comerciais: z.array(z.string()).default([]),
  padroes_dor: z.array(z.string()).default([]),
  resumo_executivo: z.string(),
});
export type ChannelSynthesisOutput = z.infer<typeof channelSynthesisOutputSchema>;

/** Linha completa para UPSERT em channel_synthesis. */
export const channelSynthesisRowSchema = channelSynthesisOutputSchema.extend({
  competitor_id: z.string().uuid(),
  channel: channelEnum,
  generated_at: z.string(), // DATE (YYYY-MM-DD)
  n_items_analisados: z.number().int().default(0),
  cost_usd: z.number().nullable().optional(),
});
export type ChannelSynthesisRow = z.infer<typeof channelSynthesisRowSchema>;
