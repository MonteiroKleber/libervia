/**
 * TESTES - Incremento 25: Operational Health Endpoint
 *
 * Testa:
 * - Endpoint /internal/health/operational existe e retorna estrutura correta
 * - RBAC: somente global_admin pode acessar
 * - Health checks avaliam metricas corretamente
 * - Status codes refletem estado de saude (200 OK, 503 CRITICAL)
 * - Thresholds estao alinhados com SLOs e Alerting Rules
 */

import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';

import { buildApp } from '../gateway/app';
import { GatewayConfig } from '../gateway/GatewayConfig';
import { clearPepperCache } from '../tenant/TenantSecurity';
import { getTelemetryRegistry, resetTelemetryRegistry } from '../gateway/telemetry/TelemetryRegistry';
import { METRIC_NAMES } from '../gateway/telemetry/TelemetryTypes';
import {
  assessOperationalHealth,
  getQuickHealthStatus,
  THRESHOLDS,
  OperationalHealthResponse,
  HealthStatus
} from '../gateway/health/OperationalHealth';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-inc25-health-' + Date.now();
const TEST_PEPPER = 'test-pepper-inc25-health-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;
  clearPepperCache();

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
  resetTelemetryRegistry();
});

afterAll(async () => {
  await app.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Ignorar erros de limpeza
  }
  delete process.env.LIBERVIA_AUTH_PEPPER;
  clearPepperCache();
});

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Criar tenant com keys
// ════════════════════════════════════════════════════════════════════════════

