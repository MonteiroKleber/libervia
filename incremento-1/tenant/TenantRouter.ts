/**
 * CAMADA 6 — MULTI-TENANT: Roteador de Tenants
 *
 * Resolve tenantId a partir de requisicoes e retorna instancia do Core.
 *
 * ESTRATEGIAS SUPORTADAS:
 * - Header: X-Tenant-Id
 * - Path prefix: /api/v1/tenants/{tenantId}/...
 * - Subdomain: {tenantId}.domain.com
 */

import { TenantRuntime, CoreInstance } from './TenantRuntime';
import { validateTenantId, normalizeTenantId } from './TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input generico para extracao de tenantId
 * Nao acopla a nenhum framework HTTP especifico
 */
export interface RouterInput {
  /**
   * Headers HTTP (case-insensitive keys)
   */
  headers?: Record<string, string | string[] | undefined>;

  /**
   * Path da requisicao (ex: /api/v1/tenants/acme-corp/solicitacoes)
   */
  path?: string;

  /**
   * Host ou subdomain (ex: acme-corp.libervia.io)
   */
  host?: string;
}

/**
 * Resultado de resolucao de tenant
 */
export interface ResolveResult {
  success: boolean;
  tenantId?: string;
  instance?: CoreInstance;
  error?: string;
}

/**
 * Estrategia de extracao de tenantId
 */
export type ExtractionStrategy = 'header' | 'path' | 'subdomain' | 'auto';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Nome do header para tenantId
 */
export const TENANT_ID_HEADER = 'x-tenant-id';

/**
 * Regex para extrair tenantId do path
 * Formato: /api/v1/tenants/{tenantId}/...
 */
export const PATH_TENANT_REGEX = /^\/api\/v\d+\/tenants\/([^/]+)/;

// ════════════════════════════════════════════════════════════════════════════
// TIPOS DE RESULTADO DE EXTRACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado detalhado da extracao de tenant de todas as fontes.
 * Usado para detectar conflitos.
 */
export interface TenantExtractionResult {
  /**
   * TenantId resolvido (null se nenhum encontrado)
   */
  tenantId: string | null;

  /**
   * TenantId extraido do header (se presente)
   */
  headerTenant: string | null;

  /**
   * TenantId extraido do path (se presente)
   */
  pathTenant: string | null;

  /**
   * TenantId extraido do subdomain (se presente)
   */
  subdomainTenant: string | null;

  /**
   * Se houve conflito entre fontes
   */
  hasConflict: boolean;

