/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Plugins
 *
 * Re-exporta todos os plugins do gateway.
 */

export { tenantPlugin } from './tenantPlugin';
export { authPlugin, AuthPluginOptions } from './authPlugin';
export { rateLimitPlugin, RateLimitPluginOptions } from './rateLimitPlugin';
