/**
 * Factory central de modelos LLM do pipeline.
 *
 * Provider ativo: **Azure OpenAI** (deployment-based API) quando AZURE_OPENAI_ENDPOINT
 * está definido. O endpoint é um `*.cognitiveservices.azure.com`, então usamos o provider
 * OpenAI-compatível (@ai-sdk/openai) apontado para a URL de deployment do Azure.
 *
 * Detalhes confirmados contra as versões instaladas (AI SDK v6 / @ai-sdk/openai v3):
 *  - `createOpenAI` NÃO tem opção `query` → injetamos `?api-version=` via `fetch` custom.
 *  - O callable default do provider usa a **Responses API** (`/responses`); o Azure
 *    deployment-based fala **chat completions**, então usamos `provider.chat(deployment)`.
 *  - Auth do Azure é pelo header `api-key` (o Bearer do AI SDK é ignorado).
 * Config validada em 2026-05-26 (HTTP 200, deployment gpt-4.1-mini).
 *
 * Uso num Agent do Mastra:  `new Agent({ ..., model: model('fast') })`
 */
import { createOpenAI } from '@ai-sdk/openai';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Cria um modelo Azure OpenAI (chat completions) para um deployment específico. */
function azure(deployment: string) {
  const endpoint = trimSlash(process.env.AZURE_OPENAI_ENDPOINT!);
  const apiKey = process.env.AZURE_OPENAI_API_KEY!;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview';
  // Retry transparente em 429 (Too Many Requests) — o AI SDK só faz ~3 retries com backoff
  // curto, insuficiente quando o TPM Azure precisa de 60s+ pra resetar.
  const MAX_429_RETRIES = Number(process.env.AZURE_429_MAX_RETRIES ?? 8);

  const provider = createOpenAI({
    baseURL: `${endpoint}/openai/deployments/${deployment}`,
    apiKey, // exigido pelo AI SDK; o Azure ignora o Bearer em favor do header api-key
    headers: { 'api-key': apiKey },
    // Injeta ?api-version=... em toda request (createOpenAI v6 não tem opção `query`).
    // Plus: retry transparente em 429 lendo Retry-After do Azure.
    fetch: async (input, init) => {
      const raw = typeof input === 'string' || input instanceof URL ? input : (input as Request).url;
      const url = new URL(raw.toString());
      if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', apiVersion);

      for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
        const res = await fetch(url, init);
        if (res.status !== 429) return res;
        if (attempt === MAX_429_RETRIES) return res; // desiste, AI SDK propaga o erro
        // Azure manda Retry-After em segundos (ou ms-since-reset em alguns deployments).
        const ra = Number(res.headers.get('retry-after') ?? 0);
        const wait = ra > 0 ? ra * 1000 : Math.min(60_000, 2_000 * Math.pow(2, attempt));
        // eslint-disable-next-line no-console
        console.warn(`[azure 429] ${deployment} attempt ${attempt + 1}/${MAX_429_RETRIES + 1} — waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
      // inalcançável
      return fetch(url, init);
    },
  });

  return provider.chat(deployment);
}

const FAST = process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4.1-mini';
const HEAVY = process.env.AZURE_OPENAI_DEPLOYMENT_HEAVY ?? FAST;

/**
 * Modelo lógico do pipeline.
 *  - 'fast'  → triagem + 10 especialistas + geradores (barato)
 *  - 'heavy' → consolidação / clustering (deployment mais forte, se configurado)
 *
 * Sem AZURE_OPENAI_ENDPOINT, cai para o Model Router do Mastra (Anthropic).
 */
export function model(tier: 'fast' | 'heavy' = 'fast') {
  if (process.env.AZURE_OPENAI_ENDPOINT) {
    return azure(tier === 'heavy' ? HEAVY : FAST);
  }
  return tier === 'heavy' ? 'anthropic/claude-sonnet-4-6' : 'anthropic/claude-haiku-4-5';
}
