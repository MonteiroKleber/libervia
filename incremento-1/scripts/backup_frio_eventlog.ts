#!/usr/bin/env ts-node
/**
 * BACKUP FRIO - EventLog
 *
 * Script para criar backup frio (cold backup) do EventLog com:
 * - Exportacao de todos os segmentos e snapshot
 * - Empacotamento em tar.gz com manifest de integridade
 * - Checksums SHA-256 para verificacao
 *
 * Uso: ts-node scripts/backup_frio_eventlog.ts [DATA_DIR] [OUTPUT_DIR]
 *
 * Exemplo:
 *   ts-node scripts/backup_frio_eventlog.ts ./data ./backups
 *
 * Output:
 *   ./backups/backup-eventlog-YYYYMMDD-HHMMSS.tar.gz
 *   ./backups/backup-eventlog-YYYYMMDD-HHMMSS.manifest.json
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as archiver from 'archiver';

// Imports do projeto
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';

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
  version: 1;
  created_at: string;
  source_dir: string;
  files: BackupFileInfo[];
  eventlog_summary: EventLogSummary;
  chain_valid_at_backup: boolean;
}

interface BackupResult {
  success: boolean;
  archive_path: string | null;
  manifest_path: string | null;
  manifest: BackupManifest | null;
  error?: string;
}

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

const DATA_DIR = process.argv[2] || './data';
const OUTPUT_DIR = process.argv[3] || './backup-out';

// ════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════

function log(msg: string): void {
  console.log(msg);
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

// ════════════════════════════════════════════════════════════════════════
// BACKUP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════

async function createBackup(dataDir: string, outputDir: string): Promise<BackupResult> {
  const timestamp = formatTimestamp();
  const archiveName = `backup-eventlog-${timestamp}.tar.gz`;
  const manifestName = `backup-eventlog-${timestamp}.manifest.json`;

  try {
    // 1. Verificar diretorio de origem
    const eventLogDir = path.join(dataDir, 'event-log');
    const snapshotPath = path.join(dataDir, 'event-log-snapshot.json');

    const eventLogDirExists = await fileExists(eventLogDir);
    if (!eventLogDirExists) {
      return {
        success: false,
        archive_path: null,
        manifest_path: null,
        manifest: null,
        error: `Diretorio EventLog nao encontrado: ${eventLogDir}`
      };
    }

    // 2. Criar diretorio de saida
    await fs.mkdir(outputDir, { recursive: true });

    // 3. Inicializar EventLog para verificacao
    log('1. Verificando integridade do EventLog...');
    const eventLog = await EventLogRepositoryImpl.create(dataDir);
    const verifyResult = await eventLog.verifyChain();
    const totalEvents = await eventLog.count();
    const lastEntry = await eventLog.getLastEntry();
    const allEntries = await eventLog.getAll();
    const firstEntry = allEntries.length > 0 ? allEntries[0] : null;

    log(`   - Cadeia valida: ${verifyResult.valid}`);
    log(`   - Total de eventos: ${totalEvents}`);

    // 4. Listar arquivos de segmento
    const files = await fs.readdir(eventLogDir);
    const segmentFiles = files
      .filter(f => f.startsWith('segment-') && f.endsWith('.json'))
      .sort();

    log(`   - Segmentos: ${segmentFiles.length}`);

    // 5. Coletar informacoes dos arquivos
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

    // 6. Criar manifest
    const manifest: BackupManifest = {
      version: 1,
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

    // 7. Criar arquivo tar.gz
    log('');
    log('3. Criando pacote compactado...');

    const archivePath = path.join(outputDir, archiveName);
    const manifestPath = path.join(outputDir, manifestName);

    await createTarGz(dataDir, archivePath, segmentFiles, snapshotExists);

    const archiveSize = await getFileSize(archivePath);
    log(`   - ${archiveName} (${formatBytes(archiveSize)})`);

    // 8. Salvar manifest
    log('');
    log('4. Gerando manifest...');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    log(`   - ${manifestName}`);

    return {
      success: true,
      archive_path: archivePath,
      manifest_path: manifestPath,
      manifest
    };

  } catch (error: any) {
    return {
      success: false,
      archive_path: null,
      manifest_path: null,
      manifest: null,
      error: error.message
    };
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

// ════════════════════════════════════════════════════════════════════════
// RESTAURACAO
// ════════════════════════════════════════════════════════════════════════

interface RestoreResult {
  success: boolean;
  events_restored: number;
  chain_valid: boolean;
  error?: string;
}

/**
 * Restaura EventLog a partir de um backup.
 * Extrai arquivos e valida integridade.
 *
 * @param archivePath Caminho do arquivo tar.gz
 * @param manifestPath Caminho do manifest JSON
 * @param destDir Diretorio de destino
 * @param overwrite Se true, sobrescreve arquivos existentes
 */
