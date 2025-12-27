/**
 * LIBERVIA SDK - Cliente HTTP
 *
 * Cliente tipado para integração com a API Libervia.
 * Usa fetch nativo (Node 18+).
 */

import {
  // Health
  HealthResponse,
  ReadinessResponse,
  MetricsResponse,
  // Tenant
  TenantRegistrationInput,
  TenantUpdateInput,
  TenantConfig,
  TenantListResponse,
  // Keys
  CreateKeyInput,
  KeyCreatedResponse,
  KeyListResponse,
  // Audit
  AuditVerifyResponse,
  EventListResponse,
  ExportQuery,
  ReplayQuery,
  // Query
  QueryTenantsResponse,
  QueryInstancesResponse,
  QueryMetricsResponse,
  QueryEventLogResponse,
  QueryMandatesResponse,
  QueryReviewsResponse,
  QueryConsequencesResponse,
  DashboardResponse,
  PaginationQuery,
  MandateInfo,
  ReviewCaseInfo,
  // Public
  DecisaoInput,
  DecisaoResponse,
  EpisodioStatusResponse,
  EventosQueryResponse,
  EventLogStatusResponse,
  SuccessResponse,
  LiberviaErrorResponse
} from './types';

import {
  LiberviaError,
  NetworkError,
  createErrorFromResponse,
  ResponseMetadata
} from './errors';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Opções de configuração do cliente
 */
export interface LiberviaClientOptions {
  /** URL base da API (ex: http://localhost:3000) */
  baseUrl: string;
  /** Token de autenticação */
  token: string;
  /** ID do tenant (obrigatório para APIs públicas, opcional para admin com global_admin) */
  tenantId?: string;
  /** Timeout em ms (default: 30000) */
  timeout?: number;
  /** Headers customizados adicionais */
  customHeaders?: Record<string, string>;
}

/**
 * Resultado de uma requisição com metadados
 */
export interface RequestResult<T> {
  /** Dados da resposta */
  data: T;
  /** Metadados da requisição */
  metadata: ResponseMetadata;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cliente Libervia SDK
 *
 * @example
 * ```typescript
 * const client = createLiberviaClient({
 *   baseUrl: 'http://localhost:3000',
 *   token: 'my-admin-token',
 *   tenantId: 'acme'
 * });
 *
 * // Health check
 * const health = await client.health.check();
 *
 * // Admin operations (global_admin)
 * const tenants = await client.admin.listTenants();
 *
 * // Query operations (tenant_admin ou global_admin)
 * const dashboard = await client.query.getDashboard('acme');
 *
 * // Public API (public token + tenantId)
 * const decisao = await client.public.criarDecisao(input);
 * ```
 */
export class LiberviaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly tenantId?: string;
  private readonly timeout: number;
  private readonly customHeaders: Record<string, string>;

  /** APIs de health check */
  public readonly health: HealthAPI;
  /** APIs administrativas (global_admin) */
  public readonly admin: AdminAPI;
  /** APIs de consulta do painel (tenant_admin ou global_admin) */
  public readonly query: QueryAPI;
  /** APIs públicas cognitivas (public token + tenantId) */
  public readonly public: PublicAPI;

  constructor(options: LiberviaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.token = options.token;
    this.tenantId = options.tenantId;
    this.timeout = options.timeout ?? 30000;
    this.customHeaders = options.customHeaders ?? {};

    // Inicializar sub-APIs
    this.health = new HealthAPI(this);
    this.admin = new AdminAPI(this);
    this.query = new QueryAPI(this);
    this.public = new PublicAPI(this);
  }

