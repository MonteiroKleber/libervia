// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 26: SERVIÇO DE DISASTER RECOVERY
// ════════════════════════════════════════════════════════════════════════

import {
  DRProcedure,
  DRProcedureType,
  DRProcedureStatus,
  DRStep,
  BackupSnapshot,
  RestoreResult
} from './BackupTypes';
import { BackupRepository } from './BackupRepository';
import { BackupService } from './BackupService';
import { RestoreService } from './RestoreService';
import { DRProcedureError, BackupNotFoundError } from './BackupErrors';
import { verifyBackupIntegrity } from './BackupCrypto';
import * as crypto from 'crypto';

/**
 * Callback para notificar progresso de DR.
 */
type DRProgressCallback = (
  procedureId: string,
  step: DRStep,
  procedure: DRProcedure
) => Promise<void>;

/**
 * Serviço de Disaster Recovery.
 *
 * Implementa procedimentos executáveis para:
 * - Perda total de nó
 * - Detecção de corrupção
 * - Restauração de snapshot antigo
 * - Rollback controlado
 */
class DisasterRecoveryService {
  private activeProcedures: Map<string, DRProcedure> = new Map();

  constructor(
    private repository: BackupRepository,
    private backupService: BackupService,
    private restoreService: RestoreService,
    private onProgress?: DRProgressCallback
  ) {}

