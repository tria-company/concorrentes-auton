/**
 * Lógica pura da transcrição: `fileNameFor` (derivação de extensão — origem do bug em que
 * bytes ogg iam com nome .mp4 e o Azure falhava) e `extractTranscript` (parse de respostas
 * `{text}` vs `{segments}` do gpt-4o-transcribe-diarize).
 */
import { describe, it, expect } from 'vitest';
import { fileNameFor, extractTranscript } from '../src/mastra/lib/transcribe';

describe('fileNameFor (extensão precisa bater com os bytes)', () => {
  it('deriva a extensão do content-type', () => {
    expect(fileNameFor('https://x/a', 'application/ogg')).toBe('media.ogg');
    expect(fileNameFor('https://x/a', 'audio/mpeg')).toBe('media.mp3');
    expect(fileNameFor('https://x/a', 'video/mp4')).toBe('media.mp4');
    expect(fileNameFor('https://x/a', 'audio/mp4')).toBe('media.m4a');
    expect(fileNameFor('https://x/a', 'audio/x-wav')).toBe('media.wav');
    expect(fileNameFor('https://x/a', 'video/webm')).toBe('media.webm');
  });

  it('ignora parâmetros do content-type (;codecs=...)', () => {
    expect(fileNameFor('https://x/a', 'audio/ogg; codecs=opus')).toBe('media.ogg');
  });

  it('cai para a extensão da URL quando o content-type não ajuda', () => {
    expect(fileNameFor('https://cdn/clip.mp3?sig=abc', 'application/octet-stream')).toBe('media.mp3');
    expect(fileNameFor('https://cdn/clip.WAV', '')).toBe('media.wav');
  });

  it('default = mp4 quando não dá pra inferir (o bug: ogg NUNCA vira mp4)', () => {
    expect(fileNameFor('https://cdn/no-ext', 'application/octet-stream')).toBe('media.mp4');
    expect(fileNameFor('https://cdn/x.ogg', 'application/ogg')).not.toBe('media.mp4');
  });
});

describe('extractTranscript (formatos de resposta)', () => {
  it('formato simples { text }', () => {
    expect(extractTranscript({ text: ' olá mundo ' })).toBe('olá mundo');
  });

  it('diarize { segments:[{speaker,text}] } → junta com locutor', () => {
    const out = extractTranscript({
      segments: [
        { speaker: 'A', text: 'bom dia' },
        { speaker: 'B', text: 'tudo bem?' },
      ],
    });
    expect(out).toBe('A: bom dia\nB: tudo bem?');
  });

  it('segmentos sem speaker → só o texto', () => {
    expect(extractTranscript({ segments: [{ text: 'um' }, { text: 'dois' }] })).toBe('um\ndois');
  });

  it('resposta vazia → null', () => {
    expect(extractTranscript({ text: '' })).toBeNull();
    expect(extractTranscript({})).toBeNull();
    expect(extractTranscript({ segments: [] })).toBeNull();
  });
});
