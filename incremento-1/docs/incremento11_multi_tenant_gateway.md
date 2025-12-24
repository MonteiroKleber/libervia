# Incremento 11 — Multi-Tenant Gateway HTTP

## Resumo

Gateway HTTP multi-tenant para o sistema Libervia, conectando requisicoes externas a infraestrutura de Camada 6 (TenantRegistry, TenantRuntime, TenantRouter, TenantAdminAPI).

**Framework**: Fastify v5.x
**Regra absoluta**: ZERO modificacoes na Camada 3 (Core Cognitivo)

## Arquitetura

```
                    ┌─────────────────────────────────────────┐
                    │         server-multitenant.ts           │
                    │  (Entrypoint HTTP - porta 3000)         │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
    ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
    │  API Publica    │   │   API Admin      │   │   Health/Metrics │
    │  /api/v1/...    │   │   /admin/...     │   │   /health, etc   │
    └────────┬────────┘   └────────┬─────────┘   └─────────────────┘
             │                     │
             ▼                     ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                      TenantRouter                           │
    │  (extrai tenantId de header/path/subdomain)                 │
    └────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                      TenantRuntime                          │
    │  (getOrCreate → CoreInstance com orquestrador isolado)      │
    └─────────────────────────────────────────────────────────────┘
```

## Estrutura de Arquivos

```
gateway/
├── GatewayConfig.ts          # Configuracao centralizada
├── app.ts                    # Factory do Fastify app (testavel)
├── server-multitenant.ts     # Entrypoint principal
├── index.ts                  # Barrel exports
├── plugins/
│   ├── tenantPlugin.ts       # Resolve tenant + valida status
│   ├── authPlugin.ts         # Autenticacao Bearer token
│   └── rateLimitPlugin.ts    # Rate limiting por tenant
└── routes/
    ├── index.ts              # Barrel exports
    ├── healthRoutes.ts       # Health checks e metricas
    ├── adminRoutes.ts        # API administrativa
    └── publicRoutes.ts       # Rotas cognitivas (/api/v1)
```

## Configuracao

```typescript
interface GatewayConfig {
  port: number;           // default: 3000
  host: string;           // default: '0.0.0.0'
  baseDir: string;        // default: './data'
  adminToken: string;     // obrigatorio em prod
  corsOrigins: string[];  // origens permitidas
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
```

### Variaveis de Ambiente

```bash
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0
GATEWAY_BASE_DIR=./data
GATEWAY_ADMIN_TOKEN=secret-admin-token
GATEWAY_CORS_ORIGINS=*
NODE_ENV=production
LOG_LEVEL=info
```

## Rotas

### Health Check (Publicas)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/health` | Liveness probe |
| GET | `/health/ready` | Readiness probe (registry loaded) |
| GET | `/metrics` | Metricas do sistema |

### API Administrativa (`/admin/*`)

