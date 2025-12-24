#!/usr/bin/env node
/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Server Entrypoint
 *
 * Entrypoint para executar o Gateway HTTP multi-tenant.
 *
 * Uso:
 *   npx ts-node gateway/server-multitenant.ts
 *
 * Variaveis de ambiente:
 *   GATEWAY_PORT          - Porta HTTP (default: 3000)
 *   GATEWAY_HOST          - Host para bind (default: 0.0.0.0)
 *   GATEWAY_BASE_DIR      - Diretorio de dados (default: ./data)
 *   GATEWAY_ADMIN_TOKEN   - Token para API admin (obrigatorio em prod)
 *   GATEWAY_CORS_ORIGINS  - Origens CORS (comma-separated, default: *)
 *   GATEWAY_LOG_LEVEL     - Nivel de log (default: info)
 *   NODE_ENV              - Ambiente (development/production/test)
 */

import { loadConfig, validateConfig } from './GatewayConfig';
import { buildApp } from './app';

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LIBERVIA — Multi-Tenant Gateway');
  console.log('═══════════════════════════════════════════════════════════');

  // Carregar e validar configuracao
  const config = loadConfig();
  validateConfig(config);

  console.log(`\n📋 Configuration:`);
  console.log(`   Port:     ${config.port}`);
  console.log(`   Host:     ${config.host}`);
  console.log(`   Base Dir: ${config.baseDir}`);
  console.log(`   Env:      ${config.nodeEnv}`);
  console.log(`   Log:      ${config.logLevel}`);
  console.log(`   Admin:    ${config.adminToken ? '✓ configured' : '✗ not set'}`);

  // Construir app
  const app = await buildApp({ config });

  // Registrar handlers de sinal
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Iniciar servidor
  try {
    await app.listen({
      port: config.port,
      host: config.host
    });

    console.log(`\n✅ Gateway listening on http://${config.host}:${config.port}`);
    console.log(`\n📚 Endpoints:`);
    console.log(`   Health:  GET /health`);
    console.log(`   Ready:   GET /health/ready`);
    console.log(`   Metrics: GET /metrics`);
    console.log(`   Admin:   /admin/* (requires adminToken)`);
    console.log(`   API:     /api/v1/* (requires tenantId + apiToken)`);
    console.log(`\n═══════════════════════════════════════════════════════════\n`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Executar
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
