/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Tenant Plugin
 *
 * Plugin Fastify para resolucao de tenant em cada requisicao.
 * Usa estrategia "auto": header -> path -> subdomain
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { TenantRegistry } from '../../tenant/TenantRegistry';
import { TenantRuntime, CoreInstance } from '../../tenant/TenantRuntime';
import { extractTenantIdWithConflictDetection } from '../../tenant/TenantRouter';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

declare module 'fastify' {
  interface FastifyInstance {
    registry: TenantRegistry;
    runtime: TenantRuntime;
  }

  interface FastifyRequest {
    tenantId: string | null;
    tenantInstance: CoreInstance | null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROTAS QUE NAO PRECISAM DE TENANT
// ════════════════════════════════════════════════════════════════════════════

const SKIP_TENANT_PREFIXES = [
  '/health',
  '/admin',
  '/metrics'
];

function shouldSkipTenant(url: string): boolean {
  return SKIP_TENANT_PREFIXES.some(prefix => url.startsWith(prefix));
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const tenantPluginImpl: FastifyPluginAsync = async (app) => {
  // Decorar request com campos de tenant
  app.decorateRequest('tenantId', null);
  app.decorateRequest('tenantInstance', null);

  // Hook preHandler para resolver tenant
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip para rotas que nao precisam de tenant
    if (shouldSkipTenant(request.url)) {
      return;
    }

    // 1. Extrair tenantId com deteccao de conflito
    const extraction = extractTenantIdWithConflictDetection({
      headers: request.headers as Record<string, string | string[] | undefined>,
      path: request.url,
      host: request.headers.host
    });

    // 2. Verificar conflito entre fontes
    if (extraction.hasConflict) {
      return reply.code(400).send({
        error: 'Tenant ID conflict',
        code: 'TENANT_CONFLICT',
        message: 'Conflicting tenant IDs detected. Header X-Tenant-Id must match path/subdomain if both are present.',
        details: extraction.conflictDetails
      });
    }

    const tenantId = extraction.tenantId;

    if (!tenantId) {
      return reply.code(400).send({
        error: 'Missing tenant ID',
        message: 'Provide tenant ID via X-Tenant-Id header, path, or subdomain'
      });
    }

    // 3. Verificar existencia do tenant
    const exists = await app.registry.exists(tenantId);
    if (!exists) {
      return reply.code(404).send({
        error: 'Tenant not found',
        tenantId
      });
    }

    // 4. Verificar se tenant esta ativo
    const isActive = await app.registry.isActive(tenantId);
    if (!isActive) {
      return reply.code(403).send({
        error: 'Tenant suspended',
        tenantId
      });
    }

    // 5. Obter instancia do Core
    try {
      const instance = await app.runtime.getOrCreate(tenantId);
      request.tenantId = tenantId;
      request.tenantInstance = instance;
    } catch (error: any) {
      request.log.error({ err: error, tenantId }, 'Failed to get tenant instance');
      return reply.code(500).send({
        error: 'Failed to initialize tenant',
        message: error.message
      });
    }
  });
};

export const tenantPlugin = fp(tenantPluginImpl, {
  name: 'tenant-plugin',
  fastify: '5.x'
});
