/**
 * INCREMENTO 21 — PAINEL OPERACIONAL: Query APIs
 *
 * Rotas de consulta (read-only) para o painel operacional.
 * Expõe dados do Core para governança, risco, compliance e auditoria.
 *
 * RBAC:
 * - /admin/query/tenants, /admin/query/instances, /admin/query/metrics, /admin/query/eventlog: global_admin
 * - /admin/query/:tenantId/*: tenant_admin do próprio tenant OU global_admin
 *
 * IMPORTANTE: Todas as rotas são read-only. Não modificam estado.
 */

import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { resolveTenantDataDir } from '../../tenant/TenantSecurity';
import * as path from 'path';

// Imports do Core (camada-3)
import { AutonomyMandateRepositoryImpl } from '../../camada-3/autonomy/AutonomyMandateRepositoryImpl';
import { ReviewCaseRepositoryImpl } from '../../camada-3/review/ReviewCaseRepositoryImpl';
import { ObservacaoRepositoryImpl } from '../../camada-3/repositorios/implementacao/ObservacaoRepositoryImpl';
import { EventLogRepositoryImpl } from '../../camada-3/event-log/EventLogRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

interface TenantIdParams {
  tenantId: string;
}

interface MandateIdParams extends TenantIdParams {
  mandateId: string;
}

interface ReviewIdParams extends TenantIdParams {
  reviewId: string;
}

