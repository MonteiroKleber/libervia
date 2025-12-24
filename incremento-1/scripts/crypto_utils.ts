/**
 * CRYPTO UTILITIES
 *
 * Utilitarios de criptografia para assinatura digital de backups.
 * Usa Ed25519 via Node crypto (disponivel desde Node 15+).
 *
 * PRINCIPIOS:
 * - Chaves privadas NUNCA ficam no repo
 * - Usar env vars ou secrets manager em producao
 * - Fallback para modo nao-assinado se chave ausente
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

export interface KeyPair {
  publicKey: string;    // Base64
  privateKey: string;   // Base64
  keyId: string;        // Identificador unico
  createdAt: string;
  expiresAt: string;
}

export interface Signature {
  algorithm: 'ed25519';
  public_key_id: string;
  signature: string;      // Base64
  signed_at: string;
}

export interface SignedData<T> {
  data: T;
  signature: Signature;
}

export interface VerificationResult {
  valid: boolean;
  keyId?: string;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════════════

const KEY_VALIDITY_DAYS = 365;
const ENV_PRIVATE_KEY = 'LIBERVIA_SIGNING_KEY';
const ENV_PUBLIC_KEY = 'LIBERVIA_PUBLIC_KEY';
const ENV_KEY_ID = 'LIBERVIA_KEY_ID';

// ════════════════════════════════════════════════════════════════════════
// GERACAO DE CHAVES
// ════════════════════════════════════════════════════════════════════════

/**
 * Gera novo par de chaves Ed25519
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });

  const keyId = crypto.randomBytes(8).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + KEY_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
    keyId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString()
  };
}

/**
 * Exporta par de chaves para arquivo (apenas chave publica no repo)
 */
export async function exportKeyPair(
  keyPair: KeyPair,
  outputDir: string
): Promise<{ publicKeyPath: string; privateKeyPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const publicKeyPath = path.join(outputDir, `public-key-${keyPair.keyId}.json`);
  const privateKeyPath = path.join(outputDir, `private-key-${keyPair.keyId}.json`);

  // Chave publica (pode ir no repo)
  await fs.writeFile(publicKeyPath, JSON.stringify({
    keyId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    createdAt: keyPair.createdAt,
    expiresAt: keyPair.expiresAt
  }, null, 2));

  // Chave privada (NUNCA no repo - apenas para geracao inicial)
  await fs.writeFile(privateKeyPath, JSON.stringify({
    keyId: keyPair.keyId,
    privateKey: keyPair.privateKey,
    createdAt: keyPair.createdAt,
    expiresAt: keyPair.expiresAt,
    WARNING: 'NUNCA COMMITAR ESTE ARQUIVO'
  }, null, 2));

  return { publicKeyPath, privateKeyPath };
}

// ════════════════════════════════════════════════════════════════════════
// CARREGAMENTO DE CHAVES
// ════════════════════════════════════════════════════════════════════════

/**
 * Carrega chave privada do ambiente
 */
export function loadPrivateKeyFromEnv(): { privateKey: crypto.KeyObject; keyId: string } | null {
  const privateKeyBase64 = process.env[ENV_PRIVATE_KEY];
  const keyId = process.env[ENV_KEY_ID] || 'env-key';

  if (!privateKeyBase64) {
    return null;
  }

  try {
    const privateKeyDer = Buffer.from(privateKeyBase64, 'base64');
    const privateKey = crypto.createPrivateKey({
      key: privateKeyDer,
      format: 'der',
      type: 'pkcs8'
    });

    return { privateKey, keyId };
  } catch (error) {
    console.error('[Crypto] Erro ao carregar chave privada:', error);
    return null;
  }
}

/**
 * Carrega chave publica do ambiente ou arquivo
 */
export function loadPublicKeyFromEnv(): { publicKey: crypto.KeyObject; keyId: string } | null {
  const publicKeyBase64 = process.env[ENV_PUBLIC_KEY];
  const keyId = process.env[ENV_KEY_ID] || 'env-key';

  if (!publicKeyBase64) {
    return null;
  }

  try {
    const publicKeyDer = Buffer.from(publicKeyBase64, 'base64');
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    return { publicKey, keyId };
  } catch (error) {
    console.error('[Crypto] Erro ao carregar chave publica:', error);
    return null;
  }
}

/**
 * Carrega chave publica de arquivo JSON
 */
