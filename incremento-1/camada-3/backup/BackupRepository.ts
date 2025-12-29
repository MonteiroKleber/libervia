// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: INTERFACE DO REPOSITÓRIO DE BACKUPS
// ════════════════════════════════════════════════════════════════════════

import { BackupSnapshot, BackupFileInfo } from './BackupTypes';

/**
 * Interface para persistência de backups.
 * Implementações devem garantir escrita atômica e controle de concorrência.
 */
interface BackupRepository {
  /**
   * Salva um snapshot de backup.
   * @param snapshot - Snapshot a salvar
   * @returns Caminho do arquivo salvo
   */
  save(snapshot: BackupSnapshot): Promise<string>;

  /**
   * Carrega um backup por ID.
   * @param backupId - ID do backup
   * @returns Snapshot ou null se não encontrado
   */
  load(backupId: string): Promise<BackupSnapshot | null>;

  /**
   * Carrega um backup por caminho de arquivo.
   * @param filePath - Caminho do arquivo
   * @returns Snapshot ou null se não encontrado
   */
  loadFromPath(filePath: string): Promise<BackupSnapshot | null>;

  /**
   * Lista todos os backups disponíveis.
   * @param tenantId - Filtrar por tenant (opcional)
   * @returns Lista de informações de arquivos de backup
   */
  list(tenantId?: string): Promise<BackupFileInfo[]>;

  /**
   * Verifica se um backup existe.
   * @param backupId - ID do backup
   */
  exists(backupId: string): Promise<boolean>;

  /**
   * Remove um backup.
   * @param backupId - ID do backup
   * @returns true se removido, false se não existia
   */
  delete(backupId: string): Promise<boolean>;

  /**
   * Obtém o caminho do diretório de backups.
   */
  getBackupDirectory(): string;
}

export { BackupRepository };
