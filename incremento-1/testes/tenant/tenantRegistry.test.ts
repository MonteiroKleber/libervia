/**
 * TESTES - CAMADA 6: TenantRegistry
 *
 * Testa registro, lifecycle e persistencia de tenants.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TenantRegistry } from '../../tenant/TenantRegistry';
import { TenantConfig } from '../../tenant/TenantConfig';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-tenant-registry-' + Date.now();

beforeAll(async () => {
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// CRIACAO E INICIALIZACAO
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Criacao', () => {
  test('cria registry com factory', async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'create-factory');
    const registry = await TenantRegistry.create(baseDir);

    expect(registry).toBeInstanceOf(TenantRegistry);
    expect(registry.list()).toEqual([]);
  });

  test('cria diretorios necessarios', async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'create-dirs');
    await TenantRegistry.create(baseDir);

    const configDir = path.join(baseDir, 'config');
    const tenantsDir = path.join(baseDir, 'tenants');

    const configStat = await fs.stat(configDir);
    const tenantsStat = await fs.stat(tenantsDir);

    expect(configStat.isDirectory()).toBe(true);
    expect(tenantsStat.isDirectory()).toBe(true);
  });

  test('carrega dados existentes', async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'load-existing');
    const registry1 = await TenantRegistry.create(baseDir);

    await registry1.register({ id: 'acme-corp', name: 'ACME Corporation' });

    // Criar novo registry no mesmo diretorio
    const registry2 = await TenantRegistry.create(baseDir);

    expect(registry2.get('acme-corp')).not.toBeNull();
    expect(registry2.get('acme-corp')?.name).toBe('ACME Corporation');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGISTRO
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Registro', () => {
  let registry: TenantRegistry;
  let baseDir: string;

  beforeEach(async () => {
    baseDir = path.join(TEST_BASE_DIR, 'register-' + Date.now());
    registry = await TenantRegistry.create(baseDir);
  });

  test('registra novo tenant', async () => {
    const config = await registry.register({
      id: 'acme-corp',
      name: 'ACME Corporation'
    });

    expect(config.id).toBe('acme-corp');
    expect(config.name).toBe('ACME Corporation');
    expect(config.status).toBe('active');
    expect(config.createdAt).toBeDefined();
  });

  test('normaliza tenantId', async () => {
    const config = await registry.register({
      id: 'ACME-CORP',
      name: 'ACME Corporation'
    });

    expect(config.id).toBe('acme-corp');
  });

  test('aplica quotas padrao', async () => {
    const config = await registry.register({
      id: 'default-quotas',
      name: 'Test'
    });

    expect(config.quotas.maxEvents).toBe(10_000_000);
    expect(config.quotas.maxStorageMB).toBe(10_240);
    expect(config.quotas.rateLimitRpm).toBe(1000);
  });

  test('aceita quotas customizadas', async () => {
    const config = await registry.register({
      id: 'custom-quotas',
      name: 'Test',
      quotas: { maxEvents: 1000 }
    });

    expect(config.quotas.maxEvents).toBe(1000);
    expect(config.quotas.maxStorageMB).toBe(10_240); // padrao
  });

  test('cria diretorio do tenant', async () => {
    await registry.register({ id: 'with-dir', name: 'Test' });

    const tenantDir = path.join(baseDir, 'tenants', 'with-dir');
    const stat = await fs.stat(tenantDir);
    expect(stat.isDirectory()).toBe(true);
  });

  test('rejeita tenantId invalido', async () => {
    await expect(registry.register({ id: '../etc', name: 'Evil' }))
      .rejects.toThrow('TenantId invalido');
  });

  test('rejeita tenantId duplicado', async () => {
    await registry.register({ id: 'unique-id', name: 'First' });

    await expect(registry.register({ id: 'unique-id', name: 'Second' }))
      .rejects.toThrow('Tenant ja existe');
  });

  test('persiste no disco', async () => {
    await registry.register({ id: 'persisted', name: 'Test' });

    const configPath = path.join(baseDir, 'config', 'tenants.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const data = JSON.parse(content);

    expect(data.tenants).toHaveLength(1);
    expect(data.tenants[0].id).toBe('persisted');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET / LIST
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Get/List', () => {
  let registry: TenantRegistry;

  beforeAll(async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'get-list');
    registry = await TenantRegistry.create(baseDir);

    await registry.register({ id: 'tenant-a', name: 'Tenant A' });
    await registry.register({ id: 'tenant-b', name: 'Tenant B' });
    await registry.register({ id: 'tenant-c', name: 'Tenant C' });
    await registry.suspend('tenant-c');
  });

  test('get retorna tenant existente', () => {
    const tenant = registry.get('tenant-a');
    expect(tenant).not.toBeNull();
    expect(tenant?.name).toBe('Tenant A');
  });

  test('get retorna null para tenant inexistente', () => {
    expect(registry.get('nao-existe')).toBeNull();
  });

  test('get normaliza tenantId', () => {
    const tenant = registry.get('TENANT-A');
    expect(tenant).not.toBeNull();
  });

  test('list retorna todos exceto deletados', () => {
    const list = registry.list();
    expect(list).toHaveLength(3);
  });

  test('list com includeDeleted', async () => {
    await registry.remove('tenant-b');

    const listWithoutDeleted = registry.list();
    const listWithDeleted = registry.list(true);

    expect(listWithoutDeleted).toHaveLength(2);
    expect(listWithDeleted).toHaveLength(3);
  });

  test('listActive retorna apenas ativos', () => {
    const active = registry.listActive();
    expect(active.every(t => t.status === 'active')).toBe(true);
  });

  test('exists verifica existencia', () => {
    expect(registry.exists('tenant-a')).toBe(true);
    expect(registry.exists('nao-existe')).toBe(false);
  });

  test('isActive verifica status', () => {
    expect(registry.isActive('tenant-a')).toBe(true);
    expect(registry.isActive('tenant-c')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// UPDATE
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Update', () => {
  let registry: TenantRegistry;

  beforeEach(async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'update-' + Date.now());
    registry = await TenantRegistry.create(baseDir);
    await registry.register({ id: 'test-tenant', name: 'Original' });
  });

  test('atualiza nome', async () => {
    const updated = await registry.update('test-tenant', { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  test('atualiza quotas parcialmente', async () => {
    const original = registry.get('test-tenant');
    const updated = await registry.update('test-tenant', {
      quotas: { maxEvents: 5000 }
    });

    expect(updated.quotas.maxEvents).toBe(5000);
    expect(updated.quotas.maxStorageMB).toBe(original?.quotas.maxStorageMB);
  });

  test('atualiza features', async () => {
    const updated = await registry.update('test-tenant', {
      features: { signedBackup: true }
    });

    expect(updated.features.signedBackup).toBe(true);
  });

  test('atualiza updatedAt', async () => {
    const original = registry.get('test-tenant');
    await new Promise(r => setTimeout(r, 10)); // pequeno delay

    const updated = await registry.update('test-tenant', { name: 'New' });
    expect(new Date(updated.updatedAt).getTime())
      .toBeGreaterThan(new Date(original!.createdAt).getTime());
  });

  test('rejeita tenant inexistente', async () => {
    await expect(registry.update('nao-existe', { name: 'X' }))
      .rejects.toThrow('Tenant nao encontrado');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SUSPEND / RESUME
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Suspend/Resume', () => {
  let registry: TenantRegistry;

  beforeEach(async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'suspend-' + Date.now());
    registry = await TenantRegistry.create(baseDir);
    await registry.register({ id: 'test-tenant', name: 'Test' });
  });

  test('suspend muda status para suspended', async () => {
    const suspended = await registry.suspend('test-tenant');
    expect(suspended.status).toBe('suspended');
  });

  test('suspend rejeita tenant ja suspenso', async () => {
    await registry.suspend('test-tenant');
    await expect(registry.suspend('test-tenant'))
      .rejects.toThrow('Tenant nao esta ativo');
  });

  test('resume reativa tenant suspenso', async () => {
    await registry.suspend('test-tenant');
    const resumed = await registry.resume('test-tenant');
    expect(resumed.status).toBe('active');
  });

  test('resume rejeita tenant ativo', async () => {
    await expect(registry.resume('test-tenant'))
      .rejects.toThrow('Tenant nao esta suspenso');
  });

  test('suspend rejeita tenant inexistente', async () => {
    await expect(registry.suspend('nao-existe'))
      .rejects.toThrow('Tenant nao encontrado');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REMOVE
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Remove', () => {
  let registry: TenantRegistry;

  beforeEach(async () => {
    const baseDir = path.join(TEST_BASE_DIR, 'remove-' + Date.now());
    registry = await TenantRegistry.create(baseDir);
    await registry.register({ id: 'test-tenant', name: 'Test' });
  });

  test('remove faz soft delete', async () => {
    const removed = await registry.remove('test-tenant');
    expect(removed.status).toBe('deleted');
  });

  test('tenant removido nao aparece em list()', () => {
    // Ja testado em Get/List
  });

  test('remove rejeita tenant ja removido', async () => {
    await registry.remove('test-tenant');
    await expect(registry.remove('test-tenant'))
      .rejects.toThrow('Tenant ja foi removido');
  });

  test('remove rejeita tenant inexistente', async () => {
    await expect(registry.remove('nao-existe'))
      .rejects.toThrow('Tenant nao encontrado');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

describe('TenantRegistry - Helpers', () => {
  let registry: TenantRegistry;
  let baseDir: string;

  beforeEach(async () => {
    baseDir = path.join(TEST_BASE_DIR, 'helpers-' + Date.now());
    registry = await TenantRegistry.create(baseDir);
    await registry.register({ id: 'test-tenant', name: 'Test' });
  });

  test('getDataDir retorna path correto', async () => {
    const dataDir = await registry.getDataDir('test-tenant');
    expect(dataDir).toContain('tenants');
    expect(dataDir).toContain('test-tenant');
  });

  test('getDataDir rejeita tenant inexistente', async () => {
    await expect(registry.getDataDir('nao-existe'))
      .rejects.toThrow('Tenant nao encontrado');
  });

  test('getBaseDir retorna diretorio base', () => {
    expect(registry.getBaseDir()).toBe(baseDir);
  });
});
