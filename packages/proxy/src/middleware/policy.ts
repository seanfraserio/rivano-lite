import type { Policy, PipelineContext, PipelineResult } from "@rivano/core";
import { evaluatePolicies, redactPii } from "@rivano/core";
import type { Middleware } from "../pipeline.js";

function extractText(ctx: PipelineContext, phase: "request" | "response"): string {
  if (phase === "response" && ctx.metadata.providerResponse !== undefined) {
    // For response phase, evaluate the provider response content
    const response = ctx.metadata.providerResponse;
    if (typeof response === "object" && response !== null) {
      // Try to extract text content from common LLM response shapes
      const obj = response as Record<string, unknown>;
      // OpenAI/Anthropic format: { choices: [{ message: { content } }] } or { content: [{ text }] }
      if (Array.isArray(obj.choices)) {
        const texts = (obj.choices as Array<Record<string, unknown>>).map((c) => {
          const msg = c.message as Record<string, unknown> | undefined;
          return typeof msg?.content === "string" ? msg.content : "";
        });
        return texts.join("\n");
      }
      if (Array.isArray(obj.content)) {
        const texts = (obj.content as Array<Record<string, unknown>>).map((c) => {
          return typeof c.text === "string" ? c.text : "";
        });
        return texts.join("\n");
      }
      // Fallback: stringify the entire response
      try {
        return JSON.stringify(response).slice(0, 10_000);
      } catch {
        return "";
      }
    }
    if (typeof response === "string") {
      return response.slice(0, 10_000);
    }
  }
  // For request phase (or when no response is available), use request messages
  return ctx.messages
    .map((m) => {
      const msg = m as { content?: string };
      return typeof msg.content === "string" ? msg.content : "";
    })
    .join("\n");
}

export function createPolicyMiddleware(
  policies: Policy[],
  phase: "request" | "response",
): Middleware {
  const phasePolicies = policies.filter((p) => p.on === phase);

  return {
    name: `policy-${phase}`,

    async execute(ctx: PipelineContext): Promise<PipelineResult> {
      if (phasePolicies.length === 0) {
        return "continue";
      }

      const text = extractText(ctx, phase);

      const evalCtx = {
        text,
        injectionScore: (ctx.metadata.injectionScore as number) ?? 0,
        piiDetected: (ctx.metadata.piiDetected as boolean) ?? false,
      };

      const result = evaluatePolicies(phasePolicies, evalCtx);

      if (result.action === "continue") {
        return "continue";
      }

      switch (result.action) {
        case "block":
          ctx.metadata.blockedBy = result.matchedPolicy?.name;
          ctx.metadata.blockReason = result.message;
          ctx.metadata.statusCode = 403;
          ctx.metadata.errorMessage =
            result.message ?? `Blocked by policy: ${result.matchedPolicy?.name}`;
          return "block";

        case "redact":
          if (phase === "request") {
            ctx.messages = ctx.messages.map((m) => {
              const msg = m as { content?: string; role?: string };
              if (typeof msg.content === "string") {
                return { ...msg, content: redactPii(msg.content) };
              }
              return m;
            });
          } else if (phase === "response" && ctx.metadata.providerResponse !== undefined) {
            // Redact PII in response text
            const response = ctx.metadata.providerResponse;
            if (typeof response === "string") {
              ctx.metadata.providerResponse = redactPii(response);
            } else if (typeof response === "object" && response !== null) {
              // Deep redact string values in response object
              const obj = JSON.parse(JSON.stringify(response as Record<string, unknown>));
              function redactStrings(o: unknown): unknown {
                if (typeof o === "string") return redactPii(o);
                if (Array.isArray(o)) return o.map(redactStrings);
                if (typeof o === "object" && o !== null) {
                  const cleaned: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
                    cleaned[k] = redactStrings(v);
                  }
                  return cleaned;
                }
                return o;
              }
              ctx.metadata.providerResponse = redactStrings(obj);
            }
            ctx.metadata.redacted = true;
          }
          break;

        case "warn":
          ctx.decisions.push({
            middleware: `policy-${phase}`,
            result: "continue",
            reason: `Warning: ${result.message}`,
          });
          break;

        case "tag":
          if (!ctx.metadata.tags) ctx.metadata.tags = [];
          (ctx.metadata.tags as string[]).push(result.matchedPolicy?.name ?? "unknown");
          break;
      }

      return "continue";
    },
  };
}