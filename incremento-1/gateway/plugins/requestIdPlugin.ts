/**
 * INCREMENTO 12 — SaaS Readiness: Request ID Plugin
 *
 * Plugin Fastify para rastreamento de requisicoes.
 * - Gera ou usa X-Request-Id existente
 * - Adiciona requestId ao contexto
 * - Retorna requestId no header de resposta
 * - Loga metricas estruturadas em JSON
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    requestStartTime: number;
  }
}

/**
 * Opcoes do plugin
 */
export interface RequestIdPluginOptions {
  /**
   * Se true, loga metricas estruturadas em JSON
   * Default: true
   */
  logMetrics?: boolean;

  /**
   * Nivel de log para metricas
   * Default: 'info'
   */
  logLevel?: 'info' | 'debug' | 'trace';
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gera um request ID unico (UUID v4)
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Extrai request ID do header ou gera um novo
 */
function extractOrGenerateRequestId(request: FastifyRequest): string {
  const headerValue = request.headers['x-request-id'];

  if (headerValue && typeof headerValue === 'string' && headerValue.length > 0) {
    // Sanitizar: apenas alfanumericos, hifens e underscores
    const sanitized = headerValue.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 64);
    if (sanitized.length > 0) {
      return sanitized;
    }
  }

  return generateRequestId();
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

const requestIdPluginImpl: FastifyPluginAsync<RequestIdPluginOptions> = async (
  app,
  opts
) => {
  const logMetrics = opts.logMetrics !== false;
  const logLevel = opts.logLevel || 'info';

  // Decorar request
  app.decorateRequest('requestId', '');
  app.decorateRequest('requestStartTime', 0);

  // Hook onRequest: capturar tempo e gerar/extrair requestId
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    request.requestStartTime = Date.now();
    request.requestId = extractOrGenerateRequestId(request);

    // Adicionar ao header de resposta
    reply.header('X-Request-Id', request.requestId);
  });

  // Hook onResponse: logar metricas estruturadas
  if (logMetrics) {
    app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
      const latencyMs = Date.now() - request.requestStartTime;

      const logEntry = {
        ts: new Date().toISOString(),
        level: logLevel,
        requestId: request.requestId,
        tenantId: (request as any).tenantId || null,
        role: (request as any).authContext?.role || null,
        method: request.method,
        url: request.url,
        route: request.routeOptions?.url || request.url,
        statusCode: reply.statusCode,
        latencyMs
      };

      // Logar como JSON estruturado
      // Usar o logger do Fastify
      switch (logLevel) {
        case 'debug':
          request.log.debug(logEntry, 'request completed');
          break;
        case 'trace':
          request.log.trace(logEntry, 'request completed');
          break;
        default:
          request.log.info(logEntry, 'request completed');
      }
    });
  }
};

export const requestIdPlugin = fp(requestIdPluginImpl, {
  name: 'request-id-plugin',
  fastify: '5.x'
});
