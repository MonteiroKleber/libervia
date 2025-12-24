# Runbook: Recuperacao de Desastre - Backup Frio do EventLog

**Data**: 2025-12-23
**Versao**: 1.0
**Autor**: Libervia
**Criticidade**: Alta

---

## 1. Visao Geral

Este runbook descreve os procedimentos para:
- Criar backups do EventLog
- Restaurar o EventLog a partir de backup
- Verificar integridade apos restauracao

O EventLog e o registro imutavel de todos os eventos do sistema Libervia. Perda ou corrupcao do EventLog pode comprometer a auditabilidade do sistema.

---

## 2. Pre-requisitos

- Node.js v20+ instalado
- Acesso ao diretorio de dados (`./data` ou configurado)
- Permissoes de leitura/escrita nos diretorios de backup e destino
- Ferramenta `tar` disponivel no sistema

---

## 3. Criar Backup

### 3.1 Comando Basico

```bash
cd incremento-1
npm run backup-frio
```

Isso cria backup do diretorio `./data` em `./backup-out/`.

### 3.2 Comando com Diretorios Customizados

```bash
npm run backup-frio -- ./data ./backups
```

Ou diretamente:

```bash
npx ts-node scripts/backup_frio_eventlog.ts ./data ./backups
```

### 3.3 Saida Esperada

```
════════════════════════════════════════════════════════════════════════
BACKUP FRIO - EventLog
════════════════════════════════════════════════════════════════════════
Data: 2025-12-23T10:00:00.000Z
Origem: ./data
Destino: ./backups

1. Verificando integridade do EventLog...
   - Cadeia valida: true
   - Total de eventos: 1000
   - Segmentos: 10

2. Coletando informacoes dos arquivos...
   - segment-000001.json (12.5 KB) [a1b2c3d4...]
   - segment-000002.json (12.3 KB) [e5f6g7h8...]
   ...

3. Criando pacote compactado...
   - backup-eventlog-20251223-100000.tar.gz (45.2 KB)

4. Gerando manifest...
   - backup-eventlog-20251223-100000.manifest.json

════════════════════════════════════════════════════════════════════════
BACKUP COMPLETO
Arquivo: ./backups/backup-eventlog-20251223-100000.tar.gz
Manifest: ./backups/backup-eventlog-20251223-100000.manifest.json
════════════════════════════════════════════════════════════════════════
```

### 3.4 Arquivos Gerados

| Arquivo | Descricao |
|---------|-----------|
| `backup-eventlog-YYYYMMDD-HHMMSS.tar.gz` | Pacote compactado com segmentos e snapshot |
| `backup-eventlog-YYYYMMDD-HHMMSS.manifest.json` | Manifest com checksums SHA-256 |

### 3.5 Armazenamento Recomendado

- Copiar backups para local externo (S3, GCS, NAS)
- Manter pelo menos 7 dias de backups
- Verificar checksums periodicamente

---

## 4. Restaurar Backup

### 4.1 Cenario: EventLog Corrompido

Se o EventLog estiver corrompido ou inacessivel:

1. **Parar o sistema** (se estiver em execucao)
2. **Identificar ultimo backup valido**
3. **Executar restauracao**

### 4.2 Passos de Restauracao

#### Passo 1: Identificar Backup

```bash
ls -la ./backups/
```

Escolher o backup mais recente com manifest correspondente.

#### Passo 2: Verificar Manifest (Opcional)

```bash
cat ./backups/backup-eventlog-20251223-100000.manifest.json
```

Verificar:
- `chain_valid_at_backup: true`
- `eventlog_summary.total_events` corresponde ao esperado

#### Passo 3: Criar Diretorio de Destino

```bash
mkdir -p ./data-restored
```

#### Passo 4: Extrair Backup

```bash
tar -xzf ./backups/backup-eventlog-20251223-100000.tar.gz -C ./data-restored
```

#### Passo 5: Verificar Estrutura

```bash
ls -la ./data-restored/event-log/
```

Esperado:
```
segment-000001.json
segment-000002.json
...
event-log-snapshot.json (opcional)
```

#### Passo 6: Mover Snapshot para Local Correto

```bash
# O snapshot fica no nivel do data dir, nao dentro de event-log
mv ./data-restored/event-log-snapshot.json ./data-restored/ 2>/dev/null || true
```

#### Passo 7: Verificar Integridade

```bash
# Via script de validacao
npx ts-node -e "
const { EventLogRepositoryImpl } = require('./event-log/EventLogRepositoryImpl');
async function verify() {
  const el = await EventLogRepositoryImpl.create('./data-restored');
  const result = await el.verifyChain();
  console.log('Cadeia valida:', result.valid);
  console.log('Total eventos:', await el.count());
}
verify();
"
```

#### Passo 8: Substituir Dados Corrompidos

**ATENCAO**: Este passo e destrutivo!

```bash
# Backup do corrompido (opcional)
mv ./data/event-log ./data/event-log-corrupted-$(date +%Y%m%d)

# Mover restaurado para producao
mv ./data-restored/event-log ./data/
mv ./data-restored/event-log-snapshot.json ./data/ 2>/dev/null || true
```

#### Passo 9: Reiniciar Sistema

```bash
# Iniciar aplicacao normalmente
npm start
```

---

## 5. Checklist Pos-Restauracao

Apos restaurar o EventLog, execute estas verificacoes:

### 5.1 Verificacao Basica

- [ ] `verifyChain()` retorna `valid: true`
- [ ] Total de eventos corresponde ao manifest
- [ ] Snapshot existe (se estava no backup)

### 5.2 Verificacao do Orquestrador

```bash
npx ts-node -e "
// Testar inicializacao do Orquestrador
// (adaptar imports conforme necessario)
"
```

