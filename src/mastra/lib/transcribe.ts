/**
 * Transcrição de áudio de vídeo (Camada 2 · especialistas de vídeo).
 * Baixa o vídeo e manda para o endpoint de transcrição do Azure OpenAI
 * (deployment Whisper / gpt-4o-(mini-)transcribe). O texto transcrito é injetado
 * no prompt do especialista — é assim que o pipeline "lê" o áudio dos vídeos.
 *
 * Requer `AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT` (um deployment de transcrição no mesmo
 * recurso Azure). Sem ele, ou para URLs que não são mídia direta (a webpage do
 * TikTok/YouTube não é um arquivo de áudio), retorna null — degrada sem quebrar.
 */
const trimSlash = (s: string) => s.replace(/\/+$/, '');
const MAX_BYTES = 24 * 1024 * 1024; // limite ~25 MB do endpoint de transcrição

const CT_EXT: Record<string, string> = {
  'application/ogg': 'ogg', 'audio/ogg': 'ogg', 'video/ogg': 'ogg',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mpga': 'mp3',
  'video/mp4': 'mp4', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
};

/**
 * O endpoint de transcrição usa a EXTENSÃO do filename para detectar o formato — então o
 * nome precisa bater com os bytes (mp4 com bytes ogg falha). Deriva do content-type, com
 * fallback na extensão da URL, e por fim mp4.
 */
export function fileNameFor(url: string, contentType: string): string {
  const ext = CT_EXT[contentType.split(';')[0].trim()];
  if (ext) return `media.${ext}`;
  const m = url.split('?')[0].match(/\.(ogg|mp3|mp4|m4a|wav|webm|flac|mpeg|mpga)$/i);
  return m ? `media.${m[1].toLowerCase()}` : 'media.mp4';
}

/**
 * Extrai o texto da resposta de transcrição, cobrindo formatos diferentes:
 *  - `{ text }` (whisper / gpt-4o-transcribe);
 *  - `{ segments: [{ speaker?, text }] }` (gpt-4o-transcribe-diarize) → junta com locutor.
 */
export function extractTranscript(data: Record<string, any>): string | null {
  const segments = data.segments ?? data.phrases ?? data.diarization;
  if (Array.isArray(segments) && segments.length) {
    const lines = segments
      .map((s: any) => {
        const t = (s?.text ?? s?.transcript ?? '').toString().trim();
        if (!t) return null;
        const who = s?.speaker ?? s?.speaker_id ?? s?.speakerLabel;
        return who != null ? `${who}: ${t}` : t;
      })
      .filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  const text = (data.text ?? '').toString().trim();
  return text || null;
}

/** Transcreve o áudio de uma URL de vídeo/áudio direta. Retorna null se não der. */
export async function transcribeAudio(url: string | null | undefined): Promise<string | null> {
  const deployment = process.env.AZURE_OPENAI_TRANSCRIBE_DEPLOYMENT;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!url || !deployment || !endpoint || !apiKey) return null;

  try {
    const media = await fetch(url);
    if (!media.ok) return null;
    const ct = (media.headers.get('content-type') ?? '').toLowerCase();
    // Pula páginas de watch / erros (TikTok/YouTube devolvem HTML; CDN expirado devolve text/plain).
    // Aceita áudio/vídeo direto incluindo application/ogg, application/octet-stream, etc.
    if (/text\/html|text\/plain|application\/(json|xml)/.test(ct)) return null;
    const buf = new Uint8Array(await media.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

    // A transcrição usa uma api-version própria (≠ da do chat).
    const apiVersion =
      process.env.AZURE_OPENAI_TRANSCRIBE_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? '2025-03-01-preview';
    const u = `${trimSlash(endpoint)}/openai/deployments/${deployment}/audio/transcriptions?api-version=${apiVersion}`;
    const form = new FormData();
    form.append('file', new Blob([buf], { type: ct || 'video/mp4' }), fileNameFor(url, ct));
    form.append('response_format', 'json');

    const r = await fetch(u, { method: 'POST', headers: { 'api-key': apiKey }, body: form });
    if (!r.ok) return null;
    const data = (await r.json()) as Record<string, any>;
    return extractTranscript(data);
  } catch {
    return null;
  }
}
