/**
 * Contrato do analisador de vídeo (Gemini): sem GEMINI_API_KEY, retorna null (o workflow
 * `analysis` cai no especialista de texto/Azure). O caminho feliz é validado por
 * scripts/smoke-gemini.ts quando a chave estiver no .env.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { runVideoAgent, isYouTube } from '../src/mastra/lib/gemini';

describe('isYouTube (decide URL nativa vs download de bytes)', () => {
  it('reconhece watch URLs do YouTube', () => {
    expect(isYouTube('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isYouTube('http://youtube.com/watch?v=xyz')).toBe(true);
  });
  it('rejeita não-YouTube (vão como bytes inline)', () => {
    expect(isYouTube('https://cdn.tiktok.com/v.mp4')).toBe(false);
    expect(isYouTube('https://scontent.cdninstagram.com/reel.mp4')).toBe(false);
    expect(isYouTube('https://youtu.be/abc')).toBe(false); // forma curta não casa o regex de watch
  });
});

describe('runVideoAgent · degradação graciosa', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });

  it('sem GEMINI_API_KEY → null (não chama a API)', async () => {
    const r = await runVideoAgent({
      agentName: 'spec-short_video-gemini',
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      prompt: 'analise',
      schema: z.object({ ok: z.boolean() }),
    });
    expect(r).toBeNull();
  });

  it('sem videoUrl → null', async () => {
    process.env.GEMINI_API_KEY = 'fake';
    const r = await runVideoAgent({ agentName: 'x', videoUrl: '', prompt: 'p', schema: z.object({}) });
    expect(r).toBeNull();
  });
});