- [ ] `orq.init()` executa sem erros
- [ ] `orq.GetEventLogStatus()` retorna `enabled: true, degraded: false`

### 5.3 Verificacao Operacional

- [ ] `ProcessarSolicitacao()` funciona com nova situacao
- [ ] `ExportEventLogForAudit()` retorna eventos
- [ ] `ReplayEventLog()` gera resumo correto

### 5.4 Smoke Test Completo

```bash
npm test -- --testPathPattern="incremento5"
```

Todos os testes devem passar.

---

## 6. Troubleshooting

### 6.1 Erro: "Diretorio EventLog nao encontrado"

**Causa**: O diretorio `./data/event-log` nao existe.

**Solucao**:
1. Verificar caminho do diretorio de dados
2. Garantir que o backup foi extraido corretamente

### 6.2 Erro: "Checksum invalido"

**Causa**: Arquivo foi modificado apos backup ou corrompido durante transferencia.

**Solucao**:
1. Re-transferir o arquivo de backup
2. Tentar backup mais antigo
3. Verificar integridade do storage

### 6.3 Erro: "verifyChain() retorna false"

**Causa**: Cadeia de hashes esta quebrada.

**Solucao**:
1. Usar backup mais antigo
2. Investigar qual evento esta corrompido:
   ```
   const result = await eventLog.verifyChainFull();
   console.log('Primeiro invalido:', result.firstInvalidIndex);
   ```

### 6.4 Erro: "Diretorio ja contem EventLog"

**Causa**: Tentando restaurar em diretorio que ja tem dados.

**Solucao**:
1. Usar diretorio novo para restauracao
2. Ou remover/renomear dados existentes primeiro

---

## 7. Politica de Backup Recomendada

| Frequencia | Retencao | Local |
|------------|----------|-------|
| Diario | 7 dias | Local |
| Semanal | 4 semanas | Externo (S3/GCS) |
| Mensal | 12 meses | Externo + Offline |

### 7.1 Cadencia de Operacao Continua

**Integrado ao Incremento 9 - Operacao Continua**

| Operacao | Frequencia | Comando | Verificacao |
|----------|------------|---------|-------------|
| Backup Frio | Semanal (Dom 02:00) | `npm run backup-frio` | `chain_valid_at_backup: true` |
| Drill Go-Live | Quinzenal (Seg 08:00) | `npm run drill:go-live` | Cenario 7 (restauracao) passa |
| Metricas | Continuo | `npm run operacao:metrics` | `dias_desde_ultimo_backup < 7` |

**Alertas de Cadencia**:
- WARNING: Backup ha mais de 7 dias
- CRITICAL: Backup ha mais de 14 dias

### 7.2 Automacao (Cron)

```bash
# /etc/cron.d/libervia-backup
0 2 * * * libervia cd /app/incremento-1 && npm run backup-frio -- ./data /backups/daily
0 3 * * 0 libervia cd /app/incremento-1 && npm run backup-frio -- ./data /backups/weekly
```

### 7.3 Monitoramento

- Alertar se backup falhar (`success: false`)
- Alertar se `chain_valid_at_backup: false`
- Monitorar espaco em disco dos backups
- Verificar via `npm run operacao:metrics` ou `GET /metrics/operacao`

---

## 8. Contatos de Emergencia

| Papel | Contato |
|-------|---------|
| DBA | (preencher) |
| DevOps | (preencher) |
| Arquiteto | (preencher) |

---

## 9. Backup Seguro com Assinatura Digital (Incremento 9)

O Incremento 9 introduz backup com assinatura digital Ed25519 para garantir integridade e autenticidade.

### 9.1 Gerar Par de Chaves

```bash
npm run crypto:generate-keys -- ./keys
```

Isso gera:
- `public-key-<keyId>.json` - Chave publica (pode ir no repo)
- `private-key-<keyId>.json` - Chave privada (**NUNCA** no repo)

### 9.2 Configurar Ambiente

```bash
export LIBERVIA_SIGNING_KEY="<conteudo-base64-da-chave-privada>"
export LIBERVIA_PUBLIC_KEY="<conteudo-base64-da-chave-publica>"
export LIBERVIA_KEY_ID="<keyId>"
```

### 9.3 Backup Assinado

```bash
npm run backup:secure -- ./data /backups/local
```

Gera:
- `backup-eventlog-YYYYMMDD-HHMMSS.tar.gz`
- `backup-eventlog-YYYYMMDD-HHMMSS.signed.json` (manifest assinado)

### 9.4 Backup Multi-Destino

```bash
npm run backup:secure -- ./data /backups/primary /backups/secondary
```

### 9.5 Restauracao com Verificacao de Assinatura

```bash
npm run backup:secure -- restore /backups/backup-xxx.tar.gz ./data-restored
```

A restauracao verifica:
1. Assinatura digital do manifest
2. Checksums SHA-256 de cada arquivo
3. Integridade da cadeia de hashes

### 9.6 Restauracao sem Verificacao (Emergencia)

```bash
npm run backup:secure -- restore /backups/backup-xxx.tar.gz ./data-restored --skip-verify
```

**ATENCAO**: Usar apenas em emergencias quando a chave nao esta disponivel.

### 9.7 Erros de Assinatura

| Erro | Causa | Acao |
|------|-------|------|
| "Assinatura invalida" | Manifest alterado ou chave errada | Verificar chave publica |
| "Chave publica nao disponivel" | Env var nao configurada | Configurar LIBERVIA_PUBLIC_KEY |
| "Backup nao assinado" | Backup sem assinatura | Usar --skip-verify ou re-fazer backup |

---

## 10. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |
| 2025-12-23 | 2.0 | Libervia | Adicao de backup seguro (Incremento 9) |

---

*Documento atualizado em: 2025-12-23*
