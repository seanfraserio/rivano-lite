import type { ChatMessage } from "./types.js";

const MAX_EVAL_TEXT_LENGTH = 10_000;

/**
 * Extracts plain text from chat messages for evaluation (PII, injection, policy).
 * Truncates to MAX_EVAL_TEXT_LENGTH characters to prevent catastrophic backtracking.
 */
export function extractMessageText(messages: ChatMessage[]): string {
  const text = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  return text.slice(0, MAX_EVAL_TEXT_LENGTH);
}
