/**
 * INCREMENTO 12 — SaaS Readiness: Auth Plugin (RBAC)
 *
 * Plugin Fastify para autenticacao e autorizacao baseada em papeis.
 *
 * PAPEIS:
 * - 'public': acesso as rotas cognitivas (/api/v1/*)
 * - 'tenant_admin': acesso as rotas admin do proprio tenant
 * - 'global_admin': acesso a todas as rotas admin
 *
 * REGRAS:
 * - /admin/tenants (CRUD global): requer global_admin
 * - /admin/tenants/:id/* (audit, metrics, keys): requer tenant_admin OU global_admin
 * - /api/v1/*: requer public (ou superior) do tenant identificado
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as fs from 'fs/promises';
import { TenantRole } from '../../tenant/TenantConfig';
import { AuthContext } from '../../tenant/TenantRegistry';
import { validateToken, secureCompare } from '../../tenant/TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export interface AuthPluginOptions {
  /**
   * Token de autenticacao para API administrativa (legacy, para compatibilidade)
   */
  adminToken?: string;

  /**
   * Caminho para arquivo de configuracao global (config/global.json)
   * Se nao fornecido, usa adminToken como fallback
   */
  globalConfigPath?: string;

  /**
   * Se true, requer autenticacao mesmo em modo de desenvolvimento
   */
  requireAuthInDev?: boolean;
}

/**
 * Configuracao global para admin tokens
 */
interface GlobalConfig {
  globalAdminKeys?: Array<{
    keyId: string;
    tokenHash: string;
    status: 'active' | 'revoked';
    createdAt: string;
    description?: string;
  }>;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extrai Bearer token do header Authorization
 */
function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice(7).trim();
  return token || null;
}

/**
 * Extrai tenantId do path /admin/tenants/:id/... ou /admin/query/:tenantId/...
 */
function extractTenantIdFromAdminPath(url: string): string | null {
  // /admin/tenants/:id/...
  const tenantsMatch = url.match(/^\/admin\/tenants\/([^/]+)/);
  if (tenantsMatch && tenantsMatch[1]) {
    return tenantsMatch[1];
  }

  // /admin/query/:tenantId/... (Query APIs)
  const queryMatch = url.match(/^\/admin\/query\/([^/]+)/);
  if (queryMatch && queryMatch[1]) {
    // Nao retornar para rotas globais
    const globalRoutes = ['tenants', 'instances', 'metrics', 'eventlog'];
    if (!globalRoutes.includes(queryMatch[1])) {
      return queryMatch[1];
    }
  }

  return null;
}

/**
 * Verifica se a rota e uma operacao global (CRUD de tenants)
 */
function isGlobalAdminRoute(url: string, method: string): boolean {
  // POST /admin/tenants (criar tenant) - global
  if (url === '/admin/tenants' && method === 'POST') {
    return true;
  }

  // GET /admin/tenants (listar tenants) - global
  if (url === '/admin/tenants' && method === 'GET') {
    return true;
  }

  // /admin/metrics/global, /admin/instances, /admin/health - global
  if (url.startsWith('/admin/metrics/global') ||
      url === '/admin/instances' ||
      url === '/admin/health' ||
      url === '/admin/shutdown') {
    return true;
  }

  // Query APIs globais (Inc 21)
  if (url === '/admin/query/tenants' ||
      url === '/admin/query/instances' ||
      url === '/admin/query/metrics' ||
      url.startsWith('/admin/query/eventlog')) {
    return true;
  }

  return false;
}

/**
 * Verifica se a rota e uma operacao por-tenant (audit, keys, metrics do tenant)
 */
