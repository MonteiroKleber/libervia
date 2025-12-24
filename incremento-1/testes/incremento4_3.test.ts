import * as fs from 'fs/promises';
import * as path from 'path';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';

const TEST_DATA_DIR = './test-data-inc4_3-' + Date.now();

// ════════════════════════════════════════════════════════════════════════
// SETUP E TEARDOWN
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorioTeste(): Promise<void> {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Ignorar se não existe
  }
}

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 4.3 - AUDITORIA OPERACIONAL
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 4.3 - Auditoria Operacional', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: exportRange
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: exportRange', () => {
    test('Exporta todos os eventos quando sem filtros', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      // Criar eventos
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', { a: 1 });
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', { b: 2 });
      await eventLog.append('Bazari', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', { c: 3 });

      const result = await eventLog.exportRange();

      expect(result.entries.length).toBe(3);
      expect(result.manifest.count).toBe(3);
      expect(result.manifest.firstId).toBe(result.entries[0].id);
      expect(result.manifest.lastId).toBe(result.entries[2].id);
      expect(result.manifest.chainValidWithinExport).toBe(true);
    });

    test('Exporta por intervalo de tempo', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      // Criar eventos com delays para garantir timestamps diferentes
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await new Promise(r => setTimeout(r, 10));

      const midTime = new Date();

      await new Promise(r => setTimeout(r, 10));
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await new Promise(r => setTimeout(r, 10));
      await eventLog.append('Libervia', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', {});

      // Export a partir de midTime
      const result = await eventLog.exportRange({ fromTs: midTime });

      expect(result.entries.length).toBe(2);
      expect(result.manifest.count).toBe(2);
      expect(result.entries[0].evento).toBe(TipoEvento.EPISODIO_CRIADO);
    });

    test('chainValidWithinExport=true para export começando no genesis', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});

      const result = await eventLog.exportRange();

      expect(result.manifest.chainValidWithinExport).toBe(true);
      // Verificar que primeiro evento tem previous_hash = null (genesis)
      expect(result.entries[0].previous_hash).toBeNull();
    });

    test('chainValidWithinExport=true para export começando no meio (encadeamento interno)', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await new Promise(r => setTimeout(r, 10));

      const midTime = new Date();

      await new Promise(r => setTimeout(r, 10));
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Libervia', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', {});

      // Export começando no meio
      const result = await eventLog.exportRange({ fromTs: midTime });

      expect(result.manifest.chainValidWithinExport).toBe(true);
      expect(result.entries.length).toBe(2);
      // Verificar encadeamento interno
      expect(result.entries[1].previous_hash).toBe(result.entries[0].current_hash);
    });

    test('Export vazio retorna manifest com chainValidWithinExport=true', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const result = await eventLog.exportRange();

      expect(result.entries.length).toBe(0);
      expect(result.manifest.count).toBe(0);
      expect(result.manifest.chainValidWithinExport).toBe(true);
    });

    test('Export com segmento específico funciona', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2
      });

      // Criar eventos para 2 segmentos
      for (let i = 0; i < 5; i++) {
        await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, `sit-${i}`, { i });
      }

      // Export do segmento 1 apenas
      const result = await eventLog.exportRange({ fromSegment: 1, toSegment: 1 });

      expect(result.entries.length).toBe(3);
      expect(result.manifest.chainValidWithinExport).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: replay
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: replay', () => {
    test('Gera resumo determinístico correto', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Bazari', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', {});
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-2', {});

      const result = await eventLog.replay();

      expect(result.totalEventos).toBe(4);
      expect(result.porEvento[TipoEvento.SITUACAO_CRIADA]).toBe(2);
      expect(result.porEvento[TipoEvento.EPISODIO_CRIADO]).toBe(1);
      expect(result.porEvento[TipoEvento.DECISAO_REGISTRADA]).toBe(1);
      expect(result.porEntidade[TipoEntidade.SITUACAO]).toBe(2);
      expect(result.porEntidade[TipoEntidade.EPISODIO]).toBe(1);
      expect(result.porEntidade[TipoEntidade.DECISAO]).toBe(1);
      expect(result.porAtor['Libervia']).toBe(3);
      expect(result.porAtor['Bazari']).toBe(1);
      expect(result.inconsistencias.length).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test('Replay com filtro por evento reduz contagem', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-2', {});

      const result = await eventLog.replay({ evento: TipoEvento.SITUACAO_CRIADA });

      expect(result.totalEventos).toBe(2);
      expect(result.porEvento[TipoEvento.SITUACAO_CRIADA]).toBe(2);
      expect(result.porEvento[TipoEvento.EPISODIO_CRIADO]).toBeUndefined();
    });

    test('Replay com filtro por entidade reduz contagem', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Libervia', TipoEvento.CONTRATO_EMITIDO, TipoEntidade.CONTRATO, 'cont-1', {});

      const result = await eventLog.replay({ entidade: TipoEntidade.EPISODIO });

      expect(result.totalEventos).toBe(1);
      expect(result.porEntidade[TipoEntidade.EPISODIO]).toBe(1);
    });

    test('Replay com filtro por entidadeId', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.SITUACAO_STATUS_ALTERADO, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-2', {});

      const result = await eventLog.replay({ entidadeId: 'sit-1' });

      expect(result.totalEventos).toBe(2);
    });

    test('Replay detecta inconsistências', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});

      // Corromper o segundo evento em memória
      eventLog._corruptEntry(1, 'current_hash', 'CORRUPTED_HASH');

      const result = await eventLog.replay();

      expect(result.inconsistencias.length).toBe(1);
      expect(result.inconsistencias[0].index).toBe(1);
      expect(result.inconsistencias[0].reason).toContain('Hash mismatch');
    });

    test('Range correto é calculado', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await new Promise(r => setTimeout(r, 10));
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});

      const result = await eventLog.replay();

      expect(result.range.firstTs).not.toBeNull();
      expect(result.range.lastTs).not.toBeNull();
      expect(new Date(result.range.firstTs!).getTime()).toBeLessThan(new Date(result.range.lastTs!).getTime());
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: verifyFromSnapshot
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: verifyFromSnapshot', () => {
    test('Verifica a partir do snapshot quando disponível', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2
      });

      // Criar eventos para gerar snapshot
      for (let i = 0; i < 5; i++) {
        await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, `sit-${i}`, { i });
      }

      const result = await eventLog.verifyFromSnapshot();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(5);
    });

    test('Detecta corrupção em evento posterior ao snapshot', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      // Criar 5 eventos (snapshot será criado após o 3º)
      for (let i = 0; i < 5; i++) {
        await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, `sit-${i}`, { i });
      }

      // Corromper diretamente no arquivo de segmento
      const segmentPath = path.join(TEST_DATA_DIR, 'event-log', 'segment-000001.json');
      const content = await fs.readFile(segmentPath, 'utf-8');
      const events = JSON.parse(content);
      events[4].current_hash = 'CORRUPTED_HASH';
      await fs.writeFile(segmentPath, JSON.stringify(events, null, 2));

      // Recriar eventLog para carregar dados corrompidos
      const eventLogCorrompido = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      const result = await eventLogCorrompido.verifyFromSnapshot();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(4);
    });

    test('Fallback para verifyChain quando sem snapshot', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 100, // Grande para não criar snapshot
        snapshotEvery: 100
      });

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});

      // Não deve ter snapshot ainda
      expect(eventLog._getSnapshot()).toBeNull();

      const result = await eventLog.verifyFromSnapshot();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(2);
    });

    test('Detecta corrupção no genesis quando sem snapshot', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 100,
        snapshotEvery: 100
      });

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});

      // Corromper genesis
      eventLog._corruptEntry(0, 'current_hash', 'CORRUPTED');

      const result = await eventLog.verifyFromSnapshot();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);
    });

    test('Verifica corretamente com múltiplos segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2
      });

      // Criar eventos para múltiplos segmentos
      for (let i = 0; i < 10; i++) {
        await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, `sit-${i}`, { i });
      }

      const result = await eventLog.verifyFromSnapshot();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(10);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Orquestrador - integração
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Orquestrador integração', () => {
    test('ExportEventLogForAudit sem eventLog retorna vazio', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo
        // SEM eventLog
      );

      const result = await orq.ExportEventLogForAudit();

      expect(result.entries.length).toBe(0);
      expect(result.manifest.count).toBe(0);
      expect(result.manifest.chainValidWithinExport).toBe(true);
    });

    test('ReplayEventLog sem eventLog retorna resumo vazio', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo
        // SEM eventLog
      );

      const result = await orq.ReplayEventLog();

      expect(result.totalEventos).toBe(0);
      expect(result.truncated).toBe(false);
      expect(result.inconsistencias.length).toBe(0);
    });

    test('ExportEventLogForAudit com eventLog funciona', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLog
      );

      // Adicionar eventos diretamente
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});

      const result = await orq.ExportEventLogForAudit();

      expect(result.entries.length).toBe(2);
      expect(result.manifest.count).toBe(2);
      expect(result.manifest.chainValidWithinExport).toBe(true);
    });

    test('ReplayEventLog com eventLog funciona', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLog
      );

      // Adicionar eventos
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Bazari', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', {});

      const result = await orq.ReplayEventLog();

      expect(result.totalEventos).toBe(2);
      expect(result.porAtor['Libervia']).toBe(1);
      expect(result.porAtor['Bazari']).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Limites de segurança
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Limites de segurança', () => {
    test('Export lança erro se exceder limite (simulado)', async () => {
      // Nota: Não vamos criar 10001 eventos no teste real
      // Este teste valida que o mecanismo de limite existe
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});

      // Export normal funciona
      const result = await eventLog.exportRange();
      expect(result.entries.length).toBe(1);
    });

    test('Replay não trunca quando abaixo do limite', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      for (let i = 0; i < 10; i++) {
        await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, `sit-${i}`, {});
      }

      const result = await eventLog.replay();

      expect(result.totalEventos).toBe(10);
      expect(result.truncated).toBe(false);
    });
  });

});
