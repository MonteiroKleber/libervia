// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: CRIPTOGRAFIA DE BACKUP
// ════════════════════════════════════════════════════════════════════════

import * as crypto from 'crypto';
import { BackupConfigError, BackupSignatureError, BackupHashError } from './BackupErrors';
import { BackupSnapshot, BackupMetadata, BackupEntityData } from './BackupTypes';

/**
 * Chave de ambiente para o pepper de assinatura de backups.
 */
const BACKUP_PEPPER_ENV_KEY = 'LIBERVIA_BACKUP_PEPPER';

/**
 * Versão atual do formato de backup.
 */
const BACKUP_FORMAT_VERSION = '1.0.0';

/**
 * Obtém o pepper de assinatura do ambiente.
 * Lança BackupConfigError se não estiver configurado.
 */
function getBackupPepper(): string {
  const pepper = process.env[BACKUP_PEPPER_ENV_KEY];
  if (!pepper) {
    throw new BackupConfigError(BACKUP_PEPPER_ENV_KEY);
  }
  return pepper;
}

/**
 * Calcula SHA-256 de uma string.
 */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Serializa dados de forma determinística para hashing.
 * Ordena chaves de objetos para garantir consistência.
 */
function serializeForHash(data: unknown): string {
  return JSON.stringify(data, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

/**
 * Calcula hash do conteúdo de um backup (metadata + entities).
 */
function computeBackupContentHash(metadata: BackupMetadata, entities: BackupEntityData[]): string {
  const content = {
    metadata: {
      ...metadata,
      createdAt: metadata.createdAt instanceof Date
        ? metadata.createdAt.toISOString()
        : metadata.createdAt
    },
    entities: entities.map(e => ({
      entityType: e.entityType,
      dataHash: e.dataHash
    }))
  };
  return sha256(serializeForHash(content));
}

/**
 * Calcula hash dos dados de uma entidade.
 */
function computeEntityDataHash(data: unknown[]): string {
  return sha256(serializeForHash(data));
}

/**
 * Calcula assinatura HMAC-SHA256 de um hash usando o pepper.
 */
function computeBackupSignature(contentHash: string, pepper?: string): string {
  const key = pepper ?? getBackupPepper();
  return crypto
    .createHmac('sha256', key)
    .update(contentHash)
    .digest('hex');
}

/**
 * Verifica se a assinatura de um backup é válida.
 */
function verifyBackupSignature(
  contentHash: string,
  signature: string,
  pepper?: string
): boolean {
  const expectedSignature = computeBackupSignature(contentHash, pepper);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Verifica integridade completa de um backup.
 * Retorna objeto com status e erros.
 */
function verifyBackupIntegrity(
  snapshot: BackupSnapshot,
  pepper?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Verificar hashes das entidades
  for (const entity of snapshot.entities) {
    const computedHash = computeEntityDataHash(entity.data);
    if (computedHash !== entity.dataHash) {
      errors.push(
        `Hash inválido para entidade ${entity.entityType}: ` +
        `esperado ${entity.dataHash}, obtido ${computedHash}`
      );
    }
  }

  // 2. Verificar hash do conteúdo
  const computedContentHash = computeBackupContentHash(
    snapshot.metadata,
    snapshot.entities
  );
  if (computedContentHash !== snapshot.contentHash) {
    errors.push(
      `Hash de conteúdo inválido: esperado ${snapshot.contentHash}, ` +
      `obtido ${computedContentHash}`
    );
  }

  // 3. Verificar assinatura
  try {
    const signatureValid = verifyBackupSignature(
      snapshot.contentHash,
      snapshot.signature,
      pepper
    );
    if (!signatureValid) {
      errors.push('Assinatura HMAC inválida');
    }
  } catch (error) {
    if (error instanceof BackupConfigError) {
      errors.push(`Configuração ausente: ${error.configKey}`);
    } else {
      errors.push(`Erro ao verificar assinatura: ${(error as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Gera ID único para backup.
 * Formato: backup_<tenantId>_<timestamp>_<random>
 */
function generateBackupId(tenantId: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `backup_${tenantId}_${timestamp}_${random}`;
}

/**
 * Gera nome de arquivo para backup.
 * Formato: backup_<tenantId>_<YYYYMMDD-HHmmss>.json
 */
function generateBackupFilename(tenantId: string, date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
  return `backup_${tenantId}_${timestamp}.json`;
}

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
};
