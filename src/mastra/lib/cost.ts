/**
 * Estimador de custo de LLM. Preços aproximados do gpt-4.1-mini (USD por token).
 * Ajustar conforme o contrato Azure (env AZURE_PRICE_IN/AZURE_PRICE_OUT, opcional).
 */
const PRICE_IN = Number(process.env.AZURE_PRICE_IN ?? 0.4 / 1_000_000);
const PRICE_OUT = Number(process.env.AZURE_PRICE_OUT ?? 1.6 / 1_000_000);

export function estimateCost(tokensIn: number, tokensOut: number): number {
  return +((tokensIn || 0) * PRICE_IN + (tokensOut || 0) * PRICE_OUT).toFixed(6);
}

// Gemini 2.5 Flash — preços aproximados (USD/token). Ajustáveis por env.
const GEMINI_PRICE_IN = Number(process.env.GEMINI_PRICE_IN ?? 0.3 / 1_000_000);
const GEMINI_PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT ?? 2.5 / 1_000_000);

/** Custo estimado de uma chamada Gemini (vídeo conta tokens de input como qualquer mídia). */
export function estimateGeminiCost(tokensIn: number, tokensOut: number): number {
  return +((tokensIn || 0) * GEMINI_PRICE_IN + (tokensOut || 0) * GEMINI_PRICE_OUT).toFixed(6);
}
