/**
 * Contrato de degradação graciosa da mídia multimodal: sem URL / sem deployment de
 * transcrição, os helpers retornam null (não quebram o pipeline). O caminho feliz
 * (visão real no gpt-4.1-mini) é validado por scripts/smoke-vision.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toImagePart } from '../src/mastra/lib/media';
import { transcribeAudio } from '../src/mastra/lib/transcribe';

/** Resposta fetch falsa p/ exercitar o guard de content-type e o cap de tamanho. */
function fakeFetch(contentType: string, byteLen: number, ok = true) {
  return vi.fn(async () => ({
    ok,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(byteLen),
  }));
}

describe('mídia multimodal · degradação graciosa', () => {
  beforeEach(() => {
    delete process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT;
  });

  it('toImagePart sem URL → null', async () => {
    expect(await toImagePart(null)).toBeNull();
    expect(await toImagePart(undefined)).toBeNull();
    expect(await toImagePart('')).toBeNull();
  });

  it('transcribeAudio sem URL → null', async () => {
    expect(await transcribeAudio(null)).toBeNull();
  });

  it('transcribeAudio sem AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT → null (não tenta baixar)', async () => {
    expect(await transcribeAudio('https://exemplo.com/video.mp4')).toBeNull();
  });
});

describe('toImagePart · guard de tipo e tamanho (fetch mockado)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('content-type image/* → devolve parte de imagem com bytes', async () => {
    vi.stubGlobal('fetch', fakeFetch('image/jpeg', 1234));
    const part = await toImagePart('https://cdn/x.jpg');
    expect(part).not.toBeNull();
    expect(part!.type).toBe('image');
    expect(part!.mediaType).toBe('image/jpeg');
    expect(part!.image.byteLength).toBe(1234);
  });

  it('content-type não-imagem (HTML/permalink) → null', async () => {
    vi.stubGlobal('fetch', fakeFetch('text/html; charset=utf-8', 5000));
    expect(await toImagePart('https://facebook.com/permalink')).toBeNull();
  });

  it('imagem vazia (0 bytes) → null', async () => {
    vi.stubGlobal('fetch', fakeFetch('image/png', 0));
    expect(await toImagePart('https://cdn/empty.png')).toBeNull();
  });

  it('imagem grande demais (> 8MB) → null', async () => {
    vi.stubGlobal('fetch', fakeFetch('image/png', 8 * 1024 * 1024 + 1));
    expect(await toImagePart('https://cdn/huge.png')).toBeNull();
  });

  it('HTTP não-ok → null', async () => {
    vi.stubGlobal('fetch', fakeFetch('image/jpeg', 100, false));
    expect(await toImagePart('https://cdn/403.jpg')).toBeNull();
  });
});
