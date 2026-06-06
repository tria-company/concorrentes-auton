/** Smoke: scorer LLM-as-judge do threat brief via Azure.
 *  Rodar: npx tsx --env-file=.env scripts/smoke-scorer.ts  */
import { threatBriefScorer } from '../src/mastra/scorers/threat-brief-scorer';

const brief = {
  threat_score: 78,
  threat_letter: 'A',
  categoria_ameaca: 'direta',
  posicionamento_dominante: 'plataforma de gestão clínica de baixo custo',
  promessas_diferenciais: ['preço acessível', 'onboarding rápido'],
  fraquezas_exploraveis: ['suporte lento', 'sem visão sistêmica'],
  canais_dominantes: ['instagram', 'meta_ads'],
  canais_ausentes: ['linkedin'],
  investimento_paid: { meta: 'alto' },
  velocidade_inovacao: { ritmo: 'médio' },
  recomendacao_acao: ['atacar a dor de suporte', 'posicionar como sistêmico'],
  justificativa: 'forte presença paga e social, porém reputação fraca em suporte ao cliente',
};

const r: any = await threatBriefScorer.run({ output: brief });
console.log('SCORE:', r?.score ?? JSON.stringify(r));
