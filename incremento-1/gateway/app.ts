/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Application Factory
 *
 * Factory para criar instancia Fastify configurada.
 * Separado do entrypoint para facilitar testes.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import { GatewayConfig } from './GatewayConfig';
import { TenantRegistry } from '../tenant/TenantRegistry';
import { TenantRuntime, CoreInstance } from '../tenant/TenantRuntime';
import { TenantAdminAPI } from '../tenant/TenantAdminAPI';
import { IntegrationFactory, noAdapterFactory } from '../tenant/IntegrationAdapter';

import { tenantPlugin } from './plugins/tenantPlugin';
import { authPlugin } from './plugins/authPlugin';
import { rateLimitPlugin } from './plugins/rateLimitPlugin';
import { requestIdPlugin } from './plugins/requestIdPlugin';
import { getAuthPepper } from '../tenant/TenantSecurity';

import { healthRoutes } from './routes/healthRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { publicRoutes } from './routes/publicRoutes';
import { queryRoutes } from './routes/queryRoutes';
import { metricsRoutes } from './routes/metricsRoutes';
import { telemetryMiddleware } from './telemetry/TelemetryMiddleware';
import fastifyStatic from '@fastify/static';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

export interface AppContext {
  registry: TenantRegistry;
  runtime: TenantRuntime;
  adminApi: TenantAdminAPI;
}

export interface BuildAppOptions {
  config: GatewayConfig;
  integrationFactory?: IntegrationFactory;
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria e configura instancia Fastify com todos os plugins e rotas.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, integrationFactory = noAdapterFactory } = options;

  // ══════════════════════════════════════════════════════════════════════════
  // VALIDAR PEPPER (Inc 12.1 - Security Requirement)
  // ══════════════════════════════════════════════════════════════════════════

  // Verificar pepper no boot - falha se nao configurado
  // Em ambiente de teste, o pepper deve ser setado no beforeAll
  try {
    getAuthPepper();
  } catch (err) {
    throw new Error(
      `[Gateway Boot] ${(err as Error).message}\n` +
      'Set LIBERVIA_AUTH_PEPPER environment variable before starting the gateway.'
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INICIALIZAR TENANT LAYER
  // ══════════════════════════════════════════════════════════════════════════

  const registry = await TenantRegistry.create(config.baseDir);
  const runtime = TenantRuntime.create(registry, integrationFactory);
  const adminApi = TenantAdminAPI.create(registry, runtime);

  // ══════════════════════════════════════════════════════════════════════════
  // CRIAR FASTIFY
  // ══════════════════════════════════════════════════════════════════════════

  const app = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DECORAR COM CONTEXTO
  // ══════════════════════════════════════════════════════════════════════════

  app.decorate('registry', registry);
  app.decorate('runtime', runtime);
  app.decorate('adminApi', adminApi);

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRAR PLUGINS
  // ══════════════════════════════════════════════════════════════════════════

  // Request ID tracking (primeiro de todos)
  await app.register(requestIdPlugin, {
    logMetrics: config.nodeEnv !== 'test', // Nao logar em testes
    logLevel: 'info'
  });

  // CORS
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // Tenant resolution (precisa vir antes de auth)
  await app.register(tenantPlugin);

  // Authentication
  await app.register(authPlugin, {
    adminToken: config.adminToken
  });

  // Rate limiting (depende de tenant)
  await app.register(rateLimitPlugin);

  // Telemetry middleware (Inc 24 - coleta métricas HTTP)
  await app.register(telemetryMiddleware);

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRAR ROTAS
  // ══════════════════════════════════════════════════════════════════════════

  // Health e metrics (sem prefix)
  await app.register(healthRoutes);

  // Admin API
  await app.register(adminRoutes, { prefix: '/admin' });

  // Query APIs (Inc 21 - Painel Operacional)
  await app.register(queryRoutes, { prefix: '/admin/query' });

  // Metrics Routes (Inc 24 - Telemetria)
  await app.register(metricsRoutes);

  // Admin UI static files (Inc 21)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, 'ui'),
    prefix: '/admin/ui/'
  });

  // Rota para servir index.html do Admin UI (redirect para /admin/ui/)
  app.get('/admin/ui', async (request, reply) => {
    return reply.redirect('/admin/ui/');
  });

  // Public API
  await app.register(publicRoutes, { prefix: '/api/v1' });

  // ══════════════════════════════════════════════════════════════════════════
  // HOOKS DE LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  // Graceful shutdown
  app.addHook('onClose', async () => {
    app.log.info('Shutting down all tenant instances...');
    await runtime.shutdownAll();
    app.log.info('All instances shutdown complete');
  });

  return app;
}

/**
 * Retorna o contexto do app (registry, runtime, adminApi)
 */
export function getAppContext(app: FastifyInstance): AppContext {
  return {
    registry: app.registry,
    runtime: app.runtime,
    adminApi: app.adminApi
  };
}
