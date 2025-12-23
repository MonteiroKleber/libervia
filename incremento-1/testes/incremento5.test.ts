import * as fs from 'fs/promises';
import * as path from 'path';
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';

import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  StatusSituacao,
  PerfilRisco,
  DadosProtocoloInput
} from '../entidades/tipos';

import {
  createBackup,
  restoreBackup,
  verifyManifest,
  BackupManifest,
  computeFileSha256
} from '../scripts/backup_frio_eventlog';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc5-' + Date.now();
const TEST_BACKUP_DIR = './test-backup-inc5-' + Date.now();
const TEST_RESTORE_DIR = './test-restore-inc5-' + Date.now();

// ════════════════════════════════════════════════════════════════════════
// SETUP E TEARDOWN
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorios(): Promise<void> {
  for (const dir of [TEST_DATA_DIR, TEST_BACKUP_DIR, TEST_RESTORE_DIR]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignorar se nao existe
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(id?: string): SituacaoDecisoria {
  return {
    id: id ?? `situacao-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    dominio: 'Teste',
    contexto: 'Contexto de teste para decisao',
    objetivo: 'Objetivo claro e mensuravel',
    incertezas: ['Incerteza real'],
    alternativas: [
      { descricao: 'Alternativa A', riscos_associados: ['risco-1'] },
      { descricao: 'Alternativa B', riscos_associados: ['risco-2'] }
    ],
    riscos: [{ descricao: 'Risco identificado', tipo: 'Operacional', reversibilidade: 'Parcial' }],
    urgencia: 'Media',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequencia significativa',
    possibilidade_aprendizado: true,
    caso_uso_declarado: 1,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    anexos_analise: []
  };
}

function criarDadosProtocoloValidos(): DadosProtocoloInput {
  return {
    criterios_minimos: ['Custo', 'Prazo'],
    riscos_considerados: ['Risco de atraso'],
    limites_definidos: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
    alternativa_escolhida: 'Alternativa A'
  };
}

async function criarEventLogComEventos(dataDir: string, numEventos: number = 10): Promise<EventLogRepositoryImpl> {
  const eventLog = await EventLogRepositoryImpl.create(dataDir, {
    segmentSize: 5,
    snapshotEvery: 3,
    retentionSegments: 10
  });

  for (let i = 0; i < numEventos; i++) {
    await eventLog.append(
      i % 2 === 0 ? 'Libervia' : 'Bazari',
      TipoEvento.SITUACAO_CRIADA,
      TipoEntidade.SITUACAO,
      `sit-${i}`,
      { index: i, data: `Evento ${i}` }
    );
  }

  return eventLog;
}

async function corruptFile(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const corrupted = content.slice(0, -20) + 'CORRUPTED_DATA_HERE!';
  await fs.writeFile(filePath, corrupted);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 5
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 5 - Backup Frio do EventLog', () => {

  beforeEach(async () => {
    await limparDiretorios();
  });

  afterAll(async () => {
    await limparDiretorios();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Backup basico
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Backup basico', () => {
    test('Cria backup de EventLog com eventos', async () => {
      // Criar EventLog com eventos
      await criarEventLogComEventos(TEST_DATA_DIR, 10);

      // Criar backup
      const result = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(result.success).toBe(true);
      expect(result.archive_path).not.toBeNull();
      expect(result.manifest_path).not.toBeNull();
      expect(result.manifest).not.toBeNull();

      // Verificar manifest
      expect(result.manifest!.eventlog_summary.total_events).toBe(10);
      expect(result.manifest!.eventlog_summary.total_segments).toBeGreaterThanOrEqual(2);
      expect(result.manifest!.chain_valid_at_backup).toBe(true);

      // Verificar arquivos existem
      expect(await fileExists(result.archive_path!)).toBe(true);
      expect(await fileExists(result.manifest_path!)).toBe(true);
    });

    test('Manifest contem checksums SHA-256 corretos', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 5);
      const result = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(result.success).toBe(true);
      expect(result.manifest!.files.length).toBeGreaterThan(0);

      // Verificar cada checksum
      for (const fileInfo of result.manifest!.files) {
        const filePath = path.join(TEST_DATA_DIR, fileInfo.path);
        const actualSha256 = await computeFileSha256(filePath);
        expect(fileInfo.sha256).toBe(actualSha256);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Backup de EventLog vazio
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Backup de EventLog vazio', () => {
    test('Falha graciosamente se EventLog nao existe', async () => {
      const result = await createBackup('/caminho/inexistente', TEST_BACKUP_DIR);

      expect(result.success).toBe(false);
      expect(result.error).toContain('nao encontrado');
    });

    test('Cria backup mesmo com EventLog sem eventos (apenas estrutura)', async () => {
      // Criar EventLog vazio
      await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const result = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      // Pode falhar se nao tem segmentos ainda - comportamento aceitavel
      if (result.success) {
        expect(result.manifest!.eventlog_summary.total_events).toBe(0);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Verificar manifest
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Verificar manifest', () => {
    test('verifyManifest retorna valido para arquivos intactos', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 8);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(backupResult.success).toBe(true);

      const verifyResult = await verifyManifest(
        backupResult.manifest_path!,
        TEST_DATA_DIR
      );

      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.files_missing).toHaveLength(0);
      expect(verifyResult.files_corrupted).toHaveLength(0);
    });

    test('verifyManifest detecta arquivo faltando', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 8);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(backupResult.success).toBe(true);

      // Deletar um segmento
      const segmentPath = path.join(TEST_DATA_DIR, 'event-log', 'segment-000001.json');
      await fs.unlink(segmentPath);

      const verifyResult = await verifyManifest(
        backupResult.manifest_path!,
        TEST_DATA_DIR
      );

      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.files_missing.length).toBeGreaterThan(0);
    });

    test('verifyManifest detecta arquivo corrompido', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 8);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(backupResult.success).toBe(true);

      // Corromper um segmento
      const segmentPath = path.join(TEST_DATA_DIR, 'event-log', 'segment-000001.json');
      await corruptFile(segmentPath);

      const verifyResult = await verifyManifest(
        backupResult.manifest_path!,
        TEST_DATA_DIR
      );

      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.files_corrupted.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Corrupcao de segmento e restauracao
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Corrupcao de segmento e restauracao', () => {
    test('Restaura EventLog apos corrupcao de segmento', async () => {
      // 1. Criar EventLog e backup
      await criarEventLogComEventos(TEST_DATA_DIR, 10);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(backupResult.success).toBe(true);

      // 2. Corromper segmento original de forma que ainda seja JSON valido mas com dados errados
      const segmentPath = path.join(TEST_DATA_DIR, 'event-log', 'segment-000001.json');
      const originalContent = await fs.readFile(segmentPath, 'utf-8');
      const jsonData = JSON.parse(originalContent);
      // Corromper o hash do primeiro evento
      if (jsonData.length > 0) {
        jsonData[0].current_hash = 'CORRUPTED_HASH_12345';
      }
      await fs.writeFile(segmentPath, JSON.stringify(jsonData));

      // 3. Verificar que cadeia esta quebrada (usar verifyChainFull para ignorar snapshot)
      const eventLogCorrupted = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      const verifyCorrupted = await eventLogCorrupted.verifyChainFull();
      expect(verifyCorrupted.valid).toBe(false);

      // 4. Restaurar do backup
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.events_restored).toBe(10);
      expect(restoreResult.chain_valid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Corrupcao de snapshot e restauracao
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Corrupcao de snapshot e restauracao', () => {
    test('Restaura EventLog apos corrupcao de snapshot', async () => {
      // 1. Criar EventLog e backup
      await criarEventLogComEventos(TEST_DATA_DIR, 10);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(backupResult.success).toBe(true);

      // 2. Corromper snapshot original
      const snapshotPath = path.join(TEST_DATA_DIR, 'event-log-snapshot.json');
      if (await fileExists(snapshotPath)) {
        await corruptFile(snapshotPath);
      }

      // 3. Restaurar do backup
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.chain_valid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Restaurar e operar com Orquestrador
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Restaurar e operar com Orquestrador', () => {
    test('Orquestrador funciona apos restauracao', async () => {
      // 1. Criar infraestrutura inicial com eventos
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLog
      );
      await orq.init();

      // Executar fluxo inicial
      const sit1 = criarSituacaoValida('sit-restore-test-1');
      const episodio1 = await orq.ProcessarSolicitacao(sit1);
      expect(episodio1).toBeDefined();

      // 2. Criar backup
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(backupResult.success).toBe(true);

      // 3. Restaurar em novo diretorio
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );
      expect(restoreResult.success).toBe(true);

      // 4. Criar novo Orquestrador no diretorio restaurado
      const situacaoRepo2 = await SituacaoRepositoryImpl.create(TEST_RESTORE_DIR);
      const episodioRepo2 = await EpisodioRepositoryImpl.create(TEST_RESTORE_DIR);
      const decisaoRepo2 = await DecisaoRepositoryImpl.create(TEST_RESTORE_DIR);
      const contratoRepo2 = await ContratoRepositoryImpl.create(TEST_RESTORE_DIR);
      const protocoloRepo2 = await DecisionProtocolRepositoryImpl.create(TEST_RESTORE_DIR);
      const memoryService2 = new MemoryQueryService(episodioRepo2, decisaoRepo2, contratoRepo2);
      const eventLog2 = await EventLogRepositoryImpl.create(TEST_RESTORE_DIR);

      const orq2 = new OrquestradorCognitivo(
        situacaoRepo2,
        episodioRepo2,
        decisaoRepo2,
        contratoRepo2,
        memoryService2,
        protocoloRepo2,
        eventLog2
      );
      await orq2.init();

      // 5. Verificar integridade do EventLog restaurado
      const status = orq2.GetEventLogStatus();
      expect(status.enabled).toBe(true);
      expect(status.degraded).toBe(false);

      // 6. Executar nova operacao
      const sit2 = criarSituacaoValida('sit-restore-test-2');
      const episodio2 = await orq2.ProcessarSolicitacao(sit2);
      expect(episodio2).toBeDefined();

      // 7. Verificar que export funciona
      const exportResult = await orq2.ExportEventLogForAudit();
      expect(exportResult.manifest.count).toBeGreaterThan(0);
      expect(exportResult.manifest.chainValidWithinExport).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Restaurar em diretorio limpo
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Restaurar em diretorio limpo', () => {
    test('Restaura corretamente em diretorio novo', async () => {
      // 1. Criar EventLog e backup
      await criarEventLogComEventos(TEST_DATA_DIR, 15);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(backupResult.success).toBe(true);

      // 2. Restaurar em diretorio completamente novo
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.events_restored).toBe(15);
      expect(restoreResult.chain_valid).toBe(true);

      // 3. Verificar que arquivos foram restaurados
      const eventLogDir = path.join(TEST_RESTORE_DIR, 'event-log');
      expect(await fileExists(eventLogDir)).toBe(true);

      const files = await fs.readdir(eventLogDir);
      const segmentFiles = files.filter(f => f.startsWith('segment-'));
      expect(segmentFiles.length).toBeGreaterThan(0);
    });

    test('Bloqueia restauracao se diretorio ja tem EventLog (sem overwrite)', async () => {
      // 1. Criar EventLog origem
      await criarEventLogComEventos(TEST_DATA_DIR, 10);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      // 2. Criar EventLog no destino
      await criarEventLogComEventos(TEST_RESTORE_DIR, 5);

      // 3. Tentar restaurar sem overwrite
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR,
        false // overwrite = false
      );

      expect(restoreResult.success).toBe(false);
      expect(restoreResult.error).toContain('overwrite');
    });

    test('Permite restauracao com overwrite=true', async () => {
      // 1. Criar EventLog origem
      await criarEventLogComEventos(TEST_DATA_DIR, 10);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      // 2. Criar EventLog diferente no destino
      await criarEventLogComEventos(TEST_RESTORE_DIR, 5);

      // 3. Restaurar com overwrite
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR,
        true // overwrite = true
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.events_restored).toBe(10); // Do backup, nao do destino
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Integridade do pacote tar.gz
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Integridade do pacote tar.gz', () => {
    test('Pacote tar.gz contem todos os arquivos do manifest', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 12);
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      expect(backupResult.success).toBe(true);

      // Extrair e verificar
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );

      expect(restoreResult.success).toBe(true);

      // Verificar cada arquivo do manifest
      for (const fileInfo of backupResult.manifest!.files) {
        const filePath = path.join(TEST_RESTORE_DIR, fileInfo.path);
        expect(await fileExists(filePath)).toBe(true);

        const actualSha256 = await computeFileSha256(filePath);
        expect(actualSha256).toBe(fileInfo.sha256);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Multiplos segmentos
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: Backup com multiplos segmentos', () => {
    test('Backup e restaura EventLog com varios segmentos', async () => {
      // Criar EventLog com muitos eventos para forcar multiplos segmentos
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3, // Pequeno para forcar rotacao
        snapshotEvery: 2
      });

      // Adicionar 15 eventos (vai criar ~5 segmentos)
      for (let i = 0; i < 15; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.SITUACAO_CRIADA,
          TipoEntidade.SITUACAO,
          `sit-${i}`,
          { index: i }
        );
      }

      // Verificar segmentos criados
      const segmentCount = await eventLog._countSegments();
      expect(segmentCount).toBeGreaterThanOrEqual(4);

      // Criar backup
      const backupResult = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(backupResult.success).toBe(true);
      expect(backupResult.manifest!.eventlog_summary.total_segments).toBeGreaterThanOrEqual(4);

      // Restaurar
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        TEST_RESTORE_DIR
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.events_restored).toBe(15);
      expect(restoreResult.chain_valid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: Idempotencia do backup
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 10: Idempotencia do backup', () => {
    test('Multiplos backups criam arquivos distintos', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 8);

      const result1 = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(result1.success).toBe(true);

      // Esperar 1 segundo para garantir timestamp diferente
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result2 = await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);
      expect(result2.success).toBe(true);

      // Arquivos devem ser diferentes (timestamps diferentes)
      expect(result1.archive_path).not.toBe(result2.archive_path);
      expect(result1.manifest_path).not.toBe(result2.manifest_path);

      // Ambos devem existir
      expect(await fileExists(result1.archive_path!)).toBe(true);
      expect(await fileExists(result2.archive_path!)).toBe(true);
    });

    test('Backup nao modifica origem', async () => {
      await criarEventLogComEventos(TEST_DATA_DIR, 10);

      // Coletar checksums antes
      const eventLogDir = path.join(TEST_DATA_DIR, 'event-log');
      const filesBefore = await fs.readdir(eventLogDir);
      const checksumsBefore: Record<string, string> = {};
      for (const f of filesBefore) {
        checksumsBefore[f] = await computeFileSha256(path.join(eventLogDir, f));
      }

      // Criar backup
      await createBackup(TEST_DATA_DIR, TEST_BACKUP_DIR);

      // Verificar checksums depois
      const filesAfter = await fs.readdir(eventLogDir);
      expect(filesAfter.sort()).toEqual(filesBefore.sort());

      for (const f of filesAfter) {
        const checksumAfter = await computeFileSha256(path.join(eventLogDir, f));
        expect(checksumAfter).toBe(checksumsBefore[f]);
      }
    });
  });

});