async function restoreBackup(
  archivePath: string,
  manifestPath: string,
  destDir: string,
  overwrite: boolean = false
): Promise<RestoreResult> {
  try {
    // 1. Verificar arquivos de backup
    if (!await fileExists(archivePath)) {
      return {
        success: false,
        events_restored: 0,
        chain_valid: false,
        error: `Arquivo de backup nao encontrado: ${archivePath}`
      };
    }

    if (!await fileExists(manifestPath)) {
      return {
        success: false,
        events_restored: 0,
        chain_valid: false,
        error: `Manifest nao encontrado: ${manifestPath}`
      };
    }

    // 2. Carregar manifest
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: BackupManifest = JSON.parse(manifestContent);

    // 3. Verificar se destino existe
    const destExists = await fileExists(destDir);
    if (destExists && !overwrite) {
      // Verificar se tem arquivos do EventLog
      const eventLogDir = path.join(destDir, 'event-log');
      if (await fileExists(eventLogDir)) {
        return {
          success: false,
          events_restored: 0,
          chain_valid: false,
          error: `Diretorio de destino ja contem EventLog. Use overwrite=true para sobrescrever.`
        };
      }
    }

    // 4. Criar diretorio de destino
    await fs.mkdir(destDir, { recursive: true });
    await fs.mkdir(path.join(destDir, 'event-log'), { recursive: true });

    // 5. Extrair arquivo
    await extractTarGz(archivePath, destDir);

    // 6. Verificar checksums
    for (const fileInfo of manifest.files) {
      const filePath = path.join(destDir, fileInfo.path);

      if (!await fileExists(filePath)) {
        return {
          success: false,
          events_restored: 0,
          chain_valid: false,
          error: `Arquivo nao encontrado apos extracao: ${fileInfo.path}`
        };
      }

      const actualSha256 = await computeFileSha256(filePath);
      if (actualSha256 !== fileInfo.sha256) {
        return {
          success: false,
          events_restored: 0,
          chain_valid: false,
          error: `Checksum invalido para ${fileInfo.path}. Esperado: ${fileInfo.sha256}, Atual: ${actualSha256}`
        };
      }
    }

    // 7. Verificar integridade da cadeia
    const eventLog = await EventLogRepositoryImpl.create(destDir);
    const verifyResult = await eventLog.verifyChain();
    const totalEvents = await eventLog.count();

    return {
      success: true,
      events_restored: totalEvents,
      chain_valid: verifyResult.valid
    };

  } catch (error: any) {
    return {
      success: false,
      events_restored: 0,
      chain_valid: false,
      error: error.message
    };
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  // Usar tar nativo do sistema para extrair
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`);
}

// ════════════════════════════════════════════════════════════════════════
// VERIFICACAO DE MANIFEST
// ════════════════════════════════════════════════════════════════════════

interface VerifyManifestResult {
  valid: boolean;
  files_checked: number;
  files_valid: number;
  files_missing: string[];
  files_corrupted: string[];
}

/**
 * Verifica se os arquivos em um diretorio batem com o manifest.
 */
async function verifyManifest(
  manifestPath: string,
  dataDir: string
): Promise<VerifyManifestResult> {
  const result: VerifyManifestResult = {
    valid: true,
    files_checked: 0,
    files_valid: 0,
    files_missing: [],
    files_corrupted: []
  };

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest: BackupManifest = JSON.parse(manifestContent);

    for (const fileInfo of manifest.files) {
      result.files_checked++;
      const filePath = path.join(dataDir, fileInfo.path);

      if (!await fileExists(filePath)) {
        result.files_missing.push(fileInfo.path);
        result.valid = false;
        continue;
      }

      const actualSha256 = await computeFileSha256(filePath);
      if (actualSha256 !== fileInfo.sha256) {
        result.files_corrupted.push(fileInfo.path);
        result.valid = false;
        continue;
      }

      result.files_valid++;
    }

  } catch (error: any) {
    result.valid = false;
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS PARA TESTES
// ════════════════════════════════════════════════════════════════════════

export {
  createBackup,
  restoreBackup,
  verifyManifest,
  BackupManifest,
  BackupResult,
  RestoreResult,
  VerifyManifestResult,
  computeFileSha256,
  extractTarGz
};

// ════════════════════════════════════════════════════════════════════════
// MAIN (CLI)
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log('════════════════════════════════════════════════════════════════════════');
  log('BACKUP FRIO - EventLog');
  log('════════════════════════════════════════════════════════════════════════');
  log(`Data: ${new Date().toISOString()}`);
  log(`Origem: ${DATA_DIR}`);
  log(`Destino: ${OUTPUT_DIR}`);
  log('');

  const result = await createBackup(DATA_DIR, OUTPUT_DIR);

  log('');
  log('════════════════════════════════════════════════════════════════════════');

  if (result.success) {
    log('BACKUP COMPLETO');
    log(`Arquivo: ${result.archive_path}`);
    log(`Manifest: ${result.manifest_path}`);

    if (result.manifest) {
      const totalSize = result.manifest.files.reduce((sum, f) => sum + f.size, 0);
      log(`Tamanho original: ${formatBytes(totalSize)}`);
      log(`Eventos: ${result.manifest.eventlog_summary.total_events}`);
      log(`Cadeia valida: ${result.manifest.chain_valid_at_backup}`);
    }
  } else {
    log('BACKUP FALHOU');
    log(`Erro: ${result.error}`);
    process.exit(1);
  }

  log('════════════════════════════════════════════════════════════════════════');
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  main().catch(err => {
    console.error('ERRO:', err);
    process.exit(1);
  });
}
