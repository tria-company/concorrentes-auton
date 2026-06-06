/** Limitador de taxa do Gemini: concorrência máx + intervalo mínimo entre inícios. */
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../src/mastra/lib/rate-limit';

describe('createRateLimiter', () => {
  it('respeita a concorrência máxima', async () => {
    const limit = createRateLimiter(2, 0);
    let active = 0;
    let maxActive = 0;
    const task = () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      });
    await Promise.all(Array.from({ length: 6 }, task));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(0);
  });

  it('espaça os inícios pelo intervalo mínimo (taxa limitada)', async () => {
    const gap = 40;
    const n = 4;
    const limit = createRateLimiter(1, gap);
    const starts: number[] = [];
    const task = () => limit(async () => { starts.push(Date.now()); });
    await Promise.all(Array.from({ length: n }, task));
    // span total ≈ (n-1)*gap; tolerância p/ granularidade de timer (Windows ~16ms).
    expect(starts[n - 1] - starts[0]).toBeGreaterThanOrEqual((n - 1) * gap * 0.7);
  });

  it('retorna o valor e propaga erros', async () => {
    const limit = createRateLimiter(1, 0);
    expect(await limit(async () => 42)).toBe(42);
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