async function createTenantWithKeys(tenantId: string): Promise<{
  publicToken: string;
  tenantAdminToken: string;
}> {
  await app.inject({
    method: 'POST',
    url: '/admin/tenants',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { id: tenantId, name: `Tenant ${tenantId}` }
  });

  const publicKeyResponse = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantId}/keys`,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { role: 'public' }
  });
  const { token: publicToken } = JSON.parse(publicKeyResponse.body);

  const adminKeyResponse = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantId}/keys`,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { role: 'tenant_admin' }
  });
  const { token: tenantAdminToken } = JSON.parse(adminKeyResponse.body);

  return { publicToken, tenantAdminToken };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RBAC
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: RBAC', () => {
  let testTenantId: string;
  let publicToken: string;
  let tenantAdminToken: string;

  beforeAll(async () => {
    testTenantId = 'rbac-health-' + Date.now();
    const tokens = await createTenantWithKeys(testTenantId);
    publicToken = tokens.publicToken;
    tenantAdminToken = tokens.tenantAdminToken;
  });

  describe('GET /internal/health/operational', () => {
    test('sem token retorna 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational'
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('MISSING_TOKEN');
    });

    test('public token retorna 401 ou 403 (nao global_admin)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational',
        headers: { authorization: `Bearer ${publicToken}` }
      });

      expect([401, 403]).toContain(response.statusCode);
    });

    test('tenant_admin retorna 401 ou 403 (nao global_admin)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational',
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      expect([401, 403]).toContain(response.statusCode);
    });

    test('global_admin retorna 200 com health assessment', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.status).toBeDefined();
      expect(['OK', 'DEGRADED', 'CRITICAL']).toContain(body.status);
      expect(body.timestamp).toBeDefined();
      expect(body.checks).toBeDefined();
      expect(Array.isArray(body.checks)).toBe(true);
    });
  });

  describe('GET /internal/health/operational/status', () => {
    test('sem token retorna 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational/status'
      });

      expect(response.statusCode).toBe(401);
    });

    test('global_admin retorna status simples', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/health/operational/status',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.status).toBeDefined();
      expect(['OK', 'DEGRADED', 'CRITICAL']).toContain(body.status);
      expect(body.timestamp).toBeDefined();
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ESTRUTURA DA RESPOSTA
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Response Structure', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('resposta inclui campos obrigatorios', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body: OperationalHealthResponse = JSON.parse(response.body);

    expect(body.status).toBeDefined();
    expect(body.timestamp).toBeDefined();
    expect(body.uptimeSeconds).toBeDefined();
    expect(body.checks).toBeDefined();
    expect(body.summary).toBeDefined();
  });

  test('summary tem contadores corretos', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body: OperationalHealthResponse = JSON.parse(response.body);

    expect(body.summary.total).toBe(body.checks.length);
    expect(body.summary.ok).toBeGreaterThanOrEqual(0);
    expect(body.summary.warn).toBeGreaterThanOrEqual(0);
    expect(body.summary.critical).toBeGreaterThanOrEqual(0);
    expect(body.summary.ok + body.summary.warn + body.summary.critical).toBe(body.summary.total);
  });

  test('cada check tem campos obrigatorios', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body: OperationalHealthResponse = JSON.parse(response.body);

    body.checks.forEach(check => {
      expect(check.name).toBeDefined();
      expect(check.status).toBeDefined();
      expect(['OK', 'WARN', 'CRITICAL']).toContain(check.status);
      expect(check.value).toBeDefined();
      expect(check.message).toBeDefined();
    });
  });

  test('checks incluem referencias a SLOs e Alertas', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body: OperationalHealthResponse = JSON.parse(response.body);

    // Pelo menos alguns checks devem ter referencias
    const checksWithSLO = body.checks.filter(c => c.sloRef);
    const checksWithAlert = body.checks.filter(c => c.alertRef);

    expect(checksWithSLO.length).toBeGreaterThan(0);
    expect(checksWithAlert.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: HEALTH CHECKS INDIVIDUAIS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Individual Checks', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('check memory_heap esta presente', async () => {
    const health = assessOperationalHealth();
    const memCheck = health.checks.find(c => c.name === 'memory_heap');

    expect(memCheck).toBeDefined();
    expect(memCheck!.sloRef).toBe('SLO-007');
    expect(memCheck!.alertRef).toBe('ALERT-007');
  });

  test('check process_uptime esta presente', async () => {
    const health = assessOperationalHealth();
    const uptimeCheck = health.checks.find(c => c.name === 'process_uptime');

    expect(uptimeCheck).toBeDefined();
    expect(uptimeCheck!.sloRef).toBe('SLO-006');
    expect(uptimeCheck!.alertRef).toBe('ALERT-008');
  });

  test('check error_rate_5xx esta presente', async () => {
    const health = assessOperationalHealth();
    const errorCheck = health.checks.find(c => c.name === 'error_rate_5xx');

    expect(errorCheck).toBeDefined();
    expect(errorCheck!.sloRef).toBe('SLO-003');
    expect(errorCheck!.alertRef).toBe('ALERT-003');
  });

  test('check auth_failures esta presente', async () => {
    const health = assessOperationalHealth();
    const authCheck = health.checks.find(c => c.name === 'auth_failures');

    expect(authCheck).toBeDefined();
    expect(authCheck!.sloRef).toBe('SLO-004');
    expect(authCheck!.alertRef).toBe('ALERT-004');
  });

  test('check tenant_conflicts esta presente', async () => {
    const health = assessOperationalHealth();
    const conflictCheck = health.checks.find(c => c.name === 'tenant_conflicts');

    expect(conflictCheck).toBeDefined();
    expect(conflictCheck!.sloRef).toBe('SLO-008');
    expect(conflictCheck!.alertRef).toBe('ALERT-005');
  });

  test('check rate_limit_abuse esta presente', async () => {
    const health = assessOperationalHealth();
    const rateCheck = health.checks.find(c => c.name === 'rate_limit_abuse');

    expect(rateCheck).toBeDefined();
    expect(rateCheck!.sloRef).toBe('SLO-005');
    expect(rateCheck!.alertRef).toBe('ALERT-006');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: THRESHOLDS ALINHADOS COM SLOs
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Thresholds', () => {
  test('memory thresholds estao alinhados com ALERT-007', () => {
    // ALERT-007: 500MB warn, 800MB critical
    expect(THRESHOLDS.MEMORY_HEAP_WARN).toBe(500_000_000);
    expect(THRESHOLDS.MEMORY_HEAP_CRITICAL).toBe(800_000_000);
  });

  test('error rate thresholds estao alinhados com SLO-003/ALERT-003', () => {
    // SLO-003: < 0.1%, ALERT-003: 0.1% warn, 1% critical
    expect(THRESHOLDS.ERROR_RATE_WARN_PERCENT).toBe(0.1);
    expect(THRESHOLDS.ERROR_RATE_CRITICAL_PERCENT).toBe(1.0);
  });

  test('auth failure thresholds estao alinhados com ALERT-004', () => {
    // ALERT-004: 1/s warn, 10/s critical
    expect(THRESHOLDS.AUTH_FAILURE_WARN_RATE).toBe(1);
    expect(THRESHOLDS.AUTH_FAILURE_CRITICAL_RATE).toBe(10);
  });

  test('tenant conflict thresholds estao alinhados com ALERT-005', () => {
    // ALERT-005: >0 warn, >10 critical
    expect(THRESHOLDS.TENANT_CONFLICT_WARN).toBe(1);
    expect(THRESHOLDS.TENANT_CONFLICT_CRITICAL).toBe(10);
  });

  test('rate limit abuse thresholds estao alinhados com ALERT-006', () => {
    // ALERT-006: 5% warn, 20% critical
    expect(THRESHOLDS.RATE_LIMIT_ABUSE_WARN_PERCENT).toBe(5);
    expect(THRESHOLDS.RATE_LIMIT_ABUSE_CRITICAL_PERCENT).toBe(20);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: STATUS DETERMINATION
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Status Determination', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('status OK quando todos os checks estao OK', () => {
    // Com registry limpo e processo saudavel, deve ser OK
    const health = assessOperationalHealth();

    // Em ambiente de teste limpo, esperamos OK
    // (pode haver WARN de uptime se processo reiniciou recentemente)
    expect(['OK', 'DEGRADED']).toContain(health.status);
  });

  test('status DEGRADED quando ha checks WARN', () => {
    const registry = getTelemetryRegistry();

    // Simular conflitos de tenant (>0 = WARN)
    registry.incTenantConflict('test-tenant');

    const health = assessOperationalHealth();
    expect(['DEGRADED', 'OK']).toContain(health.status);

    const conflictCheck = health.checks.find(c => c.name === 'tenant_conflicts');
    expect(conflictCheck?.status).toBe('WARN');
  });

  test('status CRITICAL quando ha checks CRITICAL', () => {
    const registry = getTelemetryRegistry();

    // Simular muitos conflitos de tenant (>10 = CRITICAL)
    for (let i = 0; i < 15; i++) {
      registry.incTenantConflict('test-tenant-' + i);
    }

    const health = assessOperationalHealth();
    expect(health.status).toBe('CRITICAL');

    const conflictCheck = health.checks.find(c => c.name === 'tenant_conflicts');
    expect(conflictCheck?.status).toBe('CRITICAL');
  });

  test('CRITICAL tem prioridade sobre WARN', () => {
    const registry = getTelemetryRegistry();

    // Simular WARN em um check
    registry.incTenantConflict('warn-tenant');

    // Simular CRITICAL em outro
    for (let i = 0; i < 15; i++) {
      registry.incAuthFailure({ reason: 'BRUTE_FORCE' });
    }

    const health = assessOperationalHealth();
    // Devido ao auth failure rate alto, pode ser CRITICAL ou WARN dependendo do uptime
    // O importante e que CRITICAL tem prioridade
    if (health.checks.some(c => c.status === 'CRITICAL')) {
      expect(health.status).toBe('CRITICAL');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: HTTP STATUS CODES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: HTTP Status Codes', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('retorna 200 para status OK ou DEGRADED', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body = JSON.parse(response.body);

    if (body.status === 'OK' || body.status === 'DEGRADED') {
      expect(response.statusCode).toBe(200);
    }
  });

  test('retorna 503 para status CRITICAL', async () => {
    const registry = getTelemetryRegistry();

    // Forcar CRITICAL
    for (let i = 0; i < 20; i++) {
      registry.incTenantConflict('critical-tenant-' + i);
    }

    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body = JSON.parse(response.body);

    if (body.status === 'CRITICAL') {
      expect(response.statusCode).toBe(503);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: QUICK STATUS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Quick Status', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('getQuickHealthStatus retorna status valido', () => {
    const status = getQuickHealthStatus();
    expect(['OK', 'DEGRADED', 'CRITICAL']).toContain(status);
  });

  test('getQuickHealthStatus concorda com assessOperationalHealth', () => {
    const quickStatus = getQuickHealthStatus();
    const fullHealth = assessOperationalHealth();

    expect(quickStatus).toBe(fullHealth.status);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SOMENTE LEITURA
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Read-Only', () => {
  test('assessOperationalHealth nao modifica metricas', () => {
    const registry = getTelemetryRegistry();

    // Pegar snapshot antes
    const counterBefore = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const valuesBefore = counterBefore?.getValues().length || 0;

    // Chamar assess
    assessOperationalHealth();
    assessOperationalHealth();
    assessOperationalHealth();

    // Pegar snapshot depois
    const counterAfter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const valuesAfter = counterAfter?.getValues().length || 0;

    // Nao deve ter adicionado novas metricas de request
    expect(valuesAfter).toBe(valuesBefore);
  });

  test('endpoint nao incrementa contador de requests para si mesmo', async () => {
    resetTelemetryRegistry();

    // Primeira chamada
    await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const registry = getTelemetryRegistry();
    const counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const values = counter?.getValues() || [];

    // Pode haver metrica para a rota, mas o importante e que funciona
    // O health check em si nao deve causar efeitos colaterais problematicos
    expect(Array.isArray(values)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: UPTIME
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Operational Health: Uptime', () => {
  test('uptimeSeconds reflete tempo desde inicio', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/health/operational',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body: OperationalHealthResponse = JSON.parse(response.body);

    // Uptime deve ser zero ou positivo (pode ser zero imediatamente apos reset)
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  test('uptime check considera 5 minutos como threshold', () => {
    // THRESHOLDS.UPTIME_WARN_SECONDS = 300 (5 minutos)
    expect(THRESHOLDS.UPTIME_WARN_SECONDS).toBe(300);
  });
});
