/**
 * CAMADA 6 — MULTI-TENANT: Registry de Tenants
 *
 * Gerencia o cadastro e ciclo de vida de tenants.
 *
 * RESPONSABILIDADES:
 * - Registrar novos tenants
 * - Persistir configuracoes em config/tenants.json
 * - Gerenciar status (active, suspended, deleted)
 * - Validar unicidade de tenantId
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import {
  TenantConfig,
  TenantRegistrationInput,
  TenantUpdateInput,
  TenantAuthKey,
  TenantRole,
  createTenantConfig
} from './TenantConfig';
import {
  validateTenantId,
  normalizeTenantId,
  resolveTenantDataDir,
  generateSecureToken,
  generateKeyId,
  hmacToken,
  sha256Token,
  validateToken,
  secureCompare
} from './TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS ADICIONAIS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da criacao de uma chave
 * Inclui o token plaintext (retornado APENAS UMA VEZ)
 */
export interface CreateKeyResult {
  keyId: string;
  role: TenantRole;
  token: string; // Plaintext - retornado apenas na criacao
  createdAt: string;
}

/**
 * Contexto de autenticacao apos validacao de token
 */
export interface AuthContext {
  role: TenantRole;
  tenantId?: string;
  keyId: string;
}

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

interface RegistryData {
  version: number;
  tenants: TenantConfig[];
  updatedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTACAO
// ════════════════════════════════════════════════════════════════════════════

export class TenantRegistry {
  private baseDir: string;
  private configPath: string;
  private tenants: Map<string, TenantConfig> = new Map();
  private initialized: boolean = false;
  private persistLock: Promise<void> = Promise.resolve();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.configPath = path.join(baseDir, 'config', 'tenants.json');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FACTORY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria e inicializa o registry
   */
  static async create(baseDir: string): Promise<TenantRegistry> {
    const registry = new TenantRegistry(baseDir);
    await registry.init();
    return registry;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INICIALIZACAO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Inicializa o registry, carregando dados do disco
   */
  async init(): Promise<void> {
    // Criar diretorios se nao existem
    await fs.mkdir(path.join(this.baseDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'tenants'), { recursive: true });

    // Carregar dados existentes
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const data: RegistryData = JSON.parse(content);

      this.tenants.clear();
      for (const tenant of data.tenants) {
        this.tenants.set(tenant.id, tenant);
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // Arquivo nao existe, comecar com registry vazio
    }

    this.initialized = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PERSISTENCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Persiste o estado atual no disco.
   * Usa lock para evitar race conditions entre chamadas concorrentes.
   */
  private async persist(): Promise<void> {
    // Inc 12.2.1: Serialize persist calls to avoid race conditions
    // when fire-and-forget calls (validateTenantToken) overlap with awaited calls
    const doWrite = async (): Promise<void> => {
      const data: RegistryData = {
        version: 1,
        tenants: Array.from(this.tenants.values()),
        updatedAt: new Date().toISOString()
      };

      // Garantir que o diretorio config existe
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // Escrita atomica: escrever em .tmp e renomear
      const tmpPath = this.configPath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.configPath);
    };

    // Chain onto existing persist operation to serialize writes
    this.persistLock = this.persistLock.then(doWrite, doWrite);
    return this.persistLock;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERIFICACAO
  // ══════════════════════════════════════════════════════════════════════════

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error('TenantRegistry nao inicializado. Use TenantRegistry.create()');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRUD
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Registra um novo tenant
   *
   * @throws Error se tenantId invalido ou ja existir
   */
  async register(input: TenantRegistrationInput): Promise<TenantConfig> {
    this.checkInitialized();

    // Validar tenantId
    const validation = validateTenantId(input.id);
    if (!validation.valid) {
      throw new Error(`TenantId invalido: ${validation.error}`);
    }

    const normalizedId = normalizeTenantId(input.id);

    // Verificar se ja existe
    if (this.tenants.has(normalizedId)) {
      throw new Error(`Tenant ja existe: ${normalizedId}`);
    }

    // Criar configuracao
    const config = createTenantConfig(normalizedId, input.name, {
      quotas: input.quotas,
      features: input.features,
      metadata: input.metadata
    });

    // Incluir apiToken se fornecido
    if (input.apiToken) {
      config.apiToken = input.apiToken;
    }

    // Criar diretorio do tenant
    const tenantDir = await resolveTenantDataDir(this.baseDir, normalizedId);
    await fs.mkdir(tenantDir, { recursive: true });

    // Salvar no registry
    this.tenants.set(normalizedId, config);
    await this.persist();

    return config;
  }

  /**
   * Obtem configuracao de um tenant
   */
  get(tenantId: string): TenantConfig | null {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    return this.tenants.get(normalizedId) || null;
  }

  /**
   * Lista todos os tenants (exceto deletados, por padrao)
   */
  list(includeDeleted: boolean = false): TenantConfig[] {
    this.checkInitialized();

    const all = Array.from(this.tenants.values());

    if (includeDeleted) {
      return all;
    }

    return all.filter(t => t.status !== 'deleted');
  }

  /**
   * Lista apenas tenants ativos
   */
  listActive(): TenantConfig[] {
    this.checkInitialized();

    return Array.from(this.tenants.values()).filter(t => t.status === 'active');
  }

  /**
   * Atualiza configuracao de um tenant
   *
   * @throws Error se tenant nao existir
   */
  async update(
    tenantId: string,
    partial: TenantUpdateInput
  ): Promise<TenantConfig> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const existing = this.tenants.get(normalizedId);

    if (!existing) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    // Atualizar campos permitidos
    const updated: TenantConfig = {
      ...existing,
      name: partial.name ?? existing.name,
      quotas: partial.quotas ? { ...existing.quotas, ...partial.quotas } : existing.quotas,
      features: partial.features ? { ...existing.features, ...partial.features } : existing.features,
      metadata: partial.metadata !== undefined ? partial.metadata : existing.metadata,
      updatedAt: new Date().toISOString()
    };

    this.tenants.set(normalizedId, updated);
    await this.persist();

    return updated;
  }

  /**
   * Suspende um tenant (bloqueia novos acessos)
   *
   * @throws Error se tenant nao existir ou nao estiver ativo
   */
  async suspend(tenantId: string): Promise<TenantConfig> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const existing = this.tenants.get(normalizedId);

    if (!existing) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    if (existing.status !== 'active') {
      throw new Error(`Tenant nao esta ativo: ${normalizedId} (status: ${existing.status})`);
    }

    const updated: TenantConfig = {
      ...existing,
      status: 'suspended',
      updatedAt: new Date().toISOString()
    };

    this.tenants.set(normalizedId, updated);
    await this.persist();

    return updated;
  }

