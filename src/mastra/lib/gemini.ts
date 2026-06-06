/**
 * Análise de VÍDEO via Gemini (Camada 2 · especialistas de vídeo).
 * O Gemini entende vídeo nativamente — vê os frames E ouve o áudio numa só chamada,
 * então substitui a extração de áudio/transcrição para conteúdo de vídeo.
 *
 *  - YouTube → passa a URL como `fileData.fileUri` (suporte nativo, sem baixar).
 *  - IG/FB/Meta/TikTok → baixa os bytes e manda inline (com guard de content-type:
 *    pula watch-page/HTML, como a do TikTok). URLs de CDN expiram → rodar logo após scrape.
 *
 * Requer `GEMINI_API_KEY` (Google AI Studio). Sem ela, retorna null → o chamador faz
 * fallback para o especialista de texto (Azure). Auditoria/custo gravados como os demais.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { logAgentRun } from './audit';
import { inputHash, makeRunId } from './idempotency';
import { estimateGeminiCost } from './cost';
import { createRateLimiter } from './rate-limit';
import type { AgentRunResult } from './run-agent';

const YOUTUBE = /^https?:\/\/(www\.)?youtube\.com\/watch\?v=.+/i;

// Limitador GLOBAL das chamadas ao Gemini — evita estourar a cota (a análise roda com
// concurrency:8, mas o Gemini é gargalo). Ajustável por env conforme o plano (free vs pago).
const geminiLimit = createRateLimiter(
  Number(process.env.GEMINI_MAX_CONCURRENCY ?? 2),
  Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 4000),
);

/** True se a URL é de vídeo do YouTube (entra no Gemini como fileData.fileUri, sem baixar). */
export const isYouTube = (url: string): boolean => YOUTUBE.test(url);
const MAX_INLINE = 20 * 1024 * 1024; // ~20 MB — limite prático de mídia inline

function client() {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return apiKey ? createGoogleGenerativeAI({ apiKey }) : null;
}

/** Monta a parte de vídeo (URL p/ YouTube, bytes inline p/ o resto). null se não der. */
async function videoPart(url: string): Promise<any | null> {
  if (YOUTUBE.test(url)) {
    return { type: 'file', data: new URL(url), mediaType: 'video/mp4' };
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') ?? '').toLowerCase();
    if (/text\/html|text\/plain|application\/(json|xml)/.test(ct)) return null; // watch page / erro
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_INLINE) return null;
    return { type: 'file', data: buf, mediaType: ct.startsWith('video/') ? ct : 'video/mp4' };
  } catch {
    return null;
  }
}

/**
 * Roda o Gemini sobre um vídeo com saída estruturada + auditoria. Mesmo retorno que
 * `runAgent`. Retorna null se indisponível (sem chave, URL morta, watch-page) → fallback.
 */
export async function runVideoAgent<T = unknown>(params: {
  agentName: string;
  videoUrl: string;
  prompt: string;
  schema: any;
  temperature?: number;
  model?: string;
  competitorId?: string | null;
  triggerType?: string;
  auditInput?: unknown;
}): Promise<AgentRunResult<T> | null> {
  const google = client();
  if (!google || !params.videoUrl) return null;
  const part = await videoPart(params.videoUrl);
  if (!part) return null;

  const modelId = params.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const startedAt = Date.now();
  const ih = inputHash(params.auditInput ?? params.prompt);
  const runId = `${makeRunId(params.agentName, params.auditInput ?? params.prompt)}:${startedAt}`;
  try {
    const res: any = await geminiLimit(() =>
      generateObject({
        model: google(modelId),
        schema: params.schema,
        maxRetries: 2, // o limitador espaça as chamadas; retries curtos evitam queimar cota
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        messages: [{ role: 'user', content: [{ type: 'text', text: params.prompt }, part] }],
      }),
    );
    const tin = res?.usage?.inputTokens ?? 0;
    const tout = res?.usage?.outputTokens ?? 0;
    const cost = estimateGeminiCost(tin, tout);
    await logAgentRun({
      agent_name: params.agentName,
      run_id: runId,
      started_at: new Date(startedAt).toISOString(),
      input_hash: ih,
      competitor_id: params.competitorId ?? null,
      trigger_type: params.triggerType && ['cron', 'webhook', 'manual'].includes(params.triggerType) ? params.triggerType : 'cron',
      status: 'success',
      output: res?.object,
      llm_model: modelId,
      llm_cost_usd: cost,
      llm_tokens_in: tin,
      llm_tokens_out: tout,
      duration_ms: Date.now() - startedAt,
    });
    return { object: res?.object as T, cost_usd: cost, tokens_in: tin, tokens_out: tout };
  } catch (err) {
    await logAgentRun({
      agent_name: params.agentName,
      run_id: runId,
      started_at: new Date(startedAt).toISOString(),
      input_hash: ih,
      competitor_id: params.competitorId ?? null,
      trigger_type: params.triggerType && ['cron', 'webhook', 'manual'].includes(params.triggerType) ? params.triggerType : 'cron',
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      llm_model: modelId,
      duration_ms: Date.now() - startedAt,
    });
    return null; // falha do Gemini → deixa o chamador cair no especialista de texto
  }
}
