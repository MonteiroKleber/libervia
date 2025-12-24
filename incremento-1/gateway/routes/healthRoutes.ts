/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Health Routes
 *
 * Rotas de health check e metricas basicas.
 */

import { FastifyPluginAsync } from 'fastify';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
}

interface ReadinessResponse extends HealthResponse {
  registry: {
    loaded: boolean;
    tenantCount: number;
  };
  runtime: {
    activeInstances: number;
  };
}

interface MetricsResponse {
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
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const startTime = Date.now();

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /health
   * Liveness probe - sempre retorna 200 se o servidor esta rodando
   */
  app.get('/health', async (_request, _reply): Promise<HealthResponse> => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime
    };
  });

  /**
   * GET /health/ready
   * Readiness probe - verifica se o sistema esta pronto para receber requests
   */
  app.get('/health/ready', async (_request, reply): Promise<ReadinessResponse> => {
    try {
      const tenants = await app.registry.list();
      const activeInstances = app.runtime.listActive();

      const response: ReadinessResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        registry: {
          loaded: true,
          tenantCount: tenants.length
        },
        runtime: {
          activeInstances: activeInstances.length
        }
      };

      return response;
    } catch (error: any) {
      reply.code(503);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startTime,
        registry: {
          loaded: false,
          tenantCount: 0
        },
        runtime: {
          activeInstances: 0
        }
      };
    }
  });

  /**
   * GET /metrics
   * Metricas do sistema em formato JSON
   */
  app.get('/metrics', async (_request, _reply): Promise<MetricsResponse> => {
    const mem = process.memoryUsage();
    const tenants = await app.registry.list(true); // incluir deletados para stats
    const activeInstances = app.runtime.listActive();

    const activeTenants = tenants.filter(t => t.status === 'active');
    const suspendedTenants = tenants.filter(t => t.status === 'suspended');

    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - startTime,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss
      },
      tenants: {
        registered: tenants.length,
        active: activeTenants.length,
        suspended: suspendedTenants.length
      },
      instances: {
        active: activeInstances.length
      }
    };
  });
};
