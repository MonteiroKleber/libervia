/**
 * TESTES - CAMADA 6: TenantRuntime
 *
 * Testa criacao, cache e lifecycle de instancias do Core.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TenantRegistry } from '../../tenant/TenantRegistry';
import { TenantRuntime, CoreInstance } from '../../tenant/TenantRuntime';
import { IntegrationAdapter, IntegrationFactory } from '../../tenant/IntegrationAdapter';
import { OrquestradorCognitivo } from '../../camada-3/orquestrador/OrquestradorCognitivo';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-tenant-runtime-' + Date.now();

let registry: TenantRegistry;

beforeAll(async () => {
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
  registry = await TenantRegistry.create(TEST_BASE_DIR);
});

afterAll(async () => {
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// CRIACAO
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - Criacao', () => {
  test('cria runtime com factory', () => {
    const runtime = TenantRuntime.create(registry);
    expect(runtime).toBeInstanceOf(TenantRuntime);
  });

  test('runtime comeca sem instancias', () => {
    const runtime = TenantRuntime.create(registry);
    expect(runtime.getInstanceCount()).toBe(0);
    expect(runtime.listActive()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET OR CREATE
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - getOrCreate', () => {
  let runtime: TenantRuntime;

  beforeEach(async () => {
    // Registrar tenant para cada teste
    const tenantId = 'runtime-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Runtime Test' });
    runtime = TenantRuntime.create(registry);
  });

  afterEach(async () => {
    await runtime.shutdownAll();
  });

  test('cria instancia para tenant ativo', async () => {
    const tenantId = registry.listActive()[0].id;
    const instance = await runtime.getOrCreate(tenantId);

    expect(instance).toBeDefined();
    expect(instance.tenantId).toBe(tenantId);
    expect(instance.orquestrador).toBeInstanceOf(OrquestradorCognitivo);
    expect(instance.eventLog).toBeDefined();
  });

  test('instancia tem dataDir correto', async () => {
    const tenantId = registry.listActive()[0].id;
    const instance = await runtime.getOrCreate(tenantId);

    expect(instance.dataDir).toContain('tenants');
    expect(instance.dataDir).toContain(tenantId);
  });

  test('instancia tem timestamps', async () => {
    const tenantId = registry.listActive()[0].id;
    const instance = await runtime.getOrCreate(tenantId);

    expect(instance.startedAt).toBeDefined();
    expect(instance.lastActivity).toBeDefined();
    expect(new Date(instance.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('retorna instancia do cache na segunda chamada', async () => {
    const tenantId = registry.listActive()[0].id;
    const instance1 = await runtime.getOrCreate(tenantId);
    const instance2 = await runtime.getOrCreate(tenantId);

    // Mesma instancia (referencia)
    expect(instance1).toBe(instance2);
  });

  test('atualiza lastActivity no cache hit', async () => {
    const tenantId = registry.listActive()[0].id;
    const instance1 = await runtime.getOrCreate(tenantId);
    const firstActivity = instance1.lastActivity;

    // Pequeno delay
    await new Promise(r => setTimeout(r, 10));

    const instance2 = await runtime.getOrCreate(tenantId);

    expect(new Date(instance2.lastActivity).getTime())
      .toBeGreaterThanOrEqual(new Date(firstActivity).getTime());
  });

  test('rejeita tenant inexistente', async () => {
    await expect(runtime.getOrCreate('nao-existe'))
      .rejects.toThrow('Tenant nao encontrado');
  });

  test('rejeita tenant suspenso', async () => {
    const tenantId = 'suspended-' + Date.now();
    await registry.register({ id: tenantId, name: 'Suspended' });
    await registry.suspend(tenantId);

    await expect(runtime.getOrCreate(tenantId))
      .rejects.toThrow('Tenant nao esta ativo');
  });

  test('rejeita tenant deletado', async () => {
    const tenantId = 'deleted-' + Date.now();
    await registry.register({ id: tenantId, name: 'Deleted' });
    await registry.remove(tenantId);

    await expect(runtime.getOrCreate(tenantId))
      .rejects.toThrow('Tenant nao esta ativo');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET (SEM CRIAR)
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - get', () => {
  let runtime: TenantRuntime;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = 'get-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Get Test' });
    runtime = TenantRuntime.create(registry);
  });

  afterAll(async () => {
    await runtime.shutdownAll();
  });

  test('retorna null se instancia nao existe', () => {
    expect(runtime.get(tenantId)).toBeNull();
  });

  test('retorna instancia se existe', async () => {
    await runtime.getOrCreate(tenantId);
    const instance = runtime.get(tenantId);

    expect(instance).not.toBeNull();
    expect(instance?.tenantId).toBe(tenantId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IS ACTIVE
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - isActive', () => {
  let runtime: TenantRuntime;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = 'active-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Active Test' });
    runtime = TenantRuntime.create(registry);
  });

  afterAll(async () => {
    await runtime.shutdownAll();
  });

  test('retorna false se instancia nao existe', () => {
    expect(runtime.isActive(tenantId)).toBe(false);
  });

  test('retorna true se instancia existe', async () => {
    await runtime.getOrCreate(tenantId);
    expect(runtime.isActive(tenantId)).toBe(true);
  });

  test('retorna false apos shutdown', async () => {
    await runtime.getOrCreate(tenantId);
    await runtime.shutdown(tenantId);
    expect(runtime.isActive(tenantId)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SHUTDOWN
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - shutdown', () => {
  let runtime: TenantRuntime;
  let tenantId: string;

  beforeEach(async () => {
    tenantId = 'shutdown-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Shutdown Test' });
    runtime = TenantRuntime.create(registry);
  });

  test('remove instancia do cache', async () => {
    await runtime.getOrCreate(tenantId);
    expect(runtime.getInstanceCount()).toBe(1);

    await runtime.shutdown(tenantId);
    expect(runtime.getInstanceCount()).toBe(0);
    expect(runtime.get(tenantId)).toBeNull();
  });

  test('shutdown de instancia inexistente nao da erro', async () => {
    await expect(runtime.shutdown('nao-existe')).resolves.not.toThrow();
  });

  test('shutdownAll remove todas as instancias', async () => {
    // Criar alguns tenants
    const id1 = 'shutdown-all-1-' + Date.now();
    const id2 = 'shutdown-all-2-' + Date.now();

    await registry.register({ id: id1, name: 'Test 1' });
    await registry.register({ id: id2, name: 'Test 2' });

    await runtime.getOrCreate(id1);
    await runtime.getOrCreate(id2);

    expect(runtime.getInstanceCount()).toBe(2);

    await runtime.shutdownAll();

    expect(runtime.getInstanceCount()).toBe(0);
    expect(runtime.listActive()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// METRICAS
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - Metricas', () => {
  let runtime: TenantRuntime;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = 'metrics-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Metrics Test' });
    runtime = TenantRuntime.create(registry);
    await runtime.getOrCreate(tenantId);
  });

  afterAll(async () => {
    await runtime.shutdownAll();
  });

  test('getMetrics retorna metricas', () => {
    const metrics = runtime.getMetrics(tenantId);

    expect(metrics).not.toBeNull();
    expect(metrics?.tenantId).toBe(tenantId);
    expect(metrics?.startedAt).toBeDefined();
    expect(metrics?.lastActivity).toBeDefined();
    expect(metrics?.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics?.eventLogStatus).toBeDefined();
  });

  test('getMetrics retorna null para instancia inexistente', () => {
    expect(runtime.getMetrics('nao-existe')).toBeNull();
  });

  test('getAllMetrics retorna array de metricas', () => {
    const allMetrics = runtime.getAllMetrics();

    expect(Array.isArray(allMetrics)).toBe(true);
    expect(allMetrics.length).toBeGreaterThan(0);
    expect(allMetrics[0].tenantId).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - Health Check', () => {
  let runtime: TenantRuntime;
  let tenantId: string;

  beforeAll(async () => {
    tenantId = 'health-test-' + Date.now();
    await registry.register({ id: tenantId, name: 'Health Test' });
    runtime = TenantRuntime.create(registry);
    await runtime.getOrCreate(tenantId);
  });

  afterAll(async () => {
    await runtime.shutdownAll();
  });

  test('isHealthy retorna true para instancia saudavel', async () => {
    const healthy = await runtime.isHealthy(tenantId);
    expect(healthy).toBe(true);
  });

  test('isHealthy retorna false para instancia inexistente', async () => {
    const healthy = await runtime.isHealthy('nao-existe');
    expect(healthy).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATION ADAPTER
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - Integration Adapter', () => {
  test('instancia sem adapter tem integration null', async () => {
    const tenantId = 'no-adapter-' + Date.now();
    await registry.register({ id: tenantId, name: 'No Adapter' });

    const runtime = TenantRuntime.create(registry);
    const instance = await runtime.getOrCreate(tenantId);

    expect(instance.integration).toBeNull();

    await runtime.shutdownAll();
  });

  test('instancia com adapter factory recebe adapter', async () => {
    const tenantId = 'with-adapter-' + Date.now();
    await registry.register({ id: tenantId, name: 'With Adapter' });

    // Criar adapter mock
    const mockAdapter: IntegrationAdapter = {
      name: 'mock',
      init: jest.fn(),
      shutdown: jest.fn()
    };

    // Factory deve chamar init antes de retornar o adapter
    const factory: IntegrationFactory = async (tid, dataDir, orq) => {
      if (mockAdapter.init) {
        await mockAdapter.init(tid, dataDir, orq);
      }
      return mockAdapter;
    };

    const runtime = TenantRuntime.create(registry, factory);
    const instance = await runtime.getOrCreate(tenantId);

    expect(instance.integration).toBe(mockAdapter);
    expect(mockAdapter.init).toHaveBeenCalled();

    await runtime.shutdownAll();
    expect(mockAdapter.shutdown).toHaveBeenCalled();
  });

  test('shutdown chama adapter.shutdown', async () => {
    const tenantId = 'shutdown-adapter-' + Date.now();
    await registry.register({ id: tenantId, name: 'Shutdown Adapter' });

    const mockShutdown = jest.fn();
    const mockAdapter: IntegrationAdapter = {
      name: 'mock',
      shutdown: mockShutdown
    };

    const factory: IntegrationFactory = async () => mockAdapter;

    const runtime = TenantRuntime.create(registry, factory);
    await runtime.getOrCreate(tenantId);
    await runtime.shutdown(tenantId);

    expect(mockShutdown).toHaveBeenCalledWith(tenantId);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LIST ACTIVE
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRuntime - listActive', () => {
  let runtime: TenantRuntime;

  beforeEach(() => {
    runtime = TenantRuntime.create(registry);
  });

  afterEach(async () => {
    await runtime.shutdownAll();
  });

  test('lista esta vazia inicialmente', () => {
    expect(runtime.listActive()).toEqual([]);
  });

  test('lista inclui tenants ativos', async () => {
    const id1 = 'list-1-' + Date.now();
    const id2 = 'list-2-' + Date.now();

    await registry.register({ id: id1, name: 'List 1' });
    await registry.register({ id: id2, name: 'List 2' });

    await runtime.getOrCreate(id1);
    await runtime.getOrCreate(id2);

    const active = runtime.listActive();
    expect(active).toContain(id1);
    expect(active).toContain(id2);
  });

  test('lista nao inclui tenants apos shutdown', async () => {
    const id = 'list-shutdown-' + Date.now();
    await registry.register({ id, name: 'List Shutdown' });

    await runtime.getOrCreate(id);
    expect(runtime.listActive()).toContain(id);

    await runtime.shutdown(id);
    expect(runtime.listActive()).not.toContain(id);
  });
});
