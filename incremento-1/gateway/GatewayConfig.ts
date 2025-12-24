/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Configuracao
 *
 * Tipos e loader de configuracao do Gateway HTTP multi-tenant.
 */

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Configuracao do Gateway Multi-Tenant
 */
export interface GatewayConfig {
  /**
   * Porta HTTP (default: 3000)
   */
  port: number;

  /**
   * Host para bind (default: '0.0.0.0')
   */
  host: string;

  /**
   * Diretorio base de dados (default: './data')
   */
  baseDir: string;

  /**
   * Token de autenticacao para API administrativa.
   * Obrigatorio em producao.
   */
  adminToken: string;

  /**
   * Origens CORS permitidas (default: ['*'])
   */
  corsOrigins: string[];

  /**
   * Ambiente de execucao
   */
  nodeEnv: 'development' | 'production' | 'test';

  /**
   * Nivel de log (default: 'info')
   */
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

// ════════════════════════════════════════════════════════════════════════════
// DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: GatewayConfig = {
  port: 3000,
  host: '0.0.0.0',
  baseDir: './data',
  adminToken: '',
  corsOrigins: ['*'],
  nodeEnv: 'development',
  logLevel: 'info'
};

// ════════════════════════════════════════════════════════════════════════════
// LOADER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Carrega configuracao do ambiente.
 * Variaveis de ambiente:
 * - GATEWAY_PORT
 * - GATEWAY_HOST
 * - GATEWAY_BASE_DIR
 * - GATEWAY_ADMIN_TOKEN
 * - GATEWAY_CORS_ORIGINS (comma-separated)
 * - NODE_ENV
 * - GATEWAY_LOG_LEVEL
 */
export function loadConfig(): GatewayConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development') as GatewayConfig['nodeEnv'];
  const isProduction = nodeEnv === 'production';

  const adminToken = process.env.GATEWAY_ADMIN_TOKEN || '';

  // Em producao, adminToken e obrigatorio
  if (isProduction && !adminToken) {
    throw new Error('GATEWAY_ADMIN_TOKEN is required in production');
  }

  const corsOriginsEnv = process.env.GATEWAY_CORS_ORIGINS;
  const corsOrigins = corsOriginsEnv
    ? corsOriginsEnv.split(',').map(s => s.trim())
    : DEFAULT_CONFIG.corsOrigins;

  return {
    port: parseInt(process.env.GATEWAY_PORT || String(DEFAULT_CONFIG.port), 10),
    host: process.env.GATEWAY_HOST || DEFAULT_CONFIG.host,
    baseDir: process.env.GATEWAY_BASE_DIR || DEFAULT_CONFIG.baseDir,
    adminToken,
    corsOrigins,
    nodeEnv,
    logLevel: (process.env.GATEWAY_LOG_LEVEL || DEFAULT_CONFIG.logLevel) as GatewayConfig['logLevel']
  };
}

/**
 * Valida a configuracao carregada.
 * @throws Error se a configuracao for invalida
 */
export function validateConfig(config: GatewayConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}`);
  }

  if (!config.baseDir) {
    throw new Error('baseDir is required');
  }

  if (config.nodeEnv === 'production' && !config.adminToken) {
    throw new Error('adminToken is required in production');
  }
}

export { DEFAULT_CONFIG };
