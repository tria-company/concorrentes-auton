/**
 * Constantes e schemas compartilhados do pipeline (canais, tipos de conteúdo,
 * 9 dimensões universais da Camada 1 / Organizer).
 */
import { z } from 'zod';

/** 9 canais monitorados (Camada 3 · sintetizadores). */
export const CHANNELS = [
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'linkedin',
  'meta_ads',
  'google_ads',
  'google_reviews',
  'reclame_aqui',
] as const;
export const channelEnum = z.enum(CHANNELS);
export type Channel = (typeof CHANNELS)[number];

/** 10 tipos de conteúdo → 1 especialista cada (Camada 2). */
export const CONTENT_TYPES = [
  'image',
  'carousel',
  'short_video',
  'long_video',
  'fb_organic',
  'linkedin_organic',
  'meta_ads',
  'google_ads',
  'google_reviews',
  'reclame_aqui',
] as const;
export const contentTypeEnum = z.enum(CONTENT_TYPES);
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Camada 1 (Organizer) · 9 dimensões universais de classificação. */
export const dimensionsSchema = z.object({
  tipo: contentTypeEnum.describe('Tipo de conteúdo → roteia ao especialista'),
  tema_principal: z.string(),
  temas_secund: z.array(z.string()).default([]),
  perfil_alvo: z.string(),
  nivel_tecnico: z.enum(['leigo', 'intermediario', 'tecnico']),
  tom: z.string(),
  tem_prova: z.boolean(),
  tem_cta: z.boolean(),
  qualidade_leg: z.enum(['baixa', 'media', 'alta']),
});
export type Dimensions = z.infer<typeof dimensionsSchema>;

/** Item bruto (Silver) a ser analisado, com contexto de origem. */
export const workItemSchema = z.object({
  competitor_id: z.string().uuid(),
  channel: channelEnum,
  source_table: z.string(),
  source_id: z.string(),
  posted_at: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  /** URL da imagem/capa (analisada visualmente pelo especialista). */
  media_url: z.string().nullable().optional(),
  /** URL do vídeo (áudio é transcrito e injetado no prompt do especialista). */
  video_url: z.string().nullable().optional(),
  metrics: z.record(z.string(), z.number()).default({}),
});
export type WorkItem = z.infer<typeof workItemSchema>;
