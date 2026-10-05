/**
 * Cartoon Studio — AI Cost & Token Calculator
 * Phase 04: Robust AI Generation & Prompt Hardening
 *
 * Deterministic calculation of LLM tokens and infrastructure costs in Euros (EUR).
 * All calculations use bounded floating point with 6 decimal places of precision.
 */

export const AI_RATES = Object.freeze({
  CURRENCY: 'EUR',
  EUR_PER_1M_INPUT_TOKENS: 0.09,
  EUR_PER_1M_OUTPUT_TOKENS: 0.35,
  EUR_PER_IMAGE: 0.025,
  EUR_PER_TTS_1K_CHARS: 0.015,
});

/**
 * Calculates EUR cost for Gemini LLM token consumption.
 * @param inputTokens Number of prompt tokens processed
 * @param outputTokens Number of candidate tokens generated
 * @returns Cost in EUR rounded to 6 decimal places (compatible with DECIMAL(10, 6))
 */
export function calculateGeminiCostEur(inputTokens: number, outputTokens: number): number {
  const safeInput = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0;
  const safeOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0;

  const cost = (safeInput * AI_RATES.EUR_PER_1M_INPUT_TOKENS + safeOutput * AI_RATES.EUR_PER_1M_OUTPUT_TOKENS) / 1_000_000;
  return Number(cost.toFixed(6));
}

/**
 * Calculates EUR cost for Text-To-Speech generation.
 * @param characterCount Number of characters synthesized
 */
export function calculateTtsCostEur(characterCount: number): number {
  const safeChars = Number.isFinite(characterCount) && characterCount > 0 ? Math.floor(characterCount) : 0;
  const cost = (safeChars * AI_RATES.EUR_PER_TTS_1K_CHARS) / 1_000;
  return Number(cost.toFixed(6));
}

/**
 * Calculates EUR cost for Imagen / Raster image generation.
 * @param imageCount Number of images generated
 */
export function calculateImageCostEur(imageCount: number): number {
  const safeCount = Number.isFinite(imageCount) && imageCount > 0 ? Math.floor(imageCount) : 0;
  const cost = safeCount * AI_RATES.EUR_PER_IMAGE;
  return Number(cost.toFixed(6));
}

export interface CostSummary {
  currency: string;
  inputTokensPerMillion: number;
  outputTokensPerMillion: number;
  imagePerCall: number;
  ttsPer1kChars: number;
}

export function getCostSummary(): CostSummary {
  return {
    currency: AI_RATES.CURRENCY,
    inputTokensPerMillion: AI_RATES.EUR_PER_1M_INPUT_TOKENS,
    outputTokensPerMillion: AI_RATES.EUR_PER_1M_OUTPUT_TOKENS,
    imagePerCall: AI_RATES.EUR_PER_IMAGE,
    ttsPer1kChars: AI_RATES.EUR_PER_TTS_1K_CHARS,
  };
}
