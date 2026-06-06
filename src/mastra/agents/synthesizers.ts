/** Camada 3 · 9 sintetizadores (1 por canal). Factory keyed por Channel. */
import { Agent } from '@mastra/core/agent';
import { model } from '../llm';
import { CHANNELS, type Channel } from '../schemas/common';
import { withContext } from './context';
import { agentQualityScorer } from '../scorers/agent-quality';

const CANAL: Record<Channel, string> = {
  instagram: 'Instagram (feed/reels/stories)',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn (B2B)',
  meta_ads: 'anúncios Meta (FB/IG)',
  google_ads: 'anúncios Google',
  google_reviews: 'avaliações do Google',
  reclame_aqui: 'Reclame Aqui',
};

function buildSynthesizer(ch: Channel): Agent {
  return new Agent({
    id: `synth-${ch}`,
    name: `Sintetizador · ${ch}`,
    instructions: withContext(`Você é o SINTETIZADOR do canal ${CANAL[ch]} (Camada 3).
Recebe TODAS as análises individuais (post_analysis) de um concorrente nesse canal e produz uma
síntese estratégica:

- posicionamento, promessa_principal, voz_tom, publico_alvo, diferencial.
- padroes_fortes: o que repete e funciona (com exemplos curtos).
- padroes_fracos: o que repete e falha / soa fraco.
- evolucao_narrativa: como a comunicação mudou no tempo (se houver sinal).
- assuntos_novos: temas emergentes.
- padroes_comerciais: ofertas, gatilhos, frequência de venda.
- padroes_dor: dores do público que aparecem (insumo para INSIGHTS e CAPTAÇÃO).
- resumo_executivo: 3–5 linhas acionáveis para a estratégia da Auton.

Baseie-se SOMENTE nas análises fornecidas. Seja específico — cite padrões, não generalidades.`),
    model: model('fast'),
    scorers: { quality: { scorer: agentQualityScorer, sampling: { type: 'ratio', rate: 0.2 } } },
  });
}

export const synthesizers = Object.fromEntries(
  CHANNELS.map((ch) => [ch, buildSynthesizer(ch)]),
) as Record<Channel, Agent>;

export const synthesizersById: Record<string, Agent> = Object.fromEntries(
  CHANNELS.map((ch) => [`synth-${ch}`, synthesizers[ch]]),
);
