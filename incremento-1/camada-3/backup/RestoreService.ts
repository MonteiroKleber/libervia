// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: SERVIÇO DE RESTAURAÇÃO
// ════════════════════════════════════════════════════════════════════════

import { EventLogEntry } from '../event-log/EventLogEntry';
import {
  BackupSnapshot,
  RestoreOptions,
  RestoreResult,
  RestoreEntityStats,
  BackupEntityType,
  BackupEntityData
} from './BackupTypes';
import { BackupRepository } from './BackupRepository';
import { BackupService } from './BackupService';
import { verifyBackupIntegrity } from './BackupCrypto';
import {
  RestoreRejectedError,
  EventLogContinuityError,
  BackupNotFoundError,
  BackupValidationError
} from './BackupErrors';

/**
 * Funções para verificar existência de entidades.
 */
interface RestoreExistenceCheckers {
  eventExists: (eventId: string) => Promise<boolean>;
  observacaoExists: (observacaoId: string) => Promise<boolean>;
  mandateExists: (mandateId: string) => Promise<boolean>;
  reviewCaseExists: (caseId: string) => Promise<boolean>;
  tenantExists: (tenantId: string) => Promise<boolean>;
}

/**
 * Funções para adicionar entidades (append-only).
 */
interface RestoreAppenders {
  appendEvent: (event: EventLogEntry) => Promise<void>;
  appendObservacao: (observacao: unknown) => Promise<void>;
  appendMandate: (mandate: unknown) => Promise<void>;
  appendReviewCase: (reviewCase: unknown) => Promise<void>;
  appendTenant: (tenant: unknown) => Promise<void>;
}

/**
 * Callback para notificar eventos de restore.
 */
type RestoreEventCallback = (
  evento: string,
  backupId: string,
  details: Record<string, unknown>
) => Promise<void>;

/**
 * Serviço de restauração de backups.
 *
 * PRINCÍPIO FUNDAMENTAL: Nunca sobrescreve, apenas adiciona (append-only).
 *
 * Responsabilidades:
 * - Validar backup antes de restaurar
 * - Verificar continuidade do EventLog
 * - Executar dry-run para preview
 * - Restaurar efetivamente com append-only
 */
class RestoreService {
  constructor(
    private repository: BackupRepository,
    private backupService: BackupService,
    private existenceCheckers: RestoreExistenceCheckers,
    private appenders: RestoreAppenders,
    private onEvent?: RestoreEventCallback
  ) {}

  /**
   * Restaura um backup (dry-run ou efetivo).
   */
  async restore(
    backupId: string,
    options: RestoreOptions
  ): Promise<RestoreResult> {
    // Carregar backup
    const snapshot = await this.repository.load(backupId);
    if (!snapshot) {
      throw new BackupNotFoundError(backupId);
    }

    return this.restoreFromSnapshot(snapshot, options);
  }

  /**
   * Restaura a partir de um snapshot já carregado.
   */
  async restoreFromSnapshot(
    snapshot: BackupSnapshot,
    options: RestoreOptions
  ): Promise<RestoreResult> {
    const startTime = new Date();
    const backupId = snapshot.metadata.backupId;

    // 1. Validar integridade do backup
    const integrity = verifyBackupIntegrity(snapshot);
    if (!integrity.valid) {
      if (this.onEvent) {
        await this.onEvent('RESTORE_REJECTED', backupId, {
          reason: 'integrity_check_failed',
          errors: integrity.errors
        });
      }
      throw new RestoreRejectedError(
        'Backup falhou na verificação de integridade',
        integrity.errors.join('; ')
      );
    }

    // 2. Filtrar entidades a restaurar
    const entitiesToRestore = this.filterEntities(snapshot, options);

    // 3. Verificar continuidade do EventLog se aplicável
    if (
      options.verifyEventLogContinuity !== false &&
      entitiesToRestore.some(e => e.entityType === 'EventLog')
    ) {
      await this.verifyEventLogContinuity(snapshot);
    }

    // 4. Calcular estatísticas e executar restauração
    const entityStats: RestoreEntityStats[] = [];
    let totalAdded = 0;
    let totalSkipped = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const entity of entitiesToRestore) {
      const stats = await this.processEntity(
        entity,
        options.mode,
        options.tenantId,
        errors
      );
      entityStats.push(stats);
      totalAdded += stats.toAdd;
      totalSkipped += stats.alreadyExists;

      if (stats.conflicts > 0) {
        warnings.push(
          `${stats.entityType}: ${stats.conflicts} conflitos detectados`
        );
      }
    }

    const success = errors.length === 0;
    const result: RestoreResult = {
      success,
      mode: options.mode,
      backupId,
      entityStats,
      totalAdded,
      totalSkipped,
      errors,
      warnings,
      restoredAt: startTime
    };

    // 5. Notificar evento
    if (this.onEvent) {
      const evento = options.mode === 'dry-run' ? 'RESTORE_DRY_RUN' : 'RESTORE_EXECUTED';
      await this.onEvent(evento, backupId, {
        success,
        totalAdded,
        totalSkipped,
        entityStats: entityStats.map(s => ({
          type: s.entityType,
          added: s.toAdd,
          skipped: s.alreadyExists
        }))
      });
    }

