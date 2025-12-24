# Runbook: Gestao de Chaves Criptograficas

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este runbook descreve os procedimentos para:
- Geracao de pares de chaves Ed25519
- Rotacao de chaves
- Revogacao de chaves comprometidas
- Armazenamento seguro

As chaves sao usadas para:
- Assinatura de backups do EventLog
- Autenticacao do control-plane (tokens)

---

## 2. Hierarquia de Chaves

```
Root Key (offline, HSM opcional)
    |
    +---> Signing Key (backup) - rotacao anual
    |
    +---> Auth Key (control-plane) - rotacao trimestral
```

| Chave | Uso | Rotacao | Armazenamento |
|-------|-----|---------|---------------|
| Signing Key | Assinatura de backups | Anual | Secrets Manager |
| Auth Token | Autenticacao control-plane | Trimestral | Env vars |
| Root Key | Emergencia | Nunca | Offline/HSM |

---

## 3. Geracao de Chaves

### 3.1 Gerar Par de Chaves Ed25519

```bash
cd incremento-1
npm run crypto:generate-keys -- ./keys
```

Saida esperada:
```
Gerando par de chaves Ed25519...

Chave publica: ./keys/public-key-a1b2c3d4e5f67890.json
Chave privada: ./keys/private-key-a1b2c3d4e5f67890.json

Key ID: a1b2c3d4e5f67890
Expira em: 2026-12-23T00:00:00.000Z

IMPORTANTE: Nunca commitar a chave privada!
```

### 3.2 Arquivos Gerados

**Chave Publica** (`public-key-<keyId>.json`):
```json
{
  "keyId": "a1b2c3d4e5f67890",
  "publicKey": "<base64>",
  "createdAt": "2025-12-23T00:00:00.000Z",
  "expiresAt": "2026-12-23T00:00:00.000Z"
}
```

**Chave Privada** (`private-key-<keyId>.json`):
```json
{
  "keyId": "a1b2c3d4e5f67890",
  "privateKey": "<base64>",
  "createdAt": "2025-12-23T00:00:00.000Z",
  "expiresAt": "2026-12-23T00:00:00.000Z",
  "WARNING": "NUNCA COMMITAR ESTE ARQUIVO"
}
```

### 3.3 Gerar Token de Autenticacao

```bash
npx ts-node -e "
const crypto = require('crypto');
console.log('Token:', crypto.randomBytes(32).toString('hex'));
"
```

---

## 4. Configuracao de Ambiente

### 4.1 Chaves de Assinatura

```bash
# Producao (via Secrets Manager ou similar)
export LIBERVIA_SIGNING_KEY="<base64-chave-privada>"
export LIBERVIA_PUBLIC_KEY="<base64-chave-publica>"
export LIBERVIA_KEY_ID="a1b2c3d4e5f67890"
```

### 4.2 Token do Control-Plane

```bash
export CONTROL_PLANE_TOKEN="<token-hex-64-caracteres>"
export NODE_ENV="production"
```

### 4.3 Verificacao

```bash
# Verificar se chaves estao configuradas
echo $LIBERVIA_KEY_ID

# Testar assinatura
npx ts-node -e "
const { signWithEnvKey } = require('./scripts/crypto_utils');
const sig = signWithEnvKey({ test: 'data' });
console.log('Assinatura:', sig ? 'OK' : 'Chave nao disponivel');
"
```

---

## 5. Rotacao de Chaves

### 5.1 Quando Rotacionar

| Situacao | Acao |
|----------|------|
| Chave expira em < 30 dias | Iniciar rotacao |
| Suspeita de comprometimento | Rotacao imediata |
| Funcionario com acesso deixa empresa | Rotacao preventiva |
| Anualmente (signing) | Rotacao planejada |
| Trimestralmente (auth) | Rotacao planejada |

### 5.2 Procedimento de Rotacao

#### Passo 1: Gerar Nova Chave

```bash
npm run crypto:generate-keys -- ./keys-new
```

#### Passo 2: Publicar Nova Chave Publica

1. Copiar `public-key-<newKeyId>.json` para o repositorio
2. Manter chave antiga por periodo de transicao (30 dias)

#### Passo 3: Atualizar Ambiente

```bash
# Atualizar em Secrets Manager
aws secretsmanager update-secret \
  --secret-id libervia/signing-key \
  --secret-string "$(cat ./keys-new/private-key-<newKeyId>.json)"
```

#### Passo 4: Validar

```bash
# Fazer backup de teste com nova chave
npm run backup:secure -- ./data ./backup-test

# Verificar assinatura
cat ./backup-test/*.signed.json | jq '.signature.public_key_id'
# Deve mostrar o novo keyId
```

