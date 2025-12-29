// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: TIPOS DE BACKUP & RESTORE
// ════════════════════════════════════════════════════════════════════════

import { EventLogEntry } from '../event-log/EventLogEntry';

/**
 * Entidades que podem ser incluídas em um backup.
 */
type BackupEntityType =
  | 'EventLog'
  | 'ObservacoesDeConsequencia'
  | 'AutonomyMandates'
  | 'ReviewCases'
  | 'TenantRegistry';

/**
 * Metadados de um backup.
 */
interface BackupMetadata {
  /** ID único do backup */
  backupId: string;

  /** Timestamp da criação do backup */
  createdAt: Date;

  /** Tenant do backup (ou 'global' para backup cross-tenant) */
  tenantId: string;

  /** Versão do formato de backup */
  formatVersion: string;

  /** Tipos de entidades incluídas */
  includedEntities: BackupEntityType[];

  /** Contagem de itens por tipo de entidade */
  entityCounts: Record<BackupEntityType, number>;

  /** Hash do último evento do EventLog (se incluído) */
  lastEventHash?: string;

  /** ID do último evento do EventLog (se incluído) */
  lastEventId?: string;
}

/**
 * Dados de uma entidade no backup.
 */
interface BackupEntityData<T = unknown> {
  /** Tipo da entidade */
  entityType: BackupEntityType;

  /** Dados da entidade */
  data: T[];

  /** Hash SHA-256 dos dados serializados */
  dataHash: string;
}

/**
 * Snapshot completo de backup.
 */
interface BackupSnapshot {
  /** Metadados do backup */
  metadata: BackupMetadata;

  /** Dados das entidades */
  entities: BackupEntityData[];

  /** Hash SHA-256 de todo o conteúdo (metadata + entities) */
  contentHash: string;

  /** Assinatura HMAC do contentHash usando LIBERVIA_BACKUP_PEPPER */
  signature: string;
}

/**
 * Opções para criação de backup.
 */
interface BackupOptions {
  /** Tenant específico (opcional, se não especificado faz backup global) */
  tenantId?: string;

  /** Tipos de entidades a incluir (opcional, se não especificado inclui todas) */
  includeEntities?: BackupEntityType[];

  /** Descrição opcional do backup */
  description?: string;
}

/**
 * Resultado da validação de um backup.
 */
interface BackupValidationResult {
  /** Se o backup é válido */
  valid: boolean;

  /** Metadados do backup (se válido) */
  metadata?: BackupMetadata;

  /** Erros encontrados */
  errors: string[];

  /** Avisos (não impedem restore) */
  warnings: string[];
}

/**
 * Modo de restauração.
 */
type RestoreMode = 'dry-run' | 'effective';

/**
 * Opções para restauração de backup.
 */
interface RestoreOptions {
  /** Modo de restauração */
  mode: RestoreMode;

  /** Tipos de entidades a restaurar (opcional, se não especificado restaura todas) */
  includeEntities?: BackupEntityType[];

  /** Tenant específico para restaurar (opcional) */
  tenantId?: string;

  /** Se deve verificar continuidade do EventLog */
  verifyEventLogContinuity?: boolean;
}

/**
 * Estatísticas de restauração por entidade.
 */
interface RestoreEntityStats {
  /** Tipo da entidade */
  entityType: BackupEntityType;

  /** Total de itens no backup */
  totalInBackup: number;

  /** Itens que seriam adicionados (novos) */
  toAdd: number;

  /** Itens já existentes (ignorados - append-only) */
  alreadyExists: number;

  /** Itens com conflito */
  conflicts: number;
}

/**
 * Resultado de uma restauração.
 */
interface RestoreResult {
  /** Se a restauração foi bem-sucedida */
  success: boolean;

  /** Modo utilizado */
  mode: RestoreMode;

  /** ID do backup restaurado */
  backupId: string;

  /** Estatísticas por entidade */
  entityStats: RestoreEntityStats[];

  /** Total de itens adicionados */
  totalAdded: number;

  /** Total de itens ignorados (já existentes) */
  totalSkipped: number;

  /** Erros encontrados */
  errors: string[];

  /** Avisos */
  warnings: string[];

  /** Timestamp da restauração */
  restoredAt: Date;
}

/**
 * Status de um procedimento de Disaster Recovery.
 */
type DRProcedureStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';

/**
 * Tipo de procedimento de Disaster Recovery.
 */
type DRProcedureType =
  | 'total_node_loss'
  | 'corruption_detection'
  | 'old_snapshot_restore'
  | 'controlled_rollback';

/**
 * Passo de um procedimento DR.
 */
interface DRStep {
  /** Ordem do passo */
  order: number;

  /** Descrição do passo */
  description: string;

  /** Status do passo */
  status: DRProcedureStatus;

  /** Timestamp de início */
  startedAt?: Date;

  /** Timestamp de conclusão */
  completedAt?: Date;

  /** Erro (se falhou) */
  error?: string;
}

/**
 * Procedimento de Disaster Recovery.
 */
interface DRProcedure {
  /** ID único do procedimento */
  procedureId: string;

  /** Tipo do procedimento */
  type: DRProcedureType;

  /** Status geral */
  status: DRProcedureStatus;

  /** Passos do procedimento */
  steps: DRStep[];

  /** Timestamp de início */
  startedAt: Date;

  /** Timestamp de conclusão */
  completedAt?: Date;

  /** ID do backup usado (se aplicável) */
  backupId?: string;

  /** Notas do operador */
  notes: string[];
}

/**
 * Informações de um arquivo de backup no disco.
 */
interface BackupFileInfo {
  /** Nome do arquivo */
  filename: string;

  /** Caminho completo */
  path: string;

  /** Tamanho em bytes */
  sizeBytes: number;

  /** Data de modificação */
  modifiedAt: Date;

  /** Metadados extraídos (se backup válido) */
  metadata?: BackupMetadata;
}

export {
  BackupEntityType,
  BackupMetadata,
  BackupEntityData,
  BackupSnapshot,
  BackupOptions,
  BackupValidationResult,
  RestoreMode,
  RestoreOptions,
  RestoreEntityStats,
  RestoreResult,
  DRProcedureStatus,
  DRProcedureType,
  DRStep,
  DRProcedure,
  BackupFileInfo
};
