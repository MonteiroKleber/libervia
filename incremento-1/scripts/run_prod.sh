#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# LIBERVIA — Run Production Container
# Incremento 23 — Deploy Baseline + CI/CD
# ════════════════════════════════════════════════════════════════════════════
#
# Este script demonstra como executar o container Libervia em produção.
# Adapte conforme sua infraestrutura (Kubernetes, ECS, etc.)
#
# Uso:
#   ./scripts/run_prod.sh
#
# Requisitos:
#   - LIBERVIA_AUTH_PEPPER (obrigatório)
#   - GATEWAY_ADMIN_TOKEN (obrigatório em produção)
#
# ════════════════════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  LIBERVIA — Production Container${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# ──────────────────────────────────────────────────────────────────────────────
# VALIDATE REQUIRED ENVIRONMENT VARIABLES
# ──────────────────────────────────────────────────────────────────────────────

if [ -z "$LIBERVIA_AUTH_PEPPER" ]; then
    echo -e "${RED}❌ ERROR: LIBERVIA_AUTH_PEPPER is required${NC}"
    echo ""
    echo "Set LIBERVIA_AUTH_PEPPER before running this script:"
    echo "  export LIBERVIA_AUTH_PEPPER='your-secure-pepper-value'"
    echo ""
    exit 1
fi

if [ -z "$GATEWAY_ADMIN_TOKEN" ]; then
    echo -e "${RED}❌ ERROR: GATEWAY_ADMIN_TOKEN is required in production${NC}"
    echo ""
    echo "Set GATEWAY_ADMIN_TOKEN before running this script:"
    echo "  export GATEWAY_ADMIN_TOKEN='your-secure-admin-token'"
    echo ""
    exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ──────────────────────────────────────────────────────────────────────────────

CONTAINER_NAME="${CONTAINER_NAME:-libervia-gateway}"
IMAGE_NAME="${IMAGE_NAME:-libervia:latest}"
HOST_PORT="${HOST_PORT:-3000}"
DATA_VOLUME="${DATA_VOLUME:-libervia-data}"

# Optional environment variables with defaults
LOG_LEVEL="${GATEWAY_LOG_LEVEL:-info}"
CORS_ORIGINS="${GATEWAY_CORS_ORIGINS:-}"

# ──────────────────────────────────────────────────────────────────────────────
# BUILD IMAGE IF NOT EXISTS
# ──────────────────────────────────────────────────────────────────────────────

if [[ "$(docker images -q $IMAGE_NAME 2> /dev/null)" == "" ]]; then
    echo -e "${YELLOW}📦 Image not found, building...${NC}"

    # Navigate to project root
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

    docker build -t "$IMAGE_NAME" "$PROJECT_DIR"
    echo -e "${GREEN}✅ Image built: $IMAGE_NAME${NC}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# CREATE DATA VOLUME IF NOT EXISTS
# ──────────────────────────────────────────────────────────────────────────────

if ! docker volume inspect "$DATA_VOLUME" > /dev/null 2>&1; then
    echo -e "${YELLOW}📁 Creating data volume: $DATA_VOLUME${NC}"
    docker volume create "$DATA_VOLUME"
fi

# ──────────────────────────────────────────────────────────────────────────────
# STOP EXISTING CONTAINER IF RUNNING
# ──────────────────────────────────────────────────────────────────────────────

if [ "$(docker ps -q -f name=$CONTAINER_NAME)" ]; then
    echo -e "${YELLOW}⏹️  Stopping existing container...${NC}"
    docker stop "$CONTAINER_NAME"
fi

if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo -e "${YELLOW}🗑️  Removing existing container...${NC}"
    docker rm "$CONTAINER_NAME"
fi

# ──────────────────────────────────────────────────────────────────────────────
# RUN CONTAINER
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}🚀 Starting Libervia Gateway (production)...${NC}"
echo ""

docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "$HOST_PORT:3000" \
    -v "$DATA_VOLUME:/data" \
    -e NODE_ENV=production \
    -e LIBERVIA_AUTH_PEPPER="$LIBERVIA_AUTH_PEPPER" \
    -e GATEWAY_ADMIN_TOKEN="$GATEWAY_ADMIN_TOKEN" \
    -e GATEWAY_LOG_LEVEL="$LOG_LEVEL" \
    ${CORS_ORIGINS:+-e GATEWAY_CORS_ORIGINS="$CORS_ORIGINS"} \
    "$IMAGE_NAME"

# ──────────────────────────────────────────────────────────────────────────────
# WAIT FOR HEALTH CHECK
# ──────────────────────────────────────────────────────────────────────────────

echo -e "${YELLOW}⏳ Waiting for health check...${NC}"
sleep 3

for i in {1..10}; do
    if curl -sf http://localhost:$HOST_PORT/health > /dev/null 2>&1; then
        echo ""
        echo -e "${GREEN}✅ Libervia Gateway is healthy${NC}"
        echo ""
        echo -e "${BLUE}📋 Container Info:${NC}"
        docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo ""
        echo -e "${BLUE}📚 Endpoints:${NC}"
        echo -e "   Health:  ${GREEN}http://localhost:$HOST_PORT/health${NC}"
        echo -e "   Ready:   ${GREEN}http://localhost:$HOST_PORT/health/ready${NC}"
        echo -e "   Metrics: ${GREEN}http://localhost:$HOST_PORT/metrics${NC}"
        echo -e "   Admin:   ${GREEN}http://localhost:$HOST_PORT/admin/tenants${NC}"
        echo ""
        echo -e "${BLUE}📝 Commands:${NC}"
        echo -e "   View logs:  ${YELLOW}docker logs -f $CONTAINER_NAME${NC}"
        echo -e "   Stop:       ${YELLOW}docker stop $CONTAINER_NAME${NC}"
        echo -e "   Restart:    ${YELLOW}docker restart $CONTAINER_NAME${NC}"
        echo ""
        exit 0
    fi
    echo -e "   Attempt $i/10..."
    sleep 2
done

echo -e "${RED}❌ Health check failed${NC}"
echo ""
echo "Container logs:"
docker logs "$CONTAINER_NAME"
exit 1