interface ObservacaoIdParams extends TenantIdParams {
  observacaoId: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

interface EventLogFilterQuery extends PaginationQuery {
  tenantId?: string;
  entityType?: string;
  eventType?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o usuário tem acesso ao tenant especificado.
 */
function canAccessTenant(authContext: any, tenantId: string): boolean {
  if (!authContext) return false;
  if (authContext.role === 'global_admin') return true;
  if (authContext.role === 'tenant_admin' && authContext.tenantId === tenantId) return true;
  return false;
}

function forbidden(reply: FastifyReply, message: string = 'Insufficient permissions') {
  return reply.code(403).send({ error: 'FORBIDDEN', message });
}

function notFound(reply: FastifyReply, resource: string, id: string) {
  return reply.code(404).send({ error: 'NOT_FOUND', message: `${resource} not found: ${id}` });
}

function parseLimit(limit?: string, defaultLimit: number = 50): number {
  if (!limit) return defaultLimit;
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, 200);
}

function parseOffset(offset?: string): number {
  if (!offset) return 0;
  const parsed = parseInt(offset, 10);
  if (isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Obtém repositórios do tenant
 */
async function getTenantRepositories(baseDir: string, tenantId: string) {
  const dataDir = await resolveTenantDataDir(baseDir, tenantId);
  return {
    mandateRepo: new AutonomyMandateRepositoryImpl(path.join(dataDir, 'autonomy_mandates.json')),
    reviewRepo: new ReviewCaseRepositoryImpl(path.join(dataDir, 'review_cases.json')),
    observacaoRepo: await ObservacaoRepositoryImpl.create(dataDir),
    eventLogRepo: new EventLogRepositoryImpl(dataDir)
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

export const queryRoutes: FastifyPluginAsync = async (app) => {
  const baseDir = (app as any).registry.getBaseDir();

  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL ADMIN ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/query/tenants
   */
  app.get('/tenants', async (request: any, reply) => {
    if (request.authContext?.role !== 'global_admin') {
      return forbidden(reply, 'Requires global_admin role');
    }

    const tenants = (app as any).registry.list(false);
    return {
      tenants: tenants.map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt
      })),
      total: tenants.length
    };
  });

  /**
   * GET /admin/query/instances
   */
  app.get('/instances', async (request: any, reply) => {
    if (request.authContext?.role !== 'global_admin') {
      return forbidden(reply, 'Requires global_admin role');
    }

    const activeIds = (app as any).runtime.listActive();
    const instances = activeIds.map((tenantId: string) => {
      const metrics = (app as any).runtime.getMetrics(tenantId);
      return {
        tenantId,
        startedAt: metrics?.startedAt,
        uptime: metrics?.uptime,
        lastActivity: metrics?.lastActivity
      };
    });

    return { instances, total: instances.length };
  });

  /**
   * GET /admin/query/metrics
   */
  app.get('/metrics', async (request: any, reply) => {
    if (request.authContext?.role !== 'global_admin') {
      return forbidden(reply, 'Requires global_admin role');
    }

    const tenants = (app as any).registry.list(false);
    const activeIds = (app as any).runtime.listActive();

    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter((t: any) => t.status === 'active').length,
      suspendedTenants: tenants.filter((t: any) => t.status === 'suspended').length,
      activeInstances: activeIds.length,
      timestamp: new Date().toISOString()
    };
  });

  /**
   * GET /admin/query/eventlog
   */
  app.get<{ Querystring: EventLogFilterQuery }>(
    '/eventlog',
    async (request: any, reply) => {
      if (request.authContext?.role !== 'global_admin') {
        return forbidden(reply, 'Requires global_admin role');
      }

      const { tenantId, limit, offset } = request.query;
      const parsedLimit = parseLimit(limit, 100);
      const parsedOffset = parseOffset(offset);

      if (tenantId) {
        const tenant = (app as any).registry.get(tenantId);
        if (!tenant) {
          return notFound(reply, 'Tenant', tenantId);
        }

        try {
          const repos = await getTenantRepositories(baseDir, tenantId);
          await repos.eventLogRepo.init();
          const allEvents = await repos.eventLogRepo.getAll();
          const paginated = allEvents.slice(parsedOffset, parsedOffset + parsedLimit);

          return {
            events: paginated,
            total: allEvents.length,
            limit: parsedLimit,
            offset: parsedOffset
          };
        } catch (err: any) {
          return { events: [], total: 0, limit: parsedLimit, offset: parsedOffset };
        }
      }

      // Sem tenantId: retornar vazio (agregar todos seria muito pesado)
      return { events: [], total: 0, limit: parsedLimit, offset: parsedOffset };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // TENANT-SCOPED ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/query/:tenantId/mandates
   */
  app.get<{ Params: TenantIdParams; Querystring: PaginationQuery }>(
    '/:tenantId/mandates',
    async (request: any, reply) => {
      const { tenantId } = request.params;
      const { limit, offset } = request.query;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        const allMandates = await repos.mandateRepo.getAll();
        const parsedLimit = parseLimit(limit);
        const parsedOffset = parseOffset(offset);
        const paginated = allMandates.slice(parsedOffset, parsedOffset + parsedLimit);

        return {
          mandates: paginated,
          total: allMandates.length,
          limit: parsedLimit,
          offset: parsedOffset
        };
      } catch {
        return { mandates: [], total: 0, limit: parseLimit(limit), offset: parseOffset(offset) };
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/mandates/:mandateId
   */
  app.get<{ Params: MandateIdParams }>(
    '/:tenantId/mandates/:mandateId',
    async (request: any, reply) => {
      const { tenantId, mandateId } = request.params;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        const mandate = await repos.mandateRepo.getById(mandateId);

        if (!mandate) {
          return notFound(reply, 'Mandate', mandateId);
        }

        return { mandate, history: [] };
      } catch {
        return notFound(reply, 'Mandate', mandateId);
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/reviews
   */
  app.get<{ Params: TenantIdParams; Querystring: PaginationQuery }>(
    '/:tenantId/reviews',
    async (request: any, reply) => {
      const { tenantId } = request.params;
      const { limit, offset } = request.query;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        const allCases = await repos.reviewRepo.list(tenantId, {});
        const parsedLimit = parseLimit(limit);
        const parsedOffset = parseOffset(offset);
        const paginated = allCases.slice(parsedOffset, parsedOffset + parsedLimit);

        return {
          reviews: paginated,
          total: allCases.length,
          limit: parsedLimit,
          offset: parsedOffset
        };
      } catch {
        return { reviews: [], total: 0, limit: parseLimit(limit), offset: parseOffset(offset) };
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/reviews/:reviewId
   */
  app.get<{ Params: ReviewIdParams }>(
    '/:tenantId/reviews/:reviewId',
    async (request: any, reply) => {
      const { tenantId, reviewId } = request.params;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        const reviewCase = await repos.reviewRepo.getById(tenantId, reviewId);

        if (!reviewCase) {
          return notFound(reply, 'ReviewCase', reviewId);
        }

        return { reviewCase };
      } catch {
        return notFound(reply, 'ReviewCase', reviewId);
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/consequences
   */
  app.get<{ Params: TenantIdParams; Querystring: PaginationQuery }>(
    '/:tenantId/consequences',
    async (request: any, reply) => {
      const { tenantId } = request.params;
      const { limit, offset } = request.query;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        // Usar getByDateRange com intervalo amplo como workaround para listar todos
        const allObs = await repos.observacaoRepo.getByDateRange(
          new Date('2000-01-01'),
          new Date('2100-01-01')
        );
        const parsedLimit = parseLimit(limit);
        const parsedOffset = parseOffset(offset);
        const paginated = allObs.slice(parsedOffset, parsedOffset + parsedLimit);

        return {
          consequences: paginated,
          total: allObs.length,
          limit: parsedLimit,
          offset: parsedOffset
        };
      } catch {
        return { consequences: [], total: 0, limit: parseLimit(limit), offset: parseOffset(offset) };
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/consequences/:observacaoId
   */
  app.get<{ Params: ObservacaoIdParams }>(
    '/:tenantId/consequences/:observacaoId',
    async (request: any, reply) => {
      const { tenantId, observacaoId } = request.params;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);
        const observacao = await repos.observacaoRepo.getById(observacaoId);

        if (!observacao) {
          return notFound(reply, 'Observacao', observacaoId);
        }

        return { observacao };
      } catch {
        return notFound(reply, 'Observacao', observacaoId);
      }
    }
  );

  /**
   * GET /admin/query/:tenantId/dashboard
   */
  app.get<{ Params: TenantIdParams }>(
    '/:tenantId/dashboard',
    async (request: any, reply) => {
      const { tenantId } = request.params;

      if (!canAccessTenant(request.authContext, tenantId)) {
        return forbidden(reply);
      }

      const tenant = (app as any).registry.get(tenantId);
      if (!tenant) {
        return notFound(reply, 'Tenant', tenantId);
      }

      try {
        const repos = await getTenantRepositories(baseDir, tenantId);

        // Contagem de mandatos
        const allMandates = await repos.mandateRepo.getAll();
        const activeMandates = allMandates.filter((m: any) => m.status === 'active').length;
        const suspendedMandates = allMandates.filter((m: any) => m.status === 'suspended').length;

        // Contagem de reviews
        const reviewCounts = await repos.reviewRepo.countByStatus(tenantId);

        // Contagem de consequências
        const allObs = await repos.observacaoRepo.getByDateRange(
          new Date('2000-01-01'),
          new Date('2100-01-01')
        );

        // Eventos recentes
        await repos.eventLogRepo.init();
        const allEvents = await repos.eventLogRepo.getAll();
        const lastEvents = allEvents.slice(-10).reverse();

        return {
          tenantId,
          tenant: { name: tenant.name, status: tenant.status },
          mandates: { active: activeMandates, suspended: suspendedMandates, total: allMandates.length },
          reviews: reviewCounts,
          consequences: { total: allObs.length },
          recentEvents: lastEvents.map((e: any) => ({
            evento: e.evento,
            entidade: e.entidade,
            ts: e.timestamp
          })),
          timestamp: new Date().toISOString()
        };
      } catch {
        return {
          tenantId,
          tenant: { name: tenant.name, status: tenant.status },
          mandates: { active: 0, suspended: 0, total: 0 },
          reviews: { OPEN: 0, RESOLVED: 0, DISMISSED: 0 },
          consequences: { total: 0 },
          recentEvents: [],
          timestamp: new Date().toISOString()
        };
      }
    }
  );
};