  /**
   * Reativa um tenant suspenso
   *
   * @throws Error se tenant nao existir ou nao estiver suspenso
   */
  async resume(tenantId: string): Promise<TenantConfig> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const existing = this.tenants.get(normalizedId);

    if (!existing) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    if (existing.status !== 'suspended') {
      throw new Error(`Tenant nao esta suspenso: ${normalizedId} (status: ${existing.status})`);
    }

    const updated: TenantConfig = {
      ...existing,
      status: 'active',
      updatedAt: new Date().toISOString()
    };

    this.tenants.set(normalizedId, updated);
    await this.persist();

    return updated;
  }

  /**
   * Remove um tenant (soft delete)
   * Os dados permanecem no disco para auditoria
   *
   * @throws Error se tenant nao existir
   */
  async remove(tenantId: string): Promise<TenantConfig> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const existing = this.tenants.get(normalizedId);

    if (!existing) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    if (existing.status === 'deleted') {
      throw new Error(`Tenant ja foi removido: ${normalizedId}`);
    }

    const updated: TenantConfig = {
      ...existing,
      status: 'deleted',
      updatedAt: new Date().toISOString()
    };

    this.tenants.set(normalizedId, updated);
    await this.persist();

    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica se um tenant existe
   */
  exists(tenantId: string): boolean {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    return this.tenants.has(normalizedId);
  }

  /**
   * Verifica se um tenant esta ativo
   */
  isActive(tenantId: string): boolean {
    const config = this.get(tenantId);
    return config?.status === 'active';
  }

