// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: UTILITÁRIOS DE METADADOS DE BACKUP
// ════════════════════════════════════════════════════════════════════════

import {
  BackupMetadata,
  BackupEntityType,
  BackupSnapshot,
  BackupValidationResult
} from './BackupTypes';
import { BACKUP_FORMAT_VERSION, generateBackupId } from './BackupCrypto';
import { BackupFormatError } from './BackupErrors';

/**
 * Todas as entidades suportadas para backup.
 */
const ALL_BACKUP_ENTITIES: BackupEntityType[] = [
  'EventLog',
  'ObservacoesDeConsequencia',
  'AutonomyMandates',
  'ReviewCases',
  'TenantRegistry'
];

/**
 * Cria metadados para um novo backup.
 */
function createBackupMetadata(
  tenantId: string,
  includedEntities: BackupEntityType[] = ALL_BACKUP_ENTITIES,
  entityCounts: Partial<Record<BackupEntityType, number>> = {}
): BackupMetadata {
  const fullCounts: Record<BackupEntityType, number> = {
    EventLog: 0,
    ObservacoesDeConsequencia: 0,
    AutonomyMandates: 0,
    ReviewCases: 0,
    TenantRegistry: 0,
    ...entityCounts
  };

  return {
    backupId: generateBackupId(tenantId),
    createdAt: new Date(),
    tenantId,
    formatVersion: BACKUP_FORMAT_VERSION,
    includedEntities,
    entityCounts: fullCounts
  };
}

/**
 * Valida estrutura de metadados de backup.
 */
function validateBackupMetadata(metadata: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, errors: ['Metadados ausentes ou inválidos'] };
  }

  const m = metadata as Record<string, unknown>;

  // Campos obrigatórios
  if (!m.backupId || typeof m.backupId !== 'string') {
    errors.push('Campo backupId ausente ou inválido');
  }

  if (!m.createdAt) {
    errors.push('Campo createdAt ausente');
  }

  if (!m.tenantId || typeof m.tenantId !== 'string') {
    errors.push('Campo tenantId ausente ou inválido');
  }

  if (!m.formatVersion || typeof m.formatVersion !== 'string') {
    errors.push('Campo formatVersion ausente ou inválido');
  }

  if (!Array.isArray(m.includedEntities)) {
    errors.push('Campo includedEntities ausente ou não é array');
  } else {
    for (const entity of m.includedEntities) {
      if (!ALL_BACKUP_ENTITIES.includes(entity as BackupEntityType)) {
        errors.push(`Tipo de entidade desconhecido: ${entity}`);
      }
    }
  }

  if (!m.entityCounts || typeof m.entityCounts !== 'object') {
    errors.push('Campo entityCounts ausente ou inválido');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida estrutura completa de um snapshot de backup.
 */
function validateBackupStructure(snapshot: unknown): BackupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!snapshot || typeof snapshot !== 'object') {
    return {
      valid: false,
      errors: ['Snapshot ausente ou inválido'],
      warnings: []
    };
  }

  const s = snapshot as Record<string, unknown>;

  // Validar metadados
  const metadataValidation = validateBackupMetadata(s.metadata);
  if (!metadataValidation.valid) {
    errors.push(...metadataValidation.errors.map(e => `Metadados: ${e}`));
  }

  // Validar entities
  if (!Array.isArray(s.entities)) {
    errors.push('Campo entities ausente ou não é array');
  } else {
    for (let i = 0; i < s.entities.length; i++) {
      const entity = s.entities[i] as Record<string, unknown>;
      if (!entity.entityType || typeof entity.entityType !== 'string') {
        errors.push(`Entity[${i}]: campo entityType ausente ou inválido`);
      }
      if (!Array.isArray(entity.data)) {
        errors.push(`Entity[${i}]: campo data ausente ou não é array`);
      }
      if (!entity.dataHash || typeof entity.dataHash !== 'string') {
        errors.push(`Entity[${i}]: campo dataHash ausente ou inválido`);
      }
    }
  }

  // Validar campos de integridade
  if (!s.contentHash || typeof s.contentHash !== 'string') {
    errors.push('Campo contentHash ausente ou inválido');
  }

  if (!s.signature || typeof s.signature !== 'string') {
    errors.push('Campo signature ausente ou inválido');
  }

  // Avisos
  if (metadataValidation.valid) {
    const m = s.metadata as BackupMetadata;
    if (m.formatVersion !== BACKUP_FORMAT_VERSION) {
      warnings.push(
        `Versão de formato diferente: ${m.formatVersion} (atual: ${BACKUP_FORMAT_VERSION})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    metadata: errors.length === 0 ? (s.metadata as BackupMetadata) : undefined,
    errors,
    warnings
  };
}

/**
 * Extrai informações resumidas de um backup.
 */
function getBackupSummary(snapshot: BackupSnapshot): {
  backupId: string;
  tenantId: string;
  createdAt: Date;
  totalEntities: number;
  totalItems: number;
  includedTypes: BackupEntityType[];
} {
  const totalItems = Object.values(snapshot.metadata.entityCounts)
    .reduce((sum, count) => sum + count, 0);

  return {
    backupId: snapshot.metadata.backupId,
    tenantId: snapshot.metadata.tenantId,
    createdAt: snapshot.metadata.createdAt,
    totalEntities: snapshot.entities.length,
    totalItems,
    includedTypes: snapshot.metadata.includedEntities
  };
}

/**
 * Verifica se um backup é compatível com a versão atual.
 */
function isBackupVersionCompatible(formatVersion: string): boolean {
  const [major] = formatVersion.split('.');
  const [currentMajor] = BACKUP_FORMAT_VERSION.split('.');
  return major === currentMajor;
}

/**
 * Parse de data que pode ser string ISO ou Date.
 */
function parseBackupDate(date: string | Date): Date {
  if (date instanceof Date) {
    return date;
  }
  return new Date(date);
}

/**
 * Normaliza metadados de backup (converte datas, etc).
 */
function normalizeBackupMetadata(metadata: BackupMetadata): BackupMetadata {
  return {
    ...metadata,
    createdAt: parseBackupDate(metadata.createdAt)
  };
}

export {
  ALL_BACKUP_ENTITIES,
  createBackupMetadata,
  validateBackupMetadata,
  validateBackupStructure,
  getBackupSummary,
  isBackupVersionCompatible,
  parseBackupDate,
  normalizeBackupMetadata
};
