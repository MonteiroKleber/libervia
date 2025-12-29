// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: IMPLEMENTAÇÃO DO REPOSITÓRIO DE BACKUPS
// ════════════════════════════════════════════════════════════════════════

import * as fs from 'fs/promises';
import * as path from 'path';
import { BackupRepository } from './BackupRepository';
import { BackupSnapshot, BackupFileInfo } from './BackupTypes';
import { BackupNotFoundError, BackupFormatError } from './BackupErrors';
import { generateBackupFilename, BACKUP_FORMAT_VERSION } from './BackupCrypto';
import { normalizeBackupMetadata, validateBackupStructure } from './BackupMetadata';

/**
 * Implementação do repositório de backups usando sistema de arquivos.
 *
 * Características:
 * - Escrita atômica (via .tmp + rename)
 * - Controle de concorrência via fila interna
 * - Recuperação de crash (verifica .tmp pendentes)
 */
class BackupRepositoryImpl implements BackupRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private backupDir: string) {}

  /**
   * Garante que o diretório de backups existe.
   */
  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
  }

  /**
   * Gera caminho completo para um arquivo de backup.
   */
  private getFilePath(filename: string): string {
    return path.join(this.backupDir, filename);
  }

  /**
   * Extrai ID do backup do nome do arquivo.
   */
  private extractBackupIdFromFilename(filename: string): string | null {
    // Formato: backup_<tenantId>_<timestamp>.json
    const match = filename.match(/^backup_(.+)_\d{8}-\d{6}\.json$/);
    return match ? `backup_${match[1]}` : null;
  }

  async save(snapshot: BackupSnapshot): Promise<string> {
    await this.ensureDirectory();

    const filename = generateBackupFilename(
      snapshot.metadata.tenantId,
      snapshot.metadata.createdAt
    );
    const filePath = this.getFilePath(filename);
    const tmpPath = filePath + '.tmp';

    // Serializar com datas em ISO format
    const serialized = JSON.stringify(snapshot, (key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }, 2);

    // Escrita atômica com fila para evitar race conditions
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.writeFile(tmpPath, serialized, 'utf-8');
      await fs.rename(tmpPath, filePath);
    });

    await this.writeChain;
    return filePath;
  }

  async load(backupId: string): Promise<BackupSnapshot | null> {
    const files = await this.list();
    const file = files.find(f =>
      f.metadata?.backupId === backupId
    );

    if (!file) {
      return null;
    }

    return this.loadFromPath(file.path);
  }

  async loadFromPath(filePath: string): Promise<BackupSnapshot | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Validar estrutura
      const validation = validateBackupStructure(parsed);
      if (!validation.valid) {
        throw new BackupFormatError(
          `Backup inválido: ${validation.errors.join(', ')}`
        );
      }

      // Normalizar metadados (converter datas)
      const snapshot: BackupSnapshot = {
        ...parsed,
        metadata: normalizeBackupMetadata(parsed.metadata)
      };

      return snapshot;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async list(tenantId?: string): Promise<BackupFileInfo[]> {
    await this.ensureDirectory();

    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files.filter(f =>
        f.startsWith('backup_') && f.endsWith('.json') && !f.endsWith('.tmp')
      );

      const infos: BackupFileInfo[] = [];

      for (const filename of backupFiles) {
        const filePath = this.getFilePath(filename);

        try {
          const stat = await fs.stat(filePath);
          const info: BackupFileInfo = {
            filename,
            path: filePath,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime
          };

          // Tentar extrair metadados
          try {
            const snapshot = await this.loadFromPath(filePath);
            if (snapshot) {
              info.metadata = snapshot.metadata;
            }
          } catch {
            // Ignorar erros de parsing para listagem
          }

          // Filtrar por tenant se especificado
          if (tenantId) {
            if (info.metadata?.tenantId === tenantId) {
              infos.push(info);
            }
          } else {
            infos.push(info);
          }
        } catch {
          // Ignorar arquivos com erro de stat
        }
      }

      // Ordenar por data de modificação (mais recente primeiro)
      infos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

      return infos;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async exists(backupId: string): Promise<boolean> {
    const snapshot = await this.load(backupId);
    return snapshot !== null;
  }

  async delete(backupId: string): Promise<boolean> {
    const files = await this.list();
    const file = files.find(f => f.metadata?.backupId === backupId);

    if (!file) {
      return false;
    }

    try {
      await fs.unlink(file.path);
      return true;
    } catch {
      return false;
    }
  }

  getBackupDirectory(): string {
    return this.backupDir;
  }

  /**
   * Limpa arquivos temporários (.tmp) de backups incompletos.
   */
  async cleanupTempFiles(): Promise<number> {
    await this.ensureDirectory();

    const files = await fs.readdir(this.backupDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    let cleaned = 0;

    for (const tmpFile of tmpFiles) {
      try {
        await fs.unlink(this.getFilePath(tmpFile));
        cleaned++;
      } catch {
        // Ignorar erros de limpeza
      }
    }

    return cleaned;
  }
}

export { BackupRepositoryImpl };
