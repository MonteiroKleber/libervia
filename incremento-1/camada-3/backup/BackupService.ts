// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: SERVIÇO DE BACKUP
// ════════════════════════════════════════════════════════════════════════

import { EventLogEntry } from '../event-log/EventLogEntry';
import {
  BackupSnapshot,
  BackupOptions,
  BackupEntityType,
  BackupEntityData,
  BackupMetadata,
  BackupValidationResult
} from './BackupTypes';
import { BackupRepository } from './BackupRepository';
import {
  computeBackupContentHash,
  computeEntityDataHash,
  computeBackupSignature,
  verifyBackupIntegrity,
  generateBackupId,
  BACKUP_FORMAT_VERSION
} from './BackupCrypto';
import { ALL_BACKUP_ENTITIES, createBackupMetadata } from './BackupMetadata';
import { BackupValidationError, BackupNotFoundError } from './BackupErrors';

/**
 * Provedores de dados para backup.
 * Cada função retorna os dados de uma entidade para um tenant específico.
 */
interface BackupDataProviders {
  getEventLog: (tenantId?: string) => Promise<EventLogEntry[]>;
  getObservacoesDeConsequencia: (tenantId?: string) => Promise<unknown[]>;
  getAutonomyMandates: (tenantId?: string) => Promise<unknown[]>;
  getReviewCases: (tenantId?: string) => Promise<unknown[]>;
  getTenantRegistry: () => Promise<unknown[]>;
}

/**
 * Callback para notificar eventos de backup.
 */
type BackupEventCallback = (
  evento: string,
  backupId: string,
  details: Record<string, unknown>
) => Promise<void>;

/**
 * Serviço de criação e validação de backups.
 *
 * Responsabilidades:
 * - Coletar dados das entidades
 * - Gerar snapshot assinado
 * - Persistir via BackupRepository
 * - Validar backups existentes
 */
class BackupService {
  constructor(
    private repository: BackupRepository,
    private dataProviders: BackupDataProviders,
    private onEvent?: BackupEventCallback
  ) {}

  /**
   * Cria um backup completo ou parcial.
   */
  async createBackup(options: BackupOptions = {}): Promise<BackupSnapshot> {
    const tenantId = options.tenantId ?? 'global';
    const includeEntities = options.includeEntities ?? ALL_BACKUP_ENTITIES;

    // Coletar dados de cada entidade
    const entities: BackupEntityData[] = [];
    const entityCounts: Partial<Record<BackupEntityType, number>> = {};

    for (const entityType of includeEntities) {
      const data = await this.collectEntityData(entityType, options.tenantId);
      const dataHash = computeEntityDataHash(data);

      entities.push({
        entityType,
        data,
        dataHash
      });

      entityCounts[entityType] = data.length;
    }

    // Criar metadados
    const metadata = createBackupMetadata(tenantId, includeEntities, entityCounts);

    // Adicionar info do último evento se EventLog incluído
    if (includeEntities.includes('EventLog')) {
      const eventLogEntity = entities.find(e => e.entityType === 'EventLog');
      if (eventLogEntity && eventLogEntity.data.length > 0) {
        const lastEvent = eventLogEntity.data[eventLogEntity.data.length - 1] as EventLogEntry;
        metadata.lastEventHash = lastEvent.current_hash;
        metadata.lastEventId = lastEvent.id;
      }
    }

    // Calcular hash e assinatura
    const contentHash = computeBackupContentHash(metadata, entities);
    const signature = computeBackupSignature(contentHash);

    const snapshot: BackupSnapshot = {
      metadata,
      entities,
      contentHash,
      signature
    };

    // Persistir
    const filePath = await this.repository.save(snapshot);

    // Notificar evento
    if (this.onEvent) {
      await this.onEvent('BACKUP_CREATED', metadata.backupId, {
        tenantId,
        includedEntities: includeEntities,
        entityCounts,
        filePath
      });
    }

    return snapshot;
  }

  /**
   * Coleta dados de uma entidade específica.
   */
  private async collectEntityData(
    entityType: BackupEntityType,
    tenantId?: string
  ): Promise<unknown[]> {
    switch (entityType) {
      case 'EventLog':
        return this.dataProviders.getEventLog(tenantId);
      case 'ObservacoesDeConsequencia':
        return this.dataProviders.getObservacoesDeConsequencia(tenantId);
      case 'AutonomyMandates':
        return this.dataProviders.getAutonomyMandates(tenantId);
      case 'ReviewCases':
        return this.dataProviders.getReviewCases(tenantId);
      case 'TenantRegistry':
        return this.dataProviders.getTenantRegistry();
      default:
        return [];
    }
  }

  /**
   * Valida um backup (verifica hash e assinatura).
   */
  async validateBackup(backupId: string): Promise<BackupValidationResult> {
    const snapshot = await this.repository.load(backupId);

    if (!snapshot) {
      return {
        valid: false,
        errors: [`Backup não encontrado: ${backupId}`],
        warnings: []
      };
    }

    return this.validateSnapshot(snapshot);
  }

  /**
   * Valida um snapshot de backup.
   */
  async validateSnapshot(snapshot: BackupSnapshot): Promise<BackupValidationResult> {
    const integrity = verifyBackupIntegrity(snapshot);

    const result: BackupValidationResult = {
      valid: integrity.valid,
      metadata: snapshot.metadata,
      errors: integrity.errors,
      warnings: []
    };

    // Verificar versão
    if (snapshot.metadata.formatVersion !== BACKUP_FORMAT_VERSION) {
      result.warnings.push(
        `Versão diferente: ${snapshot.metadata.formatVersion} (atual: ${BACKUP_FORMAT_VERSION})`
      );
    }

    // Notificar evento
    if (this.onEvent) {
      await this.onEvent('BACKUP_VERIFIED', snapshot.metadata.backupId, {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings
      });
    }

    return result;
  }

  /**
   * Valida um backup a partir de um arquivo.
   */
  async validateBackupFile(filePath: string): Promise<BackupValidationResult> {
    const snapshot = await this.repository.loadFromPath(filePath);

    if (!snapshot) {
      return {
        valid: false,
        errors: [`Arquivo não encontrado ou inválido: ${filePath}`],
        warnings: []
      };
    }

    return this.validateSnapshot(snapshot);
  }

  /**
   * Lista todos os backups disponíveis.
   */
  async listBackups(tenantId?: string): Promise<BackupSnapshot['metadata'][]> {
    const files = await this.repository.list(tenantId);
    return files
      .filter(f => f.metadata)
      .map(f => f.metadata!);
  }

  /**
   * Obtém um backup por ID.
   */
  async getBackup(backupId: string): Promise<BackupSnapshot | null> {
    return this.repository.load(backupId);
  }

  /**
   * Obtém o backup mais recente para um tenant.
   */
  async getLatestBackup(tenantId?: string): Promise<BackupSnapshot | null> {
    const files = await this.repository.list(tenantId);
    if (files.length === 0) {
      return null;
    }

    // Arquivos já ordenados por data (mais recente primeiro)
    return this.repository.loadFromPath(files[0].path);
  }
}

export { BackupService, BackupDataProviders, BackupEventCallback };
