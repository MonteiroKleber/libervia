/**
 * CAMADA 6 — MULTI-TENANT: Seguranca
 *
 * Validacao de tenantId e resolucao segura de diretorio.
 *
 * PROTECOES:
 * - Regex restritivo para tenantId
 * - Lista de IDs reservados
 * - Prevencao de path traversal
 * - Modo paranoid com fs.realpath
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regex para tenantId valido:
 * - Apenas letras minusculas, numeros e hifen
 * - Minimo 3, maximo 50 caracteres
 * - Nao pode comecar ou terminar com hifen
 */
export const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * IDs reservados que nao podem ser usados como tenantId
 */
export const RESERVED_IDS = [
  'admin',
  'system',
  'config',
  'backup',
  'logs',
  'tenants',
  'api',
  'public',
  'private',
  'internal',
  'root',
  'null',
  'undefined'
];

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normaliza tenantId para formato canonico
 * - Lowercase
 * - Trim
 */
export function normalizeTenantId(id: string): string {
  if (typeof id !== 'string') {
    return '';
  }
  return id.toLowerCase().trim();
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valida tenantId
 *
 * Regras:
 * - Apenas a-z, 0-9, hifen
 * - 3-50 caracteres
 * - Nao pode comecar/terminar com hifen
 * - Nao pode ser ID reservado
 * - Nao pode conter caracteres perigosos
 */
export function validateTenantId(id: string): ValidationResult {
  // Verificar tipo
  if (typeof id !== 'string') {
    return { valid: false, error: 'TenantId deve ser uma string' };
  }

  const normalized = normalizeTenantId(id);

  // Verificar comprimento
  if (normalized.length < 3) {
    return { valid: false, error: 'TenantId deve ter no minimo 3 caracteres' };
  }

  if (normalized.length > 50) {
    return { valid: false, error: 'TenantId deve ter no maximo 50 caracteres' };
  }

  // Verificar caracteres perigosos ANTES do regex
  const dangerousChars = ['/', '\\', '..', '~', '$', '%', '\0', '\n', '\r'];
  for (const char of dangerousChars) {
    if (normalized.includes(char)) {
      return { valid: false, error: `TenantId contem caractere invalido: ${char}` };
    }
  }

  // Verificar formato com regex
  if (!TENANT_ID_REGEX.test(normalized)) {
    return {
      valid: false,
      error: 'TenantId invalido: use apenas a-z, 0-9, hifen; nao pode comecar/terminar com hifen'
    };
  }

  // Verificar hifen duplo
  if (normalized.includes('--')) {
    return { valid: false, error: 'TenantId nao pode conter hifen duplo' };
  }

  // Verificar IDs reservados
  if (RESERVED_IDS.includes(normalized)) {
    return { valid: false, error: `TenantId reservado: ${normalized}` };
  }

  return { valid: true };
}

// ════════════════════════════════════════════════════════════════════════════
// RESOLUCAO DE DIRETORIO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve dataDir de forma segura para um tenant
 *
 * Estrutura: baseDir/tenants/<tenantId>
 *
 * Protecoes:
 * 1. Valida tenantId
 * 2. Normaliza path
 * 3. Verifica que resultado esta DENTRO de baseDir/tenants
 * 4. Se paranoid=true, usa fs.realpath para evitar symlink escape
 *
 * @param baseDir - Diretorio base (ex: /var/lib/libervia)
 * @param tenantId - ID do tenant
 * @param paranoid - Se true, verifica realpath (mais lento, mais seguro)
 * @returns Path absoluto para o diretorio do tenant
 * @throws Error se tenantId invalido ou path traversal detectado
 */
export async function resolveTenantDataDir(
  baseDir: string,
  tenantId: string,
  paranoid: boolean = false
): Promise<string> {
  // 1. Validar tenantId
  const validation = validateTenantId(tenantId);
  if (!validation.valid) {
    throw new Error(`TenantId invalido: ${validation.error}`);
  }

  // 2. Normalizar tenantId
  const normalizedId = normalizeTenantId(tenantId);

  // 3. Construir path esperado
  const tenantsDir = path.join(baseDir, 'tenants');
  const candidatePath = path.join(tenantsDir, normalizedId);

  // 4. Resolver para path absoluto (elimina . e ..)
  const resolvedPath = path.resolve(candidatePath);
  const resolvedTenantsDir = path.resolve(tenantsDir);

  // 5. Verificar que resultado esta dentro de tenantsDir
  // Usa path.sep para garantir que nao e apenas prefixo parcial
  if (!resolvedPath.startsWith(resolvedTenantsDir + path.sep)) {
    throw new Error('Path traversal detectado');
  }

  // 6. Modo paranoid: verificar realpath
  if (paranoid) {
    try {
      // Verificar se tenantsDir existe (para poder fazer realpath)
      await fs.mkdir(tenantsDir, { recursive: true });

      // Verificar se o diretorio do tenant existe
      try {
        await fs.access(candidatePath);
        // Se existe, verificar realpath
        const realResolved = await fs.realpath(resolvedPath);
        const realTenantsDir = await fs.realpath(tenantsDir);

        if (!realResolved.startsWith(realTenantsDir + path.sep)) {
          throw new Error('Symlink escape detectado (modo paranoid)');
        }
      } catch (err: unknown) {
        // Se diretorio nao existe, tudo bem - sera criado depois
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('detectado')) {
        throw err;
      }
      // Outros erros sao ignorados (diretorio pode nao existir ainda)
    }
  }

  return resolvedPath;
}

/**
 * Versao sincrona de resolveTenantDataDir (sem modo paranoid)
 * Util para validacoes rapidas onde async nao e necessario
 */
export function resolveTenantDataDirSync(
  baseDir: string,
  tenantId: string
): string {
  // 1. Validar tenantId
  const validation = validateTenantId(tenantId);
  if (!validation.valid) {
    throw new Error(`TenantId invalido: ${validation.error}`);
  }

  // 2. Normalizar tenantId
  const normalizedId = normalizeTenantId(tenantId);

  // 3. Construir e resolver path
  const tenantsDir = path.join(baseDir, 'tenants');
  const candidatePath = path.join(tenantsDir, normalizedId);
  const resolvedPath = path.resolve(candidatePath);
  const resolvedTenantsDir = path.resolve(tenantsDir);

  // 4. Verificar que resultado esta dentro de tenantsDir
  if (!resolvedPath.startsWith(resolvedTenantsDir + path.sep)) {
    throw new Error('Path traversal detectado');
  }

  return resolvedPath;
}

// ════════════════════════════════════════════════════════════════════════════
// TOKEN HASHING & VALIDATION (Inc 12.1 - HMAC with pepper)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cache do pepper para evitar leitura repetida de env var
 */
let cachedPepper: string | null = null;

/**
 * Obtem o pepper de autenticacao da env var LIBERVIA_AUTH_PEPPER.
 * O pepper deve ter pelo menos 16 caracteres.
 *
 * @throws Error se a env var nao existir ou for muito curta
 */
export function getAuthPepper(): string {
  if (cachedPepper !== null) {
    return cachedPepper;
  }

  const pepper = process.env.LIBERVIA_AUTH_PEPPER;

  if (!pepper) {
    throw new Error(
      'Missing LIBERVIA_AUTH_PEPPER environment variable. ' +
      'This is required for secure token hashing. ' +
      'Set a random string with at least 16 characters.'
    );
  }

  if (pepper.length < 16) {
    throw new Error(
      'LIBERVIA_AUTH_PEPPER must be at least 16 characters long.'
    );
  }

  cachedPepper = pepper;
  return pepper;
}

/**
 * Limpa o cache do pepper (util para testes)
 */
export function clearPepperCache(): void {
  cachedPepper = null;
}

/**
 * Gera um token aleatorio seguro (32 bytes em base64url)
 * Retorna aproximadamente 43 caracteres
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Gera um keyId unico
 * Formato: key_<12 caracteres alfanumericos>
 */
export function generateKeyId(): string {
  const suffix = crypto.randomBytes(9).toString('base64url').slice(0, 12);
  return `key_${suffix}`;
}

/**
 * Calcula HMAC-SHA-256 de um token usando o pepper do servidor.
 * Retorna hash em formato hex (64 caracteres).
 *
 * Este e o metodo PREFERIDO para novas keys (Inc 12.1+).
 */
export function hmacToken(token: string): string {
  const pepper = getAuthPepper();
  return crypto.createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

/**
 * Calcula hash SHA-256 puro de um token (LEGACY).
 * Retorna hash em formato hex (64 caracteres).
 *
 * Usado apenas para compatibilidade com keys criadas antes do Inc 12.1.
 * @deprecated Use hmacToken() para novas keys
 */
export function sha256Token(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Alias para sha256Token - mantido para compatibilidade
 * @deprecated Use hmacToken() para novas keys
 */
export function hashToken(token: string): string {
  return sha256Token(token);
}

/**
 * Compara dois hashes hex de forma segura (timing-safe).
 * Converte de hex para bytes antes de comparar.
 * Previne timing attacks.
 */
export function secureCompareHashes(hash1: string, hash2: string): boolean {
  if (typeof hash1 !== 'string' || typeof hash2 !== 'string') {
    return false;
  }

  // Validar que ambos sao hex de 64 caracteres (SHA-256 output)
  if (hash1.length !== 64 || hash2.length !== 64) {
    return false;
  }

  try {
    // Converter de hex para bytes para comparacao correta
    const buf1 = Buffer.from(hash1, 'hex');
    const buf2 = Buffer.from(hash2, 'hex');

    // Buffers devem ter 32 bytes cada (256 bits)
    if (buf1.length !== 32 || buf2.length !== 32) {
      return false;
    }

    return crypto.timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

/**
 * Compara duas strings de forma segura (timing-safe).
 * Util para comparar apiToken legado ou outras strings.
 * Lida com tamanhos diferentes sem vazar timing significativo.
 */
export function secureCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Converter para buffers
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Se tamanhos diferentes, fazer comparacao dummy e retornar false
  // Isso evita leak de timing baseado em tamanho
  if (bufA.length !== bufB.length) {
    // Comparar bufA consigo mesmo para manter timing constante
    try {
      crypto.timingSafeEqual(bufA, bufA);
    } catch {
      // Ignorar erro
    }
    return false;
  }

  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Valida um token contra um hash armazenado.
 * Implementa dual-verify para compatibilidade:
 * 1. Primeiro tenta HMAC-SHA-256 (novo padrao Inc 12.1+)
 * 2. Se nao bater, tenta SHA-256 puro (legacy pre-12.1)
 *
 * @param token Token em plaintext a validar
 * @param storedHash Hash armazenado (hex 64 chars)
 * @returns true se o token for valido
 */
export function validateToken(token: string, storedHash: string): boolean {
  if (!token || !storedHash) {
    return false;
  }

  // Validar formato do hash armazenado
  if (typeof storedHash !== 'string' || storedHash.length !== 64) {
    return false;
  }

  // 1. Tentar HMAC (novo padrao)
  try {
    const hmacHash = hmacToken(token);
    if (secureCompareHashes(hmacHash, storedHash)) {
      return true;
    }
  } catch {
    // Se falhar (ex: pepper nao configurado), continuar para legacy
  }

  // 2. Fallback: tentar SHA-256 puro (legacy)
  const sha256Hash = sha256Token(token);
  return secureCompareHashes(sha256Hash, storedHash);
}
