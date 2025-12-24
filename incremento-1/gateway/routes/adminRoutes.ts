/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Admin Routes
 *
 * Rotas administrativas para gerenciamento de tenants.
 * Todas as rotas requerem autenticacao via adminToken.
 */

import { FastifyPluginAsync } from 'fastify';
import { TenantAdminAPI } from '../../tenant/TenantAdminAPI';
import { TenantRegistrationInput, TenantUpdateInput, TenantRole } from '../../tenant/TenantConfig';
import crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

declare module 'fastify' {
  interface FastifyInstance {
    adminApi: TenantAdminAPI;
  }
}

interface TenantIdParams {
  id: string;
}

interface ListTenantsQuery {
  includeDeleted?: boolean;
}

interface ExportQuery {
  fromTs?: string;
  toTs?: string;
  fromSegment?: string;
  toSegment?: string;
}

interface ReplayQuery {
  evento?: string;
  entidade?: string;
  entidadeId?: string;
  fromTs?: string;
  toTs?: string;
}

interface CreateKeyBody {
  role: 'public' | 'tenant_admin';
  description?: string;
}

interface KeyIdParams {
  id: string;
  keyId: string;
}

interface RotateKeyBody {
  role: 'public' | 'tenant_admin';
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gera token de API aleatorio (32 bytes hex)
 */
function generateApiToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ══════════════════════════════════════════════════════════════════════════
  // TENANT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/tenants
   * Lista todos os tenants
   */
  app.get<{ Querystring: ListTenantsQuery }>(
    '/tenants',
    async (request, reply) => {
      const { includeDeleted } = request.query;
      const result = await app.adminApi.listTenants(includeDeleted);

      if (!result.success) {
        return reply.code(500).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * POST /admin/tenants
   * Registra novo tenant
   */
  app.post<{ Body: TenantRegistrationInput }>(
    '/tenants',
    async (request, reply) => {
      const input = request.body;

      // Gerar apiToken se nao fornecido
      const apiToken = input.apiToken || generateApiToken();
      input.apiToken = apiToken;

      const result = await app.adminApi.registerTenant(input);

      if (!result.success) {
        // Erros de validacao retornam 400
        // Mensagens em portugues: "invalido", "ja existe"
        if (
          result.error?.includes('invalido') ||
          result.error?.includes('Invalid') ||
          result.error?.includes('ja existe') ||
          result.error?.includes('already exists')
        ) {
          return reply.code(400).send({ error: result.error });
        }
        return reply.code(500).send({ error: result.error });
      }

      // Incluir apiToken na resposta (pode não estar no result.data se registry não persistir)
      const responseData = { ...result.data, apiToken };
      return reply.code(201).send(responseData);
    }
  );

  /**
   * GET /admin/tenants/:id
   * Detalhes de um tenant
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.getTenant(id);

      if (!result.success) {
        return reply.code(404).send({ error: result.error || 'Tenant not found' });
      }

      return result.data;
    }
  );

  /**
   * PATCH /admin/tenants/:id
   * Atualiza tenant
   */
  app.patch<{ Params: TenantIdParams; Body: TenantUpdateInput }>(
    '/tenants/:id',
    async (request, reply) => {
      const { id } = request.params;
      const input = request.body;

      // Cast para compatibilidade de tipos (TenantUpdateInput -> partial config)
      const result = await app.adminApi.updateTenant(id, input as any);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          return reply.code(404).send({ error: result.error });
        }
        return reply.code(400).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * POST /admin/tenants/:id/suspend
   * Suspende tenant
   */
  app.post<{ Params: TenantIdParams }>(
    '/tenants/:id/suspend',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.suspendTenant(id);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          return reply.code(404).send({ error: result.error });
        }
        return reply.code(400).send({ error: result.error });
      }

      return { success: true, message: `Tenant ${id} suspended` };
    }
  );

  /**
   * POST /admin/tenants/:id/resume
   * Reativa tenant suspenso
   */
  app.post<{ Params: TenantIdParams }>(
    '/tenants/:id/resume',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.resumeTenant(id);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          return reply.code(404).send({ error: result.error });
        }
        return reply.code(400).send({ error: result.error });
      }

