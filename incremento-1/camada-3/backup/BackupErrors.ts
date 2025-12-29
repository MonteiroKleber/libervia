// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: ERROS DE BACKUP & RESTORE
// ════════════════════════════════════════════════════════════════════════

/**
 * Erro base para operações de backup.
 */
class BackupError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Erro de validação de backup.
 */
class BackupValidationError extends BackupError {
  constructor(
    message: string,
    public readonly validationErrors: string[]
  ) {
    super(message, 'BACKUP_VALIDATION_ERROR');
    this.name = 'BackupValidationError';
  }
}

/**
 * Erro de assinatura inválida.
 */
class BackupSignatureError extends BackupError {
  constructor(message: string = 'Assinatura do backup inválida') {
    super(message, 'BACKUP_SIGNATURE_INVALID');
    this.name = 'BackupSignatureError';
  }
}

/**
 * Erro de hash inválido.
 */
class BackupHashError extends BackupError {
  constructor(
    message: string = 'Hash do backup não corresponde ao conteúdo',
    public readonly expectedHash?: string,
    public readonly actualHash?: string
  ) {
    super(message, 'BACKUP_HASH_MISMATCH');
    this.name = 'BackupHashError';
  }
}

/**
 * Erro de backup não encontrado.
 */
class BackupNotFoundError extends BackupError {
  constructor(
    public readonly backupId: string
  ) {
    super(`Backup não encontrado: ${backupId}`, 'BACKUP_NOT_FOUND');
    this.name = 'BackupNotFoundError';
  }
}

/**
 * Erro de formato de backup inválido.
 */
class BackupFormatError extends BackupError {
  constructor(message: string = 'Formato de backup inválido ou corrompido') {
    super(message, 'BACKUP_FORMAT_INVALID');
    this.name = 'BackupFormatError';
  }
}

/**
 * Erro de restauração rejeitada.
 */
class RestoreRejectedError extends BackupError {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message, 'RESTORE_REJECTED');
    this.name = 'RestoreRejectedError';
  }
}

/**
 * Erro de continuidade do EventLog.
 */
class EventLogContinuityError extends BackupError {
  constructor(
    message: string,
    public readonly lastCurrentEventId?: string,
    public readonly firstBackupEventId?: string
  ) {
    super(message, 'EVENTLOG_CONTINUITY_BROKEN');
    this.name = 'EventLogContinuityError';
  }
}

/**
 * Erro de conflito durante restauração.
 */
class RestoreConflictError extends BackupError {
  constructor(
    message: string,
    public readonly entityType: string,
    public readonly entityId: string
  ) {
    super(message, 'RESTORE_CONFLICT');
    this.name = 'RestoreConflictError';
  }
}

/**
 * Erro de procedimento DR.
 */
class DRProcedureError extends BackupError {
  constructor(
    message: string,
    public readonly procedureId: string,
    public readonly stepOrder?: number
  ) {
    super(message, 'DR_PROCEDURE_ERROR');
    this.name = 'DRProcedureError';
  }
}

/**
 * Erro de configuração ausente (ex: LIBERVIA_BACKUP_PEPPER).
 */
class BackupConfigError extends BackupError {
  constructor(
    public readonly configKey: string
  ) {
    super(`Configuração de backup ausente: ${configKey}`, 'BACKUP_CONFIG_MISSING');
    this.name = 'BackupConfigError';
  }
}

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
};