  /**
   * Obtem o dataDir de um tenant
   */
  async getDataDir(tenantId: string): Promise<string> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);

    if (!this.tenants.has(normalizedId)) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    return resolveTenantDataDir(this.baseDir, normalizedId);
  }

  /**
   * Retorna o diretorio base
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // KEY MANAGEMENT (RBAC)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Migra apiToken legado para o novo sistema de keys.
   * Chamado automaticamente na leitura de tenants.
   */
  private async migrateApiToken(tenant: TenantConfig): Promise<boolean> {
    if (!tenant.apiToken || (tenant.keys && tenant.keys.length > 0)) {
      return false; // Nada a migrar
    }

    // Criar key a partir do apiToken legado (usa SHA-256 para manter compatibilidade)
    const key: TenantAuthKey = {
      keyId: generateKeyId(),
      role: 'public',
      tokenHash: sha256Token(tenant.apiToken),
      status: 'active',
      createdAt: tenant.createdAt,
      description: 'Migrated from legacy apiToken'
    };

    tenant.keys = [key];
    // Manter apiToken para compatibilidade durante transicao
    // delete tenant.apiToken;

    return true;
  }

  /**
   * Cria uma nova chave de autenticacao para um tenant.
   *
   * @param tenantId ID do tenant
   * @param role Papel da chave (public, tenant_admin)
   * @param description Descricao opcional
   * @returns Resultado com keyId e token (token retornado APENAS UMA VEZ)
   */
  async createTenantKey(
    tenantId: string,
    role: TenantRole,
    description?: string
  ): Promise<CreateKeyResult> {
    this.checkInitialized();

    if (role === 'global_admin') {
      throw new Error('Chaves global_admin nao sao gerenciadas por tenant');
    }

    const normalizedId = normalizeTenantId(tenantId);
    const tenant = this.tenants.get(normalizedId);

    if (!tenant) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    // Gerar token e hash (HMAC com pepper - Inc 12.1)
    const token = generateSecureToken();
    const tokenHash = hmacToken(token);
    const keyId = generateKeyId();
    const createdAt = new Date().toISOString();

    const key: TenantAuthKey = {
      keyId,
      role,
      tokenHash,
      status: 'active',
      createdAt,
      description
    };

    // Adicionar ao array de keys
    tenant.keys = tenant.keys || [];
    tenant.keys.push(key);
    tenant.updatedAt = createdAt;

    this.tenants.set(normalizedId, tenant);
    await this.persist();

    return { keyId, role, token, createdAt };
  }

  /**
   * Revoga uma chave de autenticacao.
   *
   * @param tenantId ID do tenant
   * @param keyId ID da chave a revogar
   */
  async revokeTenantKey(tenantId: string, keyId: string): Promise<void> {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const tenant = this.tenants.get(normalizedId);

    if (!tenant) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    const key = tenant.keys?.find(k => k.keyId === keyId);
    if (!key) {
      throw new Error(`Chave nao encontrada: ${keyId}`);
    }

    if (key.status === 'revoked') {
      throw new Error(`Chave ja foi revogada: ${keyId}`);
    }

    key.status = 'revoked';
    tenant.updatedAt = new Date().toISOString();

    this.tenants.set(normalizedId, tenant);
    await this.persist();
  }

  /**
   * Lista chaves de um tenant (sem expor hashes).
   */
  listTenantKeys(tenantId: string): Omit<TenantAuthKey, 'tokenHash'>[] {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const tenant = this.tenants.get(normalizedId);

    if (!tenant) {
      throw new Error(`Tenant nao encontrado: ${normalizedId}`);
    }

    return (tenant.keys || []).map(k => ({
      keyId: k.keyId,
      role: k.role,
      status: k.status,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      description: k.description
    }));
  }

  /**
   * Cria nova chave para um role (rotacao).
   * Nao revoga chaves antigas automaticamente.
   */
  async rotateTenantKey(
    tenantId: string,
    role: TenantRole
  ): Promise<CreateKeyResult> {
    return this.createTenantKey(tenantId, role, `Rotated key for ${role}`);
  }

  /**
   * Valida um token e retorna o contexto de autenticacao.
   *
   * @param tenantId ID do tenant
   * @param token Token a validar
   * @returns AuthContext se valido, null se invalido
   */
  validateTenantToken(tenantId: string, token: string): AuthContext | null {
    this.checkInitialized();

    const normalizedId = normalizeTenantId(tenantId);
    const tenant = this.tenants.get(normalizedId);

    if (!tenant) {
      return null;
    }

    // 1. Verificar contra keys primeiro (mais seguro)
    const keys = tenant.keys || [];
    for (const key of keys) {
      if (key.status !== 'active') {
        continue;
      }

      if (validateToken(token, key.tokenHash)) {
        // Atualizar lastUsedAt (fire-and-forget)
        key.lastUsedAt = new Date().toISOString();
        this.persist().catch(() => {}); // Nao bloquear

        return {
          role: key.role,
          tenantId: normalizedId,
          keyId: key.keyId
        };
      }
    }

    // 2. Fallback: verificar contra apiToken legado (para compatibilidade)
    // Sempre verificar, mesmo se houver keys - permite transicao gradual
    // Inc 12.1: usar secureCompare timing-safe
    if (tenant.apiToken && secureCompare(token, tenant.apiToken)) {
      return {
        role: 'public',
        tenantId: normalizedId,
        keyId: 'legacy'
      };
    }

    return null;
  }

  /**
   * Busca o contexto de autenticacao para um token em QUALQUER tenant.
   * Usado quando o tenantId ainda nao foi resolvido.
   */
  findAuthContextByToken(token: string): AuthContext | null {
    this.checkInitialized();

    for (const tenant of this.tenants.values()) {
      const context = this.validateTenantToken(tenant.id, token);
      if (context) {
        return context;
      }
    }

    return null;
  }
}