  /**
   * Detalhes do conflito (se houver)
   */
  conflictDetails?: {
    headerTenant?: string;
    pathTenant?: string;
    subdomainTenant?: string;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXTRACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extrai tenantId do header X-Tenant-Id
 */
export function extractFromHeader(
  headers?: Record<string, string | string[] | undefined>
): string | null {
  if (!headers) {
    return null;
  }

  // Headers sao case-insensitive
  const headerValue = headers[TENANT_ID_HEADER] ??
                      headers['X-Tenant-Id'] ??
                      headers['X-TENANT-ID'];

  if (!headerValue) {
    return null;
  }

  // Pode ser string ou array
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!value || typeof value !== 'string') {
    return null;
  }

  return normalizeTenantId(value);
}

/**
 * Extrai tenantId do path
 * Formato: /api/v1/tenants/{tenantId}/...
 */
export function extractFromPath(path?: string): string | null {
  if (!path) {
    return null;
  }

  const match = path.match(PATH_TENANT_REGEX);
  if (!match || !match[1]) {
    return null;
  }

  return normalizeTenantId(match[1]);
}

/**
 * Extrai tenantId do subdomain
 * Formato: {tenantId}.domain.com
 */
export function extractFromSubdomain(host?: string): string | null {
  if (!host) {
    return null;
  }

  // Remover porta se presente
  const hostWithoutPort = host.split(':')[0];

  // Dividir em partes
  const parts = hostWithoutPort.split('.');

  // Precisa ter pelo menos 3 partes: subdomain.domain.tld
  if (parts.length < 3) {
    return null;
  }

  // Primeiro parte e o subdomain
  const subdomain = parts[0];

  // Ignorar subdomains comuns
  const ignoredSubdomains = ['www', 'api', 'app', 'admin', 'localhost'];
  if (ignoredSubdomains.includes(subdomain.toLowerCase())) {
    return null;
  }

  return normalizeTenantId(subdomain);
}

/**
 * Extrai tenantId usando todas as estrategias (auto)
 * Ordem de prioridade: header > path > subdomain
 *
 * NOTA: Para deteccao de conflitos, usar extractTenantIdWithConflictDetection
 */
export function extractTenantId(input: RouterInput): string | null {
  // 1. Tentar header
  const fromHeader = extractFromHeader(input.headers);
  if (fromHeader) {
    return fromHeader;
  }

  // 2. Tentar path
  const fromPath = extractFromPath(input.path);
  if (fromPath) {
    return fromPath;
  }

  // 3. Tentar subdomain
  const fromSubdomain = extractFromSubdomain(input.host);
  if (fromSubdomain) {
    return fromSubdomain;
  }

  return null;
}

/**
 * Extrai tenantId com deteccao de conflitos entre fontes.
 *
 * REGRAS DE PRECEDENCIA:
 * 1. Header (X-Tenant-Id) e SEMPRE a fonte de verdade se presente
 * 2. Path e subdomain sao fallback se header nao vier
 * 3. Se header existir E path/subdomain tiverem valor DIFERENTE, retorna conflito
 * 4. Se valores forem iguais, segue normalmente
 *
 * @param input Dados da requisicao (headers, path, host)
 * @returns Resultado com tenantId, fontes e info de conflito
 */
export function extractTenantIdWithConflictDetection(input: RouterInput): TenantExtractionResult {
  // Extrair de todas as fontes
  const headerTenant = extractFromHeader(input.headers);
  const pathTenant = extractFromPath(input.path);
  const subdomainTenant = extractFromSubdomain(input.host);

  // Verificar conflitos quando header esta presente
  if (headerTenant) {
    const conflicts: { headerTenant?: string; pathTenant?: string; subdomainTenant?: string } = {};
    let hasConflict = false;

    // Conflito com path?
    if (pathTenant && pathTenant !== headerTenant) {
      conflicts.headerTenant = headerTenant;
      conflicts.pathTenant = pathTenant;
      hasConflict = true;
    }

    // Conflito com subdomain?
    if (subdomainTenant && subdomainTenant !== headerTenant) {
      conflicts.headerTenant = headerTenant;
      conflicts.subdomainTenant = subdomainTenant;
      hasConflict = true;
    }

    if (hasConflict) {
      return {
        tenantId: null, // Nao resolver quando ha conflito
        headerTenant,
        pathTenant,
        subdomainTenant,
        hasConflict: true,
        conflictDetails: conflicts
      };
    }

    // Header presente, sem conflito
    return {
      tenantId: headerTenant,
      headerTenant,
      pathTenant,
      subdomainTenant,
      hasConflict: false
    };
  }

  // Sem header - usar fallback (path > subdomain)
  const tenantId = pathTenant ?? subdomainTenant ?? null;

  return {
    tenantId,
    headerTenant: null,
    pathTenant,
    subdomainTenant,
    hasConflict: false
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

export class TenantRouter {
  private runtime: TenantRuntime;
  private strategy: ExtractionStrategy;

  constructor(
    runtime: TenantRuntime,
    strategy: ExtractionStrategy = 'auto'
  ) {
    this.runtime = runtime;
    this.strategy = strategy;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESOLUCAO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve requisicao para instancia do Core
   */
  async resolve(input: RouterInput): Promise<ResolveResult> {
    // 1. Extrair tenantId
    const tenantId = this.extractWithStrategy(input);

    if (!tenantId) {
      return {
        success: false,
        error: 'TenantId nao encontrado na requisicao'
      };
    }

    // 2. Validar tenantId
    const validation = validateTenantId(tenantId);
    if (!validation.valid) {
      return {
        success: false,
        tenantId,
        error: `TenantId invalido: ${validation.error}`
      };
    }

    // 3. Obter instancia
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      return {
        success: true,
        tenantId,
        instance
      };
    } catch (err) {
      return {
        success: false,
        tenantId,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Extrai tenantId usando a estrategia configurada
   */
  private extractWithStrategy(input: RouterInput): string | null {
    switch (this.strategy) {
      case 'header':
        return extractFromHeader(input.headers);

      case 'path':
        return extractFromPath(input.path);

      case 'subdomain':
        return extractFromSubdomain(input.host);

      case 'auto':
      default:
        return extractTenantId(input);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Valida se requisicao tem tenant valido (sem criar instancia)
   */
  validateRequest(input: RouterInput): { valid: boolean; tenantId?: string; error?: string } {
    const tenantId = this.extractWithStrategy(input);

    if (!tenantId) {
      return { valid: false, error: 'TenantId nao encontrado' };
    }

    const validation = validateTenantId(tenantId);
    if (!validation.valid) {
      return { valid: false, tenantId, error: validation.error };
    }

    return { valid: true, tenantId };
  }

  /**
   * Retorna a estrategia atual
   */
  getStrategy(): ExtractionStrategy {
    return this.strategy;
  }

  /**
   * Altera a estrategia de extracao
   */
  setStrategy(strategy: ExtractionStrategy): void {
    this.strategy = strategy;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria um TenantRouter
 */
export function createRouter(
  runtime: TenantRuntime,
  strategy?: ExtractionStrategy
): TenantRouter {
  return new TenantRouter(runtime, strategy);
}
