import { describe, it, expect } from 'vitest';
import { inputHash, makeRunId } from '../src/mastra/lib/idempotency';

describe('idempotency', () => {
  it('inputHash é determinístico', () => {
    expect(inputHash({ a: 1, b: 2 })).toBe(inputHash({ a: 1, b: 2 }));
  });
  it('inputHash difere por conteúdo', () => {
    expect(inputHash({ a: 1 })).not.toBe(inputHash({ a: 2 }));
  });
  it('makeRunId usa o prefixo do agente', () => {
    expect(makeRunId('spec-image', { x: 1 }).startsWith('spec-image:')).toBe(true);
  });
});
