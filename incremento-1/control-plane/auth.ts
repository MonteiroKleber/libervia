/**
 * CONTROL-PLANE AUTHENTICATION
 *
 * Modulo de autenticacao reforcada para o control-plane.
 *
 * PRINCIPIOS:
 * - Token obrigatorio em producao
 * - Rate limiting basico
 * - Logging de tentativas falhas
 * - Preparado para mTLS
 *
 * Configuracao (env):
 *   CONTROL_PLANE_TOKEN - Token secreto (obrigatorio em prod)
 *   NODE_ENV - production | development | test
 *   CONTROL_PLANE_RATE_LIMIT - Requisicoes por minuto (default: 100)
 */

import * as http from 'http';
import * as crypto from 'crypto';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

// Funcoes para ler config dinamicamente (para testes)
function getToken(): string {
  return process.env.CONTROL_PLANE_TOKEN || '';
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

function getRateLimit(): number {
  return parseInt(process.env.CONTROL_PLANE_RATE_LIMIT || '100', 10);
}

const RATE_WINDOW_MS = 60 * 1000;  // 1 minuto

// Exports para compatibilidade (lidos no momento da chamada)
const TOKEN = '';  // Deprecated, usar getToken()
const IS_PRODUCTION = false;  // Deprecated, usar isProduction()
const RATE_LIMIT = 100;  // Deprecated, usar getRateLimit()

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

export interface AuthResult {
  authenticated: boolean;
  reason?: string;
  clientIp?: string;
}

export interface AuthConfig {
  requireToken: boolean;
  rateLimit: number;
  rateLimitWindowMs: number;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface AuthAttempt {
  timestamp: string;
  clientIp: string;
  success: boolean;
  reason?: string;
}

// ════════════════════════════════════════════════════════════════════════
// ESTADO
// ════════════════════════════════════════════════════════════════════════

// Rate limiting em memoria (por IP)
const rateLimitMap = new Map<string, RateLimitEntry>();

// Historico de tentativas falhas (ultimas 100)
const failedAttempts: AuthAttempt[] = [];
const MAX_FAILED_ATTEMPTS = 100;

// ════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════

/**
 * Extrai IP do cliente da requisicao
 */
export function getClientIp(req: http.IncomingMessage): string {
  // Verificar headers de proxy
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = typeof forwarded === 'string' ? forwarded : forwarded[0];
    return ips.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return typeof realIp === 'string' ? realIp : realIp[0];
  }

  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Compara tokens de forma segura (constant-time)
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Mesmo assim, fazer operacao para evitar timing attack
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Registra tentativa de autenticacao falha
 */
function logFailedAttempt(clientIp: string, reason: string): void {
  const attempt: AuthAttempt = {
    timestamp: new Date().toISOString(),
    clientIp,
    success: false,
    reason
  };

  failedAttempts.push(attempt);

  // Manter apenas ultimas N tentativas
  while (failedAttempts.length > MAX_FAILED_ATTEMPTS) {
    failedAttempts.shift();
  }

  // Log para monitoramento
  if (!isTest()) {
    console.warn(`[Auth] Tentativa falha de ${clientIp}: ${reason}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ════════════════════════════════════════════════════════════════════════

/**
 * Verifica rate limit para um IP
 */
export function checkRateLimit(clientIp: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const rateLimit = getRateLimit();
  const entry = rateLimitMap.get(clientIp);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    // Nova janela
    rateLimitMap.set(clientIp, { count: 1, windowStart: now });
    return { allowed: true, remaining: rateLimit - 1 };
  }

  if (entry.count >= rateLimit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: rateLimit - entry.count };
}

/**
 * Limpa entradas antigas do rate limit
 */
export function cleanupRateLimitMap(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}

// Limpar a cada 5 minutos
setInterval(cleanupRateLimitMap, 5 * 60 * 1000).unref();

// ════════════════════════════════════════════════════════════════════════
// AUTENTICACAO PRINCIPAL
// ════════════════════════════════════════════════════════════════════════

/**
 * Verifica se a requisicao pode prosseguir (apenas em producao)
 */
export function validateProductionRequirements(): { valid: boolean; error?: string } {
  const token = getToken();
  if (isProduction() && !token) {
    return {
      valid: false,
      error: 'CONTROL_PLANE_TOKEN nao configurado em producao'
    };
  }
  return { valid: true };
}

/**
 * Autentica requisicao HTTP
 */
export function authenticate(req: http.IncomingMessage): AuthResult {
  const clientIp = getClientIp(req);
  const token = getToken();

  // Em teste sem token configurado, permitir acesso
  if (isTest() && !token) {
    return { authenticated: true, clientIp };
  }

  // Em desenvolvimento sem token configurado, permitir acesso
  if (!isProduction() && !token) {
    return { authenticated: true, clientIp };
  }

  // Verificar rate limit
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    logFailedAttempt(clientIp, 'rate_limit_exceeded');
    return {
      authenticated: false,
      reason: 'Rate limit exceeded',
      clientIp
    };
  }

  // Requer token em producao ou se configurado
  if (!token) {
    logFailedAttempt(clientIp, 'no_token_configured');
    return {
      authenticated: false,
      reason: 'Token not configured',
      clientIp
    };
  }

  // Verificar header Authorization
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    logFailedAttempt(clientIp, 'missing_auth_header');
    return {
      authenticated: false,
      reason: 'Missing Authorization header',
      clientIp
    };
  }

  // Verificar formato Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    logFailedAttempt(clientIp, 'invalid_auth_format');
    return {
      authenticated: false,
      reason: 'Invalid Authorization format',
      clientIp
    };
  }

  const providedToken = parts[1];
  const expectedToken = getToken();

  // Verificar token com constant-time comparison
  if (!secureCompare(providedToken, expectedToken)) {
    logFailedAttempt(clientIp, 'invalid_token');
    return {
      authenticated: false,
      reason: 'Invalid token',
      clientIp
    };
  }

  return { authenticated: true, clientIp };
}

/**
 * Middleware de autenticacao
 */
export function authMiddleware(
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean {
  const result = authenticate(req);

  if (!result.authenticated) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="control-plane"'
    });
    res.end(JSON.stringify({
      error: 'Unauthorized',
      reason: result.reason
    }));
    return false;
  }

  // Adicionar headers de rate limit
  const rateCheck = checkRateLimit(result.clientIp || 'unknown');
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.toString());
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());

  return true;
}

// ════════════════════════════════════════════════════════════════════════
// METRICAS DE SEGURANCA
// ════════════════════════════════════════════════════════════════════════

export interface SecurityMetrics {
  failedAttemptsLast24h: number;
  failedAttemptsByIp: Record<string, number>;
  rateLimitActiveIps: number;
  lastFailedAttempt: AuthAttempt | null;
}

/**
 * Coleta metricas de seguranca
 */
export function getSecurityMetrics(): SecurityMetrics {
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  const recentAttempts = failedAttempts.filter(
    a => new Date(a.timestamp).getTime() > last24h
  );

  const byIp: Record<string, number> = {};
  for (const attempt of recentAttempts) {
    byIp[attempt.clientIp] = (byIp[attempt.clientIp] || 0) + 1;
  }

  return {
    failedAttemptsLast24h: recentAttempts.length,
    failedAttemptsByIp: byIp,
    rateLimitActiveIps: rateLimitMap.size,
    lastFailedAttempt: failedAttempts[failedAttempts.length - 1] || null
  };
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS PARA TESTES
// ════════════════════════════════════════════════════════════════════════

export {
  TOKEN,
  IS_PRODUCTION,
  RATE_LIMIT,
  RATE_WINDOW_MS
};

// Para testes: reset do estado
export function _resetState(): void {
  rateLimitMap.clear();
  failedAttempts.length = 0;
}