  /**
   * Executa requisição HTTP
   */
  async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
      requireTenantId?: boolean;
    } = {}
  ): Promise<RequestResult<T>> {
    const { body, query, headers = {}, requireTenantId = false } = options;

    // Construir URL com query params
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Construir headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...this.customHeaders,
      ...headers
    };

    // Adicionar X-Tenant-Id se configurado ou requerido
    if (this.tenantId) {
      requestHeaders['X-Tenant-Id'] = this.tenantId;
    } else if (requireTenantId) {
      throw new LiberviaError(
        'tenantId is required for this operation',
        400,
        'TENANT_ID_REQUIRED'
      );
    }

    // Executar request
    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError(`Request timeout after ${this.timeout}ms`);
      }
      throw new NetworkError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }

    // Extrair metadados
    const requestId = response.headers.get('x-request-id') || undefined;
    const metadata: ResponseMetadata = {
      status: response.status,
      requestId,
      headers: Object.fromEntries(response.headers.entries())
    };

    // Tratar resposta
    let responseBody: T | LiberviaErrorResponse;
    try {
      responseBody = await response.json() as T | LiberviaErrorResponse;
    } catch {
      // Resposta vazia ou não-JSON
      responseBody = {} as T;
    }

    // Verificar erros
    if (!response.ok) {
      throw createErrorFromResponse(
        response.status,
        responseBody as LiberviaErrorResponse,
        requestId
      );
    }

    return {
      data: responseBody as T,
      metadata
    };
  }

  /**
   * Executa requisição e retorna apenas os dados (sem metadados)
   */
  async requestData<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
      requireTenantId?: boolean;
    } = {}
  ): Promise<T> {
    const result = await this.request<T>(method, path, options);
    return result.data;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SUB-APIS
// ════════════════════════════════════════════════════════════════════════════

/**
 * APIs de Health Check
 */
class HealthAPI {
  constructor(private readonly client: LiberviaClient) {}

  /** Liveness probe */
  async check(): Promise<HealthResponse> {
    return this.client.requestData('GET', '/health');
  }

  /** Readiness probe */
  async ready(): Promise<ReadinessResponse> {
    return this.client.requestData('GET', '/health/ready');
  }

  /** Métricas do sistema */
  async metrics(): Promise<MetricsResponse> {
    return this.client.requestData('GET', '/metrics');
  }
}

/**
 * APIs Administrativas (requer global_admin)
 */
class AdminAPI {
  constructor(private readonly client: LiberviaClient) {}

  // ════════════════════════════════════════════════════════════════════════
  // TENANTS
  // ════════════════════════════════════════════════════════════════════════

  /** Lista todos os tenants */
  async listTenants(includeDeleted?: boolean): Promise<TenantListResponse> {
    return this.client.requestData('GET', '/admin/tenants', {
      query: { includeDeleted }
    });
  }

  /** Cria novo tenant */
  async createTenant(input: TenantRegistrationInput): Promise<TenantConfig> {
    return this.client.requestData('POST', '/admin/tenants', { body: input });
  }

  /** Obtém detalhes de um tenant */
  async getTenant(tenantId: string): Promise<TenantConfig> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}`);
  }

  /** Atualiza tenant */
  async updateTenant(tenantId: string, input: TenantUpdateInput): Promise<TenantConfig> {
    return this.client.requestData('PATCH', `/admin/tenants/${tenantId}`, { body: input });
  }

  /** Remove tenant (soft delete) */
  async deleteTenant(tenantId: string): Promise<SuccessResponse> {
    return this.client.requestData('DELETE', `/admin/tenants/${tenantId}`);
  }

  /** Suspende tenant */
  async suspendTenant(tenantId: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/suspend`);
  }

  /** Reativa tenant */
  async resumeTenant(tenantId: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/resume`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // KEYS
  // ════════════════════════════════════════════════════════════════════════

  /** Lista chaves de um tenant */
  async listKeys(tenantId: string): Promise<KeyListResponse> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/keys`);
  }

  /** Cria nova chave */
  async createKey(tenantId: string, input: CreateKeyInput): Promise<KeyCreatedResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/keys`, { body: input });
  }

  /** Revoga chave */
  async revokeKey(tenantId: string, keyId: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/keys/${keyId}/revoke`);
  }

  /** Rotaciona chave (cria nova) */
  async rotateKey(tenantId: string, role: 'public' | 'tenant_admin'): Promise<KeyCreatedResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/keys/rotate`, {
      body: { role }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // AUDIT
  // ════════════════════════════════════════════════════════════════════════

  /** Verifica integridade da cadeia de eventos */
  async verifyAudit(tenantId: string): Promise<AuditVerifyResponse> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/audit/verify`);
  }

  /** Verificação rápida via snapshot */
  async verifyAuditFast(tenantId: string): Promise<AuditVerifyResponse> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/audit/verify-fast`);
  }

  /** Exporta eventos por intervalo */
  async exportEvents(tenantId: string, query?: ExportQuery): Promise<{ events: unknown[] }> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/audit/export`, {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  /** Replay operacional */
  async replayEvents(tenantId: string, query?: ReplayQuery): Promise<unknown> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/audit/replay`, {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  /** Lista eventos do tenant */
  async listEvents(tenantId: string): Promise<EventListResponse> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/events`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // METRICS & INSTANCES
  // ════════════════════════════════════════════════════════════════════════

  /** Métricas de um tenant */
  async getTenantMetrics(tenantId: string): Promise<unknown> {
    return this.client.requestData('GET', `/admin/tenants/${tenantId}/metrics`);
  }

  /** Métricas globais */
  async getGlobalMetrics(): Promise<unknown> {
    return this.client.requestData('GET', '/admin/metrics');
  }

  /** Health check global com detalhes */
  async getGlobalHealth(): Promise<unknown> {
    return this.client.requestData('GET', '/admin/health');
  }

  /** Lista instâncias ativas */
  async listInstances(): Promise<{ activeInstances: string[] }> {
    return this.client.requestData('GET', '/admin/instances');
  }

  /** Força shutdown de uma instância */
  async shutdownInstance(tenantId: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', `/admin/tenants/${tenantId}/shutdown`);
  }

  /** Shutdown de todas as instâncias */
  async shutdownAll(): Promise<SuccessResponse> {
    return this.client.requestData('POST', '/admin/shutdown-all');
  }
}

