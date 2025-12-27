/**
 * EXEMPLO: Uso básico do SDK Libervia
 *
 * Demonstra consultas básicas e como acessar o requestId.
 *
 * Uso:
 *   ADMIN_TOKEN=xxx npx ts-node examples/node-basic.ts
 */

import { createLiberviaClient, LiberviaError } from '../sdk/src';

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const token = process.env.ADMIN_TOKEN || 'admin-token-dev';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LIBERVIA SDK - Exemplo Básico');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Base URL: ${baseUrl}`);
  console.log('');

  // Criar cliente
  const client = createLiberviaClient({
    baseUrl,
    token
  });

  try {
    // 1. Health check
    console.log('📋 Health Check...');
    const health = await client.health.check();
    console.log(`   Status: ${health.status}`);
    console.log(`   Uptime: ${Math.floor(health.uptime / 1000)}s`);
    console.log('');

    // 2. Readiness
    console.log('📋 Readiness Check...');
    const ready = await client.health.ready();
    console.log(`   Registry loaded: ${ready.registry.loaded}`);
    console.log(`   Tenant count: ${ready.registry.tenantCount}`);
    console.log(`   Active instances: ${ready.runtime.activeInstances}`);
    console.log('');

    // 3. Query metrics (usando request() para obter metadata)
    console.log('📊 Query Metrics (com Request ID)...');
    const result = await client.request<{
      totalTenants: number;
      activeTenants: number;
      timestamp: string;
    }>('GET', '/admin/query/metrics');

    console.log(`   Total tenants: ${result.data.totalTenants}`);
    console.log(`   Active tenants: ${result.data.activeTenants}`);
    console.log(`   Timestamp: ${result.data.timestamp}`);
    console.log(`   🔍 Request ID: ${result.metadata.requestId}`);
    console.log('');

    // 4. Listar tenants
    console.log('📁 Listando Tenants...');
    const tenants = await client.query.listTenants();
    console.log(`   Total: ${tenants.total}`);
    for (const t of tenants.tenants) {
      console.log(`   - ${t.id}: ${t.name} (${t.status})`);
    }
    console.log('');

    console.log('✅ Exemplo concluído com sucesso!');
  } catch (error) {
    if (error instanceof LiberviaError) {
      console.error(`❌ Erro ${error.status}: ${error.message}`);
      console.error(`   Code: ${error.code}`);
      console.error(`   Request ID: ${error.requestId}`);
    } else {
      console.error('❌ Erro inesperado:', error);
    }
    process.exit(1);
  }
}

main();
