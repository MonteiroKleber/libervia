/**
 * INCREMENTO 12 — Testes de RBAC do Gateway
 *
 * Testa autorizacao baseada em papeis:
 * - public: acesso a /api/v1/*
 * - tenant_admin: acesso a /admin/tenants/:id/*
 * - global_admin: acesso a todas as rotas admin
 */

import { buildApp } from '../../gateway/app';
import { GatewayConfig } from '../../gateway/GatewayConfig';
import { clearPepperCache } from '../../tenant/TenantSecurity';
import * as fs from 'fs/promises';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

// Inc 12.1: Configurar pepper para testes
const TEST_PEPPER = 'test-pepper-for-gateway-rbac-tests-1234567890';

const TEST_BASE_DIR = './test-data-gateway-rbac-' + Date.now();
const ADMIN_TOKEN = 'test-global-admin-token-' + Date.now();

const testConfig: GatewayConfig = {
  port: 0,
  host: '127.0.0.1',
  baseDir: TEST_BASE_DIR,
  adminToken: ADMIN_TOKEN,
  corsOrigins: ['*'],
  nodeEnv: 'test',
  logLevel: 'error'
};

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

describe('Gateway Auth RBAC', () => {
  beforeAll(async () => {
    // Inc 12.1: Configurar pepper antes dos testes
    process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;
    clearPepperCache();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    // Inc 12.1: Limpar pepper após testes
    delete process.env.LIBERVIA_AUTH_PEPPER;
    clearPepperCache();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL ADMIN ACCESS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Global Admin Access', () => {
    test('global_admin pode acessar GET /admin/tenants (listar)', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('global_admin pode acessar POST /admin/tenants (criar)', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'rbac-test-1', name: 'RBAC Test 1' }
      });

      expect(response.statusCode).toBe(201);
      await app.close();
    });

    test('global_admin pode acessar /admin/tenants/:id/audit/*', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant primeiro
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'rbac-audit-test', name: 'RBAC Audit Test' }
      });

      // Acessar audit
      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/rbac-audit-test/audit/verify',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('global_admin pode acessar /admin/metrics', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/metrics',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TENANT ADMIN ACCESS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Tenant Admin Access', () => {
    test('tenant_admin pode acessar audit do proprio tenant', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant e key tenant_admin
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-admin-test', name: 'Tenant Admin Test' }
      });

      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/tenant-admin-test/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'tenant_admin' }
      });
      const { token: tenantAdminToken } = JSON.parse(keyResponse.body);

      // Acessar audit com token tenant_admin
      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/tenant-admin-test/audit/verify',
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('tenant_admin NAO pode acessar rotas globais (403)', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant e key tenant_admin
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-admin-global', name: 'Tenant Admin Global' }
      });

      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/tenant-admin-global/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'tenant_admin' }
      });
      const { token: tenantAdminToken } = JSON.parse(keyResponse.body);

      // Tentar acessar rota global (listar tenants)
      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INSUFFICIENT_ROLE');

      await app.close();
    });

    test('tenant_admin NAO pode acessar outro tenant (401)', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar dois tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-a-rbac', name: 'Tenant A' }
      });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-b-rbac', name: 'Tenant B' }
      });

      // Criar key tenant_admin para tenant A
      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/tenant-a-rbac/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'tenant_admin' }
      });
      const { token: tenantAToken } = JSON.parse(keyResponse.body);

      // Tentar acessar tenant B com token do tenant A
      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/tenant-b-rbac/audit/verify',
        headers: { authorization: `Bearer ${tenantAToken}` }
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC TOKEN ACCESS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Public Token Access', () => {
    test('public token pode acessar /api/v1/*', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant e key public
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'public-api-test', name: 'Public API Test' }
      });

      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/public-api-test/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'public' }
      });
      const { token: publicToken } = JSON.parse(keyResponse.body);

      // Acessar API publica
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'public-api-test',
          authorization: `Bearer ${publicToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('public token NAO pode acessar /admin/* (403)', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant e key public
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'public-admin-test', name: 'Public Admin Test' }
      });

      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/public-admin-test/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'public' }
      });
      const { token: publicToken } = JSON.parse(keyResponse.body);

      // Tentar acessar admin do proprio tenant
      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/public-admin-test/audit/verify',
        headers: { authorization: `Bearer ${publicToken}` }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INSUFFICIENT_ROLE');

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ERROR CASES
  // ══════════════════════════════════════════════════════════════════════════

  describe('Error Cases', () => {
    test('Request sem token retorna 401', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants'
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('MISSING_TOKEN');

      await app.close();
    });

    test('Token invalido retorna 401 ou 403', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: { authorization: 'Bearer invalid-token-xyz' }
      });

      // Pode ser 401 (token invalido) ou 403 (sem permissao)
      expect([401, 403]).toContain(response.statusCode);

      await app.close();
    });

    test('Chave revogada nao funciona mais', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant e key
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'revoke-test', name: 'Revoke Test' }
      });

      const keyResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants/revoke-test/keys',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { role: 'public' }
      });
      const { token, keyId } = JSON.parse(keyResponse.body);

      // Verificar que funciona
      const response1 = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'revoke-test',
          authorization: `Bearer ${token}`
        }
      });
      expect(response1.statusCode).toBe(200);

      // Revogar a chave
      await app.inject({
        method: 'POST',
        url: `/admin/tenants/revoke-test/keys/${keyId}/revoke`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      // Verificar que nao funciona mais
      const response2 = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'revoke-test',
          authorization: `Bearer ${token}`
        }
      });
      expect(response2.statusCode).toBe(401);

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY APITOKEN COMPATIBILITY
  // ══════════════════════════════════════════════════════════════════════════

  describe('Legacy apiToken Compatibility', () => {
    test('apiToken legado continua funcionando', async () => {
      const app = await buildApp({ config: testConfig });

      // Criar tenant com apiToken legado (via POST)
      const createResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'legacy-token-test', name: 'Legacy Token Test' }
      });
      const { apiToken } = JSON.parse(createResponse.body);

      // Acessar API com apiToken legado
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'legacy-token-test',
          authorization: `Bearer ${apiToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });
});
