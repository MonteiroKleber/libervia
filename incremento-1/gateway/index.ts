/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY
 *
 * Gateway HTTP multi-tenant para Libervia.
 *
 * Re-exporta componentes principais para uso externo.
 */

// Config
export { GatewayConfig, loadConfig, validateConfig, DEFAULT_CONFIG } from './GatewayConfig';

// App factory
export { buildApp, getAppContext, AppContext, BuildAppOptions } from './app';

// Plugins
export { tenantPlugin } from './plugins/tenantPlugin';
export { authPlugin, AuthPluginOptions } from './plugins/authPlugin';
export { rateLimitPlugin, RateLimitPluginOptions } from './plugins/rateLimitPlugin';

// Routes
export { healthRoutes } from './routes/healthRoutes';
export { adminRoutes } from './routes/adminRoutes';
export { publicRoutes } from './routes/publicRoutes';
