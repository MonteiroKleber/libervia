/**
 * TESTES - Incremento 9: Seguranca Reforcada
 *
 * Testa:
 * - Assinatura digital de backups
 * - Verificacao de assinatura na restauracao
 * - Rejeicao de assinaturas invalidas
 * - Autenticacao reforcada do control-plane
 * - Metricas de seguranca
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Imports do projeto
import {
  generateKeyPair,
  sign,
  verify,
  signWithEnvKey,
  verifyWithEnvKey,
  canonicalize,
  sha256,
  KeyPair,
  Signature,
  ENV_PRIVATE_KEY,
  ENV_PUBLIC_KEY,
  ENV_KEY_ID,
  secureCompare,
  generateAuthToken,
  isKeyExpired,
  daysUntilExpiry
} from '../scripts/crypto_utils';

import {
  createSecureBackup,
  restoreSecureBackup,
  SignedManifest
} from '../scripts/backup_frio_secure';

import {
  authenticate,
  checkRateLimit,
  getSecurityMetrics,
  validateProductionRequirements,
  _resetState
} from '../control-plane/auth';

import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc9';

beforeAll(async () => {
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════
// TESTES: CRYPTO UTILS
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 9 - Crypto Utils', () => {
  test('generateKeyPair gera par de chaves Ed25519 valido', () => {
    const keyPair = generateKeyPair();

    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.keyId).toBeDefined();
    expect(keyPair.createdAt).toBeDefined();
    expect(keyPair.expiresAt).toBeDefined();

    // Chaves devem ser base64
    expect(() => Buffer.from(keyPair.publicKey, 'base64')).not.toThrow();
    expect(() => Buffer.from(keyPair.privateKey, 'base64')).not.toThrow();

    // KeyId deve ter 16 caracteres hex
    expect(keyPair.keyId).toMatch(/^[0-9a-f]{16}$/);
  });

  test('sign e verify funcionam corretamente', () => {
    const keyPair = generateKeyPair();
    const data = { foo: 'bar', num: 123 };

    // Criar chave privada para assinar
    const privateKeyDer = Buffer.from(keyPair.privateKey, 'base64');
    const privateKey = crypto.createPrivateKey({
      key: privateKeyDer,
      format: 'der',
      type: 'pkcs8'
    });

    // Criar chave publica para verificar
    const publicKeyDer = Buffer.from(keyPair.publicKey, 'base64');
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    // Assinar
    const signature = sign(data, privateKey, keyPair.keyId);

    expect(signature.algorithm).toBe('ed25519');
    expect(signature.public_key_id).toBe(keyPair.keyId);
    expect(signature.signature).toBeDefined();

    // Verificar
    const result = verify(data, signature, publicKey);

    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(keyPair.keyId);
  });

  test('verify rejeita dados alterados', () => {
    const keyPair = generateKeyPair();
    const data = { foo: 'bar' };

    const privateKeyDer = Buffer.from(keyPair.privateKey, 'base64');
    const privateKey = crypto.createPrivateKey({
      key: privateKeyDer,
      format: 'der',
      type: 'pkcs8'
    });

    const publicKeyDer = Buffer.from(keyPair.publicKey, 'base64');
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    const signature = sign(data, privateKey, keyPair.keyId);

    // Alterar dados
    const alteredData = { foo: 'altered' };
    const result = verify(alteredData, signature, publicKey);

    expect(result.valid).toBe(false);
  });

  test('verify rejeita assinatura com chave errada', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    const data = { foo: 'bar' };

    // Assinar com chave 1
    const privateKeyDer = Buffer.from(keyPair1.privateKey, 'base64');
    const privateKey = crypto.createPrivateKey({
      key: privateKeyDer,
      format: 'der',
      type: 'pkcs8'
    });

    const signature = sign(data, privateKey, keyPair1.keyId);

    // Verificar com chave 2 (errada)
    const publicKeyDer = Buffer.from(keyPair2.publicKey, 'base64');
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    const result = verify(data, signature, publicKey);

    expect(result.valid).toBe(false);
  });

  test('canonicalize produz JSON deterministico', () => {
    const data1 = { b: 2, a: 1 };
    const data2 = { a: 1, b: 2 };

    const canonical1 = canonicalize(data1);
    const canonical2 = canonicalize(data2);

    expect(canonical1).toBe(canonical2);
    expect(canonical1).toBe('{"a":1,"b":2}');
  });

  test('sha256 calcula hash corretamente', () => {
    const data = 'hello world';
    const hash = sha256(data);

    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  test('secureCompare compara strings de forma segura', () => {
    expect(secureCompare('abc', 'abc')).toBe(true);
    expect(secureCompare('abc', 'def')).toBe(false);
    expect(secureCompare('abc', 'abcd')).toBe(false);
  });

  test('generateAuthToken gera token de 64 caracteres hex', () => {
    const token = generateAuthToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('isKeyExpired detecta chave expirada', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 1000000).toISOString();

    expect(isKeyExpired(past)).toBe(true);
    expect(isKeyExpired(future)).toBe(false);
  });

  test('daysUntilExpiry calcula dias corretamente', () => {
    const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    const days = daysUntilExpiry(in10Days);

    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(10);
  });
});

// ════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP ASSINADO
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 9 - Backup Assinado', () => {
  let testKeyPair: KeyPair;

  beforeAll(() => {
    // Gerar chaves para testes
    testKeyPair = generateKeyPair();

    // Configurar env vars
    process.env[ENV_PRIVATE_KEY] = testKeyPair.privateKey;
    process.env[ENV_PUBLIC_KEY] = testKeyPair.publicKey;
    process.env[ENV_KEY_ID] = testKeyPair.keyId;
  });

  afterAll(() => {
    delete process.env[ENV_PRIVATE_KEY];
    delete process.env[ENV_PUBLIC_KEY];
    delete process.env[ENV_KEY_ID];
  });

  test('signWithEnvKey assina dados quando chave disponivel', () => {
    const data = { test: 'value' };
    const signature = signWithEnvKey(data);

    expect(signature).not.toBeNull();
    expect(signature?.algorithm).toBe('ed25519');
    expect(signature?.public_key_id).toBe(testKeyPair.keyId);
  });

  test('verifyWithEnvKey verifica assinatura valida', () => {
    const data = { test: 'value' };
    const signature = signWithEnvKey(data);

    expect(signature).not.toBeNull();

    const result = verifyWithEnvKey(data, signature!);

    expect(result.valid).toBe(true);
  });

  test('createSecureBackup cria backup assinado', async () => {
    const dataDir = path.join(TEST_DATA_DIR, 'backup-assinado');
    const outputDir = path.join(TEST_DATA_DIR, 'backup-output');

    // Criar EventLog de teste
    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'test_event', 'Test', 'test-1', { test: true });

    // Criar backup
    const result = await createSecureBackup(dataDir, [outputDir]);

    expect(result.success).toBe(true);
    expect(result.signed).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest?.signature).not.toBeNull();
    expect(result.manifest?.signature?.public_key_id).toBe(testKeyPair.keyId);
  });

  test('restoreSecureBackup verifica assinatura valida', async () => {
    const dataDir = path.join(TEST_DATA_DIR, 'backup-restore-valid');
    const outputDir = path.join(TEST_DATA_DIR, 'backup-restore-output');
    const restoreDir = path.join(TEST_DATA_DIR, 'backup-restored');

    // Criar EventLog de teste
    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'restore_test', 'Test', 'test-2', {});

    // Criar backup
    const backupResult = await createSecureBackup(dataDir, [outputDir]);
    expect(backupResult.success).toBe(true);

    // Restaurar
    const restoreResult = await restoreSecureBackup(
      backupResult.archive_path!,
      backupResult.manifest_path!,
      restoreDir
    );

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.signature_verified).toBe(true);
    expect(restoreResult.chain_valid).toBe(true);
  });

  test('restoreSecureBackup rejeita assinatura invalida', async () => {
    const dataDir = path.join(TEST_DATA_DIR, 'backup-invalid-sig');
    const outputDir = path.join(TEST_DATA_DIR, 'backup-invalid-output');
    const restoreDir = path.join(TEST_DATA_DIR, 'backup-invalid-restore');

    // Criar EventLog de teste
    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'invalid_sig_test', 'Test', 'test-3', {});

    // Criar backup
    const backupResult = await createSecureBackup(dataDir, [outputDir]);
    expect(backupResult.success).toBe(true);

    // Corromper manifest (alterar dados mantendo assinatura)
    const manifestContent = await fs.readFile(backupResult.manifest_path!, 'utf-8');
    const manifest: SignedManifest = JSON.parse(manifestContent);
    manifest.manifest.backup_id = 'corrupted-id';  // Alterar dado
    await fs.writeFile(backupResult.manifest_path!, JSON.stringify(manifest, null, 2));

    // Tentar restaurar - deve falhar
    const restoreResult = await restoreSecureBackup(
      backupResult.archive_path!,
      backupResult.manifest_path!,
      restoreDir
    );

    expect(restoreResult.success).toBe(false);
    expect(restoreResult.signature_verified).toBe(false);
    expect(restoreResult.error).toContain('invalida');
  });

  test('backup sem chave nao e assinado', async () => {
    // Temporariamente remover chaves
    const savedKey = process.env[ENV_PRIVATE_KEY];
    delete process.env[ENV_PRIVATE_KEY];

    const dataDir = path.join(TEST_DATA_DIR, 'backup-sem-chave');
    const outputDir = path.join(TEST_DATA_DIR, 'backup-sem-chave-out');

    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'no_key_test', 'Test', 'test-4', {});

    const result = await createSecureBackup(dataDir, [outputDir]);

    expect(result.success).toBe(true);
    expect(result.signed).toBe(false);
    expect(result.manifest?.signature).toBeNull();

    // Restaurar chave
    process.env[ENV_PRIVATE_KEY] = savedKey;
  });
});

// ════════════════════════════════════════════════════════════════════════
// TESTES: AUTENTICACAO CONTROL-PLANE
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 9 - Autenticacao Control-Plane', () => {
  const originalToken = process.env.CONTROL_PLANE_TOKEN;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    _resetState();  // Reset rate limit state
  });

  afterAll(() => {
    if (originalToken) {
      process.env.CONTROL_PLANE_TOKEN = originalToken;
    } else {
      delete process.env.CONTROL_PLANE_TOKEN;
    }
    if (originalEnv) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  test('authenticate permite acesso em dev sem token', () => {
    delete process.env.CONTROL_PLANE_TOKEN;
    process.env.NODE_ENV = 'development';

    const mockReq = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    } as any;

    const result = authenticate(mockReq);

    expect(result.authenticated).toBe(true);
  });

  test('authenticate valida Bearer token corretamente', () => {
    const testToken = 'test-secret-token-123';
    process.env.CONTROL_PLANE_TOKEN = testToken;
    process.env.NODE_ENV = 'development';

    const mockReq = {
      headers: { authorization: `Bearer ${testToken}` },
      socket: { remoteAddress: '127.0.0.1' }
    } as any;

    const result = authenticate(mockReq);

    expect(result.authenticated).toBe(true);
  });

  test('authenticate rejeita token invalido', () => {
    process.env.CONTROL_PLANE_TOKEN = 'correct-token';
    process.env.NODE_ENV = 'development';

    const mockReq = {
      headers: { authorization: 'Bearer wrong-token' },
      socket: { remoteAddress: '127.0.0.1' }
    } as any;

    const result = authenticate(mockReq);

    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('Invalid');
  });

  test('authenticate rejeita formato invalido', () => {
    process.env.CONTROL_PLANE_TOKEN = 'test-token';
    process.env.NODE_ENV = 'development';

    const mockReq = {
      headers: { authorization: 'Basic test-token' },  // Formato errado
      socket: { remoteAddress: '127.0.0.1' }
    } as any;

    const result = authenticate(mockReq);

    expect(result.authenticated).toBe(false);
    expect(result.reason).toContain('Invalid');
  });

  test('checkRateLimit funciona corretamente', () => {
    const ip = '192.168.1.100';

    // Primeiras requisicoes devem passar
    for (let i = 0; i < 100; i++) {
      const result = checkRateLimit(ip);
      expect(result.allowed).toBe(true);
    }

    // 101a requisicao deve ser bloqueada
    const blocked = checkRateLimit(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  test('validateProductionRequirements falha sem token em prod', () => {
    delete process.env.CONTROL_PLANE_TOKEN;
    process.env.NODE_ENV = 'production';

    const result = validateProductionRequirements();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('TOKEN');
  });

  test('validateProductionRequirements passa com token em prod', () => {
    process.env.CONTROL_PLANE_TOKEN = 'prod-token';
    process.env.NODE_ENV = 'production';

    const result = validateProductionRequirements();

    expect(result.valid).toBe(true);
  });

  test('getSecurityMetrics retorna metricas validas', () => {
    const metrics = getSecurityMetrics();

    expect(metrics).toHaveProperty('failedAttemptsLast24h');
    expect(metrics).toHaveProperty('failedAttemptsByIp');
    expect(metrics).toHaveProperty('rateLimitActiveIps');
    expect(typeof metrics.failedAttemptsLast24h).toBe('number');
  });
});

// ════════════════════════════════════════════════════════════════════════
// TESTES: MULTI-DESTINO
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 9 - Backup Multi-Destino', () => {
  let testKeyPair: KeyPair;

  beforeAll(() => {
    testKeyPair = generateKeyPair();
    process.env[ENV_PRIVATE_KEY] = testKeyPair.privateKey;
    process.env[ENV_PUBLIC_KEY] = testKeyPair.publicKey;
    process.env[ENV_KEY_ID] = testKeyPair.keyId;
  });

  afterAll(() => {
    delete process.env[ENV_PRIVATE_KEY];
    delete process.env[ENV_PUBLIC_KEY];
    delete process.env[ENV_KEY_ID];
  });

  test('backup copia para multiplos destinos locais', async () => {
    const dataDir = path.join(TEST_DATA_DIR, 'multi-dest-source');
    const dest1 = path.join(TEST_DATA_DIR, 'multi-dest-1');
    const dest2 = path.join(TEST_DATA_DIR, 'multi-dest-2');

    // Criar EventLog
    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'multi_dest_test', 'Test', 'test-multi', {});

    // Backup para dois destinos
    const result = await createSecureBackup(dataDir, [dest1, dest2]);

    expect(result.success).toBe(true);
    expect(result.destinations.length).toBe(2);
    expect(result.destinations[0].success).toBe(true);
    expect(result.destinations[0].type).toBe('local');
    expect(result.destinations[1].success).toBe(true);
    expect(result.destinations[1].type).toBe('local');

    // Verificar arquivos em ambos destinos
    const files1 = await fs.readdir(dest1);
    const files2 = await fs.readdir(dest2);

    expect(files1.some(f => f.endsWith('.tar.gz'))).toBe(true);
    expect(files1.some(f => f.endsWith('.signed.json'))).toBe(true);
    expect(files2.some(f => f.endsWith('.tar.gz'))).toBe(true);
    expect(files2.some(f => f.endsWith('.signed.json'))).toBe(true);
  });

  test('backup registra falha de destino remoto', async () => {
    const dataDir = path.join(TEST_DATA_DIR, 'remote-fail-source');
    const destLocal = path.join(TEST_DATA_DIR, 'remote-fail-local');

    await fs.mkdir(dataDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    await eventLog.append('Libervia', 'remote_test', 'Test', 'test-remote', {});

    // Tentar backup para destino S3 (sem credenciais)
    const result = await createSecureBackup(dataDir, [destLocal, 's3://fake-bucket/path']);

    expect(result.success).toBe(true);  // Local deve funcionar
    expect(result.destinations.length).toBe(2);
    expect(result.destinations[0].success).toBe(true);  // Local OK
    expect(result.destinations[1].success).toBe(false);  // S3 falha
    expect(result.destinations[1].error).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// TESTES: INTEGRACAO
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 9 - Integracao', () => {
  let testKeyPair: KeyPair;

  beforeAll(() => {
    testKeyPair = generateKeyPair();
    process.env[ENV_PRIVATE_KEY] = testKeyPair.privateKey;
    process.env[ENV_PUBLIC_KEY] = testKeyPair.publicKey;
    process.env[ENV_KEY_ID] = testKeyPair.keyId;
  });

  afterAll(() => {
    delete process.env[ENV_PRIVATE_KEY];
    delete process.env[ENV_PUBLIC_KEY];
    delete process.env[ENV_KEY_ID];
  });

  test('fluxo completo: backup assinado -> restauracao verificada', async () => {
    const sourceDir = path.join(TEST_DATA_DIR, 'full-flow-source');
    const backupDir = path.join(TEST_DATA_DIR, 'full-flow-backup');
    const restoreDir = path.join(TEST_DATA_DIR, 'full-flow-restore');

    // 1. Criar EventLog com dados
    await fs.mkdir(sourceDir, { recursive: true });
    const eventLog = await EventLogRepositoryImpl.create(sourceDir);

    for (let i = 0; i < 5; i++) {
      await eventLog.append('Libervia', 'flow_test', 'FlowTest', `test-${i}`, { index: i });
    }

    const originalCount = await eventLog.count();
    expect(originalCount).toBe(5);

    // 2. Criar backup assinado
    const backupResult = await createSecureBackup(sourceDir, [backupDir]);

    expect(backupResult.success).toBe(true);
    expect(backupResult.signed).toBe(true);

    // 3. Restaurar em novo diretorio
    const restoreResult = await restoreSecureBackup(
      backupResult.archive_path!,
      backupResult.manifest_path!,
      restoreDir
    );

    expect(restoreResult.success).toBe(true);
    expect(restoreResult.signature_verified).toBe(true);
    expect(restoreResult.chain_valid).toBe(true);
    expect(restoreResult.events_restored).toBe(5);

    // 4. Verificar dados restaurados
    const restoredEventLog = await EventLogRepositoryImpl.create(restoreDir);
    const restoredCount = await restoredEventLog.count();

    expect(restoredCount).toBe(originalCount);
  });
});
