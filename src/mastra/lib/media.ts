/**
 * Mídia visual → parte multimodal para os agentes (Camada 2 · especialistas).
 * Baixa a imagem e a entrega como BYTES inline (mais robusto que passar a URL: os
 * links de CDN de IG/FB/Meta expiram e o modelo não conseguiria buscá-los depois).
 * Falhas (404, URL expirada, não-imagem, grande demais) retornam null — degrada sem quebrar.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — criativos cabem com folga

/** Parte de imagem no formato esperado pelo AI SDK v6 (content part `image`). */
export interface ImagePart {
  type: 'image';
  image: Uint8Array;
  mediaType: string;
}

/** Baixa `url` e devolve uma parte de imagem inline, ou null se não der. */
export async function toImagePart(url: string | null | undefined): Promise<ImagePart | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mediaType = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\//i.test(mediaType)) return null; // página HTML/redirect, não a imagem
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return { type: 'image', image: buf, mediaType };
  } catch {
    return null;
  }
}
