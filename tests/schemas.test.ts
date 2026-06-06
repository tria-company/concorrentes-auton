import { describe, it, expect } from 'vitest';
import { dimensionsSchema } from '../src/mastra/schemas/common';
import { threatBriefOutputSchema } from '../src/mastra/schemas/threat-brief';

describe('schemas', () => {
  const dims = {
    tipo: 'image',
    tema_principal: 'x',
    perfil_alvo: 'y',
    nivel_tecnico: 'leigo',
    tom: 'z',
    tem_prova: true,
    tem_cta: false,
    qualidade_leg: 'alta',
  };

  it('dimensionsSchema valida tipo do enum e aplica default em temas_secund', () => {
    const r = dimensionsSchema.safeParse(dims);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.temas_secund).toEqual([]);
  });

  it('dimensionsSchema rejeita tipo inválido', () => {
    expect(dimensionsSchema.safeParse({ ...dims, tipo: 'banana' }).success).toBe(false);
  });

  it('threatBriefOutputSchema rejeita score fora de 0–100', () => {
    expect(
      threatBriefOutputSchema.safeParse({
        threat_score: 120,
        threat_letter: 'S',
        categoria_ameaca: 'x',
        posicionamento_dominante: 'y',
        justificativa: 'z',
      }).success,
    ).toBe(false);
  });
});
