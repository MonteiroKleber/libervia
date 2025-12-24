/**
 * INCREMENTO 12 — Testes de Key Management
 *
 * Testa CRUD de chaves de autenticacao:
 * - Criar chaves (public, tenant_admin)
 * - Listar chaves (sem expor tokens)
 * - Revogar chaves
 * - Rotacao de chaves
 * - Migracao de apiToken legado
 */

import { TenantRegistry } from '../../tenant/TenantRegistry';
import {
  hashToken,
  sha256Token,
  generateSecureToken,
  generateKeyId,
  validateToken,
  clearPepperCache
} from '../../tenant/TenantSecurity';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

// Inc 12.1: Configurar pepper para testes
const TEST_PEPPER = 'test-pepper-for-unit-tests-1234567890';

// Inc 12.2.1: Usar mkdtemp para diretórios exclusivos por teste
// Isso evita race conditions entre testes paralelos.
// Diretórios em /tmp são limpos automaticamente pelo SO - não precisamos cleanup manual.
async function createTestDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'libervia-tenantKeys-'));
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

describe('Tenant Keys', () => {
  beforeAll(async () => {
    // Inc 12.1: Configurar pepper antes dos testes
    process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;
    clearPepperCache();
  });

  afterAll(async () => {
    // Inc 12.1: Limpar pepper após testes
    delete process.env.LIBERVIA_AUTH_PEPPER;
    clearPepperCache();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SECURITY UTILS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Security Utils', () => {
    test('generateSecureToken gera tokens unicos', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(30);
      expect(token2.length).toBeGreaterThan(30);
    });

    test('generateKeyId gera IDs com prefixo key_', () => {
      const keyId = generateKeyId();

      expect(keyId).toMatch(/^key_[a-zA-Z0-9_-]+$/);
      expect(keyId.length).toBeGreaterThan(5);
    });

    test('hashToken gera hash SHA-256 hex', () => {
      const token = 'test-token-123';
      const hash = hashToken(token);

      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex = 64 chars
    });

    test('hashToken e deterministico', () => {
      const token = 'same-token';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
    });

    test('validateToken valida corretamente', () => {
      const token = generateSecureToken();
      const hash = hashToken(token);

      expect(validateToken(token, hash)).toBe(true);
      expect(validateToken('wrong-token', hash)).toBe(false);
      expect(validateToken(token, 'wrong-hash')).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE KEY
  // ══════════════════════════════════════════════════════════════════════════

  describe('Create Key', () => {
    test('Criar chave public retorna token', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'key-test-1', name: 'Key Test 1' });
      const result = await registry.createTenantKey('key-test-1', 'public', 'Test key');

      expect(result.keyId).toMatch(/^key_/);
      expect(result.role).toBe('public');
      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(30);
      expect(result.createdAt).toBeDefined();
    });

    test('Criar chave tenant_admin funciona', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'key-test-2', name: 'Key Test 2' });
      const result = await registry.createTenantKey('key-test-2', 'tenant_admin');

      expect(result.role).toBe('tenant_admin');
      expect(result.token).toBeDefined();
    });

    test('Criar chave global_admin falha', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'key-test-3', name: 'Key Test 3' });

      await expect(
        registry.createTenantKey('key-test-3', 'global_admin')
      ).rejects.toThrow('global_admin');
    });

    test('Criar chave para tenant inexistente falha', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await expect(
        registry.createTenantKey('nao-existe', 'public')
      ).rejects.toThrow('nao encontrado');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LIST KEYS
  // ══════════════════════════════════════════════════════════════════════════

  describe('List Keys', () => {
    test('Listar chaves nao expoe tokenHash', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'list-test-1', name: 'List Test 1' });
      await registry.createTenantKey('list-test-1', 'public');
      await registry.createTenantKey('list-test-1', 'tenant_admin');

      const keys = registry.listTenantKeys('list-test-1');

      expect(keys.length).toBe(2);

      for (const key of keys) {
        expect(key.keyId).toBeDefined();
        expect(key.role).toBeDefined();
        expect(key.status).toBe('active');
        expect((key as any).tokenHash).toBeUndefined();
      }
    });

    test('Listar chaves de tenant inexistente falha', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      expect(() => registry.listTenantKeys('nao-existe')).toThrow('nao encontrado');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REVOKE KEY
  // ══════════════════════════════════════════════════════════════════════════

  describe('Revoke Key', () => {
    test('Revogar chave muda status', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'revoke-test-1', name: 'Revoke Test 1' });
      const { keyId } = await registry.createTenantKey('revoke-test-1', 'public');

      // Antes: active
      const keysBefore = registry.listTenantKeys('revoke-test-1');
      expect(keysBefore[0].status).toBe('active');

      // Revogar
      await registry.revokeTenantKey('revoke-test-1', keyId);

      // Depois: revoked
      const keysAfter = registry.listTenantKeys('revoke-test-1');
      expect(keysAfter[0].status).toBe('revoked');
    });

    test('Revogar chave invalida o token', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'revoke-test-2', name: 'Revoke Test 2' });
      const { keyId, token } = await registry.createTenantKey('revoke-test-2', 'public');

      // Antes: token valido
      const contextBefore = registry.validateTenantToken('revoke-test-2', token);
      expect(contextBefore).not.toBeNull();
      expect(contextBefore?.keyId).toBe(keyId);

      // Revogar
      await registry.revokeTenantKey('revoke-test-2', keyId);

      // Depois: token invalido
      const contextAfter = registry.validateTenantToken('revoke-test-2', token);
      expect(contextAfter).toBeNull();
    });

    test('Revogar chave inexistente falha', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'revoke-test-3', name: 'Revoke Test 3' });

      await expect(
        registry.revokeTenantKey('revoke-test-3', 'key_nao_existe')
      ).rejects.toThrow('Chave nao encontrada');
    });

    test('Revogar chave ja revogada falha', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'revoke-test-4', name: 'Revoke Test 4' });
      const { keyId } = await registry.createTenantKey('revoke-test-4', 'public');

      await registry.revokeTenantKey('revoke-test-4', keyId);

      await expect(
        registry.revokeTenantKey('revoke-test-4', keyId)
      ).rejects.toThrow('ja foi revogada');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ROTATE KEY
  // ══════════════════════════════════════════════════════════════════════════

  describe('Rotate Key', () => {
    test('Rotacao cria nova chave sem revogar antigas', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'rotate-test-1', name: 'Rotate Test 1' });
      const { token: token1 } = await registry.createTenantKey('rotate-test-1', 'public');
      const { token: token2 } = await registry.rotateTenantKey('rotate-test-1', 'public');

      // Ambos tokens devem funcionar
      const context1 = registry.validateTenantToken('rotate-test-1', token1);
      const context2 = registry.validateTenantToken('rotate-test-1', token2);

      expect(context1).not.toBeNull();
      expect(context2).not.toBeNull();

      // Deve haver 2 chaves
      const keys = registry.listTenantKeys('rotate-test-1');
      expect(keys.length).toBe(2);
    });

    test('Rotacao com role diferente cria chave do novo role', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'rotate-test-2', name: 'Rotate Test 2' });
      await registry.createTenantKey('rotate-test-2', 'public');
      const { role } = await registry.rotateTenantKey('rotate-test-2', 'tenant_admin');

      expect(role).toBe('tenant_admin');

      const keys = registry.listTenantKeys('rotate-test-2');
      const roles = keys.map(k => k.role);
      expect(roles).toContain('public');
      expect(roles).toContain('tenant_admin');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // VALIDATE TOKEN
  // ══════════════════════════════════════════════════════════════════════════

  describe('Validate Token', () => {
    test('Token valido retorna AuthContext', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'validate-test-1', name: 'Validate Test 1' });
      const { keyId, token } = await registry.createTenantKey('validate-test-1', 'public');

      const context = registry.validateTenantToken('validate-test-1', token);

      expect(context).not.toBeNull();
      expect(context?.role).toBe('public');
      expect(context?.tenantId).toBe('validate-test-1');
      expect(context?.keyId).toBe(keyId);
    });

    test('Token invalido retorna null', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'validate-test-2', name: 'Validate Test 2' });

      const context = registry.validateTenantToken('validate-test-2', 'invalid-token');

      expect(context).toBeNull();
    });

    test('Token de outro tenant retorna null', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      await registry.register({ id: 'validate-test-3a', name: 'Validate Test 3A' });
      await registry.register({ id: 'validate-test-3b', name: 'Validate Test 3B' });

      const { token: tokenA } = await registry.createTenantKey('validate-test-3a', 'public');

      // Token de A nao funciona em B
      const context = registry.validateTenantToken('validate-test-3b', tokenA);

      expect(context).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LEGACY APITOKEN MIGRATION
  // ══════════════════════════════════════════════════════════════════════════

  describe('Legacy apiToken Migration', () => {
    test('apiToken legado e aceito', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      const legacyToken = 'legacy-token-12345';
      await registry.register({
        id: 'legacy-test-1',
        name: 'Legacy Test 1',
        apiToken: legacyToken
      });

      const context = registry.validateTenantToken('legacy-test-1', legacyToken);

      expect(context).not.toBeNull();
      expect(context?.role).toBe('public');
      expect(context?.keyId).toBe('legacy');
    });

    test('Novas keys funcionam junto com apiToken legado', async () => {
      const registry = await TenantRegistry.create(await createTestDir());

      const legacyToken = 'legacy-token-67890';
      await registry.register({
        id: 'legacy-test-2',
        name: 'Legacy Test 2',
        apiToken: legacyToken
      });

      // Criar nova key
      const { token: newToken } = await registry.createTenantKey('legacy-test-2', 'tenant_admin');

      // Ambos devem funcionar
      const contextLegacy = registry.validateTenantToken('legacy-test-2', legacyToken);
      const contextNew = registry.validateTenantToken('legacy-test-2', newToken);

      expect(contextLegacy).not.toBeNull();
      expect(contextLegacy?.role).toBe('public');

      expect(contextNew).not.toBeNull();
      expect(contextNew?.role).toBe('tenant_admin');
    });
  });
});