#### Passo 5: Revogar Chave Antiga (apos 30 dias)

```bash
# Remover chave publica antiga do repositorio
git rm ./keys/public-key-<oldKeyId>.json
git commit -m "Revoga chave antiga <oldKeyId>"
```

### 5.3 Periodo de Transicao

Durante a transicao (30 dias):
- Novos backups sao assinados com nova chave
- Restauracao aceita ambas as chaves
- Alertas para backups com chave antiga

---

## 6. Revogacao de Chaves

### 6.1 Cenario: Chave Comprometida

**Acoes Imediatas** (< 1 hora):

1. **Remover chave privada de todos os ambientes**
   ```bash
   # Secrets Manager
   aws secretsmanager delete-secret \
     --secret-id libervia/signing-key \
     --force-delete-without-recovery

   # Variaveis de ambiente
   unset LIBERVIA_SIGNING_KEY
   ```

2. **Gerar nova chave**
   ```bash
   npm run crypto:generate-keys -- ./keys-emergency
   ```

3. **Atualizar ambiente com nova chave**

4. **Documentar incidente**
   - Data/hora da suspeita
   - Escopo potencial
   - Acoes tomadas

5. **Verificar backups afetados**
   ```bash
   # Listar backups assinados com chave comprometida
   grep -l "<oldKeyId>" /backups/**/*.signed.json
   ```

### 6.2 Registro de Revogacao

Manter registro em `docs/estado/chaves_revogadas.md`:

```markdown
## Chaves Revogadas

| Key ID | Revogada em | Motivo | Revogado por |
|--------|-------------|--------|--------------|
| a1b2c3d4e5f67890 | 2025-12-23 | Rotacao anual | ops-admin |
| e5f6g7h8i9j01234 | 2025-12-20 | Comprometimento | security-team |
```

---

## 7. Armazenamento Seguro

### 7.1 Desenvolvimento

| Item | Local | Permissoes |
|------|-------|------------|
| Chave publica | Repositorio git | Publico |
| Chave privada | `.env.local` (gitignored) | Local apenas |
| Tokens | `.env.local` | Local apenas |

### 7.2 Staging/Producao

| Item | Local | Acesso |
|------|-------|--------|
| Chave publica | Repositorio / S3 | Equipe |
| Chave privada | AWS Secrets Manager | IAM role |
| Tokens | AWS Secrets Manager | IAM role |

### 7.3 CI/CD

| Item | Local | Acesso |
|------|-------|--------|
| Chave publica | Repositorio | Pipeline |
| Chave privada | GitHub Secrets / AWS SM | Pipeline |
| Tokens | GitHub Secrets | Pipeline |

### 7.4 Backup Offline (Root Key)

- Imprimir chave em papel
- Armazenar em cofre fisico
- Acesso restrito (2 pessoas necessarias)
- Verificar integridade anualmente

---

## 8. Monitoramento

### 8.1 Alertas

| Condicao | Nivel | Acao |
|----------|-------|------|
| Chave expira em < 30 dias | WARNING | Iniciar rotacao |
| Chave expira em < 7 dias | CRITICAL | Rotacao urgente |
| Tentativa de uso de chave revogada | CRITICAL | Investigar |
| > 10 auth falhas/hora | WARNING | Verificar origem |

### 8.2 Metricas

Via `GET /metrics/security`:

```json
{
  "failedAttemptsLast24h": 5,
  "failedAttemptsByIp": { "192.168.1.100": 3 },
  "rateLimitActiveIps": 2,
  "lastFailedAttempt": { ... }
}
```

### 8.3 Script de Verificacao

```bash
npm run operacao:metrics | jq '.alertas'
```

---

## 9. Checklist de Auditoria

### 9.1 Mensal

- [ ] Verificar expiracao de chaves
- [ ] Revisar logs de autenticacao falha
- [ ] Verificar backups assinados

### 9.2 Trimestral

- [ ] Rotacionar tokens de autenticacao
- [ ] Revisar acessos a Secrets Manager
- [ ] Testar procedimento de revogacao

### 9.3 Anual

- [ ] Rotacionar chaves de assinatura
- [ ] Revisar hierarquia de chaves
- [ ] Atualizar este runbook

---

## 10. Contatos

| Papel | Responsabilidade |
|-------|------------------|
| Security Team | Revogacao, investigacao |
| DevOps | Rotacao, configuracao |
| Arquiteto | Decisoes de design |

---

## 11. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento criado em: 2025-12-23*
