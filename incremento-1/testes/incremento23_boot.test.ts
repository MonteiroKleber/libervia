/**
 * TESTES - Incremento 23: Boot e Smoke Tests
 *
 * Testes de inicialização e validação básica do gateway.
 *
 * Testa:
 * - Requisito de LIBERVIA_AUTH_PEPPER no boot
 * - Health check responde OK
 * - X-Request-Id em todas as respostas
 * - Readiness probe
 */

import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';

import { buildApp } from '../gateway/app';
import { GatewayConfig } from '../gateway/GatewayConfig';
import { clearPepperCache } from '../tenant/TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-inc23-boot-' + Date.now();
const TEST_PEPPER = 'test-pepper-inc23-boot-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;

  await fs.mkdir(TEST_BASE_DIR, { recursive: true });

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
});

afterAll(async () => {
  await app.close();
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: PEPPER REQUIREMENT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: Pepper Requirement', () => {
  test('boot falha sem LIBERVIA_AUTH_PEPPER', async () => {
    // Salvar pepper atual
    const originalPepper = process.env.LIBERVIA_AUTH_PEPPER;

    // Limpar cache do pepper e remover env var
    clearPepperCache();
    delete process.env.LIBERVIA_AUTH_PEPPER;

    const config: GatewayConfig = {
      baseDir: TEST_BASE_DIR + '-no-pepper',
      port: 0,
      host: '127.0.0.1',
      adminToken: ADMIN_TOKEN,
      corsOrigins: ['*'],
      logLevel: 'warn',
      nodeEnv: 'test'
    };

    // Boot deve falhar
    try {
      await buildApp({ config });
      // Se chegou aqui, falhou em lançar erro
      throw new Error('Expected buildApp to throw');
    } catch (error) {
      expect((error as Error).message).toContain('LIBERVIA_AUTH_PEPPER');
    } finally {
      // Restaurar pepper e limpar cache para próximo uso
      process.env.LIBERVIA_AUTH_PEPPER = originalPepper;
      clearPepperCache();
    }
  });

  test('boot sucede com LIBERVIA_AUTH_PEPPER configurado', async () => {
    // O app já foi criado no beforeAll com pepper
    expect(app).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: Health Check', () => {
  test('GET /health retorna status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.uptime).toBe('number');
  });

  test('GET /health/ready retorna readiness', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.registry).toBeDefined();
    expect(body.registry.loaded).toBe(true);
    expect(body.runtime).toBeDefined();
  });

  test('GET /metrics retorna métricas', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.uptime).toBeDefined();
    expect(body.memory).toBeDefined();
    expect(body.tenants).toBeDefined();
    expect(body.instances).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: X-REQUEST-ID
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: X-Request-Id', () => {
  test('health response inclui X-Request-Id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    const requestId = response.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect((requestId as string).length).toBeGreaterThan(0);
  });

  test('erro 401 inclui X-Request-Id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/tenants'
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBeDefined();
  });

  test('erro 4xx inclui X-Request-Id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/nonexistent-route'
    });

    // Pode ser 400 ou 404 dependendo da rota
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.headers['x-request-id']).toBeDefined();
  });

  test('request pode enviar X-Request-Id próprio', async () => {
    const customRequestId = 'my-custom-request-id-12345';

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'X-Request-Id': customRequestId
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(customRequestId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CORS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: CORS', () => {
  test('OPTIONS request retorna CORS headers', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        'Origin': 'http://localhost:8080',
        'Access-Control-Request-Method': 'GET'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeDefined();
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: Admin Routes', () => {
  test('GET /admin/tenants sem token retorna 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/tenants'
    });

    expect(response.statusCode).toBe(401);
  });

  test('GET /admin/tenants com token retorna lista', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: STARTUP TIME
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 23 - Boot: Startup', () => {
  test('app inicia em menos de 5 segundos', async () => {
    const startTime = Date.now();

    const testDir = TEST_BASE_DIR + '-startup-' + Date.now();
    await fs.mkdir(testDir, { recursive: true });

    const config: GatewayConfig = {
      baseDir: testDir,
      port: 0,
      host: '127.0.0.1',
      adminToken: ADMIN_TOKEN,
      corsOrigins: ['*'],
      logLevel: 'warn',
      nodeEnv: 'test'
    };

    const testApp = await buildApp({ config });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000);

    await testApp.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });
});
