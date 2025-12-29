# ════════════════════════════════════════════════════════════════════════════
# LIBERVIA — Multi-Stage Dockerfile
# Incremento 23 — Deploy Baseline + CI/CD
# ════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────────
# STAGE 1: Build
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# STAGE 2: Production Runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root user
RUN addgroup -g 1001 libervia && \
    adduser -D -u 1001 -G libervia libervia

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy Admin UI static files
COPY --from=builder /app/gateway/ui ./dist/gateway/ui

# Create data directory
RUN mkdir -p /data && chown -R libervia:libervia /data

# Change ownership of app directory
RUN chown -R libervia:libervia /app

# Switch to non-root user
USER libervia

# ──────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT VARIABLES
# ──────────────────────────────────────────────────────────────────────────────

# Required: Authentication pepper for token hashing
# LIBERVIA_AUTH_PEPPER must be set at runtime

# Optional with defaults
ENV NODE_ENV=production
ENV GATEWAY_PORT=3000
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_BASE_DIR=/data
ENV GATEWAY_LOG_LEVEL=info

# ──────────────────────────────────────────────────────────────────────────────
# HEALTHCHECK
# ──────────────────────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${GATEWAY_PORT}/health || exit 1

# ──────────────────────────────────────────────────────────────────────────────
# EXPOSE AND ENTRYPOINT
# ──────────────────────────────────────────────────────────────────────────────
EXPOSE 3000

# Run the gateway server
CMD ["node", "dist/gateway/server-multitenant.js"]
