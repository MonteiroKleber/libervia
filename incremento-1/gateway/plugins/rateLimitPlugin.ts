/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Rate Limit Plugin
 *
 * Plugin Fastify para rate limiting por tenant.
 * Usa TenantQuotas.rateLimitRpm do registro.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitPluginOptions {
  /**
   * Limite padrao se tenant nao tiver quota definida
   */
  defaultLimit?: number;

  /**
   * Intervalo da janela em ms (default: 60000 = 1 minuto)
   */
  windowMs?: number;
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const rateLimitPluginImpl: FastifyPluginAsync<RateLimitPluginOptions> = async (app, opts) => {
  const { defaultLimit = 100, windowMs = 60000 } = opts;

  // Buckets por tenant
  const buckets = new Map<string, RateLimitBucket>();

  // Limpeza periodica de buckets expirados (a cada 5 minutos)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [tenantId, bucket] of buckets.entries()) {
      if (now > bucket.resetAt + windowMs) {
        buckets.delete(tenantId);
      }
    }
  }, 5 * 60 * 1000);

  // Garantir que o interval nao bloqueia o shutdown
  cleanupInterval.unref();

  // Hook para aplicar rate limit
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId;

    // Sem tenant (health, metrics) -> sem rate limit
    if (!tenantId) {
      return;
    }

    // Buscar limite do tenant
    const tenant = await app.registry.get(tenantId);
    const limit = tenant?.quotas.rateLimitRpm ?? defaultLimit;

    // Limite 0 = ilimitado
    if (limit === 0) {
      return;
    }

    const now = Date.now();
    let bucket = buckets.get(tenantId);

    // Criar ou resetar bucket se expirado
    if (!bucket || now > bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + windowMs
      };
      buckets.set(tenantId, bucket);
    }

    // Incrementar contador
    bucket.count++;

    // Calcular remaining
    const remaining = Math.max(0, limit - bucket.count);
    const resetInSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    // Adicionar headers de rate limit
    reply.header('X-RateLimit-Limit', limit.toString());
    reply.header('X-RateLimit-Remaining', remaining.toString());
    reply.header('X-RateLimit-Reset', resetInSeconds.toString());

    // Verificar se excedeu
    if (bucket.count > limit) {
      reply.header('Retry-After', resetInSeconds.toString());
      return reply.code(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${resetInSeconds} seconds.`,
        retryAfter: resetInSeconds
      });
    }
  });
};

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit-plugin',
  fastify: '5.x',
  dependencies: ['tenant-plugin']
});
