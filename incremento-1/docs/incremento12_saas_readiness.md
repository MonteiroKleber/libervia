# Incremento 12 — SaaS Readiness (RBAC + Key Management + Observability)

## Resumo

Este incremento implementa funcionalidades essenciais para operacao SaaS:

- **RBAC (Role-Based Access Control)**: Controle de acesso baseado em papeis
- **Key Management**: Gestao segura de chaves de autenticacao
- **Observability**: Rastreamento de requisicoes e logs estruturados

## Arquitetura

### Papeis (Roles)

```
global_admin
    |
    +-- Acesso total ao gateway
    +-- CRUD de tenants
    +-- Metricas globais
    +-- Todas as rotas admin

tenant_admin
    |
    +-- Acesso admin do proprio tenant
    +-- Audit logs
    +-- Gerenciamento de keys
    +-- Metricas do tenant

public
    |
    +-- Acesso as APIs cognitivas (/api/v1/*)
    +-- Operacoes de negocio
```

### Matriz de Autorizacao

| Rota | public | tenant_admin | global_admin |
|------|--------|--------------|--------------|
| `/api/v1/*` | OK | OK | OK |
| `/admin/tenants/:id/audit/*` | - | OK (proprio) | OK |
| `/admin/tenants/:id/keys` | - | OK (proprio) | OK |
| `/admin/tenants` (CRUD) | - | - | OK |
| `/admin/metrics` | - | - | OK |
| `/admin/instances` | - | - | OK |

## Componentes Implementados

### 1. TenantConfig.ts - Tipos de RBAC

```typescript
// Papeis disponiveis
export type TenantRole = 'public' | 'tenant_admin' | 'global_admin';

// Status de chaves
export type KeyStatus = 'active' | 'revoked';

// Estrutura de uma chave
export interface TenantAuthKey {
  keyId: string;        // Ex: key_abc123xyz
  role: TenantRole;
  tokenHash: string;    // SHA-256 do token
  status: KeyStatus;
  createdAt: string;    // ISO 8601
  lastUsedAt?: string;
  description?: string;
}
```

### 2. TenantSecurity.ts - Utilitarios de Seguranca

```typescript
// Gera token seguro (32 bytes base64url)
generateSecureToken(): string

// Gera ID de chave (key_xxxxx)
generateKeyId(): string

// Hash SHA-256 do token
hashToken(token: string): string

// Comparacao timing-safe de hashes
secureCompareHashes(a: string, b: string): boolean

// Valida token contra hash armazenado
validateToken(token: string, storedHash: string): boolean
```

### 3. TenantRegistry.ts - CRUD de Keys

```typescript
// Criar nova chave
createTenantKey(tenantId, role, description?): Promise<CreateKeyResult>
// Retorna { keyId, role, token, createdAt }
// Token em plaintext (unica vez que e exposto)

// Listar chaves (sem expor tokenHash)
listTenantKeys(tenantId): TenantKeyInfo[]

// Revogar chave
revokeTenantKey(tenantId, keyId): Promise<void>

// Rotacionar chave (cria nova sem revogar antiga)
rotateTenantKey(tenantId, role, description?): Promise<CreateKeyResult>

// Validar token
validateTenantToken(tenantId, token): AuthContext | null
```

### 4. authPlugin.ts - Middleware RBAC

O plugin intercepta todas as requisicoes e:

1. **Rotas publicas** (`/health`, `/metrics`): bypass
2. **Rotas admin** (`/admin/*`):
   - Rotas globais: requer `global_admin`
   - Rotas por-tenant: requer `tenant_admin` ou `global_admin`
3. **Rotas API** (`/api/v1/*`): requer token do tenant (`public` ou superior)

### 5. requestIdPlugin.ts - Observability

```typescript
// Gera ou propaga X-Request-Id
// Adiciona a todas as respostas
// Log estruturado com request timing
```

### 6. Endpoints de Keys (adminRoutes.ts)

```
POST   /admin/tenants/:id/keys          # Criar chave
GET    /admin/tenants/:id/keys          # Listar chaves
POST   /admin/tenants/:id/keys/:keyId/revoke  # Revogar
POST   /admin/tenants/:id/keys/rotate   # Rotacionar
```

## Seguranca

### Armazenamento de Tokens

