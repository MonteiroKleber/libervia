/**
 * TESTES - Incremento 21: Query APIs (Painel Operacional)
 *
 * Testa:
 * - Rotas globais (global_admin only)
 * - Rotas por tenant (tenant_admin ou global_admin)
 * - RBAC e controle de acesso
 * - Paginação e filtros
 */

import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';

import { buildApp } from '../gateway/app';
import { GatewayConfig } from '../gateway/GatewayConfig';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-inc21-query-' + Date.now();
const TEST_PEPPER = 'test-pepper-inc21-query-' + Date.now();

const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

let app: FastifyInstance;
let tenantId: string;
let tenantToken: string;

beforeAll(async () => {
  // Configurar pepper via env var
  process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;

  // Criar diretório base
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });

  // Build app
  const config: GatewayConfig = {
    baseDir: TEST_BASE_DIR,
    port: 0,
    host: '127.0.0.1',
    adminToken: ADMIN_TOKEN,
    corsOrigins: ['*'],
    logLevel: 'warn',
    nodeEnv: 'test'
  };

  app = await buildApp({ config });

  // Criar tenant de teste via admin API
  tenantId = 'query-test-' + Date.now();
  const createResponse = await app.inject({
    method: 'POST',
    url: '/admin/tenants',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`
    },
    payload: {
      id: tenantId,
      name: 'Query Test Tenant'
    }
  });

  expect(createResponse.statusCode).toBe(201);
  const tenant = JSON.parse(createResponse.body);

  // Criar chave tenant_admin para testes de RBAC
  const keyResponse = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantId}/keys`,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`
    },
    payload: {
      role: 'tenant_admin',
      description: 'Test tenant admin key'
    }
  });

  expect(keyResponse.statusCode).toBe(201);
  const keyData = JSON.parse(keyResponse.body);
  tenantToken = keyData.token;
});

afterAll(async () => {
  await app.close();
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ROTAS GLOBAIS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: Rotas Globais', () => {
  test('GET /admin/query/tenants requer global_admin', async () => {
    // Sem token
    const res1 = await app.inject({
      method: 'GET',
      url: '/admin/query/tenants'
    });
    expect(res1.statusCode).toBe(401);

    // Com tenant token (tenant_admin)
    const res2 = await app.inject({
      method: 'GET',
      url: '/admin/query/tenants',
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });
    expect(res2.statusCode).toBe(403);

    // Com admin token (global_admin)
    const res3 = await app.inject({
      method: 'GET',
      url: '/admin/query/tenants',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(res3.statusCode).toBe(200);
    const body = JSON.parse(res3.body);
    expect(body.tenants).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test('GET /admin/query/instances requer global_admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/query/instances',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.instances).toBeDefined();
    expect(Array.isArray(body.instances)).toBe(true);
  });

  test('GET /admin/query/metrics requer global_admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/query/metrics',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalTenants).toBeGreaterThanOrEqual(1);
    expect(body.timestamp).toBeDefined();
  });

  test('GET /admin/query/eventlog requer global_admin', async () => {
    // Com tenant_admin deve falhar
    const res1 = await app.inject({
      method: 'GET',
      url: '/admin/query/eventlog',
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });
    expect(res1.statusCode).toBe(403);

    // Com global_admin deve funcionar
    const res2 = await app.inject({
      method: 'GET',
      url: '/admin/query/eventlog',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(res2.statusCode).toBe(200);
    const body = JSON.parse(res2.body);
    expect(body.events).toBeDefined();
  });

  test('GET /admin/query/eventlog filtra por tenantId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/eventlog?tenantId=${tenantId}`,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.events).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ROTAS POR TENANT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: Rotas por Tenant', () => {
  test('GET /:tenantId/mandates acessível por tenant_admin do próprio tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mandates).toBeDefined();
    // Pode estar vazio (sem dados criados)
    expect(Array.isArray(body.mandates)).toBe(true);
  });

  test('GET /:tenantId/mandates acessível por global_admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates`,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mandates).toBeDefined();
  });

  test('GET /:tenantId/reviews lista casos de revisão', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/reviews`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reviews).toBeDefined();
    expect(Array.isArray(body.reviews)).toBe(true);
  });

  test('GET /:tenantId/consequences lista observações', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/consequences`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.consequences).toBeDefined();
    expect(Array.isArray(body.consequences)).toBe(true);
  });

  test('GET /:tenantId/dashboard retorna resumo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/dashboard`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tenantId).toBe(tenantId);
    expect(body.mandates).toBeDefined();
    expect(body.reviews).toBeDefined();
    expect(body.consequences).toBeDefined();
    expect(body.recentEvents).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RBAC - ISOLAMENTO CROSS-TENANT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: RBAC Cross-Tenant', () => {
  let otherTenantId: string;

  beforeAll(async () => {
    // Criar outro tenant
    otherTenantId = 'other-tenant-' + Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      },
      payload: {
        id: otherTenantId,
        name: 'Other Tenant'
      }
    });

    expect(res.statusCode).toBe(201);
  });

  test('tenant_admin NÃO pode acessar dados de outro tenant', async () => {
    // Tentar acessar mandatos do outro tenant
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${otherTenantId}/mandates`,
      headers: {
        Authorization: `Bearer ${tenantToken}` // Token do primeiro tenant
      }
    });

    // Token do tenant A não é válido para tenant B
    // AuthPlugin retorna 401 (token inválido para este tenant)
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('INVALID_TOKEN');
  });

  test('tenant_admin pode acessar seus próprios dados', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
  });

  test('global_admin pode acessar dados de qualquer tenant', async () => {
    // Acessar primeiro tenant
    const res1 = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates`,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(res1.statusCode).toBe(200);

    // Acessar segundo tenant
    const res2 = await app.inject({
      method: 'GET',
      url: `/admin/query/${otherTenantId}/dashboard`,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(res2.statusCode).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: PAGINAÇÃO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: Paginação', () => {
  test('respeita limit e offset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates?limit=10&offset=0`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  test('offset pula registros', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates?limit=10&offset=5`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.offset).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ERROS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: Tratamento de Erros', () => {
  test('retorna 404 para tenant inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/query/nonexistent-tenant/mandates',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  test('retorna 404 para mandate inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/mandates/nonexistent-mandate`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });

  test('retorna 404 para review inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/reviews/nonexistent-review`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: X-REQUEST-ID
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Query API: Request ID Tracking', () => {
  test('respostas incluem X-Request-Id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/dashboard`,
      headers: {
        Authorization: `Bearer ${tenantToken}`
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  test('usa X-Request-Id fornecido pelo cliente', async () => {
    const customRequestId = 'test-request-id-' + Date.now();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/query/${tenantId}/dashboard`,
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        'X-Request-Id': customRequestId
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe(customRequestId);
  });
});
