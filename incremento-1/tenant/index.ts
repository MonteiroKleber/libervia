/**
 * CAMADA 6 — MULTI-TENANT
 *
 * Orquestracao multi-tenant para o Cerebro Institucional Libervia.
 *
 * COMPONENTES:
 * - TenantConfig: Tipos e configuracao de tenants
 * - TenantSecurity: Validacao de tenantId e path safety
 * - TenantRegistry: Cadastro e lifecycle de tenants
 * - TenantRuntime: Instancias ativas do Core
 * - TenantRouter: Resolucao de requisicoes
 * - TenantAdminAPI: Operacoes administrativas
 * - IntegrationAdapter: Interface para integracoes externas
 *
 * GARANTIAS:
 * - Isolamento completo por dataDir
 * - Validacao rigorosa de tenantId
 * - Prevencao de path traversal
 * - Core inalterado (zero mudancas na Camada 3)
 *
 * USO BASICO:
 * ```typescript
 * // 1. Criar registry e runtime
 * const registry = await TenantRegistry.create('/var/lib/libervia');
 * const runtime = TenantRuntime.create(registry);
 *
 * // 2. Registrar tenant
 * await registry.register({ id: 'acme-corp', name: 'ACME Corporation' });
 *
 * // 3. Obter instancia do Core
 * const instance = await runtime.getOrCreate('acme-corp');
 *
 * // 4. Usar orquestrador
 * const contrato = await instance.orquestrador.ProcessarSolicitacao(...);
 * ```
 */

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════════

export {
  TenantStatus,
  TenantQuotas,
  TenantFeatures,
  TenantConfig,
  TenantRegistrationInput,
  TenantUpdateInput,
  DEFAULT_QUOTAS,
  DEFAULT_FEATURES,
  createTenantConfig
} from './TenantConfig';

// ════════════════════════════════════════════════════════════════════════════
// SEGURANCA
// ════════════════════════════════════════════════════════════════════════════

export {
  TENANT_ID_REGEX,
  RESERVED_IDS,
  ValidationResult,
  normalizeTenantId,
  validateTenantId,
  resolveTenantDataDir,
  resolveTenantDataDirSync
} from './TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ════════════════════════════════════════════════════════════════════════════

export { TenantRegistry } from './TenantRegistry';

// ════════════════════════════════════════════════════════════════════════════
// RUNTIME
// ════════════════════════════════════════════════════════════════════════════

export {
  CoreInstance,
  RuntimeMetrics,
  TenantRuntime
} from './TenantRuntime';

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

export {
  RouterInput,
  ResolveResult,
  ExtractionStrategy,
  TENANT_ID_HEADER,
  PATH_TENANT_REGEX,
  extractFromHeader,
  extractFromPath,
  extractFromSubdomain,
  extractTenantId,
  TenantRouter,
  createRouter
} from './TenantRouter';

// ════════════════════════════════════════════════════════════════════════════
// ADMIN API
// ════════════════════════════════════════════════════════════════════════════

export {
  AdminResult,
  GlobalMetrics,
  HealthStatus,
  TenantAdminAPI
} from './TenantAdminAPI';

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

export {
  IntegrationAdapter,
  IntegrationFactory,
  NullIntegrationAdapter,
  NULL_ADAPTER,
  noAdapterFactory,
  singleAdapterFactory,
  mapAdapterFactory
} from './IntegrationAdapter';