    return result;
  }

  /**
   * Filtra entidades a restaurar com base nas opções.
   */
  private filterEntities(
    snapshot: BackupSnapshot,
    options: RestoreOptions
  ): BackupEntityData[] {
    let entities = snapshot.entities;

    // Filtrar por tipo de entidade
    if (options.includeEntities) {
      entities = entities.filter(e =>
        options.includeEntities!.includes(e.entityType)
      );
    }

    return entities;
  }

  /**
   * Verifica continuidade do EventLog.
   * Em restore append-only, novos eventos devem encadear com os existentes.
   */
  private async verifyEventLogContinuity(snapshot: BackupSnapshot): Promise<void> {
    // Esta verificação é opcional e dependente do contexto.
    // Em um restore completo (após perda total), não há continuidade a verificar.
    // Em um restore parcial, os eventos do backup devem ser posteriores ou
    // já existentes no sistema atual.

    // Por enquanto, apenas validamos que o backup tem eventos ordenados
    const eventLogEntity = snapshot.entities.find(e => e.entityType === 'EventLog');
    if (!eventLogEntity || eventLogEntity.data.length === 0) {
      return;
    }

    const events = eventLogEntity.data as EventLogEntry[];

    // Verificar ordenação e encadeamento interno do backup
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];

      if (curr.previous_hash !== prev.current_hash) {
        throw new EventLogContinuityError(
          'Eventos do backup não estão corretamente encadeados',
          prev.id,
          curr.id
        );
      }
    }
  }

  /**
   * Processa uma entidade para restauração.
   */
  private async processEntity(
    entity: BackupEntityData,
    mode: 'dry-run' | 'effective',
    tenantId: string | undefined,
    errors: string[]
  ): Promise<RestoreEntityStats> {
    const stats: RestoreEntityStats = {
      entityType: entity.entityType,
      totalInBackup: entity.data.length,
      toAdd: 0,
      alreadyExists: 0,
      conflicts: 0
    };

    for (const item of entity.data) {
      try {
        // Filtrar por tenant se especificado
        if (tenantId && this.getItemTenantId(item) !== tenantId) {
          continue;
        }

        const exists = await this.checkExists(entity.entityType, item);

        if (exists) {
          stats.alreadyExists++;
        } else {
          stats.toAdd++;

          // Se modo efetivo, adicionar
          if (mode === 'effective') {
            await this.appendItem(entity.entityType, item);
          }
        }
      } catch (error) {
        stats.conflicts++;
        errors.push(
          `${entity.entityType}: Erro ao processar item - ${(error as Error).message}`
        );
      }
    }

    return stats;
  }

  /**
   * Obtém o tenantId de um item (se aplicável).
   */
  private getItemTenantId(item: unknown): string | undefined {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return obj.tenantId as string | undefined;
    }
    return undefined;
  }

  /**
   * Verifica se um item já existe.
   */
  private async checkExists(
    entityType: BackupEntityType,
    item: unknown
  ): Promise<boolean> {
    const id = this.getItemId(item);
    if (!id) return false;

    switch (entityType) {
      case 'EventLog':
        return this.existenceCheckers.eventExists(id);
      case 'ObservacoesDeConsequencia':
        return this.existenceCheckers.observacaoExists(id);
      case 'AutonomyMandates':
        return this.existenceCheckers.mandateExists(id);
      case 'ReviewCases':
        return this.existenceCheckers.reviewCaseExists(id);
      case 'TenantRegistry':
        return this.existenceCheckers.tenantExists(id);
      default:
        return false;
    }
  }

  /**
   * Adiciona um item (append-only).
   */
  private async appendItem(
    entityType: BackupEntityType,
    item: unknown
  ): Promise<void> {
    switch (entityType) {
      case 'EventLog':
        await this.appenders.appendEvent(item as EventLogEntry);
        break;
      case 'ObservacoesDeConsequencia':
        await this.appenders.appendObservacao(item);
        break;
      case 'AutonomyMandates':
        await this.appenders.appendMandate(item);
        break;
      case 'ReviewCases':
        await this.appenders.appendReviewCase(item);
        break;
      case 'TenantRegistry':
        await this.appenders.appendTenant(item);
        break;
    }
  }

  /**
   * Obtém o ID de um item.
   */
  private getItemId(item: unknown): string | undefined {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      return (obj.id ?? obj.mandateId ?? obj.caseId ?? obj.tenantId) as string | undefined;
    }
    return undefined;
  }

  /**
   * Executa dry-run de um backup.
   */
  async dryRun(backupId: string, options: Omit<RestoreOptions, 'mode'> = {}): Promise<RestoreResult> {
    return this.restore(backupId, { ...options, mode: 'dry-run' });
  }

  /**
   * Executa restauração efetiva de um backup.
   */
  async execute(backupId: string, options: Omit<RestoreOptions, 'mode'> = {}): Promise<RestoreResult> {
    return this.restore(backupId, { ...options, mode: 'effective' });
  }
}

export { RestoreService, RestoreExistenceCheckers, RestoreAppenders, RestoreEventCallback };
