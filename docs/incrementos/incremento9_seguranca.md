# Incremento 9 - Seguranca Reforcada

**Data**: 2025-12-23
**Versao**: 1.0
**Status**: Em Implementacao

---

## 1. Visao Geral

Este incremento reforça a seguranca do sistema de backup e autenticacao do Libervia:

1. **Backup Multi-Destino**: Exportar para multiplos destinos (local, off-site, cold storage)
2. **Assinatura Digital**: Manifests assinados com Ed25519 para garantir integridade e autenticidade
3. **Autenticacao Reforcada**: Token obrigatorio em producao, preparacao para mTLS
4. **Gestao de Chaves**: Governanca clara para geracao, rotacao e revogacao

---

## 2. Destinos de Backup

### 2.1 Tipos de Destino

| Tipo | Descricao | Exemplo | Retencao |
|------|-----------|---------|----------|
| `local` | Disco local | `/backups/daily` | 7 dias |
| `s3` | AWS S3 ou compativel | `s3://bucket/path` | 30 dias |
| `gcs` | Google Cloud Storage | `gs://bucket/path` | 30 dias |
| `cold` | Storage frio (Glacier, Archive) | `s3://bucket-glacier/` | 365 dias |

### 2.2 Configuracao via Ambiente

```bash
# Destinos (separados por virgula)
BACKUP_DESTINATIONS="/backups/local,s3://bucket/libervia"

# Credenciais (por tipo)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

### 2.3 Estrategia de Replicacao

```
Backup Local (primario)
    |
    +---> Off-site S3 (replica sincrona)
    |
    +---> Cold Storage (replica assincrona, semanal)
```

---

## 3. Formato do Manifest Assinado

### 3.1 Estrutura

```typescript
interface SignedManifest {
  // Dados do backup (igual ao manifest existente)
  manifest: {
    backup_id: string;
    timestamp: string;
    source_dir: string;
    files: Array<{
      name: string;
      size: number;
      sha256: string;
    }>;
    chain_valid_at_backup: boolean;
    total_events: number;
    segments: number;
  };

  // Assinatura digital
  signature: {
    algorithm: 'ed25519';
    public_key_id: string;      // Identificador da chave publica
    signature: string;          // Base64 da assinatura
    signed_at: string;          // Timestamp da assinatura
  };
}
```

### 3.2 Processo de Assinatura

1. Serializar manifest em JSON canonico (chaves ordenadas, sem espacos)
2. Calcular hash SHA-256 do JSON canonico
3. Assinar hash com chave privada Ed25519
4. Anexar assinatura ao manifest

### 3.3 Verificacao

1. Extrair assinatura e manifest
2. Recalcular hash do manifest
3. Verificar assinatura com chave publica correspondente
4. Validar checksums dos arquivos

---

## 4. Governanca de Chaves

### 4.1 Hierarquia

```
Root Key (offline, HSM)
    |
    +---> Signing Key (backup) - rotacao anual
    |
    +---> Auth Key (control-plane) - rotacao trimestral
```

### 4.2 Armazenamento

| Ambiente | Chave Privada | Chave Publica |
|----------|---------------|---------------|
| Desenvolvimento | Env var (mock) | Embedded |
| Producao | Secrets Manager | Embedded + Repo |
| CI/CD | Secrets do pipeline | Embedded |

### 4.3 Rotacao

1. Gerar novo par de chaves
2. Publicar nova chave publica
3. Periodo de transicao (aceitar ambas)
4. Revogar chave antiga
5. Atualizar documentacao

### 4.4 Revogacao

```typescript
interface KeyRevocation {
  key_id: string;
  revoked_at: string;
  reason: 'rotation' | 'compromise' | 'expiry';
  revoked_by: string;
}
```

---

## 5. Autenticacao Reforcada

### 5.1 Control-Plane

| Modo | Token | mTLS | Uso |
|------|-------|------|-----|
| Desenvolvimento | Opcional | Nao | Local dev |
| Staging | Obrigatorio | Opcional | Testes |
| Producao | Obrigatorio | Recomendado | Go-live |

### 5.2 Configuracao

```bash
# Token (obrigatorio em prod)
CONTROL_PLANE_TOKEN=<token-secreto-256-bits>

