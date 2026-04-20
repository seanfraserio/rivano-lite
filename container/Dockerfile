# ============================================================
# Rivano Lite — Multi-stage Bun build
# Target: <150MB uncompressed
# ============================================================

# Stage 1: Install dependencies and build backend packages
FROM oven/bun:1-alpine AS builder

WORKDIR /build

# Copy workspace config first (cache layer for deps)
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/proxy/package.json packages/proxy/
COPY packages/observer/package.json packages/observer/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/webui/package.json packages/webui/

# Install deps with Bun
RUN bun install

# Copy source
COPY tsconfig.json ./
COPY packages/ packages/

# Build each package in dependency order
RUN cd packages/core && bun run build && \
    cd ../engine && bun run build && \
    cd ../proxy && bun run build && \
    cd ../observer && bun run build && \
    cd ../server && bun run build

# Build WebUI (Astro static)
RUN cd packages/webui && bun install && bun run build

# Stage 2: Production runtime (minimal)
FROM oven/bun:1.2-alpine

RUN apk add --no-cache curl tini

# Create non-root user for security (UID 1001 — 1000 is taken by bun base image)
RUN adduser -D -u 1001 rivano

WORKDIR /rivano

# Copy built server bundle (fully self-contained, no node_modules needed)
COPY --from=builder /build/packages/server/dist ./dist

# Copy WebUI build output (Astro static: HTML + client JS)
COPY --from=builder /build/packages/webui/dist ./webui/dist

# Copy default config and entrypoint
COPY config/defaults/ ./defaults/
COPY container/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Data directory (mounted as volume)
RUN mkdir -p /data && chown -R rivano:rivano /data /rivano

USER rivano

# Ports: WebUI(9000), Proxy(4000), Observer(4100)
EXPOSE 9000 4000 4100

VOLUME ["/data"]

ENV RIVANO_DATA_DIR=/data
ENV RIVANO_CONFIG=/data/rivano.yaml
ENV NODE_ENV=production

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./entrypoint.sh"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:9000/health || exit 1

LABEL org.opencontainers.image.title="Rivano Lite" \
      org.opencontainers.image.description="Open source, self-hosted AI operations platform" \
      org.opencontainers.image.url="https://github.com/seanfraserio/rivano-lite" \
      org.opencontainers.image.source="https://github.com/seanfraserio/rivano-lite" \
      org.opencontainers.image.vendor="Rivano AI" \
      org.opencontainers.image.licenses="MIT"