/**
 * APIs de Consulta do Painel Operacional (requer tenant_admin ou global_admin)
 */
class QueryAPI {
  constructor(private readonly client: LiberviaClient) {}

  // ════════════════════════════════════════════════════════════════════════
  // GLOBAL (requer global_admin)
  // ════════════════════════════════════════════════════════════════════════

  /** Lista todos os tenants */
  async listTenants(): Promise<QueryTenantsResponse> {
    return this.client.requestData('GET', '/admin/query/tenants');
  }

  /** Lista instâncias ativas */
  async listInstances(): Promise<QueryInstancesResponse> {
    return this.client.requestData('GET', '/admin/query/instances');
  }

  /** Métricas globais */
  async getMetrics(): Promise<QueryMetricsResponse> {
    return this.client.requestData('GET', '/admin/query/metrics');
  }

  /** Consulta EventLog global */
  async getEventLog(query?: PaginationQuery & { tenantId?: string }): Promise<QueryEventLogResponse> {
    return this.client.requestData('GET', '/admin/query/eventlog', {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // TENANT-SCOPED (requer tenant_admin do próprio tenant ou global_admin)
  // ════════════════════════════════════════════════════════════════════════

  /** Lista mandatos */
  async listMandates(tenantId: string, query?: PaginationQuery): Promise<QueryMandatesResponse> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/mandates`, {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  /** Detalhes de um mandato */
  async getMandate(tenantId: string, mandateId: string): Promise<{ mandate: MandateInfo; history: unknown[] }> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/mandates/${mandateId}`);
  }

  /** Lista casos de revisão */
  async listReviews(tenantId: string, query?: PaginationQuery): Promise<QueryReviewsResponse> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/reviews`, {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  /** Detalhes de um caso de revisão */
  async getReview(tenantId: string, reviewId: string): Promise<{ reviewCase: ReviewCaseInfo }> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/reviews/${reviewId}`);
  }

  /** Lista consequências/observações */
  async listConsequences(tenantId: string, query?: PaginationQuery): Promise<QueryConsequencesResponse> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/consequences`, {
      query: query as Record<string, string | number | boolean | undefined>
    });
  }

  /** Dashboard resumido do tenant */
  async getDashboard(tenantId: string): Promise<DashboardResponse> {
    return this.client.requestData('GET', `/admin/query/${tenantId}/dashboard`);
  }
}

/**
 * APIs Públicas Cognitivas (requer token público + tenantId)
 */
class PublicAPI {
  constructor(private readonly client: LiberviaClient) {}

  /**
   * Cria decisão (fluxo completo)
   * Requer tenantId configurado no cliente
   */
  async criarDecisao(input: DecisaoInput): Promise<DecisaoResponse> {
    return this.client.requestData('POST', '/api/v1/decisoes', {
      body: input,
      requireTenantId: true
    });
  }

  /** Consulta status de um episódio */
  async getEpisodio(id: string): Promise<EpisodioStatusResponse> {
    return this.client.requestData('GET', `/api/v1/episodios/${id}`, {
      requireTenantId: true
    });
  }

  /** Encerra episódio em observação */
  async encerrarEpisodio(id: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', `/api/v1/episodios/${id}/encerrar`, {
      requireTenantId: true
    });
  }

  /** Lista eventos recentes */
  async listarEventos(query?: { tipo?: string; entidade?: string; limit?: number }): Promise<EventosQueryResponse> {
    return this.client.requestData('GET', '/api/v1/eventos', {
      query: query as Record<string, string | number | boolean | undefined>,
      requireTenantId: true
    });
  }

  /** Inicia observação de um episódio */
  async iniciarObservacao(episodioId: string): Promise<SuccessResponse> {
    return this.client.requestData('POST', '/api/v1/observacoes', {
      body: { episodio_id: episodioId },
      requireTenantId: true
    });
  }

  /** Status do EventLog */
  async getEventLogStatus(): Promise<EventLogStatusResponse> {
    return this.client.requestData('GET', '/api/v1/eventlog/status', {
      requireTenantId: true
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria cliente Libervia SDK
 *
 * @example
 * ```typescript
 * // Cliente admin (global_admin)
 * const adminClient = createLiberviaClient({
 *   baseUrl: 'http://localhost:3000',
 *   token: process.env.ADMIN_TOKEN!
 * });
 *
 * // Cliente tenant (tenant_admin)
 * const tenantClient = createLiberviaClient({
 *   baseUrl: 'http://localhost:3000',
 *   token: tenantAdminToken,
 *   tenantId: 'acme'
 * });
 *
 * // Cliente público (API cognitiva)
 * const publicClient = createLiberviaClient({
 *   baseUrl: 'http://localhost:3000',
 *   token: publicToken,
 *   tenantId: 'acme'
 * });
 * ```
 */
export function createLiberviaClient(options: LiberviaClientOptions): LiberviaClient {
  return new LiberviaClient(options);
}
