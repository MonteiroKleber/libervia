// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: EXPORTS DO MÓDULO DE BACKUP
// ════════════════════════════════════════════════════════════════════════

// Tipos
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
} from './BackupTypes';

// Erros
export {
  BackupError,
  BackupValidationError,
  BackupSignatureError,
  BackupHashError,
  BackupNotFoundError,
  BackupFormatError,
  RestoreRejectedError,
  EventLogContinuityError,
  RestoreConflictError,
  DRProcedureError,
  BackupConfigError
} from './BackupErrors';

// Crypto
export {
  BACKUP_PEPPER_ENV_KEY,
  BACKUP_FORMAT_VERSION,
  getBackupPepper,
  sha256,
  serializeForHash,
  computeBackupContentHash,
  computeEntityDataHash,
  computeBackupSignature,
  verifyBackupSignature,
  verifyBackupIntegrity,
  generateBackupId,
  generateBackupFilename
} from './BackupCrypto';

// Metadata
export {
  ALL_BACKUP_ENTITIES,
  createBackupMetadata,
  validateBackupMetadata,
  validateBackupStructure,
  getBackupSummary,
  isBackupVersionCompatible,
  parseBackupDate,
  normalizeBackupMetadata
} from './BackupMetadata';

// Repository
export { BackupRepository } from './BackupRepository';
export { BackupRepositoryImpl } from './BackupRepositoryImpl';

// Services
export { BackupService, BackupDataProviders, BackupEventCallback } from './BackupService';
export { RestoreService, RestoreExistenceCheckers, RestoreAppenders, RestoreEventCallback } from './RestoreService';
export { DisasterRecoveryService, DRProgressCallback } from './DisasterRecoveryService';
