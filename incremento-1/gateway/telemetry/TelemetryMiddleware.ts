/**
 * INCREMENTO 24 — Telemetria & Métricas: Middleware
 *
 * Plugin Fastify para coleta automática de métricas HTTP.
 * Registra onRequest/onResponse hooks.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getTelemetryRegistry } from './TelemetryRegistry';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface TelemetryMiddlewareOptions {
  /**
   * Rotas a ignorar para métricas (regex patterns)
   */
  ignoreRoutes?: RegExp[];

  /**
   * Se true, não coleta métricas em ambiente de teste
   */
  disableInTest?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extrai o template da rota (sem IDs dinâmicos)
 * Ex: /admin/tenants/acme/keys -> /admin/tenants/:id/keys
 */
function getRouteTemplate(request: FastifyRequest): string {
  // Fastify 5 tem routeOptions.url para o template
  const routeUrl = request.routeOptions?.url;
  if (routeUrl) {
    return routeUrl;
  }

  // Fallback: normalizar path removendo IDs conhecidos
  // Isso evita labels explosivos com IDs dinâmicos
  return request.url
    .split('?')[0] // Remove query string
    .replace(/\/[a-f0-9-]{36}/g, '/:id') // UUIDs
    .replace(/\/[0-9]+/g, '/:id') // Números
    .replace(/\/[a-z0-9-]{3,50}(?=\/|$)/g, '/:id'); // IDs de tenant
}

/**
 * Extrai tenantId do request (se disponível)
 */
function getTenantId(request: FastifyRequest): string | undefined {
  // Primeiro tenta do auth context
  const authContext = (request as any).authContext;
  if (authContext?.tenantId) {
    return authContext.tenantId;
  }

  // Depois tenta do header X-Tenant-Id
  const headerTenantId = request.headers['x-tenant-id'];
  if (typeof headerTenantId === 'string') {
    return headerTenantId;
  }

  // Por fim, tenta extrair do path
  const match = request.url.match(/\/(?:tenants|query)\/([a-z0-9-]+)/);
  if (match) {
    return match[1];
  }

  return undefined;
}

/**
 * Categoriza status code
 */
function getStatusCategory(statusCode: number): string {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const telemetryMiddlewarePlugin: FastifyPluginAsync<TelemetryMiddlewareOptions> = async (
  app,
  options
) => {
  const registry = getTelemetryRegistry();
  const ignoreRoutes = options.ignoreRoutes || [
    /^\/internal\/metrics/,
    /^\/favicon\.ico/
  ];

  // Em testes, pode desabilitar
  const isTest = process.env.NODE_ENV === 'test';
  if (options.disableInTest && isTest) {
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ON REQUEST: Registrar tempo de início
  // ──────────────────────────────────────────────────────────────────────────

  app.addHook('onRequest', async (request) => {
    // Marcar tempo de início
    (request as any).telemetryStartTime = process.hrtime.bigint();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ON RESPONSE: Registrar métricas
  // ──────────────────────────────────────────────────────────────────────────

  app.addHook('onResponse', async (request, reply) => {
    // Verificar se deve ignorar esta rota
    const path = request.url.split('?')[0];
    for (const pattern of ignoreRoutes) {
      if (pattern.test(path)) {
        return;
      }
    }

    const startTime = (request as any).telemetryStartTime as bigint | undefined;
    if (!startTime) {
      return;
    }

    // Calcular duração em ms
    const endTime = process.hrtime.bigint();
    const durationNs = Number(endTime - startTime);
    const durationMs = durationNs / 1_000_000;

    // Extrair informações
    const method = request.method;
    const route = getRouteTemplate(request);
    const statusCode = reply.statusCode;
    const tenantId = getTenantId(request);

    // Métricas HTTP
    registry.incHttpRequests({
      method,
      route,
      status_code: String(statusCode),
      tenant_id: tenantId
    });

    registry.observeHttpDuration({
      method,
      route,
      tenant_id: tenantId
    }, durationMs);

    // Métricas de erro (4xx e 5xx)
    if (statusCode >= 400) {
      const errorCode = getStatusCategory(statusCode);
      registry.incHttpError({
        error_code: errorCode,
        tenant_id: tenantId
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ON ERROR: Registrar erros específicos
  // ──────────────────────────────────────────────────────────────────────────

  app.addHook('onError', async (request, _reply, error) => {
    const tenantId = getTenantId(request);
    const errorCode = (error as any).code || 'UNKNOWN';

    // Detectar tipos específicos de erros
    if (errorCode === 'MISSING_TOKEN' || errorCode === 'INVALID_TOKEN') {
      registry.incAuthFailure({
        reason: errorCode,
        tenant_id: tenantId
      });
    } else if (errorCode === 'TENANT_CONFLICT') {
      if (tenantId) {
        registry.incTenantConflict(tenantId);
      }
    } else if (errorCode === 'RATE_LIMITED') {
      if (tenantId) {
        registry.incRateLimited(tenantId);
      }
    }
  });
};

export const telemetryMiddleware = fp(telemetryMiddlewarePlugin, {
  name: 'telemetry-middleware',
  fastify: '5.x'
});

// ════════════════════════════════════════════════════════════════════════════
// UTILITIES FOR MANUAL TRACKING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registra falha de autenticação manualmente
 * (para casos onde o hook não captura)
 */
export function trackAuthFailure(reason: string, tenantId?: string): void {
  const registry = getTelemetryRegistry();
  registry.incAuthFailure({ reason, tenant_id: tenantId });
}

/**
 * Registra conflito de tenant manualmente
 */
export function trackTenantConflict(tenantId: string): void {
  const registry = getTelemetryRegistry();
  registry.incTenantConflict(tenantId);
}

/**
 * Registra rate limit manualmente
 */
export function trackRateLimited(tenantId: string): void {
  const registry = getTelemetryRegistry();
  registry.incRateLimited(tenantId);
}
