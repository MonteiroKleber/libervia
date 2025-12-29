# Incremento 26: Backup, Restore & Disaster Recovery (DR v1)

## Visão Geral

O Incremento 26 implementa um sistema completo de backup, restauração e recuperação de desastres para a Libervia, garantindo a integridade e recuperabilidade da memória institucional.

### Princípios Fundamentais

1. **Memória é imutável** - Backup captura estado, nunca altera
2. **Restore nunca reescreve passado** - Append-only sempre
3. **Integridade sempre verificável** - Hash + assinatura HMAC
4. **Camada cognitiva intocada** - Backup é infraestrutura, não decisão

## Arquitetura

### Entidades Alvo do Backup

| Entidade | Descrição |
|----------|-----------|
| EventLog | Log encadeado de eventos (append-only) |
| ObservacoesDeConsequencia | Consequências registradas |
| AutonomyMandates | Mandatos de autonomia |
| ReviewCases | Casos de revisão humana |
| TenantRegistry | Registro de tenants (multi-tenant) |

### Estrutura de Arquivos

```
camada-3/
├── backup/
│   ├── BackupTypes.ts          # Tipos e interfaces
│   ├── BackupErrors.ts         # Classes de erro
│   ├── BackupCrypto.ts         # Hash + HMAC
│   ├── BackupMetadata.ts       # Utilitários de metadados
│   ├── BackupRepository.ts     # Interface do repositório
│   ├── BackupRepositoryImpl.ts # Implementação (filesystem)
│   ├── BackupService.ts        # Serviço de backup
│   ├── RestoreService.ts       # Serviço de restore
│   ├── DisasterRecoveryService.ts # Procedimentos DR
│   └── index.ts                # Exports
```

## A) Backup Canônico

### Formato do Backup

```typescript
interface BackupSnapshot {
  metadata: BackupMetadata;
  entities: BackupEntityData[];
  contentHash: string;      // SHA-256 de (metadata + entities)
  signature: string;        // HMAC-SHA256(contentHash, PEPPER)
}

interface BackupMetadata {
  backupId: string;
  createdAt: Date;
  tenantId: string;
  formatVersion: string;
  includedEntities: BackupEntityType[];
  entityCounts: Record<BackupEntityType, number>;
  lastEventHash?: string;
  lastEventId?: string;
}
```

### Assinatura HMAC

O backup é assinado usando HMAC-SHA256 com a variável de ambiente `LIBERVIA_BACKUP_PEPPER`:

```typescript
signature = HMAC-SHA256(contentHash, LIBERVIA_BACKUP_PEPPER)
```

### Criando um Backup

```typescript
// Configurar backup (uma vez)
await orquestrador.ConfigurarBackup('/path/to/backups');

// Criar backup completo
const snapshot = await orquestrador.CriarBackup();

// Criar backup de tenant específico
const snapshot = await orquestrador.CriarBackup({
  tenantId: 'tenant-abc',
  includeEntities: ['EventLog', 'AutonomyMandates']
});
```

### Validando um Backup

```typescript
const result = await orquestrador.ValidarBackup(backupId);
if (!result.valid) {
  console.error('Backup inválido:', result.errors);
}
```

## B) Restore Verificado

### Princípio: Append-Only

O restore **nunca sobrescreve** dados existentes. Apenas adiciona itens que não existem:

```typescript
interface RestoreResult {
  totalAdded: number;      // Itens novos adicionados
  totalSkipped: number;    // Itens já existentes (ignorados)
  entityStats: RestoreEntityStats[];
}
```

### Modos de Restauração

| Modo | Descrição |
|------|-----------|
| `dry-run` | Simula restore, retorna estatísticas |
| `effective` | Executa restore real |

### Executando Restore

```typescript
// Dry-run primeiro
const dryResult = await orquestrador.RestaurarBackup(backupId, {
  mode: 'dry-run'
});

console.log(`Seriam adicionados: ${dryResult.totalAdded}`);
console.log(`Já existentes: ${dryResult.totalSkipped}`);

// Executar efetivamente
const result = await orquestrador.RestaurarBackup(backupId, {
  mode: 'effective'
});
```

### Restore Parcial

```typescript
// Restaurar apenas mandatos de um tenant
const result = await orquestrador.RestaurarBackup(backupId, {
  mode: 'effective',
  includeEntities: ['AutonomyMandates'],
  tenantId: 'tenant-abc'
});
```

