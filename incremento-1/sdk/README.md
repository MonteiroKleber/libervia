# @libervia/sdk

SDK TypeScript para integração com a API Libervia.

## Instalação

```bash
npm install @libervia/sdk
```

## Uso Rápido

```typescript
import { createLiberviaClient } from '@libervia/sdk';

// Criar cliente
const client = createLiberviaClient({
  baseUrl: 'http://localhost:3000',
  token: 'your-token',
  tenantId: 'acme' // Opcional para admin, obrigatório para APIs públicas
});

// Health check (não requer autenticação)
const health = await client.health.check();
console.log(health.status); // 'ok'

// Admin operations (requer global_admin token)
const tenants = await client.admin.listTenants();
console.log(`Total tenants: ${tenants.total}`);

// Query operations (requer tenant_admin ou global_admin)
const dashboard = await client.query.getDashboard('acme');
console.log(dashboard.mandates.total);

// Public API (requer token público + tenantId)
const decisao = await client.public.criarDecisao({
  situacao: { /* ... */ },
  protocolo: { /* ... */ }
});
console.log(decisao.contrato.id);
```

## Configuração

```typescript
interface LiberviaClientOptions {
  /** URL base da API (ex: http://localhost:3000) */
  baseUrl: string;

  /** Token de autenticação */
  token: string;

  /** ID do tenant (obrigatório para APIs públicas) */
  tenantId?: string;

  /** Timeout em ms (default: 30000) */
  timeout?: number;

  /** Headers customizados */
  customHeaders?: Record<string, string>;
}
```

## APIs Disponíveis

### Health

```typescript
// Liveness probe
const health = await client.health.check();

// Readiness probe
const ready = await client.health.ready();

// Métricas
const metrics = await client.health.metrics();
```

### Admin (requer global_admin)

```typescript
// Tenants
const tenants = await client.admin.listTenants();
const tenant = await client.admin.createTenant({ id: 'acme', name: 'ACME Corp' });
await client.admin.suspendTenant('acme');
await client.admin.resumeTenant('acme');
await client.admin.deleteTenant('acme');

// Keys
const keys = await client.admin.listKeys('acme');
const newKey = await client.admin.createKey('acme', { role: 'tenant_admin' });
await client.admin.revokeKey('acme', newKey.keyId);
const rotated = await client.admin.rotateKey('acme', 'public');

// Audit
const verify = await client.admin.verifyAudit('acme');
const events = await client.admin.listEvents('acme');
```

### Query (requer tenant_admin ou global_admin)

```typescript
// Global (requer global_admin)
const allTenants = await client.query.listTenants();
const instances = await client.query.listInstances();
const metrics = await client.query.getMetrics();
const eventLog = await client.query.getEventLog({ limit: 100 });

// Por tenant
const mandates = await client.query.listMandates('acme', { limit: 10 });
const reviews = await client.query.listReviews('acme');
const consequences = await client.query.listConsequences('acme');
const dashboard = await client.query.getDashboard('acme');
```

### Public (requer token público + tenantId)

```typescript
// Decisões
const decisao = await client.public.criarDecisao(input);
const episodio = await client.public.getEpisodio(decisao.episodio_id);
await client.public.encerrarEpisodio(episodio.episodio_id);

// Eventos
const eventos = await client.public.listarEventos({ limit: 50 });

// Observações
await client.public.iniciarObservacao(episodio.episodio_id);

// Status
const status = await client.public.getEventLogStatus();
```

## Tratamento de Erros

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
  } else if (error instanceof UnauthorizedError) {
    console.log('Token inválido ou ausente');
  } else if (error instanceof ForbiddenError) {
    console.log('Permissão insuficiente');
  } else if (error instanceof TenantConflictError) {
    console.log('Conflito de tenant');
  } else if (error instanceof LiberviaError) {
    console.log(`Erro ${error.status}: ${error.message}`);
    console.log('Request ID:', error.requestId);
  }
}
```

## Request ID (Rastreabilidade)

Toda resposta inclui um `X-Request-Id` para rastreabilidade:

```typescript
const result = await client.request<DashboardResponse>(
  'GET',
  '/admin/query/acme/dashboard'
);

console.log('Data:', result.data);
console.log('Request ID:', result.metadata.requestId);
console.log('Status:', result.metadata.status);
```

## Autenticação e Tenant Identification

### Roles

- **global_admin**: Acesso total (usa `GATEWAY_ADMIN_TOKEN`)
- **tenant_admin**: Administrador do tenant (criado via `/admin/tenants/:id/keys`)
- **public**: API cognitiva (token público do tenant)

### Tenant Identification

Para rotas `/api/v1/*`, o tenant pode ser identificado via:
- Header `X-Tenant-Id` (configurado automaticamente pelo SDK)
- Path parameter em rotas tenant-scoped

**IMPORTANTE**: Se o tenant do path conflitar com o tenant do token,
o servidor retorna erro `400 TENANT_CONFLICT`.

## Licença

Proprietary - Bazari
