# Incremento 23 — Deploy Baseline + CI/CD (SaaS-ready)

## Visão Geral

Este incremento entrega um baseline operacional "rodável" para dev/staging/prod:
- Containerização Docker do gateway + Admin UI
- Configuração de ambiente e hardening de runtime
- CI pipeline (build + test + lint + artifact) via GitHub Actions
- Documentação de deploy cloud-agnostic

## Arquitetura Docker

### Multi-Stage Build

```
┌────────────────────────────────────────────────────────────────┐
│  STAGE 1: Builder (node:20-alpine)                              │
│  ├── npm ci (todas as dependências)                             │
│  ├── npm run build (TypeScript → JavaScript)                    │
│  └── Gera /app/dist/                                            │
├────────────────────────────────────────────────────────────────┤
│  STAGE 2: Runtime (node:20-alpine)                              │
│  ├── npm ci --only=production                                   │
│  ├── COPY dist/ e gateway/ui/                                   │
│  ├── Non-root user (libervia:libervia)                          │
│  ├── Healthcheck integrado                                      │
│  └── Expõe porta 3000                                           │
└────────────────────────────────────────────────────────────────┘
```

### Imagem Final

- **Base**: `node:20-alpine` (~180MB)
- **Usuário**: `libervia` (UID 1001, non-root)
- **Porta**: 3000
- **Volume**: `/data` (persistência de tenants)

## Execução Local

### Usando Docker Compose

```bash
# 1. Definir variáveis obrigatórias
export LIBERVIA_AUTH_PEPPER=$(openssl rand -hex 32)
export GATEWAY_ADMIN_TOKEN=$(openssl rand -hex 32)

# 2. Subir o gateway
./scripts/run_local.sh

# Ou com rebuild da imagem
./scripts/run_local.sh --build

# Ou seguindo logs
./scripts/run_local.sh --logs

# Parar
./scripts/run_local.sh --stop

# Limpar volumes
./scripts/run_local.sh --clean
```

### Usando Docker Compose Diretamente

```bash
# Start
docker-compose up -d

# Logs
docker-compose logs -f

# Status
docker-compose ps

# Stop
docker-compose down

# Clean (remove volumes)
docker-compose down -v
```

### Endpoints Disponíveis

| Endpoint | Descrição |
|----------|-----------|
| http://localhost:3000/health | Liveness probe |
| http://localhost:3000/health/ready | Readiness probe |
| http://localhost:3000/metrics | Métricas do sistema |
| http://localhost:3000/admin/ui/ | Admin UI (Painel Operacional) |
| http://localhost:3000/admin/tenants | API Admin |
| http://localhost:3000/api/v1/* | API Pública |

## Execução em Produção

### Usando o Script de Produção

```bash
# 1. Configurar variáveis (OBRIGATÓRIO)
export LIBERVIA_AUTH_PEPPER="seu-pepper-super-secreto"
export GATEWAY_ADMIN_TOKEN="seu-token-admin-secreto"

# 2. Executar
./scripts/run_prod.sh
```

### Usando Docker Run Diretamente

```bash
# Build da imagem
docker build -t libervia:latest .

# Criar volume de dados
docker volume create libervia-data

# Executar container
docker run -d \
  --name libervia-gateway \
  --restart unless-stopped \
  -p 3000:3000 \
  -v libervia-data:/data \
  -e NODE_ENV=production \
  -e LIBERVIA_AUTH_PEPPER="$LIBERVIA_AUTH_PEPPER" \
  -e GATEWAY_ADMIN_TOKEN="$GATEWAY_ADMIN_TOKEN" \
  -e GATEWAY_LOG_LEVEL=info \
  libervia:latest
```

### Verificar Saúde

```bash
# Liveness
curl http://localhost:3000/health

# Readiness
curl http://localhost:3000/health/ready

# Métricas
curl -H "Authorization: Bearer $GATEWAY_ADMIN_TOKEN" \
  http://localhost:3000/metrics
```

## Variáveis de Ambiente

### Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `LIBERVIA_AUTH_PEPPER` | Pepper para hash de tokens. **Obrigatório no boot.** |
| `GATEWAY_ADMIN_TOKEN` | Token para rotas `/admin/*`. **Obrigatório em produção.** |

### Opcionais

| Variável | Default | Descrição |
|----------|---------|-----------|
| `NODE_ENV` | `development` | Ambiente (development/production/test) |
| `GATEWAY_PORT` | `3000` | Porta HTTP |
| `GATEWAY_HOST` | `0.0.0.0` | Host de binding |
| `GATEWAY_BASE_DIR` | `/data` | Diretório de dados |
| `GATEWAY_LOG_LEVEL` | `info` | Nível de log |
| `GATEWAY_CORS_ORIGINS` | `*` | Origens CORS (comma-separated) |

### Gerar Template

