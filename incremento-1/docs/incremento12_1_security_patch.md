# INCREMENTO 12.1 — Security Patch

## Resumo

Patch de seguranca que fortalece a autenticacao de tokens no sistema multi-tenant.

**Mudancas principais:**
1. **HMAC-SHA-256 com pepper** em vez de SHA-256 puro
2. **Comparacao correta de bytes hex** (timing-safe)
3. **apiToken legado timing-safe** usando secureCompare
4. **Boot requirement** para LIBERVIA_AUTH_PEPPER

---

## Motivacao

### Problema 1: SHA-256 puro sem salt/pepper
Tokens hashados apenas com SHA-256 sao vulneraveis a:
- Rainbow tables
- Hash collision attacks (teorico)
- Timing attacks na comparacao

### Problema 2: Comparacao de strings UTF-8
A comparacao `crypto.timingSafeEqual` estava sendo feita com buffers UTF-8:
```typescript
// INCORRETO - compara bytes UTF-8 do hex string
const buf1 = Buffer.from(hash1, 'utf8');  // 64 bytes (caracteres)
const buf2 = Buffer.from(hash2, 'utf8');  // 64 bytes (caracteres)
```

Deveria comparar os bytes reais do hash:
```typescript
// CORRETO - compara os 32 bytes reais do hash
const buf1 = Buffer.from(hash1, 'hex');   // 32 bytes (hash real)
const buf2 = Buffer.from(hash2, 'hex');   // 32 bytes (hash real)
```

### Problema 3: apiToken legado sem timing-safe
O fallback para `apiToken` legado usava comparacao direta de strings.

---

## Implementacao

### 1. Novas funcoes em TenantSecurity.ts

```typescript
// Pepper management
getAuthPepper(): string        // Le LIBERVIA_AUTH_PEPPER, lanca erro se nao existir
clearPepperCache(): void       // Limpa cache do pepper (para testes)

// Token hashing
hmacToken(token: string): string     // HMAC-SHA-256 com pepper (NOVO PADRAO)
sha256Token(token: string): string   // SHA-256 puro (LEGACY)
hashToken(token: string): string     // Alias para sha256Token (deprecated)

// Comparacao timing-safe
secureCompareHashes(h1, h2): boolean // Compara hashes hex (bytes reais)
secureCompare(a, b): boolean         // Compara strings (para apiToken legado)

// Validacao dual-verify
validateToken(token, storedHash): boolean  // HMAC primeiro, SHA-256 fallback
```

### 2. Dual-Verify Strategy

Para manter compatibilidade com keys existentes:

```typescript
function validateToken(token: string, storedHash: string): boolean {
  // 1. Tentar HMAC (novo padrao)
  try {
    const hmacHash = hmacToken(token);
    if (secureCompareHashes(hmacHash, storedHash)) {
      return true;
    }
  } catch {}

  // 2. Fallback: SHA-256 puro (legacy)
  const sha256Hash = sha256Token(token);
  return secureCompareHashes(sha256Hash, storedHash);
}
```

### 3. Boot Requirement

Gateway recusa iniciar sem pepper configurado:

```typescript
// Em app.ts buildApp()
try {
  getAuthPepper();
} catch (err) {
  throw new Error(
    `[Gateway Boot] ${(err as Error).message}\n` +
    'Set LIBERVIA_AUTH_PEPPER environment variable before starting the gateway.'
  );
}
```

---

## Configuracao

### Variavel de ambiente obrigatoria

```bash
# Gerar um pepper seguro (32+ caracteres recomendado)
export LIBERVIA_AUTH_PEPPER="$(openssl rand -base64 32)"

# Minimo: 16 caracteres
export LIBERVIA_AUTH_PEPPER="my-super-secret-pepper-1234567890"
```

### Requisitos do pepper
- Minimo 16 caracteres
- Recomendado 32+ caracteres
- Deve ser unico por ambiente (dev/staging/prod)
- NAO deve ser commitado no codigo
- Deve estar em secrets manager em producao

---

## Migracao de Keys Existentes

### Keys criadas antes do 12.1
- Continuam funcionando via fallback SHA-256
- Nao requerem migracao imediata
- Recomendado rotacionar gradualmente

### Novas keys (pos-12.1)
- Hashadas com HMAC-SHA-256
- Mais seguras contra rainbow tables
- Requerem pepper no servidor

### apiToken legado
- Continua funcionando
- Comparacao agora e timing-safe
- Recomendado migrar para sistema de keys

---

## Testes

### Testes adicionados

1. **Gateway boot sem pepper** - Deve falhar com erro claro
2. **Gateway boot com pepper curto** - Deve falhar (<16 chars)
3. **Validacao de token HMAC** - Novas keys funcionam
4. **Fallback SHA-256** - Keys antigas funcionam
5. **apiToken timing-safe** - Tokens legados funcionam

### Executar testes

```bash
# Testes de gateway (inclui boot requirements)
npm test -- --testPathPattern="gateway/"

# Testes de keys
npm test -- --testPathPattern="tenant/tenantKeys"
```

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `tenant/TenantSecurity.ts` | +getAuthPepper, +hmacToken, +secureCompare*, +validateToken |
| `tenant/TenantRegistry.ts` | createTenantKey usa hmacToken, validateTenantToken usa validateToken |
| `gateway/plugins/authPlugin.ts` | validateGlobalAdminToken usa validateToken e secureCompare |
| `gateway/app.ts` | Boot check para LIBERVIA_AUTH_PEPPER |
| `testes/gateway/*.test.ts` | Setup de pepper em beforeAll/afterAll |
| `testes/tenant/tenantKeys.test.ts` | Setup de pepper, teste de dual-verify |

---

## Seguranca

### Protecoes implementadas

1. **Rainbow tables**: Pepper unico por instalacao
2. **Timing attacks**: secureCompareHashes com bytes reais
3. **Brute force**: HMAC mais lento que SHA-256 puro
4. **Downgrade attack**: HMAC tentado primeiro, SHA-256 so como fallback

### Limitacoes conhecidas

1. Keys antigas continuam com SHA-256 (necessario para compatibilidade)
2. Pepper e compartilhado entre todas as keys (por design)
3. Rotacao de pepper requer re-hash de todas as keys

---

## Checklist de Deploy

- [ ] Gerar LIBERVIA_AUTH_PEPPER unico para o ambiente
- [ ] Adicionar ao secrets manager (nao commitar!)
- [ ] Configurar em todas as instancias do gateway
- [ ] Testar boot do gateway
- [ ] Verificar que keys existentes continuam funcionando
- [ ] Monitorar logs por "Invalid token" excessivos
