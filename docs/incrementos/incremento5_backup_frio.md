# Incremento 5 - Backup Frio do EventLog

**Data**: 2025-12-23
**Autor**: Libervia
**Status**: Em Implementacao

---

## 1. Escopo

O Incremento 5 adiciona capacidade de **backup frio** (cold backup) do EventLog, permitindo:

1. **Exportacao segura** de todos os segmentos e snapshot do EventLog
2. **Empacotamento** em formato compactado com manifesto de integridade
3. **Restauracao** a partir do pacote, com validacao automatica
4. **Testes automatizados** de corrupcao e recuperacao

### 1.1 O que NAO esta no escopo

- Ancoragem em blockchain (futuro)
- Backup incremental/diferencial (futuro)
- Backup remoto (S3, GCS, etc.) - scripts locais apenas
- Replicacao em tempo real

---

## 2. Requisitos

### 2.1 Nao-Bloqueante

O backup frio NAO deve bloquear operacoes do Orquestrador:
- Operacoes de leitura nos arquivos de segmento (copy-on-read)
- Nao adquire locks exclusivos
- Snapshot e segmentos sao imutaveis apos rotacao (ver Inc 4.2)

### 2.2 Compatibilidade com Retencao

O script de backup deve respeitar a estrutura de segmentos/snapshot:
- Copiar todos os arquivos `segment-NNNNNN.json`
- Copiar `event-log-snapshot.json` se existir
- Nao interferir com `prune()` (politica de retencao)

### 2.3 Verificacao de Integridade

O pacote de backup deve incluir:
- Manifest JSON com:
  - Data/hora do backup
  - Lista de arquivos com checksums SHA-256
  - Total de eventos
  - Hash do ultimo evento (ancoragem)
  - Versao do formato

### 2.4 Restauracao Segura

A restauracao deve:
1. Verificar checksums de todos os arquivos antes de copiar
2. Executar `verifyChain()` apos restauracao
3. Nao sobrescrever dados existentes sem confirmacao
4. Permitir restauracao em diretorio alternativo

---

## 3. Formato do Pacote

### 3.1 Estrutura do Arquivo

```
backup-eventlog-YYYYMMDD-HHMMSS.tar.gz
├── manifest.json
├── event-log/
│   ├── segment-000001.json
│   ├── segment-000002.json
│   └── ...
└── event-log-snapshot.json (se existir)
```

### 3.2 Manifest JSON

```typescript
interface BackupManifest {
  version: 1;
  created_at: string;          // ISO timestamp
  source_dir: string;          // Diretorio origem
  files: Array<{
    path: string;              // Caminho relativo
    size: number;              // Bytes
    sha256: string;            // Checksum
  }>;
  eventlog_summary: {
    total_events: number;
    total_segments: number;
    first_event_id: string | null;
    last_event_id: string | null;
    last_current_hash: string | null;
    snapshot_exists: boolean;
  };
  chain_valid_at_backup: boolean;
}
```

---

## 4. Decisoes de Design

### 4.1 Por que tar.gz?

- **zlib/tar nativos**: Node.js possui `zlib` nativo e existem bibliotecas leves para tar
- **Portabilidade**: Formato universal, facilita auditoria externa
- **Streaming**: Permite criar pacote sem carregar tudo em memoria

**Dependencia escolhida**: `archiver` (leve, bem mantida, 0 deps transitivas pesadas)

```bash
npm install archiver --save-dev
npm install @types/archiver --save-dev
```

Justificativa: `archiver` e uma biblioteca madura (~10M downloads/semana) que permite criar tar.gz com streaming, ideal para backups grandes.

### 4.2 Por que nao ZIP?

- tar.gz preserva melhor metadados Unix
- Compressao superior para JSON repetitivo
- Mais facil de verificar integridade parcial

### 4.3 Idempotencia

O script de backup:
- Cria arquivo unico por execucao (timestamp no nome)
- Nao modifica origem
- Pode ser executado multiplas vezes sem efeitos colaterais

---

## 5. API do Script

### 5.1 Comando

```bash
npm run backup-frio [DATA_DIR] [OUTPUT_DIR]

# Exemplo:
npm run backup-frio ./data ./backups
```

### 5.2 Saida

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

2. Copiando arquivos...
   - segment-000001.json (12.5 KB) ✓
   - segment-000002.json (12.3 KB) ✓
   ...
   - event-log-snapshot.json (0.5 KB) ✓

3. Criando pacote compactado...
   - backup-eventlog-20251223-100000.tar.gz (45.2 KB)

4. Gerando manifest...
   - manifest.json

════════════════════════════════════════════════════════════════════════
BACKUP COMPLETO
Arquivo: ./backups/backup-eventlog-20251223-100000.tar.gz
Manifest: ./backups/backup-eventlog-20251223-100000.manifest.json
Tamanho: 45.2 KB
════════════════════════════════════════════════════════════════════════
```

---

## 6. Testes Automatizados

### 6.1 Cenarios

| # | Cenario | Descricao |
|---|---------|-----------|
| 1 | Backup basico | Criar backup de EventLog com eventos |
| 2 | Backup vazio | EventLog sem eventos |
| 3 | Verificar manifest | Checksums batem |
| 4 | Corrupcao de segmento | Corromper segmento, restaurar, validar |
| 5 | Corrupcao de snapshot | Corromper snapshot, restaurar, validar |
| 6 | Restaurar e operar | Apos restauracao, Orquestrador funciona |
| 7 | Restaurar em diretorio limpo | Novo diretorio, nenhum dado previo |

### 6.2 Utilitarios de Teste

```typescript
// Corromper arquivo para teste
async function corruptFile(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const corrupted = content.slice(0, -10) + 'CORRUPTED!';
  await fs.writeFile(filePath, corrupted);
}

// Extrair pacote tar.gz
async function extractBackup(archivePath: string, destDir: string): Promise<void>;

// Verificar manifest
async function verifyManifest(manifestPath: string, dataDir: string): Promise<boolean>;
```

---

## 7. Integracao com Documentacao

### 7.1 Atualizacoes Necessarias

- `docs/incremento 1 - persistencia ...`: Adicionar secao "Incremento 5 - Backup Frio"
- `docs/runbooks/desastre_backup_frio.md`: Procedimento operacional
- `docs/estado/semana2_hardening.md`: Relatorio de implementacao

### 7.2 Runbook de Desastre

O runbook deve cobrir:
1. Como executar backup
2. Onde ficam os arquivos
3. Procedimento de restauracao passo a passo
4. Checklist pos-restauracao

---

## 8. Limitacoes Conhecidas

| Limitacao | Motivo | Mitigacao Futura |
|-----------|--------|------------------|
| Backup local apenas | Escopo do incremento | Inc 6+: S3/GCS |
| Sem compressao de segmentos antigos | Complexidade | Inc 6+: Arquivamento |
| Sem criptografia | Escopo do incremento | Inc 6+: AES-256 |
| Restauracao manual | Simplicidade | Inc 6+: CLI interativo |

---

## 9. Checklist de Implementacao

- [ ] Instalar `archiver` e `@types/archiver`
- [ ] Criar `scripts/backup_frio_eventlog.ts`
- [ ] Adicionar script `backup-frio` ao `package.json`
- [ ] Criar `testes/incremento5.test.ts`
- [ ] Criar `docs/runbooks/desastre_backup_frio.md`
- [ ] Atualizar documentacao canonica
- [ ] Criar `docs/estado/semana2_hardening.md`
- [ ] Executar testes e validar cobertura

---

*Documento criado em: 2025-12-23*
*Versao: 5.0*
