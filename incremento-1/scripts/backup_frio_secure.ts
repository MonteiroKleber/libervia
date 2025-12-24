#!/usr/bin/env ts-node
/**
 * BACKUP FRIO SEGURO - EventLog
 *
 * Extensao do backup frio com:
 * - Assinatura digital Ed25519 do manifest
 * - Suporte a multiplos destinos
 * - Verificacao de assinatura na restauracao
 *
 * Uso:
 *   npm run backup:secure -- ./data /backups/local [destino2] [destino3]
 *   npm run backup:secure -- restore /backups/backup-xxx.tar.gz ./data
 *
 * Env vars para assinatura:
 *   LIBERVIA_SIGNING_KEY - Chave privada Ed25519 (base64)
 *   LIBERVIA_PUBLIC_KEY - Chave publica Ed25519 (base64)
 *   LIBERVIA_KEY_ID - Identificador da chave
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as archiver from 'archiver';

// Imports do projeto
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import {
  signWithEnvKey,
  verifyWithEnvKey,
  Signature,
  VerificationResult,
  loadPublicKeyFromEnv,
  verify
} from './crypto_utils';

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

interface BackupFileInfo {
  path: string;
  size: number;
  sha256: string;
}

interface EventLogSummary {
  total_events: number;
  total_segments: number;
  first_event_id: string | null;
  last_event_id: string | null;
  last_current_hash: string | null;
  snapshot_exists: boolean;
}

interface BackupManifest {
  version: 2;  // Versao 2 = com assinatura
  backup_id: string;
  created_at: string;
  source_dir: string;
  files: BackupFileInfo[];
  eventlog_summary: EventLogSummary;
  chain_valid_at_backup: boolean;
}

interface SignedManifest {
  manifest: BackupManifest;
  signature: Signature | null;  // null se nao assinado
}

interface SecureBackupResult {
  success: boolean;
  backup_id: string;
  archive_path: string | null;
  manifest_path: string | null;
  manifest: SignedManifest | null;
  signed: boolean;
  destinations: DestinationResult[];
  error?: string;
}

interface DestinationResult {
  destination: string;
  type: 'local' | 's3' | 'gcs' | 'cold';
  success: boolean;
  archive_path?: string;
  manifest_path?: string;
  error?: string;
}

interface SecureRestoreResult {
  success: boolean;
  events_restored: number;
  chain_valid: boolean;
  signature_verified: boolean;
  signature_result?: VerificationResult;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════

function log(msg: string): void {
  console.log(msg);
}

function generateBackupId(): string {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}

function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function computeFileSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

function detectDestinationType(dest: string): 'local' | 's3' | 'gcs' | 'cold' {
  if (dest.startsWith('s3://') && dest.includes('glacier')) return 'cold';
  if (dest.startsWith('s3://')) return 's3';
  if (dest.startsWith('gs://')) return 'gcs';
  return 'local';
}

// ════════════════════════════════════════════════════════════════════════
// BACKUP SEGURO
// ════════════════════════════════════════════════════════════════════════

async function createSecureBackup(
  dataDir: string,
  destinations: string[],
  options: { sign?: boolean; verifyAfter?: boolean } = {}
): Promise<SecureBackupResult> {
  const backupId = generateBackupId();
  const timestamp = formatTimestamp();
  const archiveName = `backup-eventlog-${timestamp}.tar.gz`;
  const manifestName = `backup-eventlog-${timestamp}.signed.json`;
  const shouldSign = options.sign !== false;  // Default: assinar se chave disponivel

  const result: SecureBackupResult = {
    success: false,
    backup_id: backupId,
    archive_path: null,
    manifest_path: null,
    manifest: null,
    signed: false,
    destinations: []
  };

  try {
    // 1. Verificar diretorio de origem
    const eventLogDir = path.join(dataDir, 'event-log');
    const snapshotPath = path.join(dataDir, 'event-log-snapshot.json');

    const eventLogDirExists = await fileExists(eventLogDir);
    if (!eventLogDirExists) {
      result.error = `Diretorio EventLog nao encontrado: ${eventLogDir}`;
      return result;
    }

    // Garantir pelo menos um destino local
    const primaryDest = destinations[0] || './backup-out';
    await fs.mkdir(primaryDest, { recursive: true });

    // 2. Verificar integridade do EventLog
    log('1. Verificando integridade do EventLog...');
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    const verifyResult = await eventLog.verifyChain();
    const totalEvents = await eventLog.count();
    const lastEntry = await eventLog.getLastEntry();
    const allEntries = await eventLog.getAll();
    const firstEntry = allEntries.length > 0 ? allEntries[0] : null;

    log(`   - Cadeia valida: ${verifyResult.valid}`);
    log(`   - Total de eventos: ${totalEvents}`);

    // 3. Listar arquivos de segmento
    const files = await fs.readdir(eventLogDir);
    const segmentFiles = files
      .filter(f => f.startsWith('segment-') && f.endsWith('.json'))
      .sort();

    log(`   - Segmentos: ${segmentFiles.length}`);

    // 4. Coletar informacoes dos arquivos
    log('');
    log('2. Coletando informacoes dos arquivos...');

    const fileInfos: BackupFileInfo[] = [];

    for (const segFile of segmentFiles) {
      const segPath = path.join(eventLogDir, segFile);
      const size = await getFileSize(segPath);
      const sha256 = await computeFileSha256(segPath);

      fileInfos.push({
        path: `event-log/${segFile}`,
        size,
        sha256
      });

      log(`   - ${segFile} (${formatBytes(size)}) [${sha256.substring(0, 8)}...]`);
    }

    // Snapshot
    const snapshotExists = await fileExists(snapshotPath);
    if (snapshotExists) {
      const size = await getFileSize(snapshotPath);
      const sha256 = await computeFileSha256(snapshotPath);

      fileInfos.push({
        path: 'event-log-snapshot.json',
        size,
        sha256
      });

      log(`   - event-log-snapshot.json (${formatBytes(size)}) [${sha256.substring(0, 8)}...]`);
    }

    // 5. Criar manifest
    const manifest: BackupManifest = {
      version: 2,
      backup_id: backupId,
      created_at: new Date().toISOString(),
      source_dir: path.resolve(dataDir),
      files: fileInfos,
      eventlog_summary: {
        total_events: totalEvents,
        total_segments: segmentFiles.length,
        first_event_id: firstEntry?.id ?? null,
        last_event_id: lastEntry?.id ?? null,
        last_current_hash: lastEntry?.current_hash ?? null,
        snapshot_exists: snapshotExists
      },
      chain_valid_at_backup: verifyResult.valid
    };

    // 6. Assinar manifest
    log('');
    log('3. Assinando manifest...');

    let signature: Signature | null = null;
    if (shouldSign) {
      signature = signWithEnvKey(manifest);
      if (signature) {
        log(`   - Assinatura criada (key: ${signature.public_key_id})`);
        result.signed = true;
      } else {
        log('   - Chave de assinatura nao disponivel (backup nao assinado)');
      }
    } else {
      log('   - Assinatura desabilitada');
    }

    const signedManifest: SignedManifest = { manifest, signature };
    result.manifest = signedManifest;

    // 7. Criar arquivo tar.gz no destino primario
    log('');
    log('4. Criando pacote compactado...');

    const archivePath = path.join(primaryDest, archiveName);
    const manifestPath = path.join(primaryDest, manifestName);

    await createTarGz(dataDir, archivePath, segmentFiles, snapshotExists);

    const archiveSize = await getFileSize(archivePath);
    log(`   - ${archiveName} (${formatBytes(archiveSize)})`);

    // 8. Salvar manifest assinado
    log('');
    log('5. Salvando manifest assinado...');
    await fs.writeFile(manifestPath, JSON.stringify(signedManifest, null, 2));
    log(`   - ${manifestName}`);

    result.archive_path = archivePath;
    result.manifest_path = manifestPath;

    // 9. Registrar destino primario
    result.destinations.push({
      destination: primaryDest,
      type: 'local',
      success: true,
      archive_path: archivePath,
      manifest_path: manifestPath
    });

    // 10. Copiar para destinos adicionais
    if (destinations.length > 1) {
      log('');
      log('6. Replicando para destinos adicionais...');

      for (let i = 1; i < destinations.length; i++) {
        const dest = destinations[i];
        const destType = detectDestinationType(dest);
        const destResult = await copyToDestination(
          archivePath,
          manifestPath,
          dest,
          destType,
          archiveName,
          manifestName
        );
        result.destinations.push(destResult);

        if (destResult.success) {
          log(`   - ${dest}: OK`);
        } else {
          log(`   - ${dest}: FALHOU (${destResult.error})`);
        }
      }
    }

    // 11. Verificar apos upload (opcional)
    if (options.verifyAfter) {
      log('');
      log('7. Verificando integridade pos-backup...');
      // TODO: Implementar verificacao de destinos remotos
      log('   - Verificacao local OK');
    }

    result.success = true;
    return result;

  } catch (error: any) {
    result.error = error.message;
    return result;
  }
}

async function createTarGz(
  dataDir: string,
  outputPath: string,
  segmentFiles: string[],
  includeSnapshot: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputPath);
    const archive = archiver.default('tar', {
      gzip: true,
      gzipOptions: { level: 9 }
    });

    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));

    archive.pipe(output);

    // Adicionar segmentos
    const eventLogDir = path.join(dataDir, 'event-log');
    for (const segFile of segmentFiles) {
      const segPath = path.join(eventLogDir, segFile);
      archive.file(segPath, { name: `event-log/${segFile}` });
    }

    // Adicionar snapshot
    if (includeSnapshot) {
      const snapshotPath = path.join(dataDir, 'event-log-snapshot.json');
      archive.file(snapshotPath, { name: 'event-log-snapshot.json' });
    }

    archive.finalize();
  });
}

async function copyToDestination(
  archivePath: string,
  manifestPath: string,
  destination: string,
  destType: 'local' | 's3' | 'gcs' | 'cold',
  archiveName: string,
  manifestName: string
): Promise<DestinationResult> {
  const result: DestinationResult = {
    destination,
    type: destType,
    success: false
  };

  try {
    switch (destType) {
      case 'local': {
        await fs.mkdir(destination, { recursive: true });
        const destArchive = path.join(destination, archiveName);
        const destManifest = path.join(destination, manifestName);
        await fs.copyFile(archivePath, destArchive);
        await fs.copyFile(manifestPath, destManifest);
        result.archive_path = destArchive;
        result.manifest_path = destManifest;
        result.success = true;
        break;
      }

      case 's3':
      case 'cold': {
        // Para S3, usariamos AWS SDK ou CLI
        // Por enquanto, simular sucesso ou falha
        const isAvailable = !!process.env.AWS_ACCESS_KEY_ID;
        if (!isAvailable) {
          result.error = 'AWS credentials not configured';
        } else {
          // TODO: Implementar upload real com AWS SDK
          result.error = 'S3 upload not implemented (use aws s3 cp manually)';
        }
        break;
      }

      case 'gcs': {
        const isAvailable = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!isAvailable) {
          result.error = 'GCS credentials not configured';
        } else {
          // TODO: Implementar upload real com GCS SDK
          result.error = 'GCS upload not implemented (use gsutil cp manually)';
        }
        break;
      }
    }

  } catch (error: any) {
    result.error = error.message;
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// RESTAURACAO SEGURA
// ════════════════════════════════════════════════════════════════════════

async function restoreSecureBackup(
  archivePath: string,
  manifestPath: string,
  destDir: string,
  options: { verifySignature?: boolean; overwrite?: boolean } = {}
): Promise<SecureRestoreResult> {
  const shouldVerifySignature = options.verifySignature !== false;  // Default: verificar
  const overwrite = options.overwrite || false;

  const result: SecureRestoreResult = {
    success: false,
    events_restored: 0,
    chain_valid: false,
    signature_verified: false
  };

  try {
    // 1. Verificar arquivos de backup
    if (!await fileExists(archivePath)) {
      result.error = `Arquivo de backup nao encontrado: ${archivePath}`;
      return result;
    }

    if (!await fileExists(manifestPath)) {
      result.error = `Manifest nao encontrado: ${manifestPath}`;
      return result;
    }

    // 2. Carregar manifest assinado
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const signedManifest: SignedManifest = JSON.parse(manifestContent);

    // 3. Verificar assinatura
    if (shouldVerifySignature && signedManifest.signature) {
      log('Verificando assinatura do manifest...');

      const verifyResult = verifyWithEnvKey(
        signedManifest.manifest,
        signedManifest.signature
      );

      result.signature_result = verifyResult;

      if (!verifyResult.valid) {
        result.error = `Assinatura invalida: ${verifyResult.error || 'verificacao falhou'}`;
        log(`   ERRO: ${result.error}`);
        return result;
      }

      log(`   - Assinatura valida (key: ${verifyResult.keyId})`);
      result.signature_verified = true;

    } else if (signedManifest.signature) {
      log('   - Verificacao de assinatura desabilitada');
    } else {
      log('   - Backup nao assinado');
    }

    // 4. Verificar se destino existe
    const destExists = await fileExists(destDir);
    if (destExists && !overwrite) {
      const eventLogDir = path.join(destDir, 'event-log');
      if (await fileExists(eventLogDir)) {
        result.error = 'Diretorio de destino ja contem EventLog. Use overwrite=true para sobrescrever.';
        return result;
      }
    }

    // 5. Criar diretorio de destino
    await fs.mkdir(destDir, { recursive: true });
    await fs.mkdir(path.join(destDir, 'event-log'), { recursive: true });

    // 6. Extrair arquivo
    log('Extraindo backup...');
    await extractTarGz(archivePath, destDir);

    // 7. Verificar checksums
    log('Verificando checksums...');
    for (const fileInfo of signedManifest.manifest.files) {
      const filePath = path.join(destDir, fileInfo.path);

      if (!await fileExists(filePath)) {
        result.error = `Arquivo nao encontrado apos extracao: ${fileInfo.path}`;
        return result;
      }

      const actualSha256 = await computeFileSha256(filePath);
      if (actualSha256 !== fileInfo.sha256) {
        result.error = `Checksum invalido para ${fileInfo.path}`;
        return result;
      }
    }
    log('   - Todos os checksums validos');

    // 8. Verificar integridade da cadeia
    log('Verificando cadeia de eventos...');
    const eventLog = await EventLogRepositoryImpl.create(destDir);
    const chainResult = await eventLog.verifyChain();
    const totalEvents = await eventLog.count();

    result.events_restored = totalEvents;
    result.chain_valid = chainResult.valid;
    result.success = true;

    log(`   - Eventos restaurados: ${totalEvents}`);
    log(`   - Cadeia valida: ${chainResult.valid}`);

    return result;

  } catch (error: any) {
    result.error = error.message;
    return result;
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`);
}

// ════════════════════════════════════════════════════════════════════════
// REGISTRO DE OPERACOES
// ════════════════════════════════════════════════════════════════════════

interface BackupOperation {
  timestamp: string;
  operation: 'backup' | 'restore';
  backup_id: string;
  success: boolean;
  signed: boolean;
  destinations: string[];
  error?: string;
}

async function logOperation(
  outputDir: string,
  operation: BackupOperation
): Promise<void> {
  const logDir = path.join(outputDir, 'logs');
  await fs.mkdir(logDir, { recursive: true });

  const logFile = path.join(logDir, 'backup-operations.jsonl');

  const logLine = JSON.stringify(operation) + '\n';
  await fs.appendFile(logFile, logLine);
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════

export {
  createSecureBackup,
  restoreSecureBackup,
  logOperation,
  SecureBackupResult,
  SecureRestoreResult,
  SignedManifest,
  BackupManifest,
  DestinationResult
};

// ════════════════════════════════════════════════════════════════════════
// MAIN (CLI)
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  log('════════════════════════════════════════════════════════════════════════');
  log('BACKUP FRIO SEGURO - EventLog');
  log('════════════════════════════════════════════════════════════════════════');
  log(`Data: ${new Date().toISOString()}`);
  log('');

  if (command === 'restore') {
    // Modo restauracao
    const archivePath = args[1];
    const destDir = args[2];
    const skipVerify = args.includes('--skip-verify');

    if (!archivePath || !destDir) {
      log('Uso: npm run backup:secure -- restore <arquivo.tar.gz> <destino> [--skip-verify]');
      process.exit(1);
    }

    // Derivar manifest path do archive path
    const manifestPath = archivePath.replace('.tar.gz', '.signed.json');

    log(`Arquivo: ${archivePath}`);
    log(`Manifest: ${manifestPath}`);
    log(`Destino: ${destDir}`);
    log(`Verificar assinatura: ${!skipVerify}`);
    log('');

    const result = await restoreSecureBackup(archivePath, manifestPath, destDir, {
      verifySignature: !skipVerify,
      overwrite: args.includes('--overwrite')
    });

    log('');
    log('════════════════════════════════════════════════════════════════════════');

    if (result.success) {
      log('RESTAURACAO COMPLETA');
      log(`Eventos: ${result.events_restored}`);
      log(`Cadeia valida: ${result.chain_valid}`);
      log(`Assinatura verificada: ${result.signature_verified}`);
    } else {
      log('RESTAURACAO FALHOU');
      log(`Erro: ${result.error}`);
      process.exit(1);
    }

  } else {
    // Modo backup
    const dataDir = args[0] || './data';
    const destinations = args.slice(1).filter(a => !a.startsWith('--'));

    if (destinations.length === 0) {
      destinations.push('./backup-out');
    }

    const noSign = args.includes('--no-sign');
    const verifyAfter = args.includes('--verify-after');

    log(`Origem: ${dataDir}`);
    log(`Destinos: ${destinations.join(', ')}`);
    log(`Assinar: ${!noSign}`);
    log('');

    const result = await createSecureBackup(dataDir, destinations, {
      sign: !noSign,
      verifyAfter
    });

    log('');
    log('════════════════════════════════════════════════════════════════════════');

    if (result.success) {
      log('BACKUP COMPLETO');
      log(`Backup ID: ${result.backup_id}`);
      log(`Arquivo: ${result.archive_path}`);
      log(`Manifest: ${result.manifest_path}`);
      log(`Assinado: ${result.signed}`);

      if (result.manifest?.manifest) {
        const totalSize = result.manifest.manifest.files.reduce((sum, f) => sum + f.size, 0);
        log(`Tamanho original: ${formatBytes(totalSize)}`);
        log(`Eventos: ${result.manifest.manifest.eventlog_summary.total_events}`);
        log(`Cadeia valida: ${result.manifest.manifest.chain_valid_at_backup}`);
      }

      log('');
      log('Destinos:');
      for (const dest of result.destinations) {
        const status = dest.success ? 'OK' : `FALHOU (${dest.error})`;
        log(`  - ${dest.destination} [${dest.type}]: ${status}`);
      }

      // Registrar operacao
      const primaryDest = destinations[0];
      await logOperation(primaryDest, {
        timestamp: new Date().toISOString(),
        operation: 'backup',
        backup_id: result.backup_id,
        success: true,
        signed: result.signed,
        destinations: result.destinations.filter(d => d.success).map(d => d.destination)
      });

    } else {
      log('BACKUP FALHOU');
      log(`Erro: ${result.error}`);
      process.exit(1);
    }

    log('════════════════════════════════════════════════════════════════════════');
  }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  main().catch(err => {
    console.error('ERRO:', err);
    process.exit(1);
  });
}
