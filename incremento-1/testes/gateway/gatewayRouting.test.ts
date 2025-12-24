/**
 * INCREMENTO 11 — Testes de Roteamento do Gateway
 *
 * Testa a resolucao de tenantId e roteamento de requests.
 */

import { buildApp } from '../../gateway/app';
import { GatewayConfig } from '../../gateway/GatewayConfig';
import { TenantRegistry } from '../../tenant/TenantRegistry';
import { clearPepperCache } from '../../tenant/TenantSecurity';
import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

// Inc 12.1: Configurar pepper para testes
const TEST_PEPPER = 'test-pepper-for-gateway-routing-tests-1234567890';

const TEST_BASE_DIR = './test-data-gateway-routing-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

const testConfig: GatewayConfig = {
  port: 0, // Port 0 = random port
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

describe('Gateway Routing', () => {
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
  // HEALTH ROUTES (sem tenant)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Health Routes', () => {
    test('GET /health retorna 200', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(body.uptime).toBeGreaterThanOrEqual(0);

      await app.close();
    });

    test('GET /health/ready retorna 200 com registry carregado', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/health/ready'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.registry).toBeDefined();
      expect(body.registry.loaded).toBe(true);

      await app.close();
    });

    test('GET /metrics retorna metricas', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/metrics'
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.memory).toBeDefined();
      expect(body.tenants).toBeDefined();
      expect(body.instances).toBeDefined();

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TENANT EXTRACTION
  // ══════════════════════════════════════════════════════════════════════════

  describe('Tenant Extraction', () => {
    test('Request sem tenantId retorna 400', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos'
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Missing tenant ID');

      await app.close();
    });

    test('Tenant inexistente retorna 404', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'nao-existe'
        }
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Tenant not found');

      await app.close();
    });

    test('Extrai tenantId do header X-Tenant-Id', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant primeiro (apiToken sera gerado)
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`
        },
        payload: {
          id: 'tenant-header',
          name: 'Tenant Header Test'
        }
      });

      const { apiToken } = JSON.parse(registerResponse.body);

      // Fazer request com header e apiToken
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'tenant-header',
          'authorization': `Bearer ${apiToken}`
        }
      });

      // Deve funcionar (200)
      expect(response.statusCode).toBe(200);

      await app.close();
    });

    test('Extrai tenantId do path /api/v1/tenants/:id/...', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`
        },
        payload: {
          id: 'tenant-path',
          name: 'Tenant Path Test'
        }
      });

      const { apiToken } = JSON.parse(registerResponse.body);

      // Fazer request com tenantId no path
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tenants/tenant-path/eventos',
        headers: {
          'authorization': `Bearer ${apiToken}`
        }
      });

      // Path extractor deve funcionar
      // Nota: rota pode nao existir exatamente assim, mas extrator deve pegar o ID
      expect([200, 404]).toContain(response.statusCode);
      // Nao deve ser 400 (Missing tenant ID)
      expect(response.statusCode).not.toBe(400);

      await app.close();
    });

    test('Tenant suspenso retorna 403', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar e suspender tenant
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-suspenso', name: 'Tenant Suspenso' }
      });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants/tenant-suspenso/suspend',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      // Request para tenant suspenso
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-suspenso' }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Tenant suspended');

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TENANT CONFLICT DETECTION
  // ══════════════════════════════════════════════════════════════════════════

  describe('Tenant Conflict Detection', () => {
    test('Header-only resolve corretamente (sem conflito)', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const regResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme-header-only', name: 'Acme Header Only' }
      });
      const { apiToken } = JSON.parse(regResponse.body);

      // Request apenas com header
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'acme-header-only',
          authorization: `Bearer ${apiToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('Path-only resolve corretamente (sem conflito)', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const regResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme-path-only', name: 'Acme Path Only' }
      });
      const { apiToken } = JSON.parse(regResponse.body);

      // Request apenas com path
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tenants/acme-path-only/eventos',
        headers: {
          authorization: `Bearer ${apiToken}`
        }
      });

      // Pode ser 200 (rota existe) ou 404 (rota nao existe mas tenant foi extraido)
      // Importante: NAO deve ser 400 (Missing tenant ID)
      expect(response.statusCode).not.toBe(400);
      await app.close();
    });

    test('Subdomain-only resolve corretamente (sem conflito)', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const regResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme-sub-only', name: 'Acme Subdomain Only' }
      });
      const { apiToken } = JSON.parse(regResponse.body);

      // Request apenas com subdomain
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          host: 'acme-sub-only.libervia.io',
          authorization: `Bearer ${apiToken}`
        }
      });

      // Deve resolver o tenant corretamente
      expect(response.statusCode).toBe(200);
      await app.close();
    });

    test('Conflito header vs path retorna 400 com TENANT_CONFLICT', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar dois tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme', name: 'Acme Corp' }
      });
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'globex', name: 'Globex Corp' }
      });

      // Request com header=acme e path=globex (CONFLITO!)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tenants/globex/eventos',
        headers: {
          'x-tenant-id': 'acme'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('TENANT_CONFLICT');
      expect(body.details).toBeDefined();
      expect(body.details.headerTenant).toBe('acme');
      expect(body.details.pathTenant).toBe('globex');

      await app.close();
    });

    test('Conflito header vs subdomain retorna 400 com TENANT_CONFLICT', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar dois tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme2', name: 'Acme Corp 2' }
      });
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'globex2', name: 'Globex Corp 2' }
      });

      // Request com header=acme2 e subdomain=globex2 (CONFLITO!)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'acme2',
          host: 'globex2.libervia.io'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('TENANT_CONFLICT');
      expect(body.details).toBeDefined();
      expect(body.details.headerTenant).toBe('acme2');
      expect(body.details.subdomainTenant).toBe('globex2');

      await app.close();
    });

    test('Header + path iguais resolve normalmente (sem conflito)', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const regResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme-igual', name: 'Acme Igual' }
      });
      const { apiToken } = JSON.parse(regResponse.body);

      // Request com header=acme-igual e path=acme-igual (IGUAIS - OK)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tenants/acme-igual/eventos',
        headers: {
          'x-tenant-id': 'acme-igual',
          authorization: `Bearer ${apiToken}`
        }
      });

      // Nao deve ser 400 (conflito)
      expect(response.statusCode).not.toBe(400);
      await app.close();
    });

    test('Header + subdomain iguais resolve normalmente (sem conflito)', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenant
      const regResponse = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'acme-igual2', name: 'Acme Igual 2' }
      });
      const { apiToken } = JSON.parse(regResponse.body);

      // Request com header=acme-igual2 e subdomain=acme-igual2 (IGUAIS - OK)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: {
          'x-tenant-id': 'acme-igual2',
          host: 'acme-igual2.libervia.io',
          authorization: `Bearer ${apiToken}`
        }
      });

      // Deve resolver normalmente
      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN AUTHENTICATION
  // ══════════════════════════════════════════════════════════════════════════

  describe('Admin Authentication', () => {
    test('Admin API sem token retorna 401', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants'
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    test('Admin API com token invalido retorna 401 ou 403', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: {
          authorization: 'Bearer token-invalido'
        }
      });

      // 401 (token invalido) ou 403 (insufficient role para rota global)
      expect([401, 403]).toContain(response.statusCode);

      await app.close();
    });

    test('Admin API com token valido retorna 200', async () => {
      const app = await buildApp({ config: testConfig });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/tenants',
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(JSON.parse(response.body))).toBe(true);

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT REQUIREMENTS (Inc 12.1)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Boot Requirements', () => {
    test('Gateway falha ao iniciar sem LIBERVIA_AUTH_PEPPER', async () => {
      // Salvar pepper atual e remover
      const savedPepper = process.env.LIBERVIA_AUTH_PEPPER;
      delete process.env.LIBERVIA_AUTH_PEPPER;
      clearPepperCache();

      try {
        // Tentar criar app sem pepper - deve falhar
        await expect(buildApp({ config: testConfig })).rejects.toThrow(
          /LIBERVIA_AUTH_PEPPER/
        );
      } finally {
        // Restaurar pepper
        if (savedPepper) {
          process.env.LIBERVIA_AUTH_PEPPER = savedPepper;
        }
        clearPepperCache();
      }
    });

    test('Gateway falha com pepper muito curto (< 16 chars)', async () => {
      // Salvar pepper atual
      const savedPepper = process.env.LIBERVIA_AUTH_PEPPER;

      // Definir pepper muito curto
      process.env.LIBERVIA_AUTH_PEPPER = 'short';
      clearPepperCache();

      try {
        // Tentar criar app com pepper curto - deve falhar
        await expect(buildApp({ config: testConfig })).rejects.toThrow(
          /16 characters/
        );
      } finally {
        // Restaurar pepper
        if (savedPepper) {
          process.env.LIBERVIA_AUTH_PEPPER = savedPepper;
        }
        clearPepperCache();
      }
    });
  });
});
