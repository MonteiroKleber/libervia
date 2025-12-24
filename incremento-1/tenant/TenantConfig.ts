/**
 * CAMADA 6 — MULTI-TENANT: Configuracao de Tenants
 *
 * Define tipos e estruturas para configuracao de tenants (instituicoes).
 *
 * PRINCIPIOS:
 * - Tenant = instituicao isolada por dataDir
 * - Sem referencia a implementacoes especificas (Bazari, etc)
 * - Quotas e features configuraveis por tenant
 */

// ════════════════════════════════════════════════════════════════════════════
// ROLES (RBAC)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Papeis de acesso no sistema (RBAC minimo)
 *
 * - 'public': acesso as rotas cognitivas publicas do tenant (/api/v1/*)
 * - 'tenant_admin': acesso as rotas admin do proprio tenant (audit, metrics)
 * - 'global_admin': acesso a todas as rotas admin (CRUD tenants, metricas globais)
 */
export type TenantRole = 'public' | 'tenant_admin' | 'global_admin';

/**
 * Status de uma chave de autenticacao
 */
export type KeyStatus = 'active' | 'revoked';

/**
 * Chave de autenticacao de um tenant
 *
 * Tokens NUNCA sao armazenados em texto puro - apenas o hash.
 */
export interface TenantAuthKey {
  /**
   * ID unico da chave (ex: 'key_abc123')
   */
  keyId: string;

  /**
   * Papel associado a esta chave
   */
  role: TenantRole;

  /**
   * Hash SHA-256 do token (hex)
   * O token plaintext e retornado apenas UMA vez na criacao
   */
  tokenHash: string;

  /**
   * Status da chave
   */
  status: KeyStatus;

  /**
   * Data de criacao (ISO 8601)
   */
  createdAt: string;

  /**
   * Data do ultimo uso (ISO 8601) - opcional
   */
  lastUsedAt?: string;

  /**
   * Descricao opcional da chave
   */
  description?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// STATUS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Status do tenant no ciclo de vida
 */
export type TenantStatus = 'active' | 'suspended' | 'deleted';

// ════════════════════════════════════════════════════════════════════════════
// QUOTAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Quotas e limites por tenant
 */
export interface TenantQuotas {
  /**
   * Maximo de eventos no EventLog (0 = ilimitado)
   */
  maxEvents: number;

  /**
   * Espaco maximo em disco em MB (0 = ilimitado)
   */
  maxStorageMB: number;

  /**
   * Rate limit: requisicoes por minuto (0 = ilimitado)
   */
  rateLimitRpm: number;
}

/**
 * Quotas padrao para novos tenants
 */
export const DEFAULT_QUOTAS: TenantQuotas = {
  maxEvents: 10_000_000,    // 10M eventos
  maxStorageMB: 10_240,     // 10 GB
  rateLimitRpm: 1000        // 1000 req/min
};

// ════════════════════════════════════════════════════════════════════════════
// FEATURES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Features habilitadas por tenant
 */
export interface TenantFeatures {
  /**
   * Backup automatico habilitado
   */
  backupEnabled: boolean;

  /**
   * Usar backup assinado (Ed25519)
   */
  signedBackup: boolean;
}

/**
 * Features padrao para novos tenants
 */
export const DEFAULT_FEATURES: TenantFeatures = {
  backupEnabled: true,
  signedBackup: false
};

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACAO PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Configuracao completa de um tenant
 */
export interface TenantConfig {
  /**
   * ID unico do tenant (slug normalizado)
   * Exemplo: "acme-corp", "globex-inc"
   */
  id: string;

  /**
   * Nome legivel da instituicao
   * Exemplo: "ACME Corporation"
   */
  name: string;

  /**
   * Status atual do tenant
   */
  status: TenantStatus;

  /**
   * Data de criacao (ISO 8601)
   */
  createdAt: string;

  /**
   * Data de ultima atualizacao (ISO 8601)
   */
  updatedAt: string;

  /**
   * Quotas e limites
   */
  quotas: TenantQuotas;

  /**
   * Features habilitadas
   */
  features: TenantFeatures;

  /**
   * Metadados adicionais (extensivel)
   */
  metadata?: Record<string, unknown>;

  /**
   * @deprecated Use 'keys' em vez disso. Mantido para compatibilidade.
   * Token de API legado para autenticacao de requisicoes do tenant.
   * Sera migrado automaticamente para 'keys' na primeira leitura.
   */
  apiToken?: string;

  /**
   * Chaves de autenticacao do tenant (RBAC).
   * Cada chave tem um papel (role) e um hash do token.
   */
  keys?: TenantAuthKey[];
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tipo para overrides de criacao/atualizacao
 * Permite passar quotas/features parciais que serao mesclados com defaults
 */
export interface TenantConfigOverrides {
  quotas?: Partial<TenantQuotas>;
  features?: Partial<TenantFeatures>;
  metadata?: Record<string, unknown>;
}

/**
 * Cria uma configuracao de tenant com valores padrao
 */
export function createTenantConfig(
  id: string,
  name: string,
  overrides?: TenantConfigOverrides
): TenantConfig {
  const now = new Date().toISOString();

  return {
    id,
    name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    quotas: { ...DEFAULT_QUOTAS, ...overrides?.quotas },
    features: { ...DEFAULT_FEATURES, ...overrides?.features },
    metadata: overrides?.metadata
  };
}

/**
 * Tipo para input de registro (campos obrigatorios minimos)
 */
export interface TenantRegistrationInput {
  id: string;
  name: string;
  quotas?: Partial<TenantQuotas>;
  features?: Partial<TenantFeatures>;
  metadata?: Record<string, unknown>;
  /**
   * Token de API opcional. Se nao fornecido, sera gerado automaticamente.
   */
  apiToken?: string;
}

/**
 * Tipo para input de atualizacao (permite parciais)
 */
export interface TenantUpdateInput {
  name?: string;
  quotas?: Partial<TenantQuotas>;
  features?: Partial<TenantFeatures>;
  metadata?: Record<string, unknown>;
}