export async function loadPublicKeyFromFile(
  filePath: string
): Promise<{ publicKey: crypto.KeyObject; keyId: string } | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const publicKeyDer = Buffer.from(data.publicKey, 'base64');
    const publicKey = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki'
    });

    return { publicKey, keyId: data.keyId };
  } catch (error) {
    console.error('[Crypto] Erro ao carregar chave de arquivo:', error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// ASSINATURA
// ════════════════════════════════════════════════════════════════════════

/**
 * Serializa dados para JSON canonico (ordenado, sem espacos)
 */
export function canonicalize(data: any): string {
  return JSON.stringify(data, Object.keys(data).sort(), 0);
}

/**
 * Calcula hash SHA-256 de string
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Assina dados com chave privada Ed25519
 */
export function sign(
  data: any,
  privateKey: crypto.KeyObject,
  keyId: string
): Signature {
  const canonical = canonicalize(data);
  const signature = crypto.sign(null, Buffer.from(canonical), privateKey);

  return {
    algorithm: 'ed25519',
    public_key_id: keyId,
    signature: signature.toString('base64'),
    signed_at: new Date().toISOString()
  };
}

/**
 * Assina dados usando chave do ambiente
 */
export function signWithEnvKey(data: any): Signature | null {
  const keyInfo = loadPrivateKeyFromEnv();
  if (!keyInfo) {
    return null;
  }

  return sign(data, keyInfo.privateKey, keyInfo.keyId);
}

/**
 * Cria objeto assinado
 */
export function createSignedData<T>(data: T, signature: Signature): SignedData<T> {
  return { data, signature };
}

// ════════════════════════════════════════════════════════════════════════
// VERIFICACAO
// ════════════════════════════════════════════════════════════════════════

/**
 * Verifica assinatura com chave publica
 */
export function verify(
  data: any,
  signature: Signature,
  publicKey: crypto.KeyObject
): VerificationResult {
  try {
    const canonical = canonicalize(data);
    const signatureBuffer = Buffer.from(signature.signature, 'base64');

    const isValid = crypto.verify(
      null,
      Buffer.from(canonical),
      publicKey,
      signatureBuffer
    );

    return {
      valid: isValid,
      keyId: signature.public_key_id
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Verifica assinatura usando chave do ambiente
 */
export function verifyWithEnvKey(data: any, signature: Signature): VerificationResult {
  const keyInfo = loadPublicKeyFromEnv();
  if (!keyInfo) {
    return {
      valid: false,
      error: 'Chave publica nao disponivel no ambiente'
    };
  }

  return verify(data, signature, keyInfo.publicKey);
}

/**
 * Verifica dados assinados
 */
export function verifySignedData<T>(
  signedData: SignedData<T>,
  publicKey: crypto.KeyObject
): VerificationResult {
  return verify(signedData.data, signedData.signature, publicKey);
}

// ════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════

/**
 * Verifica se chave esta expirada
 */
export function isKeyExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

/**
 * Calcula dias ate expiracao
 */
export function daysUntilExpiry(expiresAt: string): number {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diff = expires.getTime() - now.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

/**
 * Gera token de autenticacao seguro
 */
export function generateAuthToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Compara tokens de forma segura (constant-time)
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════

export {
  ENV_PRIVATE_KEY,
  ENV_PUBLIC_KEY,
  ENV_KEY_ID,
  KEY_VALIDITY_DAYS
};

// ════════════════════════════════════════════════════════════════════════
// CLI (para geracao de chaves)
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'generate': {
      const outputDir = args[1] || './keys';
      console.log('Gerando par de chaves Ed25519...');

      const keyPair = generateKeyPair();
      const { publicKeyPath, privateKeyPath } = await exportKeyPair(keyPair, outputDir);

      console.log(`\nChave publica: ${publicKeyPath}`);
      console.log(`Chave privada: ${privateKeyPath}`);
      console.log(`\nKey ID: ${keyPair.keyId}`);
      console.log(`Expira em: ${keyPair.expiresAt}`);
      console.log('\n⚠️  IMPORTANTE: Nunca commitar a chave privada!');
      console.log('\nPara usar em producao, configure as env vars:');
      console.log(`  export ${ENV_PRIVATE_KEY}="${keyPair.privateKey}"`);
      console.log(`  export ${ENV_PUBLIC_KEY}="${keyPair.publicKey}"`);
      console.log(`  export ${ENV_KEY_ID}="${keyPair.keyId}"`);
      break;
    }

    case 'verify': {
      const filePath = args[1];
      if (!filePath) {
        console.error('Uso: crypto_utils.ts verify <manifest.json>');
        process.exit(1);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const signedData = JSON.parse(content);

      if (!signedData.signature) {
        console.log('Manifest nao assinado');
        process.exit(0);
      }

      const result = verifyWithEnvKey(signedData.data || signedData.manifest, signedData.signature);
      if (result.valid) {
        console.log(`✓ Assinatura valida (key: ${result.keyId})`);
        process.exit(0);
      } else {
        console.error(`✗ Assinatura invalida: ${result.error}`);
        process.exit(1);
      }
    }

    default:
      console.log('Uso:');
      console.log('  ts-node crypto_utils.ts generate [output-dir]');
      console.log('  ts-node crypto_utils.ts verify <manifest.json>');
      process.exit(0);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Erro:', error);
    process.exit(1);
  });
}
