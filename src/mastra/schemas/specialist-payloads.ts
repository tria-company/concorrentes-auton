/**
 * Payloads específicos por especialista (Camada 2). Cada tipo de conteúdo extrai campos
 * próprios além dos 6 universais. Vão para `post_analysis.specialist_payload` (JSONB).
 */
import { z } from 'zod';
import { CONTENT_TYPES, type ContentType } from './common';
import { specialistAnalysisSchema } from './post-analysis';

export const specialistPayloadSchemas: Record<ContentType, z.ZodTypeAny> = {
  image: z.object({
    texto_sobreposto: z.string().nullable(),
    elementos_visuais: z.array(z.string()).default([]),
    apelo_emocional: z.string().nullable(),
  }),
  carousel: z.object({
    num_cards: z.number().int().nullable(),
    gancho_card1: z.string().nullable(),
    progressao: z.string().nullable(),
    card_final_cta: z.string().nullable(),
  }),
  short_video: z.object({
    gancho_3s: z.string().nullable(),
    formato: z.enum(['talking_head', 'b_roll', 'tutorial', 'depoimento', 'trend', 'outro']).nullable(),
    ritmo_edicao: z.enum(['lento', 'medio', 'rapido']).nullable(),
    retencao_tatica: z.string().nullable(),
    trilha: z.string().nullable(),
  }),
  long_video: z.object({
    estrutura: z.string().nullable(),
    capitulos: z.array(z.string()).default([]),
    proposta_valor: z.string().nullable(),
    retencao_estimada: z.string().nullable(),
  }),
  fb_organic: z.object({
    tipo_post: z.string().nullable(),
    apelo_comunidade: z.string().nullable(),
    oferta: z.string().nullable(),
  }),
  linkedin_organic: z.object({
    angulo_autoridade: z.string().nullable(),
    prova_social_b2b: z.string().nullable(),
    formato_post: z.enum(['texto', 'documento', 'video', 'imagem', 'artigo']).nullable(),
  }),
  meta_ads: z.object({
    angulo_copy: z.string().nullable(),
    oferta: z.string().nullable(),
    gatilho_urgencia: z.string().nullable(),
    tipo_prova_social: z.string().nullable(),
    publico_inferido: z.string().nullable(),
  }),
  google_ads: z.object({
    headline_principal: z.string().nullable(),
    proposta: z.string().nullable(),
    termos_alvo: z.array(z.string()).default([]),
    extensao_oferta: z.string().nullable(),
  }),
  google_reviews: z.object({
    sentimento: z.enum(['positivo', 'neutro', 'negativo']).nullable(),
    temas_elogio: z.array(z.string()).default([]),
    temas_queixa: z.array(z.string()).default([]),
    qualidade_resposta_empresa: z.enum(['ausente', 'generica', 'boa']).nullable(),
  }),
  reclame_aqui: z.object({
    tipo_problema: z.string().nullable(),
    gravidade: z.enum(['baixa', 'media', 'alta']).nullable(),
    foi_resolvido: z.boolean().nullable(),
    risco_reputacional: z.enum(['baixo', 'medio', 'alto']).nullable(),
    sinal_de_lead: z.boolean().nullable().describe('Cliente insatisfeito que pode migrar para a Auton'),
  }),
};

/** Schema de saída completo de um especialista (6 universais + payload específico do tipo). */
export function specialistOutputSchema(ct: ContentType) {
  return specialistAnalysisSchema.extend({ specialist_payload: specialistPayloadSchemas[ct] });
}

/** Resumo curto do foco de extração por tipo (usado nas instruções do agente). */
export const PAYLOAD_FOCUS: Record<ContentType, string> = {
  image: 'texto sobreposto, elementos visuais, apelo emocional',
  carousel: 'nº de cards, gancho do card 1, progressão entre cards, CTA do card final',
  short_video: 'gancho dos 3s, formato, ritmo de edição, tática de retenção, trilha',
  long_video: 'estrutura, capítulos, proposta de valor, retenção estimada',
  fb_organic: 'tipo de post, apelo de comunidade, oferta',
  linkedin_organic: 'ângulo de autoridade, prova social B2B, formato do post',
  meta_ads: 'ângulo da copy, oferta, gatilho de urgência, tipo de prova social, público inferido',
  google_ads: 'headline principal, proposta, termos-alvo, extensão de oferta',
  google_reviews: 'sentimento, temas de elogio/queixa, qualidade da resposta da empresa',
  reclame_aqui: 'tipo e gravidade do problema, resolução, risco reputacional, sinal de lead',
};

export { CONTENT_TYPES };
