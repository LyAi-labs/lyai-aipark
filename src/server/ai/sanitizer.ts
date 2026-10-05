/**
 * 
 * Cartoon Studio — AI Prompt Hardening & Input Sanitizer
 * Phase 04: Robust AI Generation & Prompt Hardening
 *
 * Sanitizes and neutralizes user input to prevent prompt injection,
 * delimiter evasion, token smuggling, control characters, and Unicode spoofing.
 */

// Dangerous ASCII control characters (excluding standard whitespace \t, \n, \r)
const DANGEROUS_ASCII_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// Unicode BiDi override characters and direction markers (used in Trojan Source / text spoofing)
const UNICODE_BIDI_OVERRIDES = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// Zero-width spaces, joiners and BOM markers
const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

// Common pseudo-role / instruction escape patterns
const INJECTION_ROLE_MARKERS = /(?:^|\n)\s*(?:system|assistant|user|human|admin)\s*:/gi;
const SPECIAL_TOKEN_MARKERS = /\[\/?(?:inst|sys|prompt)\]|<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi;

export interface SanitizeOptions {
  maxLength?: number;
  allowNewlines?: boolean;
}

/**
 * Sanitizes untrusted text intended for LLM prompt interpolation.
 * Removes null bytes, unprintable control codes, BiDi overrides, zero-width chars,
 * and neutralizes special instruction markers and delimiters.
 */
export function sanitizePromptText(input: unknown, options: SanitizeOptions = {}): string {
  const { maxLength = 1000, allowNewlines = true } = options;

  if (input === null || input === undefined) {
    return '';
  }

  let text = typeof input === 'string' ? input : String(input);

  // 1. Unicode normalization (NFKC decomposes compatibility characters safely)
  try {
    text = text.normalize('NFKC');
  } catch {
    // Fallback if normalization fails on corrupted strings
  }

  // 2. Strip null bytes and unprintable control characters
  text = text.replace(DANGEROUS_ASCII_CONTROL, '');

  // 3. Strip BiDi overrides and invisible zero-width chars
  text = text.replace(UNICODE_BIDI_OVERRIDES, '');
  text = text.replace(ZERO_WIDTH_CHARS, '');

  // 4. Handle newlines
  if (!allowNewlines) {
    text = text.replace(/[\r\n]+/g, ' ');
  } else {
    // Normalize Windows CRLF to LF
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  // 5. Neutralize LLM special tokens and pseudo-role headers
  text = text.replace(SPECIAL_TOKEN_MARKERS, (match) => `[escaped:${match.slice(1, -1)}]`);
  text = text.replace(INJECTION_ROLE_MARKERS, (match) => match.replace(':', ' -'));

  // 6. Escape XML/HTML-like delimiters that could break custom prompt boundaries
  text = text
    .replace(/<\/user_content>/gi, '&lt;/user_content&gt;')
    .replace(/<user_content>/gi, '&lt;user_content&gt;');

  // 7. Enforce max length bound
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }

  return text.trim();
}

/**
 * Wraps untrusted user content in clearly demarcated XML tags with metadata.
 * Models are explicitly instructed in the system prompt that content inside
 * <user_content> blocks is untrusted data and cannot override instructions.
 */
export function wrapUntrustedContent(tag: string, content: string): string {
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]/g, '');
  return `<user_content type="${safeTag}">\n${content}\n</user_content>`;
}