## C) Disaster Recovery Playbook

O `DisasterRecoveryService` implementa procedimentos executáveis para cenários de recuperação.

### Procedimentos Disponíveis

| Tipo | Descrição |
|------|-----------|
| `total_node_loss` | Perda total de nó |
| `corruption_detection` | Detecção de corrupção |
| `old_snapshot_restore` | Restauração de snapshot antigo |
| `controlled_rollback` | Rollback controlado |

### Exemplo: Perda Total de Nó

```typescript
const drService = new DisasterRecoveryService(
  backupRepo,
  backupService,
  restoreService
);

// Iniciar procedimento
const procedure = await drService.startTotalNodeLoss('tenant-abc');

// Aguarda confirmação do operador...
console.log(procedure.notes); // Instruções e status

// Confirmar e executar
const completed = await drService.confirmTotalNodeLoss(procedure.procedureId);
```

### Passos do Procedimento

1. Localizar backup mais recente válido
2. Validar integridade do backup
3. Executar dry-run de restauração
4. Aguardar confirmação do operador
5. Executar restauração efetiva
6. Verificar integridade pós-restore

## D) Eventos de Auditoria

O Incremento 26 adiciona os seguintes eventos ao EventLog:

| Evento | Descrição |
|--------|-----------|
| `BACKUP_CREATED` | Backup criado com sucesso |
| `BACKUP_VERIFIED` | Backup validado |
| `RESTORE_DRY_RUN` | Dry-run executado |
| `RESTORE_EXECUTED` | Restore efetivo executado |
| `RESTORE_REJECTED` | Restore rejeitado (falha de validação) |

### Entidade

Nova entidade `BACKUP = 'BackupSnapshot'` adicionada ao `TipoEntidade`.

## Erros

| Erro | Código | Descrição |
|------|--------|-----------|
| `BackupValidationError` | `BACKUP_VALIDATION_ERROR` | Estrutura inválida |
| `BackupSignatureError` | `BACKUP_SIGNATURE_INVALID` | Assinatura HMAC inválida |
| `BackupHashError` | `BACKUP_HASH_MISMATCH` | Hash não corresponde |
| `BackupNotFoundError` | `BACKUP_NOT_FOUND` | Backup não encontrado |
| `BackupFormatError` | `BACKUP_FORMAT_INVALID` | Formato corrompido |
| `RestoreRejectedError` | `RESTORE_REJECTED` | Restore rejeitado |
| `EventLogContinuityError` | `EVENTLOG_CONTINUITY_BROKEN` | Cadeia quebrada |
| `BackupConfigError` | `BACKUP_CONFIG_MISSING` | Configuração ausente |

## Configuração

### Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `LIBERVIA_BACKUP_PEPPER` | Chave para assinatura HMAC | Sim |

### Integração com OrquestradorCognitivo

```typescript
const orq = new OrquestradorCognitivo(
  situacaoRepo,
  episodioRepo,
  decisaoRepo,
  contratoRepo,
  memoryService,
  protocoloRepo,
  eventLog,
  observacaoRepo,
  autonomyMandateRepo,
  reviewCaseRepo
);

// Habilitar backup
await orq.ConfigurarBackup('/path/to/backups');

// Usar métodos de backup
await orq.CriarBackup();
await orq.ValidarBackup(backupId);
await orq.RestaurarBackup(backupId, { mode: 'dry-run' });
await orq.ListarBackups();
await orq.GetBackupMaisRecente();
```

## Armazenamento

### Estrutura de Diretório

```
/backups/
├── backup_global_20241226-143000.json
├── backup_tenant-abc_20241226-150000.json
└── backup_tenant-xyz_20241226-160000.json
```

### Formato do Nome

```
backup_<tenantId>_<YYYYMMDD-HHmmss>.json
```

## Testes

Execute os testes do Incremento 26:

```bash
npm test -- incremento26
```

Os testes cobrem:

- Criação de backup com hash e assinatura
- Validação de integridade
- Restore dry-run e efetivo
- Append-only (nunca sobrescreve)
- Procedimentos de DR
- Eventos de auditoria

## Referências

- [Incremento 4: EventLog](./incremento4_event_log.md)
- [Incremento 17: Autonomia Graduada](./incremento17_autonomia.md)
- [Incremento 20: Human Review](./incremento20_human_review.md)
- [Incremento 25: SLO Definitions](./slo_definitions.md)
