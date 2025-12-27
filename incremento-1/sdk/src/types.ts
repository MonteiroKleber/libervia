/**
 * LIBERVIA SDK - Tipos
 *
 * DTOs e interfaces tipadas para a API Libervia.
 * Gerado a partir da especificação OpenAPI.
 */

// ════════════════════════════════════════════════════════════════════════════
// COMMON
// ════════════════════════════════════════════════════════════════════════════

export type TenantRole = 'public' | 'tenant_admin' | 'global_admin';
export type TenantStatus = 'active' | 'suspended' | 'deleted';
export type KeyStatus = 'active' | 'revoked';
export type HealthStatus = 'ok' | 'degraded' | 'error';
export type PerfilRisco = 'conservador' | 'moderado' | 'arrojado';
export type ReviewStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type MandateStatus = 'active' | 'suspended' | 'revoked';

// ════════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface LiberviaErrorResponse {
  error: string;
  code?: string;
  message?: string;
}

export type ErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'INSUFFICIENT_ROLE'
  | 'TENANT_CONFLICT'
  | 'NOT_FOUND';

// ════════════════════════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════════════════════════

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
}

export interface ReadinessResponse extends HealthResponse {
  registry: {
    loaded: boolean;
    tenantCount: number;
  };
  runtime: {
    activeInstances: number;
  };
}

export interface MetricsResponse {
  timestamp: string;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  tenants: {
    registered: number;
    active: number;
    suspended: number;
  };
  instances: {
    active: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TENANT
// ════════════════════════════════════════════════════════════════════════════

export interface TenantRegistrationInput {
  id: string;
  name: string;
  apiToken?: string;
}

export interface TenantUpdateInput {
  name?: string;
  status?: 'active' | 'suspended';
}

export interface TenantConfig {
  id: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt?: string;
  apiToken?: string;
}

export interface TenantListResponse {
  tenants: TenantConfig[];
  total: number;
}

// ════════════════════════════════════════════════════════════════════════════
// KEYS
// ════════════════════════════════════════════════════════════════════════════

export interface CreateKeyInput {
  role: 'public' | 'tenant_admin';
  description?: string;
}

export interface KeyCreatedResponse {
  keyId: string;
  role: string;
  token: string;
  createdAt: string;
  warning: string;
}

export interface KeyInfo {
  keyId: string;
  role: string;
  status: KeyStatus;
  createdAt: string;
  description?: string;
}

export interface KeyListResponse {
  keys: KeyInfo[];
  count: number;
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT
// ════════════════════════════════════════════════════════════════════════════

export interface AuditVerifyResponse {
  valid: boolean;
  totalEvents: number;
  verifiedAt: string;
  errors?: string[];
}

export interface EventLogEntry {
  id: string;
  evento: string;
  entidade: string;
  entidade_id: string;
  timestamp: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

export interface EventListResponse {
  events: EventLogEntry[];
  count: number;
}

export interface ExportQuery {
  fromTs?: string;
  toTs?: string;
  fromSegment?: number;
  toSegment?: number;
}

export interface ReplayQuery {
  evento?: string;
  entidade?: string;
  entidadeId?: string;
  fromTs?: string;
  toTs?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// QUERY (Inc 21)
// ════════════════════════════════════════════════════════════════════════════

export interface QueryTenantsResponse {
  tenants: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
  }>;
  total: number;
}

export interface QueryInstancesResponse {
  instances: Array<{
    tenantId: string;
    startedAt?: string;
    uptime?: number;
    lastActivity?: string;
  }>;
  total: number;
}

export interface QueryMetricsResponse {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  activeInstances: number;
  timestamp: string;
}

export interface QueryEventLogResponse {
  events: EventLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface MandateInfo {
  id: string;
  agentId: string;
  scope: Record<string, unknown>;
  constraints: Record<string, unknown>;
  status: MandateStatus;
  createdAt: string;
}

export interface QueryMandatesResponse {
  mandates: MandateInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReviewCaseInfo {
  id: string;
  tenantId: string;
  reason: string;
  status: ReviewStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface QueryReviewsResponse {
  reviews: ReviewCaseInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface ObservacaoInfo {
  id: string;
  episodioId: string;
  tipo: string;
  descricao: string;
  dataRegistro: string;
}

export interface QueryConsequencesResponse {
  consequences: ObservacaoInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardResponse {
  tenantId: string;
  tenant: {
    name: string;
    status: string;
  };
  mandates: {
    active: number;
    suspended: number;
    total: number;
  };
  reviews: {
    OPEN: number;
    RESOLVED: number;
    DISMISSED: number;
  };
  consequences: {
    total: number;
  };
  recentEvents: Array<{
    evento: string;
    entidade: string;
    ts: string;
  }>;
  timestamp: string;
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC API - DECISÕES
// ════════════════════════════════════════════════════════════════════════════

export interface Alternativa {
  descricao: string;
  riscos_associados: string[];
}

export interface Risco {
  descricao: string;
  tipo: string;
  reversibilidade: string;
}

export interface Limite {
  tipo: string;
  valor: string;
  descricao: string;
}

export interface SituacaoInput {
  dominio: string;
  contexto: string;
  objetivo: string;
  incertezas: string[];
  alternativas: Alternativa[];
  riscos: Risco[];
  urgencia: string;
  capacidade_absorcao: string;
  consequencia_relevante: string;
  possibilidade_aprendizado: boolean;
  caso_uso_declarado: number;
}

export interface ProtocoloInput {
  criterios_minimos: string[];
  riscos_considerados: string[];
  limites_definidos: Limite[];
  perfil_risco: PerfilRisco;
  alternativas_avaliadas: string[];
  alternativa_escolhida: string;
  memoria_consultada_ids?: string[];
}

export interface DecisaoInput {
  situacao: SituacaoInput;
  protocolo: ProtocoloInput;
}

export interface ContratoDeDecisao {
  id: string;
  episodio_id: string;
  alternativa_escolhida: string;
  criterios: string[];
  perfil_risco: string;
  limites: Limite[];
  emitido_em: string;
  emitido_para: string;
}

export interface DecisaoResponse {
  contrato: ContratoDeDecisao;
  episodio_id: string;
  metadados: {
    tenant_id: string;
    timestamp: string;
  };
}

export interface EpisodioStatusResponse {
  episodio_id: string;
  ultimo_evento: string;
  timestamp: string;
  total_eventos: number;
  tem_contrato: boolean;
}

export interface EventosQueryResponse {
  eventos: Array<{
    id: string;
    evento: string;
    entidade: string;
    entidade_id: string;
    timestamp: string;
    actor?: string;
  }>;
  total: number;
  limit: number;
}

export interface EventLogStatusResponse {
  enabled: boolean;
  degraded: boolean;
  errorCount: number;
  lastErrorAt?: string;
  lastErrorMsg?: string;
}

export interface SuccessResponse {
  success: boolean;
  message: string;
}
