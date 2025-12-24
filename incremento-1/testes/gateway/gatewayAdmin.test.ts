/**
 * INCREMENTO 11 — Testes da Admin API do Gateway
 *
 * Testa as operacoes administrativas do Gateway.
 */

import { buildApp } from '../../gateway/app';
import { GatewayConfig } from '../../gateway/GatewayConfig';
import { clearPepperCache } from '../../tenant/TenantSecurity';
import * as fs from 'fs/promises';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

// Inc 12.1: Configurar pepper para testes
const TEST_PEPPER = 'test-pepper-for-gateway-admin-tests-1234567890';

const TEST_BASE_DIR = './test-data-gateway-admin-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

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

describe('Gateway Admin API', () => {
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
  // TENANT CRUD
  // ══════════════════════════════════════════════════════════════════════════

  describe('Tenant CRUD', () => {
    test('POST /admin/tenants registra novo tenant', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          id: 'acme-corp',
          name: 'ACME Corporation'
        }
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('acme-corp');
      expect(body.name).toBe('ACME Corporation');
      expect(body.status).toBe('active');
      expect(body.apiToken).toBeDefined();

      await app.close();
    });

    test('POST /admin/tenants com ID invalido retorna 400', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: {
          id: '-invalid',
          name: 'Invalid ID'
        }
      });

      expect(response.statusCode).toBe(400);

      await app.close();
    });

    test('POST /admin/tenants duplicado retorna 400', async () => {
      const app = await buildApp({ config: testConfig });

      // Primeiro registro
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'duplicate', name: 'First' }
      });

      // Segundo com mesmo ID
      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'duplicate', name: 'Second' }
      });

      expect(response.statusCode).toBe(400);
      // Mensagem pode ser em portugues ou ingles
      const error = JSON.parse(response.body).error;
      expect(error).toMatch(/already exists|ja existe/);

      await app.close();
    });

    test('GET /admin/tenants lista todos os tenants', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar alguns tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'list-test-1', name: 'List Test 1' }
      });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'list-test-2', name: 'List Test 2' }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);

      await app.close();
    });

    test('GET /admin/tenants/:id retorna detalhes', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'detail-test', name: 'Detail Test' }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/detail-test',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('detail-test');
      expect(body.quotas).toBeDefined();
      expect(body.features).toBeDefined();

      await app.close();
    });

    test('PATCH /admin/tenants/:id atualiza tenant', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'update-test', name: 'Before Update' }
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/tenants/update-test',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { name: 'After Update' }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('After Update');

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUSPEND/RESUME
  // ══════════════════════════════════════════════════════════════════════════

  describe('Suspend/Resume', () => {
    test('POST /admin/tenants/:id/suspend suspende tenant', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'suspend-test', name: 'Suspend Test' }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants/suspend-test/suspend',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);

      // Verificar que tenant esta suspenso
      const details = await app.inject({
        method: 'GET',
        url: '/admin/tenants/suspend-test',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(JSON.parse(details.body).status).toBe('suspended');

      await app.close();
    });

    test('POST /admin/tenants/:id/resume reativa tenant', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'resume-test', name: 'Resume Test' }
      });

      // Suspender
      await app.inject({
        method: 'POST',
        url: '/admin/tenants/resume-test/suspend',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      // Reativar
      const response = await app.inject({
        method: 'POST',
        url: '/admin/tenants/resume-test/resume',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);

      // Verificar que tenant esta ativo
      const details = await app.inject({
        method: 'GET',
        url: '/admin/tenants/resume-test',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(JSON.parse(details.body).status).toBe('active');

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ══════════════════════════════════════════════════════════════════════════

  describe('Delete', () => {
    test('DELETE /admin/tenants/:id remove tenant (soft delete)', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'delete-test', name: 'Delete Test' }
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/admin/tenants/delete-test',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);

      // Tenant nao deve aparecer na lista padrao
      const list = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      const tenants = JSON.parse(list.body);
      expect(tenants.find((t: any) => t.id === 'delete-test')).toBeUndefined();

      // Mas deve aparecer com includeDeleted
      const listAll = await app.inject({
        method: 'GET',
        url: '/admin/tenants?includeDeleted=true',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      const allTenants = JSON.parse(listAll.body);
      const deleted = allTenants.find((t: any) => t.id === 'delete-test');
      expect(deleted).toBeDefined();
      expect(deleted.status).toBe('deleted');

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIT
  // ══════════════════════════════════════════════════════════════════════════

  describe('Audit', () => {
    test('GET /admin/tenants/:id/audit/verify verifica cadeia', async () => {
      const app = await buildApp({ config: testConfig });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'audit-test', name: 'Audit Test' }
      });

      // Acessar tenant para criar instancia
      await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'audit-test' }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants/audit-test/audit/verify',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.valid).toBe(true);

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // METRICS & HEALTH
  // ══════════════════════════════════════════════════════════════════════════

  describe('Metrics & Health', () => {
    test('GET /admin/metrics retorna metricas globais', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/metrics',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalTenants).toBeDefined();
      expect(body.activeTenants).toBeDefined();
      expect(body.activeInstances).toBeDefined();

      await app.close();
    });

    test('GET /admin/health retorna status de saude', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.healthy).toBeDefined();
      expect(body.registry).toBeDefined();
      expect(body.runtime).toBeDefined();

      await app.close();
    });

    test('GET /admin/instances lista instancias ativas', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/instances',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.activeInstances)).toBe(true);

      await app.close();
    });
  });
});
