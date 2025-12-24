import * as crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4: UTILITÁRIO DE HASH (SHA-256)
// ════════════════════════════════════════════════════════════════════════

/**
 * Calcula SHA-256 de uma string.
 * Usado para hash encadeado no EventLog.
 */
function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Calcula o hash de um EventLogEntry para encadeamento.
 *
 * REGRA DE OURO:
 * current_hash = SHA256(
 *   previous_hash +
 *   timestamp +
 *   actor +
 *   evento +
 *   entidade +
 *   entidade_id +
 *   payload_hash
 * )
 */
function computeEventHash(
  previousHash: string | null,
  timestamp: Date,
  actor: string,
  evento: string,
  entidade: string,
  entidadeId: string,
  payloadHash: string
): string {
  const data = [
    previousHash ?? '',
    timestamp.toISOString(),
    actor,
    evento,
    entidade,
    entidadeId,
    payloadHash
  ].join('|');

  return sha256(data);
}

/**
 * Calcula hash do payload de uma entidade.
 * Serializa o objeto e calcula SHA-256.
 */
function computePayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return sha256(serialized);
}

export { sha256, computeEventHash, computePayloadHash };
