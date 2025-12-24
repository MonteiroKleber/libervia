/**
 * TESTES - CAMADA 6: TenantSecurity
 *
 * Testa validacao de tenantId e prevencao de path traversal.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  TENANT_ID_REGEX,
  RESERVED_IDS,
  normalizeTenantId,
  validateTenantId,
  resolveTenantDataDir,
  resolveTenantDataDirSync
} from '../../tenant/TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-tenant-security-' + Date.now();

beforeAll(async () => {
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZACAO
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeTenantId', () => {
  test('converte para lowercase', () => {
    expect(normalizeTenantId('ACME-CORP')).toBe('acme-corp');
    expect(normalizeTenantId('AcMe-CoRp')).toBe('acme-corp');
  });

  test('remove espacos', () => {
    expect(normalizeTenantId('  acme-corp  ')).toBe('acme-corp');
    expect(normalizeTenantId('acme-corp ')).toBe('acme-corp');
  });

  test('retorna string vazia para input invalido', () => {
    expect(normalizeTenantId(null as any)).toBe('');
    expect(normalizeTenantId(undefined as any)).toBe('');
    expect(normalizeTenantId(123 as any)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALIDACAO - IDS VALIDOS
// ════════════════════════════════════════════════════════════════════════════

describe('validateTenantId - IDs validos', () => {
  const validIds = [
    'acme-corp',
    'globex1',
    'initech-llc',
    'abc',
    'a1b',
    '123',
    'my-company-name',
    'tenant-with-many-hyphens-in-name',
    '12345678901234567890123456789012345678901234567890'  // 50 chars
  ];

  test.each(validIds)('aceita: %s', (id) => {
    const result = validateTenantId(id);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALIDACAO - IDS INVALIDOS
// ════════════════════════════════════════════════════════════════════════════

describe('validateTenantId - IDs invalidos', () => {
  test('rejeita ID muito curto', () => {
    expect(validateTenantId('a').valid).toBe(false);
    expect(validateTenantId('ab').valid).toBe(false);
  });

  test('rejeita ID muito longo', () => {
    const longId = 'a'.repeat(51);
    expect(validateTenantId(longId).valid).toBe(false);
  });

  test('rejeita ID que comeca com hifen', () => {
    expect(validateTenantId('-abc').valid).toBe(false);
  });

  test('rejeita ID que termina com hifen', () => {
    expect(validateTenantId('abc-').valid).toBe(false);
  });

  test('rejeita ID com hifen duplo', () => {
    expect(validateTenantId('abc--def').valid).toBe(false);
  });

  test('rejeita ID com caracteres especiais', () => {
    expect(validateTenantId('abc/def').valid).toBe(false);
    expect(validateTenantId('abc\\def').valid).toBe(false);
    expect(validateTenantId('abc..def').valid).toBe(false);
    expect(validateTenantId('abc~def').valid).toBe(false);
    expect(validateTenantId('abc$def').valid).toBe(false);
    expect(validateTenantId('abc%def').valid).toBe(false);
  });

  test('rejeita path traversal', () => {
    expect(validateTenantId('../etc').valid).toBe(false);
    expect(validateTenantId('..\\etc').valid).toBe(false);
    expect(validateTenantId('abc/../def').valid).toBe(false);
  });

  test('rejeita IDs reservados', () => {
    for (const reserved of RESERVED_IDS) {
      const result = validateTenantId(reserved);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reservado');
    }
  });

  test('rejeita maiusculas (normalizadas primeiro)', () => {
    // O regex exige lowercase, mas normalizamos antes
    // Entao ACME vira acme e passa
    // O teste real e que o regex nao aceita maiusculas diretamente
    expect(TENANT_ID_REGEX.test('ACME')).toBe(false);
  });

  test('rejeita caracteres unicode', () => {
    expect(validateTenantId('acme-corp-ç').valid).toBe(false);
    expect(validateTenantId('empresa-ão').valid).toBe(false);
  });

  test('rejeita espacos', () => {
    expect(validateTenantId('acme corp').valid).toBe(false);
  });

  test('rejeita null bytes', () => {
    expect(validateTenantId('acme\0corp').valid).toBe(false);
  });

  test('rejeita newlines', () => {
    expect(validateTenantId('acme\ncorp').valid).toBe(false);
    expect(validateTenantId('acme\rcorp').valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RESOLUCAO DE DIRETORIO - SINCRONA
// ════════════════════════════════════════════════════════════════════════════

describe('resolveTenantDataDirSync', () => {
  test('resolve diretorio valido', () => {
    const result = resolveTenantDataDirSync('/var/lib/libervia', 'acme-corp');
    expect(result).toContain('tenants');
    expect(result).toContain('acme-corp');
    expect(result).toBe(path.resolve('/var/lib/libervia/tenants/acme-corp'));
  });

  test('normaliza maiusculas', () => {
    const result = resolveTenantDataDirSync('/var/lib/libervia', 'ACME-CORP');
    expect(result).toContain('acme-corp');
  });

  test('rejeita tenantId invalido', () => {
    expect(() => resolveTenantDataDirSync('/base', '../etc'))
      .toThrow('TenantId invalido');
  });

  test('rejeita path traversal via regex', () => {
    expect(() => resolveTenantDataDirSync('/base', 'abc/../def'))
      .toThrow('TenantId invalido');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RESOLUCAO DE DIRETORIO - ASSINCRONA
// ════════════════════════════════════════════════════════════════════════════

describe('resolveTenantDataDir', () => {
  test('resolve diretorio valido', async () => {
    const result = await resolveTenantDataDir(TEST_BASE_DIR, 'acme-corp');
    expect(result).toContain('tenants');
    expect(result).toContain('acme-corp');
  });

  test('cria diretorio tenants se nao existe', async () => {
    const newBase = TEST_BASE_DIR + '-new-' + Date.now();
    await resolveTenantDataDir(newBase, 'test-tenant', true);

    const tenantsDir = path.join(newBase, 'tenants');
    const stat = await fs.stat(tenantsDir);
    expect(stat.isDirectory()).toBe(true);

    await fs.rm(newBase, { recursive: true, force: true });
  });

  test('rejeita tenantId invalido', async () => {
    await expect(resolveTenantDataDir(TEST_BASE_DIR, '../etc'))
      .rejects.toThrow('TenantId invalido');
  });

  test('modo paranoid verifica realpath', async () => {
    const result = await resolveTenantDataDir(TEST_BASE_DIR, 'safe-tenant', true);
    expect(result).toContain('safe-tenant');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PREVENCAO DE PATH TRAVERSAL
// ════════════════════════════════════════════════════════════════════════════

describe('Path Traversal Prevention', () => {
  test('bloqueia tentativa de sair do diretorio base', () => {
    // Tentativas de path traversal sao bloqueadas pelo regex antes de chegar ao path
    expect(() => resolveTenantDataDirSync('/base', '../etc/passwd'))
      .toThrow();

    expect(() => resolveTenantDataDirSync('/base', '..'))
      .toThrow();

    expect(() => resolveTenantDataDirSync('/base', '../..'))
      .toThrow();
  });

  test('bloqueia paths absolutos', () => {
    expect(() => resolveTenantDataDirSync('/base', '/etc/passwd'))
      .toThrow();
  });

  test('bloqueia tilde expansion', () => {
    expect(() => resolveTenantDataDirSync('/base', '~root'))
      .toThrow();
  });

  test('bloqueia paths com ponto duplo', () => {
    expect(() => resolveTenantDataDirSync('/base', 'abc..def'))
      .toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGEX
// ════════════════════════════════════════════════════════════════════════════

describe('TENANT_ID_REGEX', () => {
  test('regex aceita padroes validos', () => {
    expect(TENANT_ID_REGEX.test('abc')).toBe(true);
    expect(TENANT_ID_REGEX.test('abc-def')).toBe(true);
    expect(TENANT_ID_REGEX.test('abc123')).toBe(true);
    expect(TENANT_ID_REGEX.test('123abc')).toBe(true);
  });

  test('regex rejeita padroes invalidos', () => {
    expect(TENANT_ID_REGEX.test('ab')).toBe(false);      // muito curto
    expect(TENANT_ID_REGEX.test('-abc')).toBe(false);    // comeca com hifen
    expect(TENANT_ID_REGEX.test('abc-')).toBe(false);    // termina com hifen
    expect(TENANT_ID_REGEX.test('ABC')).toBe(false);     // maiusculas
    expect(TENANT_ID_REGEX.test('abc def')).toBe(false); // espaco
  });
});
