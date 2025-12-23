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

### 7.1 Automacao (Cron)

```bash
# /etc/cron.d/libervia-backup
0 2 * * * libervia cd /app/incremento-1 && npm run backup-frio -- ./data /backups/daily
0 3 * * 0 libervia cd /app/incremento-1 && npm run backup-frio -- ./data /backups/weekly
```

### 7.2 Monitoramento

- Alertar se backup falhar (`success: false`)
- Alertar se `chain_valid_at_backup: false`
- Monitorar espaco em disco dos backups

---

## 8. Contatos de Emergencia

| Papel | Contato |
|-------|---------|
| DBA | (preencher) |
| DevOps | (preencher) |
| Arquiteto | (preencher) |

---

## 9. Historico de Revisoes

| Data | Versao | Autor | Mudancas |
|------|--------|-------|----------|
| 2025-12-23 | 1.0 | Libervia | Versao inicial |

---

*Documento gerado em: 2025-12-23*
