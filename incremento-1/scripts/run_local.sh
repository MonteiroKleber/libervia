#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# LIBERVIA — Run Local Development with Docker Compose
# Incremento 23 — Deploy Baseline + CI/CD
# ════════════════════════════════════════════════════════════════════════════
#
# Uso:
#   ./scripts/run_local.sh              # Start with defaults
#   ./scripts/run_local.sh --build      # Rebuild image before starting
#   ./scripts/run_local.sh --logs       # Start and follow logs
#   ./scripts/run_local.sh --stop       # Stop the containers
#   ./scripts/run_local.sh --clean      # Stop and remove volumes
#
# ════════════════════════════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Navigate to project root (incremento-1)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  LIBERVIA — Local Development Environment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# ──────────────────────────────────────────────────────────────────────────────
# CHECK REQUIRED ENVIRONMENT VARIABLES
# ──────────────────────────────────────────────────────────────────────────────

if [ -z "$LIBERVIA_AUTH_PEPPER" ]; then
    # Generate a random pepper for development if not set
    export LIBERVIA_AUTH_PEPPER="dev-pepper-$(date +%s)-$RANDOM"
    echo -e "${YELLOW}⚠️  LIBERVIA_AUTH_PEPPER not set, using generated value for dev${NC}"
    echo -e "${YELLOW}   Pepper: ${LIBERVIA_AUTH_PEPPER:0:20}...${NC}"
fi

if [ -z "$GATEWAY_ADMIN_TOKEN" ]; then
    export GATEWAY_ADMIN_TOKEN="admin-token-dev"
    echo -e "${YELLOW}⚠️  GATEWAY_ADMIN_TOKEN not set, using: admin-token-dev${NC}"
fi

# ──────────────────────────────────────────────────────────────────────────────
# PARSE ARGUMENTS
# ──────────────────────────────────────────────────────────────────────────────

BUILD_FLAG=""
FOLLOW_LOGS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --build)
            BUILD_FLAG="--build"
            shift
            ;;
        --logs)
            FOLLOW_LOGS=true
            shift
            ;;
        --stop)
            echo -e "${YELLOW}Stopping containers...${NC}"
            docker-compose down
            echo -e "${GREEN}✅ Containers stopped${NC}"
            exit 0
            ;;
        --clean)
            echo -e "${YELLOW}Stopping containers and removing volumes...${NC}"
            docker-compose down -v
            echo -e "${GREEN}✅ Containers and volumes removed${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--build] [--logs] [--stop] [--clean]"
            exit 1
            ;;
    esac
done

# ──────────────────────────────────────────────────────────────────────────────
# START CONTAINERS
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}🚀 Starting Libervia Gateway...${NC}"
echo ""

if [ "$FOLLOW_LOGS" = true ]; then
    docker-compose up $BUILD_FLAG
else
    docker-compose up -d $BUILD_FLAG

    echo ""
    echo -e "${GREEN}✅ Libervia Gateway started${NC}"
    echo ""
    echo -e "${BLUE}📋 Container Status:${NC}"
    docker-compose ps
    echo ""
    echo -e "${BLUE}📚 Endpoints:${NC}"
    echo -e "   Health:  ${GREEN}http://localhost:3000/health${NC}"
    echo -e "   Ready:   ${GREEN}http://localhost:3000/health/ready${NC}"
    echo -e "   Metrics: ${GREEN}http://localhost:3000/metrics${NC}"
    echo -e "   Admin:   ${GREEN}http://localhost:3000/admin/tenants${NC}"
    echo -e "   UI:      ${GREEN}http://localhost:3000/admin/ui/${NC}"
    echo ""
    echo -e "${BLUE}📝 Commands:${NC}"
    echo -e "   View logs:     ${YELLOW}docker-compose logs -f${NC}"
    echo -e "   Stop:          ${YELLOW}./scripts/run_local.sh --stop${NC}"
    echo -e "   Clean:         ${YELLOW}./scripts/run_local.sh --clean${NC}"
    echo ""
fi
