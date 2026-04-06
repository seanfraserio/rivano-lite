import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import type { ProxyConfig, ProviderConfig, PipelineContext, Provider } from "@rivano/core";
import { Pipeline } from "./pipeline.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { createInjectionMiddleware } from "./middleware/injection.js";
import { createPolicyMiddleware } from "./middleware/policy.js";
import { createCacheMiddleware } from "./middleware/cache.js";
import { createAuditMiddleware } from "./middleware/audit.js";
import { createProvider, detectProvider, type ProviderFn, type ProviderResponse } from "./providers/index.js";

interface ProxyStats {
  requests: number;
  cacheHits: number;
  blocks: number;
  startedAt: number;
}

export function createProxyServer(
  config: ProxyConfig,
  providers: Record<string, ProviderConfig>,
): FastifyInstance {
  const app = Fastify({ logger: true });
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
    createCacheMiddleware(config.cache),
    createPolicyMiddleware(config.policies, "response"),
    createAuditMiddleware(),
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

    const path = request.url;
    const providerName =
      (request.headers["x-rivano-provider"] as string) ?? detectProvider(path);

    if (!providerName) {
      return reply.status(400).send({ error: "Unable to detect provider from path" });
    }

    const providerFn = providerFns.get(providerName);
    if (!providerFn) {
      return reply.status(400).send({ error: `Provider not configured: ${providerName}` });
    }

    const body = request.body as { model?: string; messages?: unknown[] };

    const ctx: PipelineContext = {
      id: crypto.randomUUID(),
      provider: providerName as Provider,
      model: body.model ?? "unknown",
      messages: body.messages ?? [],
      decisions: [],
      startTime: Date.now(),
      metadata: {
        ip: request.ip,
        path,
      },
    };

    const requestResult = await requestPipeline.execute(ctx);

    if (requestResult === "block") {
      stats.blocks++;
      const statusCode = (ctx.metadata.statusCode as number) ?? 403;
      return reply.status(statusCode).send({
        error: ctx.metadata.errorMessage ?? "Request blocked",
        blocked_by: ctx.metadata.blockedBy,
      });
    }

    if (requestResult === "short-circuit" && ctx.metadata.cacheHit) {
      stats.cacheHits++;
      ctx.metadata.providerResponse = ctx.metadata.providerResponse;
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
      const message = err instanceof Error ? err.message : "Provider request failed";
      return reply.status(502).send({ error: message });
    }

    if (providerResponse.stream) {
      reply.raw.writeHead(providerResponse.status, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const reader = providerResponse.stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
      } finally {
        reply.raw.end();
      }

      await responsePipeline.execute(ctx);
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
