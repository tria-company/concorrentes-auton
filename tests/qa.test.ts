import { describe, it, expect } from 'vitest';
import { validateThreatBrief } from '../src/mastra/scorers/qa';

const base = {
  threat_score: 80,
  threat_letter: 'A' as const,
  categoria_ameaca: 'direta',
  posicionamento_dominante: 'plataforma sistêmica',
  promessas_diferenciais: [],
  fraquezas_exploraveis: [],
  canais_dominantes: [],
  canais_ausentes: [],
  investimento_paid: {},
  velocidade_inovacao: {},
  recomendacao_acao: ['agir no canal X'],
  justificativa: 'justificativa suficientemente longa para passar no gate de QA',
};

describe('QA threat brief', () => {
  it('passa um brief válido', () => {
    expect(validateThreatBrief(base).passed).toBe(true);
  });
  it('reprova score fora de faixa', () => {
    expect(validateThreatBrief({ ...base, threat_score: 200 }).passed).toBe(false);
  });
  it('reprova sem recomendações de ação', () => {
    expect(validateThreatBrief({ ...base, recomendacao_acao: [] }).passed).toBe(false);
  });
});
