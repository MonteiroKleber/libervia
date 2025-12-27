/**
 * EXEMPLO: Criar tenant e gerar chave
 *
 * Demonstra o fluxo de criar um novo tenant e gerar chaves de autenticação.
 *
 * Uso:
 *   ADMIN_TOKEN=xxx npx ts-node examples/admin-create-tenant.ts
 */

import { createLiberviaClient, LiberviaError } from '../sdk/src';

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const token = process.env.ADMIN_TOKEN || 'admin-token-dev';
  const tenantId = `example-${Date.now()}`;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LIBERVIA SDK - Criar Tenant e Gerar Chaves');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log('');

  // Criar cliente admin
  const client = createLiberviaClient({
    baseUrl,
    token
  });

  try {
    // 1. Criar tenant
    console.log('📁 Criando tenant...');
    const tenant = await client.admin.createTenant({
      id: tenantId,
      name: 'Example Tenant'
    });
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Name: ${tenant.name}`);
    console.log(`   Status: ${tenant.status}`);
    console.log(`   API Token: ${tenant.apiToken}`);
    console.log('');

    // 2. Criar chave tenant_admin
    console.log('🔑 Criando chave tenant_admin...');
    const adminKey = await client.admin.createKey(tenantId, {
      role: 'tenant_admin',
      description: 'Admin key for example'
    });
    console.log(`   Key ID: ${adminKey.keyId}`);
    console.log(`   Role: ${adminKey.role}`);
    console.log(`   Token: ${adminKey.token}`);
    console.log(`   ⚠️  ${adminKey.warning}`);
    console.log('');

    // 3. Criar chave public
    console.log('🔑 Criando chave public...');
    const publicKey = await client.admin.createKey(tenantId, {
      role: 'public',
      description: 'Public API key'
    });
    console.log(`   Key ID: ${publicKey.keyId}`);
    console.log(`   Role: ${publicKey.role}`);
    console.log(`   Token: ${publicKey.token}`);
    console.log('');

    // 4. Listar chaves
    console.log('📋 Listando chaves do tenant...');
    const keys = await client.admin.listKeys(tenantId);
    console.log(`   Total: ${keys.count}`);
    for (const k of keys.keys) {
      console.log(`   - ${k.keyId}: ${k.role} (${k.status})`);
    }
    console.log('');

    // 5. Testar com chave tenant_admin
    console.log('🔄 Testando acesso com chave tenant_admin...');
    const tenantClient = createLiberviaClient({
      baseUrl,
      token: adminKey.token,
      tenantId
    });
    const dashboard = await tenantClient.query.getDashboard(tenantId);
    console.log(`   Dashboard tenant: ${dashboard.tenantId}`);
    console.log(`   Mandates: ${dashboard.mandates.total}`);
    console.log(`   Reviews: ${dashboard.reviews.OPEN} open`);
    console.log('');

    // 6. Cleanup: deletar tenant
    console.log('🗑️  Removendo tenant de exemplo...');
    await client.admin.deleteTenant(tenantId);
    console.log('   Tenant removido com sucesso');
    console.log('');

    console.log('✅ Exemplo concluído com sucesso!');
    console.log('');
    console.log('Resumo dos tokens gerados:');
    console.log(`  - tenant_admin: ${adminKey.token}`);
    console.log(`  - public: ${publicKey.token}`);
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