# mTLS (opcional)
CONTROL_PLANE_TLS_CERT=/path/to/cert.pem
CONTROL_PLANE_TLS_KEY=/path/to/key.pem
CONTROL_PLANE_TLS_CA=/path/to/ca.pem
```

### 5.3 Fallback Seguro

- Se `NODE_ENV=production` e `CONTROL_PLANE_TOKEN` ausente: **recusar iniciar**
- Se token invalido: retornar 401, logar tentativa
- Rate limiting: 100 req/min por IP

---

## 6. Fluxo de Backup Seguro

```
1. Verificar integridade do EventLog (verifyChain)
       |
       v
2. Coletar arquivos e checksums
       |
       v
3. Criar manifest com metadados
       |
       v
4. Assinar manifest com chave privada
       |
       v
5. Empacotar (tar.gz + manifest assinado)
       |
       v
6. Upload para cada destino configurado
       |
       +---> Local: mv para diretorio
       +---> S3: aws s3 cp (ou SDK)
       +---> Cold: aws s3 cp --storage-class GLACIER
       |
       v
7. Verificar uploads (checksums remotos)
       |
       v
8. Registrar em log de operacoes
```

---

## 7. Fluxo de Restauracao Segura

```
1. Baixar pacote do destino
       |
       v
2. Extrair manifest assinado
       |
       v
3. Verificar assinatura (rejeitar se invalida)
       |
       v
4. Verificar checksums dos arquivos
       |
       v
5. Restaurar para diretorio destino
       |
       v
6. Verificar integridade pos-restauracao
       |
       v
7. Registrar em log de operacoes
```

---

## 8. API do Script

### 8.1 Backup

```bash
# Backup simples (local)
npm run backup:secure -- ./data /backups/daily

# Backup multi-destino
npm run backup:secure -- ./data /backups/daily s3://bucket/path

# Opcoes
--sign              # Assinar manifest (default: true se chave disponivel)
--no-sign           # Nao assinar (dev mode)
--verify-after      # Verificar apos upload
--cold-storage      # Marcar para cold storage
```

### 8.2 Restauracao

```bash
# Restaurar de local
npm run backup:secure -- restore /backups/backup-xxx.tar.gz ./data

# Restaurar de S3
npm run backup:secure -- restore s3://bucket/backup-xxx.tar.gz ./data

# Opcoes
--verify-signature  # Verificar assinatura (default: true)
--skip-verify       # Pular verificacao (emergencia apenas)
--dry-run           # Simular sem restaurar
```

---

## 9. Metricas e Alertas

### 9.1 Metricas Adicionais

```typescript
interface BackupSecurityMetrics {
  ultimo_backup_assinado: boolean;
  ultimo_backup_destinos: string[];
  ultimo_backup_verificado: boolean;
  chave_dias_ate_rotacao: number;
  tentativas_auth_falhas_24h: number;
}
```

### 9.2 Alertas

| Condicao | Nivel | Acao |
|----------|-------|------|
| Backup nao assinado | WARNING | Verificar chave |
| Assinatura invalida na restauracao | CRITICAL | Bloquear, investigar |
| Chave expira em < 30 dias | WARNING | Iniciar rotacao |
| > 10 auth falhas/hora | WARNING | Verificar origem |
| > 100 auth falhas/hora | CRITICAL | Bloquear IP |

---

## 10. Implementacao

### 10.1 Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `scripts/backup_frio_secure.ts` | Backup multi-destino com assinatura |
| `scripts/crypto_utils.ts` | Utilitarios de criptografia |
| `control-plane/auth.ts` | Autenticacao reforcada |
| `testes/incremento9.test.ts` | Testes de seguranca |

### 10.2 Dependencias

- `crypto` (Node stdlib) - Ed25519, SHA-256
- Nenhuma dependencia externa adicional

---

## 11. Riscos e Mitigacoes

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Perda de chave privada | Nao assina novos backups | Backup da chave em HSM/cold |
| Comprometimento de chave | Backups falsos aceitos | Revogacao + rotacao imediata |
| Falha de destino remoto | Backup incompleto | Retry + alertas |
| Latencia de upload | Backup lento | Upload assincrono |

---

## 12. Checklist de Implementacao

- [ ] Criar `crypto_utils.ts` com Ed25519
- [ ] Implementar `backup_frio_secure.ts`
- [ ] Refatorar autenticacao do control-plane
- [ ] Criar testes de seguranca
- [ ] Documentar gestao de chaves
- [ ] Atualizar runbooks
- [ ] Testar em ambiente isolado

---

*Documento criado em: 2025-12-23*
*Autor: Libervia*
