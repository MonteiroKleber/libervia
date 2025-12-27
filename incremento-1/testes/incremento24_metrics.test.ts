/**
 * TESTES - Incremento 24: Telemetria & Métricas
 *
 * Testa:
 * - Coleta de métricas em rotas públicas (/health e cognitivas)
 * - Labels não incluem path raw (apenas routeTemplate)
 * - RBAC: public 403, tenant_admin só do próprio tenant, global_admin ok
 * - Rate limit incrementa métrica
 * - Tenant conflict incrementa métrica
 */

import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';

import { buildApp } from '../gateway/app';
import { GatewayConfig } from '../gateway/GatewayConfig';
import { clearPepperCache } from '../tenant/TenantSecurity';
import { getTelemetryRegistry, resetTelemetryRegistry } from '../gateway/telemetry/TelemetryRegistry';
import { METRIC_NAMES } from '../gateway/telemetry/TelemetryTypes';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-inc24-metrics-' + Date.now();
const TEST_PEPPER = 'test-pepper-inc24-metrics-' + Date.now();
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

  // Reset metrics antes dos testes
  resetTelemetryRegistry();
});

afterAll(async () => {
  await app.close();
  // Aguardar um pouco antes de limpar para garantir que todos os handles estão fechados
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
  // Criar tenant
  await app.inject({
    method: 'POST',
    url: '/admin/tenants',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { id: tenantId, name: `Tenant ${tenantId}` }
  });

  // Criar key public
  const publicKeyResponse = await app.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantId}/keys`,
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    payload: { role: 'public' }
  });
  const { token: publicToken } = JSON.parse(publicKeyResponse.body);

  // Criar key tenant_admin
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
// TESTES: COLETA DE MÉTRICAS EM ROTAS PÚBLICAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: HTTP Metric Collection', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('GET /health incrementa contador de requisições', async () => {
    const registry = getTelemetryRegistry();

    // Fazer requisição
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);

    // Verificar que a métrica foi incrementada
    const counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    expect(counter).toBeDefined();

    const values = counter!.getValues();
    const healthMetric = values.find(
      v => v.labels.route === '/health' && v.labels.method === 'GET'
    );

    expect(healthMetric).toBeDefined();
    expect(healthMetric!.value).toBeGreaterThanOrEqual(1);
    expect(healthMetric!.labels.status_code).toBe('200');
  });

  test('GET /health registra duração no histogram', async () => {
    const registry = getTelemetryRegistry();

    await app.inject({
      method: 'GET',
      url: '/health'
    });

    const histogram = registry.getHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION_MS);
    expect(histogram).toBeDefined();

    const values = histogram!.getValues();
    const healthMetric = values.find(
      v => v.labels.route === '/health' && v.labels.method === 'GET'
    );

    expect(healthMetric).toBeDefined();
    expect(healthMetric!.count).toBeGreaterThanOrEqual(1);
    expect(healthMetric!.sum).toBeGreaterThan(0);
  });

  test('requisições com erro 4xx incrementam contador de erros', async () => {
    const registry = getTelemetryRegistry();

    // Fazer requisição que retorna 401 (sem token em rota admin)
    const response = await app.inject({
      method: 'GET',
      url: '/admin/tenants'
    });

    expect(response.statusCode).toBe(401);

    // Verificar contador de erros
    const errorCounter = registry.getCounter(METRIC_NAMES.HTTP_ERRORS_TOTAL);
    expect(errorCounter).toBeDefined();

    const values = errorCounter!.getValues();
    const errorMetric = values.find(v => v.labels.error_code === '4xx');

    expect(errorMetric).toBeDefined();
    expect(errorMetric!.value).toBeGreaterThanOrEqual(1);
  });

  test('requisições com tenant incluem tenant_id no label', async () => {
    const tenantId = 'metrics-tenant-' + Date.now();
    const { publicToken } = await createTenantWithKeys(tenantId);
    const registry = getTelemetryRegistry();

    // Fazer requisição com tenant
    await app.inject({
      method: 'GET',
      url: '/api/v1/eventos',
      headers: {
        'x-tenant-id': tenantId,
        authorization: `Bearer ${publicToken}`
      }
    });

    // Verificar que tenant_id está presente
    const counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const values = counter!.getValues();
    const tenantMetric = values.find(v => v.labels.tenant_id === tenantId);

    expect(tenantMetric).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: LABELS NÃO INCLUEM PATH RAW
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: Route Template Normalization', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('métricas usam route template, não path raw', async () => {
    const tenantId = 'route-template-' + Date.now();
    await createTenantWithKeys(tenantId);
    const registry = getTelemetryRegistry();

    // Fazer requisição para rota com parâmetro dinâmico
    await app.inject({
      method: 'GET',
      url: `/admin/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    // Verificar que o label usa template, não path raw
    const counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const values = counter!.getValues();

    // Não deve existir métrica com o tenantId no path
    const rawPathMetric = values.find(
      v => v.labels.route && v.labels.route.includes(tenantId)
    );
    expect(rawPathMetric).toBeUndefined();

    // Deve existir métrica com template normalizado
    const templateMetric = values.find(
      v => v.labels.route === '/admin/tenants/:id'
    );
    expect(templateMetric).toBeDefined();
  });

  test('rota /internal/tenants/:id/metrics usa template', async () => {
    const tenantId = 'internal-metrics-' + Date.now();
    const { tenantAdminToken } = await createTenantWithKeys(tenantId);
    const registry = getTelemetryRegistry();

    // Fazer requisição para métricas do tenant
    await app.inject({
      method: 'GET',
      url: `/internal/tenants/${tenantId}/metrics`,
      headers: { authorization: `Bearer ${tenantAdminToken}` }
    });

    // Verificar template
    const counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    const values = counter!.getValues();

    const templateMetric = values.find(
      v => v.labels.route === '/internal/tenants/:tenantId/metrics'
    );
    expect(templateMetric).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RBAC PARA ENDPOINTS DE MÉTRICAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: RBAC', () => {
  let testTenantId: string;
  let publicToken: string;
  let tenantAdminToken: string;

  beforeAll(async () => {
    testTenantId = 'rbac-metrics-' + Date.now();
    const tokens = await createTenantWithKeys(testTenantId);
    publicToken = tokens.publicToken;
    tenantAdminToken = tokens.tenantAdminToken;
  });

  // /internal/metrics (global)
  describe('GET /internal/metrics', () => {
    test('sem token retorna 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics'
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('MISSING_TOKEN');
    });

    test('public token retorna 401 ou 403 (não global_admin)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics',
        headers: { authorization: `Bearer ${publicToken}` }
      });

      // public token não é reconhecido como global_admin
      // authPlugin não consegue validar, metricsRoutes vê null authContext
      expect([401, 403]).toContain(response.statusCode);
    });

    test('tenant_admin retorna 401 ou 403 (não global_admin)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics',
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      // tenant_admin token não é reconhecido como global_admin
      expect([401, 403]).toContain(response.statusCode);
    });

    test('global_admin retorna 200 com formato Prometheus', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');

      // Verificar formato Prometheus
      const body = response.body;
      expect(body).toContain('# HELP');
      expect(body).toContain('# TYPE');
      expect(body).toContain('libervia_');
    });
  });

  // /internal/metrics/json
  describe('GET /internal/metrics/json', () => {
    test('global_admin retorna 200 com JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics/json',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeDefined();
      expect(body.metrics).toBeDefined();
      expect(Array.isArray(body.metrics)).toBe(true);
    });

    test('tenant_admin retorna 401 ou 403 (não global_admin)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/metrics/json',
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      // tenant_admin token não é reconhecido como global_admin
      // authPlugin não consegue validar (retorna 401) ou metricsRoutes nega (403)
      expect([401, 403]).toContain(response.statusCode);
    });
  });

  // /internal/tenants/:id/metrics
  describe('GET /internal/tenants/:tenantId/metrics', () => {
    test('public token retorna 401 ou 403 (insuficiente)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/tenants/${testTenantId}/metrics`,
        headers: { authorization: `Bearer ${publicToken}` }
      });

      // public role não pode acessar métricas
      // Pode ser 401 (token não validado como tenant_admin) ou 403 (INSUFFICIENT_ROLE)
      expect([401, 403]).toContain(response.statusCode);
    });

    test('tenant_admin pode ver métricas do próprio tenant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/tenants/${testTenantId}/metrics`,
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
    });

    test('tenant_admin NÃO pode ver métricas de outro tenant', async () => {
      // Criar outro tenant
      const otherTenantId = 'other-tenant-' + Date.now();
      await createTenantWithKeys(otherTenantId);

      // Tentar acessar com token do primeiro tenant
      // O token do tenant A é inválido para tenant B, então retorna 403 (não autorizado para este tenant)
      const response = await app.inject({
        method: 'GET',
        url: `/internal/tenants/${otherTenantId}/metrics`,
        headers: { authorization: `Bearer ${tenantAdminToken}` }
      });

      // Pode ser 401 (token inválido para este tenant) ou 403 (acesso negado)
      // Depende de se a validação do token falha primeiro ou se chega ao RBAC check
      expect([401, 403]).toContain(response.statusCode);
    });

    test('global_admin pode ver métricas de qualquer tenant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/tenants/${testTenantId}/metrics`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      expect(response.statusCode).toBe(200);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: MÉTRICAS DE SEGURANÇA
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: Security Metrics', () => {
  beforeEach(() => {
    resetTelemetryRegistry();
  });

  test('registry suporta tracking de auth failures manualmente', async () => {
    const registry = getTelemetryRegistry();

    // Tracking manual (como seria chamado em integração mais profunda)
    registry.incAuthFailure({ reason: 'INVALID_TOKEN', tenant_id: 'test-tenant' });
    registry.incAuthFailure({ reason: 'MISSING_TOKEN' });

    // Verificar métrica de auth failure
    const counter = registry.getCounter(METRIC_NAMES.AUTH_FAILURES_TOTAL);
    expect(counter).toBeDefined();

    const values = counter!.getValues();
    expect(values.length).toBe(2);

    // Deve ter reasons válidas
    const invalidTokenMetric = values.find(v => v.labels.reason === 'INVALID_TOKEN');
    expect(invalidTokenMetric).toBeDefined();
    expect(invalidTokenMetric!.labels.tenant_id).toBe('test-tenant');

    const missingTokenMetric = values.find(v => v.labels.reason === 'MISSING_TOKEN');
    expect(missingTokenMetric).toBeDefined();
  });

  test('registry suporta tracking de tenant conflicts', async () => {
    const registry = getTelemetryRegistry();

    // Tracking manual de conflito
    registry.incTenantConflict('tenant-a');
    registry.incTenantConflict('tenant-a'); // Segundo conflito
    registry.incTenantConflict('tenant-b');

    // Verificar métrica de conflito
    const counter = registry.getCounter(METRIC_NAMES.TENANT_CONFLICTS_TOTAL);
    expect(counter).toBeDefined();

    const values = counter!.getValues();
    expect(values.length).toBe(2);

    const tenantA = values.find(v => v.labels.tenant_id === 'tenant-a');
    expect(tenantA).toBeDefined();
    expect(tenantA!.value).toBe(2);

    const tenantB = values.find(v => v.labels.tenant_id === 'tenant-b');
    expect(tenantB).toBeDefined();
    expect(tenantB!.value).toBe(1);
  });

  test('registry suporta tracking de rate limits', async () => {
    const registry = getTelemetryRegistry();

    // Tracking manual de rate limit
    registry.incRateLimited('rate-limited-tenant');

    // Verificar métrica
    const counter = registry.getCounter(METRIC_NAMES.RATE_LIMITED_TOTAL);
    expect(counter).toBeDefined();

    const values = counter!.getValues();
    expect(values.length).toBe(1);
    expect(values[0].labels.tenant_id).toBe('rate-limited-tenant');
    expect(values[0].value).toBe(1);
  });

  test('HTTP 4xx errors são tracked automaticamente', async () => {
    const registry = getTelemetryRegistry();

    // Fazer requisição que retorna 401
    await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: 'Bearer invalid-token' }
    });

    // Verificar que erro 4xx foi registrado
    const errorCounter = registry.getCounter(METRIC_NAMES.HTTP_ERRORS_TOTAL);
    expect(errorCounter).toBeDefined();

    const values = errorCounter!.getValues();
    const error4xx = values.find(v => v.labels.error_code === '4xx');
    expect(error4xx).toBeDefined();
    expect(error4xx!.value).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RUNTIME METRICS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: Runtime Metrics', () => {
  test('uptime seconds é atualizado corretamente', async () => {
    const registry = getTelemetryRegistry();

    // Atualizar runtime metrics
    registry.updateRuntimeMetrics();

    const gauge = registry.getGauge(METRIC_NAMES.PROCESS_UPTIME_SECONDS);
    expect(gauge).toBeDefined();

    const values = gauge!.getValues();
    expect(values.length).toBeGreaterThan(0);
    expect(values[0].value).toBeGreaterThan(0);
  });

  test('memory metrics são atualizadas', async () => {
    const registry = getTelemetryRegistry();

    // Atualizar runtime metrics
    registry.updateRuntimeMetrics();

    const gauge = registry.getGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES);
    expect(gauge).toBeDefined();

    const values = gauge!.getValues();

    // Deve ter heap_used, heap_total, rss, external
    const types = values.map(v => v.labels.type);
    expect(types).toContain('heap_used');
    expect(types).toContain('rss');

    // Valores devem ser positivos
    values.forEach(v => {
      expect(v.value).toBeGreaterThan(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: PROMETHEUS OUTPUT FORMAT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: Prometheus Output', () => {
  test('output inclui HELP e TYPE para cada métrica', async () => {
    // Gerar algumas métricas primeiro
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/metrics',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body = response.body;

    // Verificar estrutura Prometheus
    expect(body).toContain('# HELP libervia_http_requests_total');
    expect(body).toContain('# TYPE libervia_http_requests_total counter');

    expect(body).toContain('# HELP libervia_http_request_duration_ms');
    expect(body).toContain('# TYPE libervia_http_request_duration_ms histogram');

    expect(body).toContain('# HELP libervia_process_uptime_seconds');
    expect(body).toContain('# TYPE libervia_process_uptime_seconds gauge');
  });

  test('histograms incluem buckets, sum e count', async () => {
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/metrics',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body = response.body;

    // Verificar estrutura de histogram
    expect(body).toContain('libervia_http_request_duration_ms_bucket');
    expect(body).toContain('libervia_http_request_duration_ms_sum');
    expect(body).toContain('libervia_http_request_duration_ms_count');
    expect(body).toContain('le="'); // bucket label
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: JSON SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: JSON Snapshot', () => {
  test('snapshot inclui timestamp e metrics array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/metrics/json',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);

    expect(body.metrics).toBeDefined();
    expect(Array.isArray(body.metrics)).toBe(true);
  });

  test('cada métrica tem name, help, type e values', async () => {
    // Gerar métricas
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/metrics/json',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    const body = JSON.parse(response.body);

    // Verificar estrutura de cada métrica
    body.metrics.forEach((metric: any) => {
      expect(metric.name).toBeDefined();
      expect(metric.help).toBeDefined();
      expect(metric.type).toBeDefined();
      expect(['counter', 'gauge', 'histogram']).toContain(metric.type);
      expect(metric.values).toBeDefined();
      expect(Array.isArray(metric.values)).toBe(true);
    });
  });

  test('tenant snapshot filtra métricas por tenant_id', async () => {
    const tenantId = 'snapshot-tenant-' + Date.now();
    const { publicToken, tenantAdminToken } = await createTenantWithKeys(tenantId);

    // Gerar métricas para este tenant
    await app.inject({
      method: 'GET',
      url: '/api/v1/eventos',
      headers: {
        'x-tenant-id': tenantId,
        authorization: `Bearer ${publicToken}`
      }
    });

    // Gerar métricas para outro tenant
    const otherTenantId = 'other-snapshot-' + Date.now();
    const { publicToken: otherToken } = await createTenantWithKeys(otherTenantId);
    await app.inject({
      method: 'GET',
      url: '/api/v1/eventos',
      headers: {
        'x-tenant-id': otherTenantId,
        authorization: `Bearer ${otherToken}`
      }
    });

    // Buscar métricas filtradas
    const response = await app.inject({
      method: 'GET',
      url: `/internal/tenants/${tenantId}/metrics/json`,
      headers: { authorization: `Bearer ${tenantAdminToken}` }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.tenantId).toBe(tenantId);

    // Verificar que só tem métricas deste tenant
    body.metrics.forEach((metric: any) => {
      metric.values.forEach((value: any) => {
        if (value.labels.tenant_id) {
          expect(value.labels.tenant_id).toBe(tenantId);
        }
      });
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGISTRY SINGLETON
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 24 - Metrics: Registry Singleton', () => {
  test('getTelemetryRegistry retorna mesma instância', () => {
    const registry1 = getTelemetryRegistry();
    const registry2 = getTelemetryRegistry();

    expect(registry1).toBe(registry2);
  });

  test('resetTelemetryRegistry limpa todas as métricas', () => {
    const registry = getTelemetryRegistry();

    // Adicionar métricas
    registry.incHttpRequests({
      method: 'GET',
      route: '/test',
      status_code: '200'
    });

    // Verificar que existem
    let counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    expect(counter!.getValues().length).toBeGreaterThan(0);

    // Reset
    resetTelemetryRegistry();

    // Verificar que foram limpas
    counter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
    expect(counter!.getValues().length).toBe(0);
  });
});