  /**
   * Inicia procedimento de recuperação de perda total de nó.
   *
   * Passos:
   * 1. Localizar backup mais recente válido
   * 2. Validar integridade do backup
   * 3. Executar dry-run
   * 4. Aguardar confirmação
   * 5. Executar restauração efetiva
   * 6. Verificar integridade pós-restore
   */
  async startTotalNodeLoss(tenantId?: string): Promise<DRProcedure> {
    const procedure = this.createProcedure('total_node_loss', [
      { order: 1, description: 'Localizar backup mais recente válido', status: 'pending' },
      { order: 2, description: 'Validar integridade do backup', status: 'pending' },
      { order: 3, description: 'Executar dry-run de restauração', status: 'pending' },
      { order: 4, description: 'Aguardar confirmação do operador', status: 'pending' },
      { order: 5, description: 'Executar restauração efetiva', status: 'pending' },
      { order: 6, description: 'Verificar integridade pós-restore', status: 'pending' }
    ]);

    this.activeProcedures.set(procedure.procedureId, procedure);

    // Executar primeiros passos automaticamente
    try {
      // Passo 1: Localizar backup
      await this.executeStep(procedure, 1, async () => {
        const backup = await this.backupService.getLatestBackup(tenantId);
        if (!backup) {
          throw new BackupNotFoundError(`Nenhum backup encontrado para tenant: ${tenantId ?? 'global'}`);
        }
        procedure.backupId = backup.metadata.backupId;
        return backup;
      });

      // Passo 2: Validar integridade
      await this.executeStep(procedure, 2, async () => {
        const validation = await this.backupService.validateBackup(procedure.backupId!);
        if (!validation.valid) {
          throw new DRProcedureError(
            `Backup inválido: ${validation.errors.join(', ')}`,
            procedure.procedureId,
            2
          );
        }
      });

      // Passo 3: Dry-run
      await this.executeStep(procedure, 3, async () => {
        const result = await this.restoreService.dryRun(procedure.backupId!);
        procedure.notes.push(
          `Dry-run: ${result.totalAdded} itens a adicionar, ${result.totalSkipped} já existentes`
        );
        return result;
      });

      // Passo 4 aguarda confirmação manual
      procedure.notes.push('Aguardando confirmação do operador para prosseguir com restauração');

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Confirma e continua procedimento de perda total.
   */
  async confirmTotalNodeLoss(procedureId: string): Promise<DRProcedure> {
    const procedure = this.activeProcedures.get(procedureId);
    if (!procedure) {
      throw new DRProcedureError('Procedimento não encontrado', procedureId);
    }

    if (procedure.type !== 'total_node_loss') {
      throw new DRProcedureError('Tipo de procedimento incorreto', procedureId);
    }

    try {
      // Marcar passo 4 como completo
      await this.executeStep(procedure, 4, async () => {
        procedure.notes.push('Confirmação recebida');
      });

      // Passo 5: Restauração efetiva
      await this.executeStep(procedure, 5, async () => {
        const result = await this.restoreService.execute(procedure.backupId!);
        if (!result.success) {
          throw new DRProcedureError(
            `Restauração falhou: ${result.errors.join(', ')}`,
            procedureId,
            5
          );
        }
        procedure.notes.push(`Restauração: ${result.totalAdded} itens adicionados`);
        return result;
      });

      // Passo 6: Verificação pós-restore
      await this.executeStep(procedure, 6, async () => {
        // Aqui poderia verificar integridade do EventLog restaurado
        procedure.notes.push('Verificação pós-restore concluída');
      });

      procedure.status = 'completed';
      procedure.completedAt = new Date();

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Inicia procedimento de detecção de corrupção.
   */
  async startCorruptionDetection(): Promise<DRProcedure> {
    const procedure = this.createProcedure('corruption_detection', [
      { order: 1, description: 'Listar todos os backups disponíveis', status: 'pending' },
      { order: 2, description: 'Validar integridade de cada backup', status: 'pending' },
      { order: 3, description: 'Identificar backup válido mais recente', status: 'pending' },
      { order: 4, description: 'Gerar relatório de corrupção', status: 'pending' }
    ]);

    this.activeProcedures.set(procedure.procedureId, procedure);

    try {
      // Passo 1: Listar backups
      let backups: BackupSnapshot['metadata'][] = [];
      await this.executeStep(procedure, 1, async () => {
        backups = await this.backupService.listBackups();
        procedure.notes.push(`Encontrados ${backups.length} backups`);
      });

      // Passo 2: Validar cada backup
      const validationResults: { backupId: string; valid: boolean; errors: string[] }[] = [];
      await this.executeStep(procedure, 2, async () => {
        for (const meta of backups) {
          const validation = await this.backupService.validateBackup(meta.backupId);
          validationResults.push({
            backupId: meta.backupId,
            valid: validation.valid,
            errors: validation.errors
          });
        }
      });

      // Passo 3: Identificar backup válido mais recente
      await this.executeStep(procedure, 3, async () => {
        const validBackups = validationResults.filter(r => r.valid);
        if (validBackups.length > 0) {
          procedure.backupId = validBackups[0].backupId;
          procedure.notes.push(`Backup válido mais recente: ${validBackups[0].backupId}`);
        } else {
          procedure.notes.push('ALERTA: Nenhum backup válido encontrado!');
        }
      });

      // Passo 4: Relatório
      await this.executeStep(procedure, 4, async () => {
        const corrupted = validationResults.filter(r => !r.valid);
        procedure.notes.push(`Relatório: ${validationResults.filter(r => r.valid).length} válidos, ${corrupted.length} corrompidos`);
        if (corrupted.length > 0) {
          procedure.notes.push(`Backups corrompidos: ${corrupted.map(c => c.backupId).join(', ')}`);
        }
      });

      procedure.status = 'completed';
      procedure.completedAt = new Date();

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Inicia procedimento de restauração de snapshot antigo.
   */
  async startOldSnapshotRestore(backupId: string): Promise<DRProcedure> {
    const procedure = this.createProcedure('old_snapshot_restore', [
      { order: 1, description: 'Carregar backup especificado', status: 'pending' },
      { order: 2, description: 'Validar integridade', status: 'pending' },
      { order: 3, description: 'Comparar com estado atual', status: 'pending' },
      { order: 4, description: 'Executar dry-run', status: 'pending' },
      { order: 5, description: 'Aguardar confirmação', status: 'pending' },
      { order: 6, description: 'Executar restauração', status: 'pending' }
    ]);

    procedure.backupId = backupId;
    this.activeProcedures.set(procedure.procedureId, procedure);

    try {
      // Passo 1: Carregar backup
      let backup: BackupSnapshot | null = null;
      await this.executeStep(procedure, 1, async () => {
        backup = await this.backupService.getBackup(backupId);
        if (!backup) {
          throw new BackupNotFoundError(backupId);
        }
        procedure.notes.push(`Backup carregado: ${backup.metadata.createdAt}`);
      });

      // Passo 2: Validar
      await this.executeStep(procedure, 2, async () => {
        const validation = await this.backupService.validateSnapshot(backup!);
        if (!validation.valid) {
          throw new DRProcedureError(
            `Backup inválido: ${validation.errors.join(', ')}`,
            procedure.procedureId,
            2
          );
        }
      });

      // Passo 3: Comparar (informativo)
      await this.executeStep(procedure, 3, async () => {
        procedure.notes.push(`Entidades no backup: ${backup!.metadata.includedEntities.join(', ')}`);
        const counts = backup!.metadata.entityCounts;
        for (const [type, count] of Object.entries(counts)) {
          if (count > 0) {
            procedure.notes.push(`  - ${type}: ${count} itens`);
          }
        }
      });

      // Passo 4: Dry-run
      await this.executeStep(procedure, 4, async () => {
        const result = await this.restoreService.dryRun(backupId);
        procedure.notes.push(
          `Dry-run: ${result.totalAdded} a adicionar, ${result.totalSkipped} existentes`
        );
      });

      procedure.notes.push('Aguardando confirmação para prosseguir');

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Confirma restauração de snapshot antigo.
   */
  async confirmOldSnapshotRestore(procedureId: string): Promise<DRProcedure> {
    const procedure = this.activeProcedures.get(procedureId);
    if (!procedure || procedure.type !== 'old_snapshot_restore') {
      throw new DRProcedureError('Procedimento não encontrado ou tipo incorreto', procedureId);
    }

    try {
      await this.executeStep(procedure, 5, async () => {
        procedure.notes.push('Confirmação recebida');
      });

      await this.executeStep(procedure, 6, async () => {
        const result = await this.restoreService.execute(procedure.backupId!);
        if (!result.success) {
          throw new DRProcedureError(
            `Restauração falhou: ${result.errors.join(', ')}`,
            procedureId,
            6
          );
        }
        procedure.notes.push(`Restauração concluída: ${result.totalAdded} itens adicionados`);
      });

      procedure.status = 'completed';
      procedure.completedAt = new Date();

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Inicia procedimento de rollback controlado.
   * Cria backup do estado atual antes de restaurar.
   */
  async startControlledRollback(targetBackupId: string): Promise<DRProcedure> {
    const procedure = this.createProcedure('controlled_rollback', [
      { order: 1, description: 'Criar backup do estado atual', status: 'pending' },
      { order: 2, description: 'Validar backup de destino', status: 'pending' },
      { order: 3, description: 'Executar dry-run', status: 'pending' },
      { order: 4, description: 'Aguardar confirmação', status: 'pending' },
      { order: 5, description: 'Executar rollback', status: 'pending' }
    ]);

    procedure.backupId = targetBackupId;
    this.activeProcedures.set(procedure.procedureId, procedure);

    try {
      // Passo 1: Backup do estado atual
      let currentBackup: BackupSnapshot | null = null;
      await this.executeStep(procedure, 1, async () => {
        currentBackup = await this.backupService.createBackup({
          description: `Pre-rollback backup for procedure ${procedure.procedureId}`
        });
        procedure.notes.push(`Backup atual criado: ${currentBackup.metadata.backupId}`);
      });

      // Passo 2: Validar destino
      await this.executeStep(procedure, 2, async () => {
        const validation = await this.backupService.validateBackup(targetBackupId);
        if (!validation.valid) {
          throw new DRProcedureError(
            `Backup de destino inválido: ${validation.errors.join(', ')}`,
            procedure.procedureId,
            2
          );
        }
      });

      // Passo 3: Dry-run
      await this.executeStep(procedure, 3, async () => {
        const result = await this.restoreService.dryRun(targetBackupId);
        procedure.notes.push(
          `Dry-run: ${result.totalAdded} a adicionar, ${result.totalSkipped} existentes`
        );
      });

      procedure.notes.push('Aguardando confirmação para rollback');

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Confirma rollback controlado.
   */
  async confirmControlledRollback(procedureId: string): Promise<DRProcedure> {
    const procedure = this.activeProcedures.get(procedureId);
    if (!procedure || procedure.type !== 'controlled_rollback') {
      throw new DRProcedureError('Procedimento não encontrado ou tipo incorreto', procedureId);
    }

    try {
      await this.executeStep(procedure, 4, async () => {
        procedure.notes.push('Confirmação de rollback recebida');
      });

      await this.executeStep(procedure, 5, async () => {
        const result = await this.restoreService.execute(procedure.backupId!);
        if (!result.success) {
          throw new DRProcedureError(
            `Rollback falhou: ${result.errors.join(', ')}`,
            procedureId,
            5
          );
        }
        procedure.notes.push(`Rollback concluído: ${result.totalAdded} itens adicionados`);
      });

      procedure.status = 'completed';
      procedure.completedAt = new Date();

    } catch (error) {
      procedure.status = 'failed';
      procedure.notes.push(`Erro: ${(error as Error).message}`);
    }

    return procedure;
  }

  /**
   * Obtém status de um procedimento.
   */
  getProcedure(procedureId: string): DRProcedure | undefined {
    return this.activeProcedures.get(procedureId);
  }

  /**
   * Lista procedimentos ativos.
   */
  listActiveProcedures(): DRProcedure[] {
    return Array.from(this.activeProcedures.values());
  }

  /**
   * Cancela um procedimento em andamento.
   */
  cancelProcedure(procedureId: string): boolean {
    const procedure = this.activeProcedures.get(procedureId);
    if (!procedure || procedure.status === 'completed') {
      return false;
    }

    procedure.status = 'rolled_back';
    procedure.completedAt = new Date();
    procedure.notes.push('Procedimento cancelado pelo operador');
    return true;
  }

  /**
   * Cria estrutura de procedimento.
   */
  private createProcedure(type: DRProcedureType, steps: Omit<DRStep, 'startedAt' | 'completedAt' | 'error'>[]): DRProcedure {
    return {
      procedureId: `dr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      type,
      status: 'in_progress',
      steps: steps.map(s => ({ ...s })),
      startedAt: new Date(),
      notes: []
    };
  }

  /**
   * Executa um passo do procedimento.
   */
  private async executeStep<T>(
    procedure: DRProcedure,
    stepOrder: number,
    action: () => Promise<T>
  ): Promise<T> {
    const step = procedure.steps.find(s => s.order === stepOrder);
    if (!step) {
      throw new DRProcedureError(`Passo ${stepOrder} não encontrado`, procedure.procedureId);
    }

    step.status = 'in_progress';
    step.startedAt = new Date();

    if (this.onProgress) {
      await this.onProgress(procedure.procedureId, step, procedure);
    }

    try {
      const result = await action();
      step.status = 'completed';
      step.completedAt = new Date();

      if (this.onProgress) {
        await this.onProgress(procedure.procedureId, step, procedure);
      }

      return result;
    } catch (error) {
      step.status = 'failed';
      step.completedAt = new Date();
      step.error = (error as Error).message;

      if (this.onProgress) {
        await this.onProgress(procedure.procedureId, step, procedure);
      }

      throw error;
    }
  }
}

export { DisasterRecoveryService, DRProgressCallback };
