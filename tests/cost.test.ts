import { describe, it, expect } from 'vitest';
import { estimateCost, estimateGeminiCost } from '../src/mastra/lib/cost';

describe('estimateCost', () => {
  it('zero tokens => custo zero', () => {
    expect(estimateCost(0, 0)).toBe(0);
  });
  it('output é mais caro que input (mesma qtd)', () => {
    expect(estimateCost(0, 1000)).toBeGreaterThan(estimateCost(1000, 0));
  });
  it('é monotônico com o nº de tokens', () => {
    expect(estimateCost(1000, 1000)).toBeGreaterThan(estimateCost(500, 500));
  });
  it('lida com valores ausentes (NaN/0)', () => {
    expect(estimateCost(Number.NaN, 0)).toBe(0);
  });
});

describe('estimateGeminiCost', () => {
  it('zero tokens => custo zero', () => {
    expect(estimateGeminiCost(0, 0)).toBe(0);
  });
  it('output mais caro que input', () => {
    expect(estimateGeminiCost(0, 1000)).toBeGreaterThan(estimateGeminiCost(1000, 0));
  });
  it('monotônico no nº de tokens', () => {
    expect(estimateGeminiCost(2000, 2000)).toBeGreaterThan(estimateGeminiCost(1000, 1000));
  });
});
