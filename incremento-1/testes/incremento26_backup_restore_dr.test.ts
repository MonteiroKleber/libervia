/**
 * TESTES - Incremento 26: Backup, Restore & Disaster Recovery
 *
 * Testa:
 * - Criação de backup com hash e assinatura HMAC
 * - Validação de integridade de backup
 * - Restore dry-run e efetivo (append-only)
 * - Procedimentos de Disaster Recovery
 * - Eventos de auditoria (BACKUP_CREATED, etc.)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import {
  BackupService,
  BackupDataProviders,
  RestoreService,
  RestoreExistenceCheckers,
  RestoreAppenders,
  BackupRepositoryImpl,
  BackupSnapshot,
  BackupOptions,
  RestoreOptions,
  computeBackupContentHash,
  computeEntityDataHash,
  computeBackupSignature,
  verifyBackupIntegrity,
  generateBackupId,
  generateBackupFilename,
  BACKUP_FORMAT_VERSION,
  BACKUP_PEPPER_ENV_KEY,
  createBackupMetadata,
  validateBackupStructure,
  ALL_BACKUP_ENTITIES,
  BackupValidationError,
  BackupSignatureError,
  BackupHashError,
  BackupNotFoundError
} from '../camada-3/backup';

import { EventLogEntry, TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE TESTE
// ════════════════════════════════════════════════════════════════════════════

const TEST_DIR = path.join(__dirname, '../test-artifacts/backup-test');
const TEST_BACKUP_DIR = path.join(TEST_DIR, 'backups');
const TEST_PEPPER = 'test-pepper-for-backup-signing-12345';

// Configurar pepper antes dos testes
beforeAll(() => {
  process.env[BACKUP_PEPPER_ENV_KEY] = TEST_PEPPER;
});

afterAll(() => {
  delete process.env[BACKUP_PEPPER_ENV_KEY];
});

// Limpar diretório de teste antes de cada teste
beforeEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_BACKUP_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// DADOS DE TESTE
// ════════════════════════════════════════════════════════════════════════════

function createMockEventLogEntry(index: number, previousHash: string | null = null): EventLogEntry {
  const currentHash = crypto.randomBytes(32).toString('hex');
  return {
    id: `evt-${index}`,
    timestamp: new Date(),
    actor: 'Libervia',
    evento: TipoEvento.SITUACAO_CRIADA,
    entidade: TipoEntidade.SITUACAO,
    entidade_id: `sit-${index}`,
    payload_hash: crypto.randomBytes(32).toString('hex'),
    previous_hash: previousHash,
    current_hash: currentHash
  };
}

function createMockObservacao(index: number): unknown {
  return {
    id: `obs-${index}`,
    contrato_id: `contrato-${index}`,
    episodio_id: `episodio-${index}`,
    data_registro: new Date()
  };
}

function createMockMandate(index: number): unknown {
  return {
    id: `mandate-${index}`,
    agentId: `agent-${index}`,
    modo: 'AUTONOMO',
    concedido_em: new Date()
  };
}

function createMockReviewCase(index: number): unknown {
  return {
    id: `case-${index}`,
    tenantId: 'test-tenant',
    status: 'open',
    createdAt: new Date()
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP CRYPTO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - BackupCrypto', () => {
  test('computeEntityDataHash gera hash determinístico', () => {
    const data = [{ id: '1', name: 'test' }, { id: '2', name: 'test2' }];
    const hash1 = computeEntityDataHash(data);
    const hash2 = computeEntityDataHash(data);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  test('computeBackupSignature usa HMAC com pepper', () => {
    const contentHash = crypto.randomBytes(32).toString('hex');
    const signature = computeBackupSignature(contentHash, TEST_PEPPER);

    expect(signature).toHaveLength(64); // HMAC-SHA256 hex

    // Verificar que assinatura é determinística
    const signature2 = computeBackupSignature(contentHash, TEST_PEPPER);
    expect(signature).toBe(signature2);
  });

  test('verifyBackupIntegrity detecta hash corrompido', () => {
    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [createMockEventLogEntry(1)],
      dataHash: computeEntityDataHash([createMockEventLogEntry(1)])
    }];

    const contentHash = computeBackupContentHash(metadata, entities);
    const signature = computeBackupSignature(contentHash, TEST_PEPPER);

    const snapshot: BackupSnapshot = {
      metadata,
      entities,
      contentHash: 'corrupted-hash',
      signature
    };

    const result = verifyBackupIntegrity(snapshot, TEST_PEPPER);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('verifyBackupIntegrity detecta assinatura inválida', () => {
    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [createMockEventLogEntry(1)],
      dataHash: computeEntityDataHash([createMockEventLogEntry(1)])
    }];

    const contentHash = computeBackupContentHash(metadata, entities);

    const snapshot: BackupSnapshot = {
      metadata,
      entities,
      contentHash,
      signature: 'invalid-signature-'.padEnd(64, '0')
    };

    const result = verifyBackupIntegrity(snapshot, TEST_PEPPER);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('assinatura') || e.toLowerCase().includes('signature') || e.toLowerCase().includes('hmac'))).toBe(true);
  });

  test('generateBackupId inclui tenant e timestamp', () => {
    const id = generateBackupId('test-tenant');
    expect(id).toContain('backup_');
    expect(id).toContain('test-tenant');
  });

  test('generateBackupFilename segue formato esperado', () => {
    const date = new Date('2024-12-26T14:30:00Z');
    const filename = generateBackupFilename('test-tenant', date);

    expect(filename).toMatch(/^backup_test-tenant_\d{8}-\d{6}\.json$/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP METADATA
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - BackupMetadata', () => {
  test('createBackupMetadata gera metadados válidos', () => {
    const metadata = createBackupMetadata('test-tenant');

    expect(metadata.backupId).toContain('backup_');
    expect(metadata.tenantId).toBe('test-tenant');
    expect(metadata.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(metadata.includedEntities).toEqual(ALL_BACKUP_ENTITIES);
    expect(metadata.createdAt).toBeInstanceOf(Date);
  });

  test('validateBackupStructure aceita snapshot válido', () => {
    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [],
      dataHash: 'abc123'
    }];

    const snapshot = {
      metadata,
      entities,
      contentHash: 'hash123',
      signature: 'sig123'
    };

    const result = validateBackupStructure(snapshot);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validateBackupStructure rejeita snapshot sem metadata', () => {
    const snapshot = {
      entities: [],
      contentHash: 'hash',
      signature: 'sig'
    };

    const result = validateBackupStructure(snapshot);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Metadados'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - BackupRepository', () => {
  test('save persiste backup em arquivo JSON', async () => {
    const repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [createMockEventLogEntry(1)],
      dataHash: computeEntityDataHash([createMockEventLogEntry(1)])
    }];

    const contentHash = computeBackupContentHash(metadata, entities);
    const signature = computeBackupSignature(contentHash, TEST_PEPPER);

    const snapshot: BackupSnapshot = {
      metadata,
      entities,
      contentHash,
      signature
    };

    const filePath = await repo.save(snapshot);

    expect(filePath).toContain('backup_test-tenant');
    expect(filePath).toContain('.json');

    // Verificar arquivo existe
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  test('load recupera backup salvo', async () => {
    const repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [createMockEventLogEntry(1)],
      dataHash: computeEntityDataHash([createMockEventLogEntry(1)])
    }];

    const contentHash = computeBackupContentHash(metadata, entities);
    const signature = computeBackupSignature(contentHash, TEST_PEPPER);

    const snapshot: BackupSnapshot = {
      metadata,
      entities,
      contentHash,
      signature
    };

    await repo.save(snapshot);

    const loaded = await repo.load(metadata.backupId);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.backupId).toBe(metadata.backupId);
    expect(loaded!.contentHash).toBe(contentHash);
  });

  test('list retorna backups ordenados por data', async () => {
    const repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    // Criar dois backups
    for (let i = 1; i <= 2; i++) {
      const metadata = createBackupMetadata(`tenant-${i}`);
      const entities = [{
        entityType: 'EventLog' as const,
        data: [],
        dataHash: computeEntityDataHash([])
      }];

      const contentHash = computeBackupContentHash(metadata, entities);
      const signature = computeBackupSignature(contentHash, TEST_PEPPER);

      await repo.save({
        metadata,
        entities,
        contentHash,
        signature
      });

      // Pequeno delay para garantir ordem diferente
      await new Promise(r => setTimeout(r, 10));
    }

    const list = await repo.list();
    expect(list.length).toBe(2);
    // Mais recente primeiro
    expect(list[0].modifiedAt.getTime()).toBeGreaterThanOrEqual(list[1].modifiedAt.getTime());
  });

  test('delete remove backup', async () => {
    const repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    const metadata = createBackupMetadata('test-tenant');
    const entities = [{
      entityType: 'EventLog' as const,
      data: [],
      dataHash: computeEntityDataHash([])
    }];

    const contentHash = computeBackupContentHash(metadata, entities);
    const signature = computeBackupSignature(contentHash, TEST_PEPPER);

    await repo.save({
      metadata,
      entities,
      contentHash,
      signature
    });

    const deleted = await repo.delete(metadata.backupId);
    expect(deleted).toBe(true);

    const exists = await repo.exists(metadata.backupId);
    expect(exists).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP SERVICE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - BackupService', () => {
  let repo: BackupRepositoryImpl;
  let service: BackupService;
  let mockEvents: EventLogEntry[];
  let mockObservacoes: unknown[];
  let mockMandates: unknown[];
  let mockReviewCases: unknown[];
  let eventLog: string[];

  beforeEach(() => {
    repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    mockEvents = [
      createMockEventLogEntry(1, null),
      createMockEventLogEntry(2, 'prev-hash')
    ];

    mockObservacoes = [createMockObservacao(1)];
    mockMandates = [createMockMandate(1)];
    mockReviewCases = [createMockReviewCase(1)];
    eventLog = [];

    const providers: BackupDataProviders = {
      getEventLog: async () => mockEvents,
      getObservacoesDeConsequencia: async () => mockObservacoes,
      getAutonomyMandates: async () => mockMandates,
      getReviewCases: async () => mockReviewCases,
      getTenantRegistry: async () => []
    };

    const onEvent = async (evento: string, backupId: string, details: Record<string, unknown>) => {
      eventLog.push(evento);
    };

    service = new BackupService(repo, providers, onEvent);
  });

  test('createBackup gera snapshot válido', async () => {
    const snapshot = await service.createBackup({ tenantId: 'test' });

    expect(snapshot.metadata.tenantId).toBe('test');
    expect(snapshot.entities.length).toBeGreaterThan(0);
    expect(snapshot.contentHash).toHaveLength(64);
    expect(snapshot.signature).toHaveLength(64);

    // Verificar integridade
    const integrity = verifyBackupIntegrity(snapshot, TEST_PEPPER);
    expect(integrity.valid).toBe(true);
  });

  test('createBackup registra evento BACKUP_CREATED', async () => {
    await service.createBackup({ tenantId: 'test' });

    expect(eventLog).toContain('BACKUP_CREATED');
  });

  test('createBackup inclui contagem de entidades', async () => {
    const snapshot = await service.createBackup();

    expect(snapshot.metadata.entityCounts.EventLog).toBe(2);
    expect(snapshot.metadata.entityCounts.ObservacoesDeConsequencia).toBe(1);
    expect(snapshot.metadata.entityCounts.AutonomyMandates).toBe(1);
    expect(snapshot.metadata.entityCounts.ReviewCases).toBe(1);
  });

  test('validateBackup retorna válido para backup íntegro', async () => {
    const snapshot = await service.createBackup({ tenantId: 'test' });
    const result = await service.validateBackup(snapshot.metadata.backupId);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validateBackup registra evento BACKUP_VERIFIED', async () => {
    const snapshot = await service.createBackup({ tenantId: 'test' });
    await service.validateBackup(snapshot.metadata.backupId);

    expect(eventLog).toContain('BACKUP_VERIFIED');
  });

  test('listBackups retorna metadados', async () => {
    await service.createBackup({ tenantId: 'tenant-a' });
    await service.createBackup({ tenantId: 'tenant-b' });

    const list = await service.listBackups();
    expect(list.length).toBe(2);
  });

  test('getLatestBackup retorna mais recente', async () => {
    await service.createBackup({ tenantId: 'tenant-a' });
    await new Promise(r => setTimeout(r, 10));
    const second = await service.createBackup({ tenantId: 'tenant-b' });

    const latest = await service.getLatestBackup();
    expect(latest!.metadata.backupId).toBe(second.metadata.backupId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RESTORE SERVICE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - RestoreService', () => {
  let repo: BackupRepositoryImpl;
  let backupService: BackupService;
  let restoreService: RestoreService;
  let restoredEvents: EventLogEntry[];
  let restoredMandates: unknown[];
  let eventLog: string[];

  beforeEach(async () => {
    repo = new BackupRepositoryImpl(TEST_BACKUP_DIR);

    const mockEvents = [createMockEventLogEntry(1, null)];
    const mockMandates = [createMockMandate(1)];

    const providers: BackupDataProviders = {
      getEventLog: async () => mockEvents,
      getObservacoesDeConsequencia: async () => [],
      getAutonomyMandates: async () => mockMandates,
      getReviewCases: async () => [],
      getTenantRegistry: async () => []
    };

    backupService = new BackupService(repo, providers);

    restoredEvents = [];
    restoredMandates = [];
    eventLog = [];

    const existenceCheckers: RestoreExistenceCheckers = {
      eventExists: async (id) => restoredEvents.some(e => e.id === id),
      observacaoExists: async () => false,
      mandateExists: async (id) => restoredMandates.some((m: any) => m.id === id),
      reviewCaseExists: async () => false,
      tenantExists: async () => false
    };

    const appenders: RestoreAppenders = {
      appendEvent: async (event) => { restoredEvents.push(event); },
      appendObservacao: async () => {},
      appendMandate: async (mandate) => { restoredMandates.push(mandate); },
      appendReviewCase: async () => {},
      appendTenant: async () => {}
    };

    const onEvent = async (evento: string, backupId: string, details: Record<string, unknown>) => {
      eventLog.push(evento);
    };

    restoreService = new RestoreService(
      repo,
      backupService,
      existenceCheckers,
      appenders,
      onEvent
    );
  });

  test('dry-run não modifica dados', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });

    const result = await restoreService.dryRun(snapshot.metadata.backupId);

    expect(result.mode).toBe('dry-run');
    expect(result.totalAdded).toBeGreaterThan(0);
    expect(restoredEvents).toHaveLength(0); // Nada foi adicionado
    expect(restoredMandates).toHaveLength(0);
  });

  test('dry-run registra evento RESTORE_DRY_RUN', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });
    await restoreService.dryRun(snapshot.metadata.backupId);

    expect(eventLog).toContain('RESTORE_DRY_RUN');
  });

  test('execute adiciona dados ausentes', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });

    const result = await restoreService.execute(snapshot.metadata.backupId);

    expect(result.mode).toBe('effective');
    expect(result.success).toBe(true);
    expect(result.totalAdded).toBeGreaterThan(0);
    expect(restoredEvents.length).toBeGreaterThan(0);
    expect(restoredMandates.length).toBeGreaterThan(0);
  });

  test('execute registra evento RESTORE_EXECUTED', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });
    await restoreService.execute(snapshot.metadata.backupId);

    expect(eventLog).toContain('RESTORE_EXECUTED');
  });

  test('execute não duplica dados existentes (append-only)', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });

    // Primeiro restore
    const firstResult = await restoreService.execute(snapshot.metadata.backupId);
    const eventsAfterFirst = restoredEvents.length;
    const mandatesAfterFirst = restoredMandates.length;
    const totalAfterFirst = firstResult.totalAdded;

    // Segundo restore
    const result = await restoreService.execute(snapshot.metadata.backupId);

    expect(result.totalAdded).toBe(0); // Nada novo
    expect(result.totalSkipped).toBe(totalAfterFirst); // Tudo já existe
    expect(restoredEvents.length).toBe(eventsAfterFirst); // Não duplicou eventos
    expect(restoredMandates.length).toBe(mandatesAfterFirst); // Não duplicou mandatos
  });

  test('restore parcial filtra por entidade', async () => {
    const snapshot = await backupService.createBackup({ tenantId: 'test' });

    const result = await restoreService.execute(snapshot.metadata.backupId, {
      includeEntities: ['AutonomyMandates']
    });

    expect(restoredMandates.length).toBeGreaterThan(0);
    expect(restoredEvents.length).toBe(0); // Não incluído
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: EVENTOS NO EVENTLOG
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - Eventos de Auditoria', () => {
  test('TipoEvento inclui eventos de backup', () => {
    expect(TipoEvento.BACKUP_CREATED).toBe('BACKUP_CREATED');
    expect(TipoEvento.BACKUP_VERIFIED).toBe('BACKUP_VERIFIED');
    expect(TipoEvento.RESTORE_DRY_RUN).toBe('RESTORE_DRY_RUN');
    expect(TipoEvento.RESTORE_EXECUTED).toBe('RESTORE_EXECUTED');
    expect(TipoEvento.RESTORE_REJECTED).toBe('RESTORE_REJECTED');
  });

  test('TipoEntidade inclui BACKUP', () => {
    expect(TipoEntidade.BACKUP).toBe('BackupSnapshot');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: DOCUMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - Documentação', () => {
  const DOCS_DIR = path.join(__dirname, '../docs');

  test('documentação incremento26_backup_restore_dr.md existe', async () => {
    const docPath = path.join(DOCS_DIR, 'incremento26_backup_restore_dr.md');
    const stat = await fs.stat(docPath);
    expect(stat.isFile()).toBe(true);
  });

  test('documentação contém seções essenciais', async () => {
    const docPath = path.join(DOCS_DIR, 'incremento26_backup_restore_dr.md');
    const content = await fs.readFile(docPath, 'utf-8');

    expect(content).toContain('# Incremento 26');
    expect(content).toContain('Backup');
    expect(content).toContain('Restore');
    expect(content).toContain('Disaster Recovery');
    expect(content).toContain('LIBERVIA_BACKUP_PEPPER');
    expect(content).toContain('append-only');
    expect(content).toContain('dry-run');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ERROS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 26 - Erros', () => {
  test('BackupNotFoundError inclui backupId', () => {
    const error = new BackupNotFoundError('backup-123');
    expect(error.backupId).toBe('backup-123');
    expect(error.code).toBe('BACKUP_NOT_FOUND');
  });

  test('BackupHashError inclui hashes', () => {
    const error = new BackupHashError('Hash mismatch', 'expected', 'actual');
    expect(error.expectedHash).toBe('expected');
    expect(error.actualHash).toBe('actual');
    expect(error.code).toBe('BACKUP_HASH_MISMATCH');
  });

  test('BackupSignatureError tem código correto', () => {
    const error = new BackupSignatureError();
    expect(error.code).toBe('BACKUP_SIGNATURE_INVALID');
  });
});