```bash
./scripts/print_env_template.sh > .env
```

## Persistência de Dados

### Estrutura do Volume

```
/data/
├── tenants/
│   ├── tenant-a/
│   │   ├── tenant.json          # Configuração do tenant
│   │   ├── event-log.jsonl      # Log de eventos append-only
│   │   ├── situacoes.json       # Situações
│   │   ├── contratos.json       # Contratos
│   │   └── consequencias.json   # Consequências
│   ├── tenant-b/
│   │   └── ...
│   └── tenant-c/
│       └── ...
└── registry.json                 # Registro de tenants
```

### Backup

```bash
# Backup do volume Docker
docker run --rm \
  -v libervia-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/libervia-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v libervia-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/libervia-backup-20241227.tar.gz -C /
```

## CI/CD

### GitHub Actions Workflow

O pipeline CI (`ci.yml`) executa em cada push para `main` ou `develop`:

```
┌─────────┐     ┌──────┐     ┌──────┐     ┌─────┐     ┌────────┐
│ install │────▶│ lint │────▶│ test │────▶│ sdk │────▶│ docker │
└─────────┘     └──────┘     └──────┘     └─────┘     └────────┘
                  ▲                           │
                  │                           │
                  └───────────────────────────┘
                           (build)
```

### Jobs

| Job | Descrição |
|-----|-----------|
| `install` | Instala dependências com cache npm |
| `lint` | ESLint em modo tolerante |
| `test` | Suite Jest com cobertura |
| `build` | Compilação TypeScript |
| `sdk` | Build do SDK TypeScript |
| `docker` | Build da imagem Docker |

### Artifacts

- `coverage-report`: Relatório de cobertura de testes
- `dist`: Build compilado
- `sdk-dist`: SDK compilado

## Observabilidade

### Logs Estruturados

O Fastify já gera logs JSON estruturados:

```json
{
  "level": 30,
  "time": 1735318800000,
  "pid": 1,
  "hostname": "libervia-gateway",
  "reqId": "abc123-def456",
  "req": {
    "method": "GET",
    "url": "/health"
  },
  "res": {
    "statusCode": 200
  },
  "responseTime": 1.5
}
```

### X-Request-Id para Troubleshooting

Toda resposta inclui `X-Request-Id`:

```bash
curl -v http://localhost:3000/health
# < X-Request-Id: abc123-def456-ghi789
```

Para correlacionar erros:

1. Cliente recebe erro com `X-Request-Id`
2. Buscar nos logs: `docker logs libervia-gateway | grep "abc123-def456"`
3. Encontrar o contexto completo da requisição

### Métricas

Disponíveis em `/metrics` (requer autenticação):

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/metrics
```

Retorna:
- Uptime
- Memória (heap, rss, external)
- Contagem de tenants
- Contagem de instâncias ativas

## Segurança

### Checklist de Produção

- [ ] `LIBERVIA_AUTH_PEPPER` configurado e secreto
- [ ] `GATEWAY_ADMIN_TOKEN` configurado e secreto
- [ ] `NODE_ENV=production`
- [ ] HTTPS via reverse proxy (nginx, Traefik, etc.)
- [ ] CORS restritivo configurado
- [ ] Logs externos (CloudWatch, Datadog, etc.)
- [ ] Backup automatizado do volume `/data`

### Recomendações

1. **Nunca** armazene secrets em arquivos `.env` commitados
2. Use secrets managers (Vault, AWS Secrets Manager, etc.)
3. Rotacione `GATEWAY_ADMIN_TOKEN` periodicamente
4. Monitore logs para tentativas de acesso não autorizado
5. Configure rate limiting para produção

## Estrutura de Arquivos

```
incremento-1/
├── Dockerfile                    # Multi-stage build
├── .dockerignore                 # Arquivos excluídos do build
├── docker-compose.yml            # Compose para dev local
├── .eslintrc.js                  # ESLint config (tolerante)
├── .github/
│   └── workflows/
│       └── ci.yml                # CI pipeline
├── scripts/
│   ├── run_local.sh              # Dev com Docker Compose
│   ├── run_prod.sh               # Prod com docker run
│   └── print_env_template.sh     # Gera .env.example
└── docs/
    └── incremento23_deploy_baseline_ci.md  # Esta documentação
```

## Testes

### Smoke Test

O teste de boot verifica:
- Pepper obrigatório no ambiente
- Health check responde OK
- Request ID gerado em todas as respostas

```bash
npm test -- testes/incremento23_boot.test.ts
```

### Suite Completa

```bash
npm test
```

## Changelog

### v23.0.0

- Dockerfile multi-stage com non-root user
- Docker Compose para desenvolvimento local
- Scripts de operação (run_local.sh, run_prod.sh)
- CI/CD via GitHub Actions
- ESLint em modo tolerante
- Documentação completa de deploy
- Smoke test de boot