- Tokens NUNCA sao armazenados em plaintext
- Apenas hash SHA-256 e persistido
- Token e retornado apenas na criacao
- Comparacao usa timing-safe equal

### Principios

1. **Menor privilegio**: Cada papel tem acesso minimo necessario
2. **Isolamento**: Tenant admin nao acessa outros tenants
3. **Auditoria**: Todas as operacoes sao logadas
4. **Rotacao**: Keys podem ser rotacionadas sem downtime

## Compatibilidade Retroativa

### apiToken Legado

Tenants existentes com `apiToken` continuam funcionando:

```typescript
// Ordem de validacao
1. Verificar contra keys (hash comparison)
2. Fallback: verificar contra apiToken (legacy)
```

O apiToken legado e tratado como role `public`.

### Migracao Recomendada

1. Criar nova key com `createTenantKey`
2. Atualizar clientes para usar nova key
3. Remover apiToken do tenant config

## Testes

### gatewayAuthRbac.test.ts (13 testes)

- Global Admin: acesso a todas as rotas
- Tenant Admin: acesso restrito ao proprio tenant
- Public: apenas APIs cognitivas
- Casos de erro: token invalido, chave revogada

### tenantKeys.test.ts (22 testes)

- Security Utils: geracao, hash, validacao
- CRUD: criar, listar, revogar, rotacionar
- Validacao: token valido/invalido/cross-tenant
- Legacy: compatibilidade com apiToken

## Uso

### Criar Tenant com Key

```bash
# 1. Criar tenant (como global_admin)
curl -X POST http://localhost:3000/admin/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "acme", "name": "ACME Corp"}'

# 2. Criar key tenant_admin
curl -X POST http://localhost:3000/admin/tenants/acme/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "tenant_admin", "description": "Admin key"}'
# Resposta: { keyId, role, token, createdAt }
# SALVAR o token - nao sera mostrado novamente!

# 3. Criar key public
curl -X POST http://localhost:3000/admin/tenants/acme/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "public", "description": "API key"}'
```

### Usar Key nas APIs

```bash
# API publica com key public
curl http://localhost:3000/api/v1/eventos \
  -H "X-Tenant-Id: acme" \
  -H "Authorization: Bearer $PUBLIC_TOKEN"

# Admin do tenant com key tenant_admin
curl http://localhost:3000/admin/tenants/acme/audit/verify \
  -H "Authorization: Bearer $TENANT_ADMIN_TOKEN"
```

### Revogar e Rotacionar

```bash
# Listar keys
curl http://localhost:3000/admin/tenants/acme/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Revogar key especifica
curl -X POST http://localhost:3000/admin/tenants/acme/keys/key_xxx/revoke \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Rotacionar (cria nova sem revogar antigas)
curl -X POST http://localhost:3000/admin/tenants/acme/keys/rotate \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "public"}'
```

## Observability

### Request ID

Todas as requisicoes incluem `X-Request-Id`:
- Se fornecido pelo cliente, e propagado
- Se nao, e gerado automaticamente
- Incluido em todos os logs estruturados

### Logs Estruturados

```json
{
  "level": "info",
  "time": 1703456789123,
  "requestId": "req_abc123",
  "tenantId": "acme",
  "method": "POST",
  "url": "/api/v1/decisoes",
  "statusCode": 200,
  "responseTime": 45
}
```

## Arquivos Criados/Modificados

### Novos
- `gateway/plugins/requestIdPlugin.ts`
- `testes/gateway/gatewayAuthRbac.test.ts`
- `testes/tenant/tenantKeys.test.ts`
- `docs/incremento12_saas_readiness.md`

### Modificados
- `tenant/TenantConfig.ts` - tipos RBAC
- `tenant/TenantSecurity.ts` - utilitarios de seguranca
- `tenant/TenantRegistry.ts` - CRUD de keys
- `gateway/plugins/authPlugin.ts` - middleware RBAC
- `gateway/routes/adminRoutes.ts` - endpoints de keys
- `gateway/app.ts` - registro do requestIdPlugin

## Proximos Passos

1. **Global Admin Keys**: Suporte a multiplas keys global_admin via config/global.json
2. **Key Expiration**: Adicionar expirationAt opcional
3. **Rate Limiting por Key**: Limites diferenciados por role
4. **Audit Log Detalhado**: Registrar uso de cada key
5. **Dashboard de Keys**: UI para gerenciamento visual
