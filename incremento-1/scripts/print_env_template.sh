#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# LIBERVIA — Print Environment Template
# Incremento 23 — Deploy Baseline + CI/CD
# ════════════════════════════════════════════════════════════════════════════
#
# Gera um arquivo .env.example com todas as variáveis de ambiente.
#
# Uso:
#   ./scripts/print_env_template.sh              # Print to stdout
#   ./scripts/print_env_template.sh > .env       # Save to .env file
#
# ════════════════════════════════════════════════════════════════════════════

cat << 'EOF'
# ════════════════════════════════════════════════════════════════════════════
# LIBERVIA — Environment Variables
# ════════════════════════════════════════════════════════════════════════════
# Copy this file to .env and configure the values.
# DO NOT commit .env files with real secrets to version control!
# ════════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────────
# REQUIRED
# ──────────────────────────────────────────────────────────────────────────────

# Authentication pepper for token hashing (REQUIRED)
# Must be a strong, random value. Keep this secret!
# Generate with: openssl rand -hex 32
LIBERVIA_AUTH_PEPPER=

# Admin token for /admin/* routes (REQUIRED in production)
# Generate with: openssl rand -hex 32
GATEWAY_ADMIN_TOKEN=

# ──────────────────────────────────────────────────────────────────────────────
# OPTIONAL (with defaults)
# ──────────────────────────────────────────────────────────────────────────────

# Environment (development | production | test)
# Default: development
NODE_ENV=production

# HTTP port
# Default: 3000
GATEWAY_PORT=3000

# HTTP host binding
# Default: 0.0.0.0
GATEWAY_HOST=0.0.0.0

# Data directory for tenant persistence
# Default: ./data (local) or /data (Docker)
GATEWAY_BASE_DIR=/data

# Log level (fatal | error | warn | info | debug | trace)
# Default: info
GATEWAY_LOG_LEVEL=info

# CORS origins (comma-separated)
# Default: * (allow all)
# Example: https://app.example.com,https://admin.example.com
GATEWAY_CORS_ORIGINS=*

# ──────────────────────────────────────────────────────────────────────────────
# DOCKER SPECIFIC
# ──────────────────────────────────────────────────────────────────────────────

# Container name (for run_prod.sh)
# Default: libervia-gateway
CONTAINER_NAME=libervia-gateway

# Image name (for run_prod.sh)
# Default: libervia:latest
IMAGE_NAME=libervia:latest

# Host port mapping
# Default: 3000
HOST_PORT=3000

# Data volume name
# Default: libervia-data
DATA_VOLUME=libervia-data

# ════════════════════════════════════════════════════════════════════════════
# SECURITY NOTES
# ════════════════════════════════════════════════════════════════════════════
#
# 1. NEVER commit real secrets to version control
# 2. Use different peppers for each environment (dev/staging/prod)
# 3. Rotate GATEWAY_ADMIN_TOKEN periodically
# 4. In production, use HTTPS with a reverse proxy (nginx, Traefik, etc.)
# 5. Set restrictive CORS origins in production
#
# ════════════════════════════════════════════════════════════════════════════
EOF
