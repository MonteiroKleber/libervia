# Incremento 22 — API Contract + SDK (Developer Preview Ready)

## Visão Geral

Este incremento formaliza o contrato da API Libervia através de uma especificação OpenAPI 3.0 e disponibiliza um SDK TypeScript para integração.

## Público-Alvo

- **Desenvolvedores de clientes**: Integradores que consomem a API Libervia
- **Equipes de produto**: Para entender as capacidades da plataforma
- **QA/DevOps**: Para validação e monitoramento

## Estrutura de Arquivos

```
incremento-1/
├── docs/
│   └── openapi.yaml          # Especificação OpenAPI 3.0
├── sdk/
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── index.ts          # Entry point
│       ├── client.ts         # Cliente HTTP
│       ├── types.ts          # DTOs e interfaces
│       └── errors.ts         # Erros tipados
├── examples/
│   ├── node-basic.ts         # Exemplo básico
│   ├── admin-create-tenant.ts # Criar tenant e keys
│   └── tenant-flow.ts        # Fluxo completo de decisão
└── testes/
    ├── incremento22_sdk.test.ts     # Testes do SDK
    └── incremento22_openapi.test.ts # Validação spec-rotas
```

## Autenticação

### Roles

| Role | Descrição | Acesso |
|------|-----------|--------|
| `global_admin` | Administrador global | Todas as rotas |
| `tenant_admin` | Administrador do tenant | Rotas do próprio tenant |
| `public` | API cognitiva | Rotas `/api/v1/*` do tenant |

### Obtenção de Tokens

```bash
# Token global_admin
# Configurado via GATEWAY_ADMIN_TOKEN

# Token tenant_admin ou public
curl -X POST http://localhost:3000/admin/tenants/acme/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "tenant_admin", "description": "Admin key"}'
```

### Uso do Token

```http
Authorization: Bearer <token>
```

## Identificação de Tenant

### Header X-Tenant-Id

Para rotas `/api/v1/*`, o tenant é identificado via header:

```http
X-Tenant-Id: acme
```

### Conflito de Tenant

Se o tenant do path conflitar com o tenant do token, retorna:

```json
{
  "error": "Bad Request",
  "code": "TENANT_CONFLICT",
  "message": "Tenant in path does not match tenant in token"
}
```

## Rastreabilidade (X-Request-Id)

Toda resposta inclui header `X-Request-Id`:

```http
X-Request-Id: abc123-def456
```

Você pode enviar seu próprio ID:

```http
X-Request-Id: my-correlation-id
```

## Uso do SDK

### Instalação

```bash
npm install @libervia/sdk
```

### Exemplo Básico

```typescript
import { createLiberviaClient } from '@libervia/sdk';

const client = createLiberviaClient({
  baseUrl: 'http://localhost:3000',
  token: 'my-admin-token',
  tenantId: 'acme'  // Opcional para admin
});

// Health check
const health = await client.health.check();

// Listar tenants (global_admin)
const tenants = await client.admin.listTenants();

// Dashboard do tenant
const dashboard = await client.query.getDashboard('acme');

// Criar decisão (requer tenantId)
const decisao = await client.public.criarDecisao({
  situacao: { /* ... */ },
  protocolo: { /* ... */ }
});
```

### Tratamento de Erros

```typescript
import {
  LiberviaError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  TenantConflictError
} from '@libervia/sdk';

try {
  await client.admin.getTenant('nonexistent');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Tenant não encontrado');
    console.log('Request ID:', error.requestId);
  } else if (error instanceof ForbiddenError) {
    console.log('Permissão insuficiente');
  }
}
```

### Acessar Request ID

```typescript
const result = await client.request<DashboardResponse>(
  'GET',
  '/admin/query/acme/dashboard'
);

console.log('Data:', result.data);
console.log('Request ID:', result.metadata.requestId);
```

## Endpoints Principais

### Health (Público)

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/health` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/metrics` | Métricas do sistema |

### Admin (global_admin)

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/admin/tenants` | Lista tenants |
| POST | `/admin/tenants` | Cria tenant |
| GET | `/admin/tenants/:id` | Detalhes do tenant |
| PATCH | `/admin/tenants/:id` | Atualiza tenant |
| DELETE | `/admin/tenants/:id` | Remove tenant |
| POST | `/admin/tenants/:id/suspend` | Suspende tenant |
| POST | `/admin/tenants/:id/resume` | Reativa tenant |

### Keys (tenant_admin ou global_admin)

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/admin/tenants/:id/keys` | Lista chaves |
| POST | `/admin/tenants/:id/keys` | Cria chave |
| POST | `/admin/tenants/:id/keys/:keyId/revoke` | Revoga chave |
| POST | `/admin/tenants/:id/keys/rotate` | Rotaciona chave |

### Query (tenant_admin ou global_admin)

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/admin/query/tenants` | Lista tenants (global) |
| GET | `/admin/query/instances` | Instâncias ativas (global) |
| GET | `/admin/query/metrics` | Métricas (global) |
| GET | `/admin/query/:tenantId/mandates` | Mandatos do tenant |
| GET | `/admin/query/:tenantId/reviews` | Reviews do tenant |
| GET | `/admin/query/:tenantId/dashboard` | Dashboard do tenant |

### Public API (public + tenantId)

| Método | Path | Descrição |
|--------|------|-----------|
| POST | `/api/v1/decisoes` | Cria decisão |
| GET | `/api/v1/episodios/:id` | Status do episódio |
| POST | `/api/v1/episodios/:id/encerrar` | Encerra episódio |
| GET | `/api/v1/eventos` | Lista eventos |
| POST | `/api/v1/observacoes` | Inicia observação |

## Códigos de Erro

| Status | Code | Descrição |
|--------|------|-----------|
| 401 | `MISSING_TOKEN` | Token não fornecido |
| 401 | `INVALID_TOKEN` | Token inválido |
| 403 | `INSUFFICIENT_ROLE` | Role insuficiente |
| 400 | `TENANT_CONFLICT` | Conflito de tenant |
| 404 | `NOT_FOUND` | Recurso não encontrado |

## Segurança

### Práticas Recomendadas

1. **Não armazene tokens em localStorage** - Use apenas memória
2. **Rotacione tokens periodicamente** - Use `/keys/rotate`
3. **Revogue tokens comprometidos** - Use `/keys/:keyId/revoke`
4. **Use HTTPS em produção**
5. **Valide X-Request-Id para auditoria**

### RBAC

O sistema implementa RBAC em 3 níveis:

```
global_admin
    └── Acesso total a todas as rotas

tenant_admin
    └── Acesso às rotas do próprio tenant

public
    └── Acesso às APIs cognitivas do tenant
```

## Testes

### Rodar testes do SDK

```bash
npm test -- incremento22
```

### Validar OpenAPI vs Rotas

Os testes em `incremento22_openapi.test.ts` validam que:
- Todos os paths da spec existem no gateway
- Schemas estão corretamente definidos
- Security requirements estão configurados

## Exemplos

### Executar exemplos

```bash
# Básico
ADMIN_TOKEN=xxx npx ts-node examples/node-basic.ts

# Criar tenant
ADMIN_TOKEN=xxx npx ts-node examples/admin-create-tenant.ts

# Fluxo completo
ADMIN_TOKEN=xxx npx ts-node examples/tenant-flow.ts
```

## Changelog

### v1.0.0 (Inc 22)
- OpenAPI 3.0 spec completa
- SDK TypeScript com zero dependências externas
- Erros tipados com requestId
- Exemplos executáveis
- Testes de validação spec-rotas
