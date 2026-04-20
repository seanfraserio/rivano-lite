import type { ChatMessage, PipelineContext, Provider, ProviderConfig, ProxyConfig, Trace } from "@rivano/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { createAuditMiddleware } from "./middleware/audit.js";
import { createCacheMiddleware } from "./middleware/cache.js";
import { createInjectionMiddleware } from "./middleware/injection.js";
import { createPolicyMiddleware } from "./middleware/policy.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { Pipeline } from "./pipeline.js";
import { createProvider, detectProvider, type ProviderFn, type ProviderResponse } from "./providers/index.js";

const ProxyRequestBodySchema = z
  .object({
    model: z.string().optional(),
    messages: z.array(z.record(z.unknown())).optional(),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
  })
  .passthrough();

interface ProxyStats {
  requests: number;
  cacheHits: number;
  blocks: number;
  startedAt: number;
}

export interface ProxyOptions {
  onTrace?: (trace: Trace) => void;
}

export function createProxyServer(
  config: ProxyConfig,
  providers: Record<string, ProviderConfig>,
  options?: ProxyOptions,
): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 }); // 10MB max request body
  const stats: ProxyStats = { requests: 0, cacheHits: 0, blocks: 0, startedAt: Date.now() };

  const providerFns = new Map<string, ProviderFn>();
  for (const [name, providerConfig] of Object.entries(providers)) {
    providerFns.set(name, createProvider(name, providerConfig));
  }

  const requestPipeline = new Pipeline([
    createRateLimitMiddleware(config.rate_limit),
    createInjectionMiddleware(),
    createPolicyMiddleware(config.policies, "request"),
    createCacheMiddleware(config.cache),
  ]);

  const responsePipeline = new Pipeline([
    createPolicyMiddleware(config.policies, "response"),
    createCacheMiddleware(config.cache),
    createAuditMiddleware({ onTrace: options?.onTrace }),
  ]);

  app.get("/health", async () => {
    return { status: "ok", uptime: Date.now() - stats.startedAt };
  });

  app.get("/stats", async () => {
    const total = stats.requests || 1;
    return {
      requests: stats.requests,
      cacheHitRate: stats.cacheHits / total,
      blocks: stats.blocks,
      uptime: Date.now() - stats.startedAt,
    };
  });

  app.post("/*", async (request: FastifyRequest, reply: FastifyReply) => {
    stats.requests++;

    // Validate request body with Zod
    const parsed = ProxyRequestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    const path = request.url;
    const providerName =
      (request.headers["x-rivano-provider"] as string) ?? detectProvider(path) ?? config.default_provider;

    if (!providerName) {
      return reply
        .status(400)
        .send({ error: "Unable to detect provider from path and no default_provider configured" });
    }

    const providerFn = providerFns.get(providerName);
    if (!providerFn) {
      return reply.status(400).send({ error: `Provider not configured: ${providerName}` });
    }

    const ctx: PipelineContext = {
      id: crypto.randomUUID(),
      provider: providerName as Provider,
      model: body.model ?? "unknown",
      messages: (body.messages ?? []) as ChatMessage[],
      decisions: [],
      startTime: Date.now(),
      metadata: {
        ip: request.ip,
        path,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      },
    };

    const requestResult = await requestPipeline.execute(ctx);

    if (requestResult === "block") {
      stats.blocks++;
      // Still run response pipeline so audit middleware emits a trace
      await responsePipeline.execute(ctx);
      const statusCode = (ctx.metadata.statusCode as number) ?? 403;
      return reply.status(statusCode).send({
        error: ctx.metadata.errorMessage ?? "Request blocked",
        blocked_by: ctx.metadata.blockedBy,
      });
    }

    if (requestResult === "short-circuit" && ctx.metadata.cacheHit) {
      stats.cacheHits++;
      await responsePipeline.execute(ctx);
      return reply.send(ctx.metadata.providerResponse);
    }

    let providerResponse: ProviderResponse;
    try {
      const rawHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") {
          rawHeaders[key] = value;
        }
      }

      providerResponse = await providerFn(path, body, rawHeaders);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return reply.status(504).send({ error: "Provider request timed out" });
      }
      const message = err instanceof Error ? err.message : "Provider request failed";
      return reply.status(502).send({ error: message });
    }

    if (providerResponse.stream) {
      // Buffer the full stream first so response-phase policies (block/redact) can evaluate
      const chunks: Uint8Array[] = [];
      const reader = providerResponse.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } catch {
        // Stream read error — work with what we have
      }

      // Set provider response metadata for policy evaluation
      try {
        const fullBody = Buffer.concat(chunks).toString("utf-8");
        try {
          ctx.metadata.providerResponse = JSON.parse(fullBody);
        } catch {
          ctx.metadata.providerResponse = fullBody;
        }
      } catch {
        // If buffering fails, still run response pipeline with what we have
      }
      ctx.metadata.tokensIn = providerResponse.tokensIn;
      ctx.metadata.tokensOut = providerResponse.tokensOut;

      // Run response pipeline BEFORE sending — policies can block/redact
      const responseResult = await responsePipeline.execute(ctx);

      if (responseResult === "block") {
        stats.blocks++;
        const statusCode = (ctx.metadata.statusCode as number) ?? 403;
        return reply.status(statusCode).send({
          error: ctx.metadata.errorMessage ?? "Response blocked by policy",
          blocked_by: ctx.metadata.blockedBy,
        });
      }

      // Stream the (potentially redacted) response to client
      reply.raw.writeHead(providerResponse.status, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      // If response was redacted, send the modified version
      if (ctx.metadata.redacted && typeof ctx.metadata.providerResponse === "string") {
        reply.raw.write(ctx.metadata.providerResponse);
      } else {
        for (const chunk of chunks) {
          reply.raw.write(chunk);
        }
      }
      reply.raw.end();
      return;
    }

    ctx.metadata.providerResponse = providerResponse.body;
    ctx.metadata.tokensIn = providerResponse.tokensIn;
    ctx.metadata.tokensOut = providerResponse.tokensOut;

    await responsePipeline.execute(ctx);

    return reply.status(providerResponse.status).send(ctx.metadata.providerResponse);
  });

  return app;
}
