/**
 * INCREMENTO 24 — Telemetria & Métricas: Routes
 * INCREMENTO 25 — Runbook Operacional + SLOs + Alerting
 *
 * Endpoints para exposição de métricas e saude operacional.
 * Respeita RBAC:
 * - /internal/metrics: global_admin only
 * - /internal/tenants/:id/metrics: tenant_admin do tenant OU global_admin
 * - /internal/health/operational: global_admin only
 */

import { FastifyPluginAsync } from 'fastify';
import {
  generatePrometheusOutput,
  generateTenantPrometheusOutput,
  generateSnapshot,
  generateTenantSnapshot
} from '../telemetry/TelemetrySnapshot';
import { assessOperationalHealth, getQuickHealthStatus } from '../health/OperationalHealth';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

interface TenantMetricsParams {
  tenantId: string;
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

export const metricsRoutes: FastifyPluginAsync = async (app) => {

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/metrics (Prometheus format)
  // ──────────────────────────────────────────────────────────────────────────

  app.get('/internal/metrics', async (request, reply) => {
    // RBAC: requer global_admin
    const authContext = (request as any).authContext;

    if (!authContext) {
      reply.code(401);
      return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
    }

    if (authContext.role !== 'global_admin') {
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'global_admin required' };
    }

    // Gerar output Prometheus
    const output = generatePrometheusOutput();

    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return output;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/metrics/json (JSON format para debug)
  // ──────────────────────────────────────────────────────────────────────────

  app.get('/internal/metrics/json', async (request, reply) => {
    // RBAC: requer global_admin
    const authContext = (request as any).authContext;

    if (!authContext) {
      reply.code(401);
      return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
    }

    if (authContext.role !== 'global_admin') {
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'global_admin required' };
    }

    // Gerar snapshot JSON
    const snapshot = generateSnapshot();
    return snapshot;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/tenants/:tenantId/metrics (Prometheus format)
  // ──────────────────────────────────────────────────────────────────────────

  app.get<{ Params: TenantMetricsParams }>(
    '/internal/tenants/:tenantId/metrics',
    async (request, reply) => {
      const { tenantId } = request.params;

      // RBAC: requer tenant_admin do tenant OU global_admin
      const authContext = (request as any).authContext;

      if (!authContext) {
        reply.code(401);
        return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
      }

      // global_admin pode ver qualquer tenant
      if (authContext.role === 'global_admin') {
        const output = generateTenantPrometheusOutput(tenantId);
        reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return output;
      }

      // tenant_admin só pode ver o próprio tenant
      if (authContext.role === 'tenant_admin') {
        if (authContext.tenantId !== tenantId) {
          reply.code(403);
          return {
            error: 'Forbidden',
            code: 'TENANT_MISMATCH',
            message: 'Cannot access metrics for other tenants'
          };
        }

        const output = generateTenantPrometheusOutput(tenantId);
        reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return output;
      }

      // public role não pode acessar métricas
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'tenant_admin or global_admin required' };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/tenants/:tenantId/metrics/json (JSON format)
  // ──────────────────────────────────────────────────────────────────────────

  app.get<{ Params: TenantMetricsParams }>(
    '/internal/tenants/:tenantId/metrics/json',
    async (request, reply) => {
      const { tenantId } = request.params;

      // RBAC: requer tenant_admin do tenant OU global_admin
      const authContext = (request as any).authContext;

      if (!authContext) {
        reply.code(401);
        return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
      }

      // global_admin pode ver qualquer tenant
      if (authContext.role === 'global_admin') {
        const snapshot = generateTenantSnapshot(tenantId);
        return snapshot;
      }

      // tenant_admin só pode ver o próprio tenant
      if (authContext.role === 'tenant_admin') {
        if (authContext.tenantId !== tenantId) {
          reply.code(403);
          return {
            error: 'Forbidden',
            code: 'TENANT_MISMATCH',
            message: 'Cannot access metrics for other tenants'
          };
        }

        const snapshot = generateTenantSnapshot(tenantId);
        return snapshot;
      }

      // public role não pode acessar métricas
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'tenant_admin or global_admin required' };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/health/operational (Operational Health Assessment)
  // INCREMENTO 25
  // ──────────────────────────────────────────────────────────────────────────

  app.get('/internal/health/operational', async (request, reply) => {
    // RBAC: requer global_admin
    const authContext = (request as any).authContext;

    if (!authContext) {
      reply.code(401);
      return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
    }

    if (authContext.role !== 'global_admin') {
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'global_admin required' };
    }

    // Avaliar saude operacional
    const health = assessOperationalHealth();

    // Retornar com status code apropriado
    if (health.status === 'CRITICAL') {
      reply.code(503);
    } else if (health.status === 'DEGRADED') {
      reply.code(200); // 200 mas com status DEGRADED no body
    }

    return health;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /internal/health/operational/status (Quick Status Check)
  // INCREMENTO 25
  // ──────────────────────────────────────────────────────────────────────────

  app.get('/internal/health/operational/status', async (request, reply) => {
    // RBAC: requer global_admin
    const authContext = (request as any).authContext;

    if (!authContext) {
      reply.code(401);
      return { error: 'Unauthorized', code: 'MISSING_TOKEN' };
    }

    if (authContext.role !== 'global_admin') {
      reply.code(403);
      return { error: 'Forbidden', code: 'INSUFFICIENT_ROLE', message: 'global_admin required' };
    }

    // Retornar apenas o status
    const status = getQuickHealthStatus();

    return {
      status,
      timestamp: new Date().toISOString()
    };
  });
};