function isTenantAdminRoute(url: string): boolean {
  const tenantIdFromPath = extractTenantIdFromAdminPath(url);
  if (!tenantIdFromPath) {
    return false;
  }

  // /admin/tenants/:id/* (exceto operacoes que requerem global_admin)
  // Ex: /admin/tenants/acme/audit/verify, /admin/tenants/acme/keys
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const { adminToken, globalConfigPath, requireAuthInDev = false } = opts;
  const isDev = process.env.NODE_ENV !== 'production';

  // Carregar configuracao global
  let globalConfig: GlobalConfig = {};
  if (globalConfigPath) {
    try {
      const content = await fs.readFile(globalConfigPath, 'utf-8');
      globalConfig = JSON.parse(content);
    } catch {
      // Arquivo nao existe ou invalido - usar adminToken como fallback
    }
  }

  // Decorar request com authContext
  app.decorateRequest('authContext', null);

  /**
   * Valida token global admin
   * Inc 12.1: usa validateToken com dual-verify (HMAC + SHA-256 legacy)
   */
  function validateGlobalAdminToken(token: string): AuthContext | null {
    // 1. Verificar contra keys do arquivo global.json
    if (globalConfig.globalAdminKeys) {
      for (const key of globalConfig.globalAdminKeys) {
        if (key.status !== 'active') continue;

        // Inc 12.1: validateToken faz dual-verify (HMAC primeiro, SHA-256 fallback)
        if (validateToken(token, key.tokenHash)) {
          return {
            role: 'global_admin',
            keyId: key.keyId
          };
        }
      }
    }

    // 2. Fallback: verificar contra adminToken (legacy)
    // Inc 12.1: usar secureCompare timing-safe
    if (adminToken && secureCompare(token, adminToken)) {
      return {
        role: 'global_admin',
        keyId: 'legacy-admin'
      };
    }

    return null;
  }

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;
    const method = request.method;

    // ══════════════════════════════════════════════════════════════════════════
    // SKIP: Health, Metrics e Admin UI (arquivos estáticos) publicos
    // ══════════════════════════════════════════════════════════════════════════
    if (url.startsWith('/health') || url === '/metrics') {
      return;
    }

    // Admin UI é público (a autenticação é feita via JS no frontend)
    if (url.startsWith('/admin/ui')) {
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTERNAL ROUTES (Inc 24 - Metrics): handled by metricsRoutes with own RBAC
    // ══════════════════════════════════════════════════════════════════════════
    if (url.startsWith('/internal')) {
      const token = extractBearerToken(request.headers.authorization);

      if (!token) {
        // RBAC checks happen in metricsRoutes - just don't set authContext
        return;
      }

      // Tentar validar como global_admin
      const globalAuthContext = validateGlobalAdminToken(token);
      if (globalAuthContext) {
        request.authContext = globalAuthContext;
        return;
      }

      // Para rotas /internal/tenants/:tenantId/*, tentar validar como tenant_admin
      const tenantMatch = url.match(/^\/internal\/tenants\/([^/]+)/);
      if (tenantMatch && tenantMatch[1]) {
        const tenantId = tenantMatch[1];
        const tenantAuthContext = app.registry.validateTenantToken(tenantId, token);
        if (tenantAuthContext) {
          request.authContext = tenantAuthContext;
          return;
        }
      }

      // Token inválido - RBAC checks in metricsRoutes will handle 403
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ADMIN ROUTES
    // ══════════════════════════════════════════════════════════════════════════
    if (url.startsWith('/admin')) {
      const token = extractBearerToken(request.headers.authorization);

      if (!token) {
        // Em dev sem token configurado, permitir (facilita testes)
        if (isDev && !adminToken && !requireAuthInDev) {
          return;
        }

        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'MISSING_TOKEN',
          message: 'Missing Authorization header'
        });
      }

      // 1. Tentar validar como global_admin
      const globalAuthContext = validateGlobalAdminToken(token);

      if (globalAuthContext) {
        // Token de global_admin - acesso total
        request.authContext = globalAuthContext;
        return;
      }

      // 2. Se e rota global, requer global_admin (e nao encontrou)
      if (isGlobalAdminRoute(url, method)) {
        request.log.warn({ ip: request.ip }, 'Invalid global admin token attempt');
        return reply.code(403).send({
          error: 'Forbidden',
          code: 'INSUFFICIENT_ROLE',
          message: 'This operation requires global_admin role'
        });
      }

      // 3. Se e rota por-tenant, tentar validar como tenant_admin
      if (isTenantAdminRoute(url)) {
        const pathTenantId = extractTenantIdFromAdminPath(url);

        if (pathTenantId) {
          // Validar token contra o tenant do path
          const tenantAuthContext = app.registry.validateTenantToken(pathTenantId, token);

          if (tenantAuthContext) {
            // Verificar se tem role adequado (tenant_admin ou public para algumas rotas)
            if (tenantAuthContext.role === 'tenant_admin' ||
                tenantAuthContext.role === 'global_admin') {
              request.authContext = tenantAuthContext;
              return;
            }

            // Token valido mas role insuficiente
            return reply.code(403).send({
              error: 'Forbidden',
              code: 'INSUFFICIENT_ROLE',
              message: 'This operation requires tenant_admin role'
            });
          }
        }

        // Token invalido para qualquer tenant
        request.log.warn({ ip: request.ip }, 'Invalid admin token attempt');
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'INVALID_TOKEN',
          message: 'Invalid token'
        });
      }

      // 4. Rota admin nao reconhecida - requer global_admin por seguranca
      return reply.code(401).send({
        error: 'Unauthorized',
        code: 'INVALID_TOKEN',
        message: 'Invalid token'
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PUBLIC API ROUTES: requer token do tenant com role 'public' ou superior
    // ══════════════════════════════════════════════════════════════════════════
    if (url.startsWith('/api/')) {
      const tenantId = request.tenantId;

      // Se nao tem tenantId, o tenantPlugin ja tratou
      if (!tenantId) {
        return;
      }

      // Buscar config do tenant
      const tenant = app.registry.get(tenantId);

      // Se tenant nao tem keys NEM apiToken configurado, permitir (dev mode)
      if (!tenant?.apiToken && (!tenant?.keys || tenant.keys.length === 0)) {
        return;
      }

      const token = extractBearerToken(request.headers.authorization);

      if (!token) {
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'MISSING_TOKEN',
          message: 'Missing Authorization header'
        });
      }

      // Validar token do tenant
      const authContext = app.registry.validateTenantToken(tenantId, token);

      if (!authContext) {
        request.log.warn({ ip: request.ip, tenantId }, 'Invalid tenant API token attempt');
        return reply.code(401).send({
          error: 'Unauthorized',
          code: 'INVALID_TOKEN',
          message: 'Invalid API token'
        });
      }

      // Verificar role - qualquer role de tenant pode acessar API publica
      request.authContext = authContext;
    }
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth-plugin',
  fastify: '5.x',
  dependencies: ['tenant-plugin']
});
