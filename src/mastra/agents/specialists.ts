/** Camada 2 · 10 especialistas (1 por tipo de conteúdo). Factory keyed por ContentType. */
import { Agent } from '@mastra/core/agent';
import { model } from '../llm';
import { CONTENT_TYPES, type ContentType } from '../schemas/common';
import { PAYLOAD_FOCUS } from '../schemas/specialist-payloads';
import { withContext } from './context';
import { agentQualityScorer } from '../scorers/agent-quality';

/** Descrição do que cada especialista analisa. */
const FOCO: Record<ContentType, string> = {
  image: 'posts de imagem estática (feed do Instagram/Facebook)',
  carousel: 'carrosséis (múltiplas imagens/cards)',
  short_video: 'vídeos curtos (Reels, Shorts, TikTok)',
  long_video: 'vídeos longos (YouTube)',
  fb_organic: 'posts orgânicos de Facebook',
  linkedin_organic: 'posts orgânicos de LinkedIn (B2B)',
  meta_ads: 'anúncios pagos no Meta (Facebook/Instagram Ads)',
  google_ads: 'anúncios pagos no Google',
  google_reviews: 'avaliações de clientes no Google',
  reclame_aqui: 'reclamações no Reclame Aqui',
};

function buildSpecialist(ct: ContentType): Agent {
  return new Agent({
    id: `spec-${ct}`,
    name: `Especialista · ${ct}`,
    instructions: withContext(`Você é o ESPECIALISTA em ${FOCO[ct]} (Camada 2).

Para cada item, extraia os **6 campos universais**:
- gancho_texto: a primeira frase/elemento que prende a atenção.
- tipo_gancho: categoria do gancho (ex.: pergunta, dado chocante, dor, promessa, curiosidade, prova).
- promessa_central: o que o conteúdo promete entregar.
- prova_mostrada: que prova/evidência aparece (ou null).
- estrutura: como o conteúdo é organizado (esqueleto).
- cta: a chamada para ação (ou null).

E preencha **specialist_payload** com os campos específicos deste formato:
${PAYLOAD_FOCUS[ct]}.

Extraia só o que está explícito. Campo inexistente → null (ou lista vazia).`),
    model: model('fast'),
    scorers: { quality: { scorer: agentQualityScorer, sampling: { type: 'ratio', rate: 0.15 } } },
  });
}

export const specialists = Object.fromEntries(
  CONTENT_TYPES.map((ct) => [ct, buildSpecialist(ct)]),
) as Record<ContentType, Agent>;

/** Record id→agent para registrar na instância Mastra. */
export const specialistsById: Record<string, Agent> = Object.fromEntries(
  CONTENT_TYPES.map((ct) => [`spec-${ct}`, specialists[ct]]),
);