Todas requerem `Authorization: Bearer <adminToken>`

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/admin/tenants` | Listar tenants |
| POST | `/admin/tenants` | Registrar tenant |
| GET | `/admin/tenants/:id` | Detalhes do tenant |
| PATCH | `/admin/tenants/:id` | Atualizar tenant |
| POST | `/admin/tenants/:id/suspend` | Suspender |
| POST | `/admin/tenants/:id/resume` | Reativar |
| DELETE | `/admin/tenants/:id` | Remover (soft delete) |
| GET | `/admin/tenants/:id/audit/verify` | Verificar cadeia |
| GET | `/admin/tenants/:id/audit/export` | Exportar eventos |
| GET | `/admin/tenants/:id/audit/replay` | Replay operacional |
| GET | `/admin/metrics` | Metricas globais |
| GET | `/admin/health` | Health check global |
| GET | `/admin/instances` | Listar instancias ativas |

### API Publica (`/api/v1/*`)

Requer identificacao de tenant (header/path/subdomain) e `Authorization: Bearer <apiToken>`

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/v1/decisoes` | Solicitar decisao (fluxo completo) |
| GET | `/api/v1/episodios/:id` | Status de episodio |
| GET | `/api/v1/eventos` | Listar eventos do EventLog |
| POST | `/api/v1/observacoes` | Iniciar observacao |
| GET | `/api/v1/eventlog/status` | Status do EventLog |

## Identificacao de Tenant

O gateway suporta tres estrategias de extracao de tenantId:

1. **Header**: `X-Tenant-Id: acme-corp`
2. **Path**: `/api/v1/tenants/acme-corp/decisoes`
3. **Subdomain**: `acme-corp.api.example.com`

### Regras de Precedencia e Conflito

**Header e a fonte de verdade**: Se o header `X-Tenant-Id` estiver presente, ele SEMPRE prevalece.

**Fallback**: Path e subdomain sao usados apenas se o header NAO estiver presente.

**Deteccao de Conflito**: Se o header existir E tambem houver tenant detectavel em path ou subdomain com valor DIFERENTE, o gateway retorna erro:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Tenant ID conflict",
  "code": "TENANT_CONFLICT",
  "message": "Conflicting tenant IDs detected. Header X-Tenant-Id must match path/subdomain if both are present.",
  "details": {
    "headerTenant": "acme",
    "pathTenant": "globex"
  }
}
```

**Valores Iguais**: Se header e path/subdomain tiverem o mesmo valor, segue normalmente sem erro.

### Exemplos

| Header | Path | Subdomain | Resultado |
|--------|------|-----------|-----------|
| `acme` | - | - | OK: usa `acme` |
| - | `acme` | - | OK: usa `acme` |
| - | - | `acme.libervia.io` | OK: usa `acme` |
| `acme` | `globex` | - | **ERRO 400**: TENANT_CONFLICT |
| `acme` | - | `globex.libervia.io` | **ERRO 400**: TENANT_CONFLICT |
| `acme` | `acme` | - | OK: usa `acme` |
| `acme` | - | `acme.libervia.io` | OK: usa `acme` |

## Autenticacao

### Admin API

Usa Bearer token global configurado em `GATEWAY_ADMIN_TOKEN`:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants
```

### Tenant API

Cada tenant recebe um `apiToken` unico ao ser registrado:

```bash
# Registrar tenant (retorna apiToken)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"acme","name":"ACME Corp"}' \
  http://localhost:3000/admin/tenants

# Usar API do tenant
curl -H "X-Tenant-Id: acme" \
  -H "Authorization: Bearer $API_TOKEN" \
  http://localhost:3000/api/v1/eventos
```

## Rate Limiting

Configurado por tenant via `TenantQuotas.rateLimitRpm`:

- Headers retornados: `X-RateLimit-Limit`, `X-RateLimit-Remaining`
- Retorna 429 quando excedido
- Reset a cada minuto

## Plugins Fastify

### tenantPlugin

- Decora `request.tenantId` e `request.tenantInstance`
- Valida existencia e status do tenant
- Retorna 400/403/404 conforme o caso

### authPlugin

- Verifica Bearer token para rotas admin
- Verifica apiToken do tenant para rotas publicas
- Usa comparacao timing-safe para prevenir ataques

### rateLimitPlugin

- Bucket por tenant com reset a cada minuto
- Usa quotas configuradas no TenantConfig
- Headers padrao de rate limiting

## Uso Programatico

```typescript
import { buildApp, loadConfig } from './gateway';

const config = loadConfig();
const app = await buildApp({ config });

await app.listen({ port: config.port, host: config.host });
```

### Para Testes

```typescript
import { buildApp } from './gateway/app';

const app = await buildApp({
  config: {
    port: 0,
    host: '127.0.0.1',
    baseDir: './test-data',
    adminToken: 'test-token',
    corsOrigins: ['*'],
    nodeEnv: 'test',
    logLevel: 'error'
  }
});

const response = await app.inject({
  method: 'GET',
  url: '/health'
});

await app.close();
```

## Testes

35 testes automatizados cobrindo:

- **gatewayRouting.test.ts**: Extracao de tenant, autenticacao, health checks, **deteccao de conflitos**
- **gatewayIsolation.test.ts**: Isolamento de dados entre tenants
- **gatewayAdmin.test.ts**: CRUD de tenants, suspend/resume, audit

## Dependencias

```json
{
  "fastify": "^5.2.2",
  "@fastify/cors": "^11.0.0",
  "fastify-plugin": "^5.0.1"
}
```

## Modificacoes na Camada 6

Unica modificacao necessaria:

**TenantConfig.ts**: Adicionado campo `apiToken?: string`
**TenantRegistry.ts**: Persiste `apiToken` ao registrar tenant

## Garantias

- Isolamento completo de dados por tenant (dataDir separado)
- Validacao rigorosa de tenantId (previne path traversal)
- Autenticacao por token (admin e tenant)
- Rate limiting por tenant
- Core Cognitivo (Camada 3) inalterado
- Graceful shutdown com cleanup de instancias