      return { success: true, message: `Tenant ${id} resumed` };
    }
  );

  /**
   * DELETE /admin/tenants/:id
   * Remove tenant (soft delete)
   */
  app.delete<{ Params: TenantIdParams }>(
    '/tenants/:id',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.removeTenant(id);

      if (!result.success) {
        if (result.error?.includes('not found')) {
          return reply.code(404).send({ error: result.error });
        }
        return reply.code(400).send({ error: result.error });
      }

      return { success: true, message: `Tenant ${id} removed` };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIT OPERATIONS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/tenants/:id/audit/verify
   * Verifica integridade da cadeia de eventos
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id/audit/verify',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.verifyChain(id);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * GET /admin/tenants/:id/audit/verify-fast
   * Verificacao rapida via snapshot
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id/audit/verify-fast',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.verifyFromSnapshot(id);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * GET /admin/tenants/:id/audit/export
   * Exporta eventos por intervalo
   */
  app.get<{ Params: TenantIdParams; Querystring: ExportQuery }>(
    '/tenants/:id/audit/export',
    async (request, reply) => {
      const { id } = request.params;
      const { fromTs, toTs, fromSegment, toSegment } = request.query;

      const options: any = {};
      if (fromTs) options.fromTs = new Date(fromTs);
      if (toTs) options.toTs = new Date(toTs);
      if (fromSegment) options.fromSegment = parseInt(fromSegment, 10);
      if (toSegment) options.toSegment = parseInt(toSegment, 10);

      const result = await app.adminApi.exportEventLog(id, options);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * GET /admin/tenants/:id/audit/replay
   * Replay operacional
   */
  app.get<{ Params: TenantIdParams; Querystring: ReplayQuery }>(
    '/tenants/:id/audit/replay',
    async (request, reply) => {
      const { id } = request.params;
      const { evento, entidade, entidadeId, fromTs, toTs } = request.query;

      const options: any = {};
      if (evento) options.evento = evento;
      if (entidade) options.entidade = entidade;
      if (entidadeId) options.entidadeId = entidadeId;
      if (fromTs) options.fromTs = new Date(fromTs);
      if (toTs) options.toTs = new Date(toTs);

      const result = await app.adminApi.replayEventLog(id, options);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * GET /admin/tenants/:id/events
   * Lista eventos do tenant
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id/events',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.listEvents(id);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return { events: result.data, count: result.data?.length ?? 0 };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // KEY MANAGEMENT (RBAC)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /admin/tenants/:id/keys
   * Cria nova chave de autenticacao para o tenant
   * Requer: global_admin OU tenant_admin do mesmo tenant
   */
  app.post<{ Params: TenantIdParams; Body: CreateKeyBody }>(
    '/tenants/:id/keys',
    async (request, reply) => {
      const { id } = request.params;
      const { role, description } = request.body;

      // Validar role
      if (role !== 'public' && role !== 'tenant_admin') {
        return reply.code(400).send({
          error: 'Invalid role',
          message: "Role must be 'public' or 'tenant_admin'"
        });
      }

      try {
        const result = await app.registry.createTenantKey(id, role as TenantRole, description);

        return reply.code(201).send({
          keyId: result.keyId,
          role: result.role,
          token: result.token, // Retornado APENAS UMA VEZ
          createdAt: result.createdAt,
          warning: 'Save this token now. It will not be shown again.'
        });
      } catch (err: any) {
        if (err.message?.includes('nao encontrado')) {
          return reply.code(404).send({ error: 'Tenant not found' });
        }
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  /**
   * GET /admin/tenants/:id/keys
   * Lista chaves do tenant (sem expor tokens/hashes)
   * Requer: global_admin OU tenant_admin do mesmo tenant
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id/keys',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const keys = app.registry.listTenantKeys(id);
        return { keys, count: keys.length };
      } catch (err: any) {
        if (err.message?.includes('nao encontrado')) {
          return reply.code(404).send({ error: 'Tenant not found' });
        }
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /admin/tenants/:id/keys/:keyId/revoke
   * Revoga uma chave especifica
   * Requer: global_admin OU tenant_admin do mesmo tenant
   */
  app.post<{ Params: KeyIdParams }>(
    '/tenants/:id/keys/:keyId/revoke',
    async (request, reply) => {
      const { id, keyId } = request.params;

      try {
        await app.registry.revokeTenantKey(id, keyId);
        return { success: true, message: `Key ${keyId} revoked` };
      } catch (err: any) {
        if (err.message?.includes('nao encontrado') || err.message?.includes('Chave nao encontrada')) {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message?.includes('ja foi revogada')) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /admin/tenants/:id/keys/rotate
   * Cria nova chave para um role (rotacao)
   * Nao revoga chaves antigas automaticamente
   * Requer: global_admin OU tenant_admin do mesmo tenant
   */
  app.post<{ Params: TenantIdParams; Body: RotateKeyBody }>(
    '/tenants/:id/keys/rotate',
    async (request, reply) => {
      const { id } = request.params;
      const { role } = request.body;

      // Validar role
      if (role !== 'public' && role !== 'tenant_admin') {
        return reply.code(400).send({
          error: 'Invalid role',
          message: "Role must be 'public' or 'tenant_admin'"
        });
      }

      try {
        const result = await app.registry.rotateTenantKey(id, role as TenantRole);

        return reply.code(201).send({
          keyId: result.keyId,
          role: result.role,
          token: result.token, // Retornado APENAS UMA VEZ
          createdAt: result.createdAt,
          warning: 'Save this token now. It will not be shown again. Old keys remain active until revoked.'
        });
      } catch (err: any) {
        if (err.message?.includes('nao encontrado')) {
          return reply.code(404).send({ error: 'Tenant not found' });
        }
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // METRICS & HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /admin/tenants/:id/metrics
   * Metricas de um tenant
   */
  app.get<{ Params: TenantIdParams }>(
    '/tenants/:id/metrics',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.getTenantMetrics(id);

      if (!result.success) {
        return reply.code(404).send({ error: result.error });
      }

      return result.data;
    }
  );

  /**
   * GET /admin/metrics
   * Metricas globais
   */
  app.get('/metrics', async (_request, _reply) => {
    const result = await app.adminApi.getGlobalMetrics();

    if (!result.success) {
      return { error: result.error };
    }

    return result.data;
  });

  /**
   * GET /admin/health
   * Health check global (com detalhes de cada tenant)
   */
  app.get('/health', async (_request, _reply) => {
    const result = await app.adminApi.healthCheck();

    if (!result.success) {
      return { error: result.error };
    }

    return result.data;
  });

  /**
   * GET /admin/instances
   * Lista instancias ativas
   */
  app.get('/instances', async (_request, _reply) => {
    const activeInstances = app.adminApi.listActiveInstances();
    return { activeInstances };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INSTANCE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /admin/tenants/:id/shutdown
   * Força shutdown de uma instância
   */
  app.post<{ Params: TenantIdParams }>(
    '/tenants/:id/shutdown',
    async (request, reply) => {
      const { id } = request.params;
      const result = await app.adminApi.shutdownInstance(id);

      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }

      return { success: true, message: `Instance ${id} shutdown` };
    }
  );

  /**
   * POST /admin/shutdown-all
   * Shutdown de todas as instancias
   */
  app.post('/shutdown-all', async (_request, _reply) => {
    const result = await app.adminApi.shutdownAll();

    if (!result.success) {
      return { error: result.error };
    }

    return { success: true, message: 'All instances shutdown' };
  });
};
