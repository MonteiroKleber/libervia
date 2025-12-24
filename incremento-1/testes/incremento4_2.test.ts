import * as fs from 'fs/promises';
import * as path from 'path';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { computeEventHash, computePayloadHash } from '../camada-3/utilitarios/HashUtil';

const TEST_DATA_DIR = './test-data-inc4_2-' + Date.now();

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
// TESTES DO INCREMENTO 4.2 - ROTAÇÃO, SNAPSHOT E RETENÇÃO
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 4.2 - Rotação, Snapshot e Retenção', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Rotação cria múltiplos segmentos
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Rotação de segmentos', () => {
    test('Criar múltiplos segmentos ao ultrapassar limite', async () => {
      // Configurar limite baixo para teste
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      // Adicionar 12 eventos (deve criar 3 segmentos: 5+5+2)
      for (let i = 0; i < 12; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.SITUACAO_CRIADA,
          TipoEntidade.SITUACAO,
          `sit-${i}`,
          { index: i }
        );
      }

      // Verificar número de segmentos
      const segmentCount = await eventLog._countSegments();
      expect(segmentCount).toBe(3);

      // Verificar segmento atual
      expect(eventLog._getCurrentSegment()).toBe(3);

      // Verificar total de eventos
      expect(await eventLog.count()).toBe(12);

      // Verificar que getAll retorna todos
      const all = await eventLog.getAll();
      expect(all.length).toBe(12);
    });

    test('Primeiro evento do novo segmento tem previous_hash correto', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2
      });

      // Adicionar 5 eventos (deve criar 2 segmentos: 3+2)
      for (let i = 0; i < 5; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.SITUACAO_CRIADA,
          TipoEntidade.SITUACAO,
          `sit-${i}`,
          { index: i }
        );
      }

      const all = await eventLog.getAll();

      // O evento 4 (índice 3, primeiro do segundo segmento) deve ter
      // previous_hash igual ao current_hash do evento 3 (último do primeiro segmento)
      expect(all[3].previous_hash).toBe(all[2].current_hash);

      // Genesis deve ter previous_hash null
      expect(all[0].previous_hash).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: verifyChain() valida cadeia atravessando segmentos
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: verifyChain atravessa segmentos', () => {
    test('Cadeia válida atravessando múltiplos segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 4,
        snapshotEvery: 2
      });

      // Adicionar 10 eventos (3 segmentos: 4+4+2)
      for (let i = 0; i < 10; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.EPISODIO_CRIADO,
          TipoEntidade.EPISODIO,
          `ep-${i}`,
          { index: i }
        );
      }

      const result = await eventLog.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(10);
    });

    test('verifyChainFull() verifica desde genesis', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2
      });

      for (let i = 0; i < 8; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.DECISAO_REGISTRADA,
          TipoEntidade.DECISAO,
          `dec-${i}`,
          { index: i }
        );
      }

      const result = await eventLog.verifyChainFull();
      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(8);
    });

    test('Corrupção entre segmentos é detectada', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 10 // Alto para não criar snapshot
      });

      for (let i = 0; i < 6; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.CONTRATO_EMITIDO,
          TipoEntidade.CONTRATO,
          `cont-${i}`,
          { index: i }
        );
      }

      // Corromper evento no limite entre segmentos (índice 3)
      eventLog._corruptEntry(3, 'previous_hash', 'CORRUPTED_HASH');

      // Aguardar o cache ser atualizado
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = await eventLog.verifyChainFull();
      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Snapshot é criado e usado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Snapshot funciona corretamente', () => {
    test('Snapshot é criado após rotação', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      // Adicionar 6 eventos (vai criar snapshot na rotação após 5)
      for (let i = 0; i < 6; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.PROTOCOLO_VALIDADO,
          TipoEntidade.PROTOCOLO,
          `prot-${i}`,
          { index: i }
        );
      }

      const snapshot = eventLog._getSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.version).toBe(1);
      expect(snapshot!.total_events).toBe(5); // Snapshot criado após 5 eventos
      expect(snapshot!.last_segment).toBe(1);
      expect(snapshot!.last_index_in_segment).toBe(4); // Índice 4 = quinto evento
    });

    test('Fast verify usa snapshot', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      // Adicionar 8 eventos
      for (let i = 0; i < 8; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.MEMORIA_CONSULTADA,
          TipoEntidade.CONSULTA,
          `query-${i}`,
          { index: i }
        );
      }

      // Verificar stats de debug
      const stats = await eventLog._debugVerifyStats();
      expect(stats.startedFromSnapshot).toBe(true);
      expect(stats.totalEvents).toBe(8);
      // Fast verify só precisa verificar eventos após snapshot
      expect(stats.verifiedEvents).toBeLessThan(stats.totalEvents);
    });

    test('Snapshot é atualizado periodicamente', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 100, // Alto para não rotacionar
        snapshotEvery: 3  // Baixo para testar atualização periódica
      });

      // Adicionar 4 eventos (deve atualizar snapshot após 3)
      for (let i = 0; i < 4; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.SITUACAO_CRIADA,
          TipoEntidade.SITUACAO,
          `sit-${i}`,
          { index: i }
        );
      }

      const snapshot = eventLog._getSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.total_events).toBe(3); // Snapshot após 3 eventos
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: prune() respeita retenção
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Política de retenção (prune)', () => {
    test('prune() mantém apenas N segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2,
        retentionSegments: 2
      });

      // Adicionar 12 eventos (4 segmentos: 3+3+3+3)
      for (let i = 0; i < 12; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.EPISODIO_CRIADO,
          TipoEntidade.EPISODIO,
          `ep-${i}`,
          { index: i }
        );
      }

      expect(await eventLog._countSegments()).toBe(4);

      // Executar prune
      const result = await eventLog.prune();

      expect(result.segmentsRemoved).toBe(2); // 4 - 2 = 2 removidos
      expect(result.eventsRemoved).toBe(6);   // 2 segmentos * 3 eventos
      expect(await eventLog._countSegments()).toBe(2);
      expect(await eventLog.count()).toBe(6); // 12 - 6 = 6 restantes
    });

    test('prune() não remove se dentro do limite', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3,
        retentionSegments: 10
      });

      // Adicionar 8 eventos (2 segmentos)
      for (let i = 0; i < 8; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.DECISAO_REGISTRADA,
          TipoEntidade.DECISAO,
          `dec-${i}`,
          { index: i }
        );
      }

      const result = await eventLog.prune();
      expect(result.segmentsRemoved).toBe(0);
      expect(result.eventsRemoved).toBe(0);
    });

    test('prune() avança snapshot antes de remover segmentos necessários', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3,
        snapshotEvery: 2,
        retentionSegments: 2
      });

      // Adicionar 9 eventos (3 segmentos: 3+3+3)
      for (let i = 0; i < 9; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.CONTRATO_EMITIDO,
          TipoEntidade.CONTRATO,
          `cont-${i}`,
          { index: i }
        );
      }

      // Verificar que temos 3 segmentos
      expect(await eventLog._countSegments()).toBe(3);

      // Prune vai remover segmento 1 (manter 2 e 3)
      const pruneResult = await eventLog.prune();
      expect(pruneResult.segmentsRemoved).toBe(1);

      // Verificar que restam 2 segmentos
      expect(await eventLog._countSegments()).toBe(2);

      // Verificar que cadeia ainda é válida
      const verifyResult = await eventLog.verifyChain();
      expect(verifyResult.valid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Migração do legado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Migração de event-log.json legado', () => {
    test('Migra event-log.json para segment-000001.json', async () => {
      // Criar arquivo legado manualmente
      const legacyPath = path.join(TEST_DATA_DIR, 'event-log.json');
      const legacyBackupPath = path.join(TEST_DATA_DIR, 'event-log.legacy.json');
      const segmentDir = path.join(TEST_DATA_DIR, 'event-log');
      const segment1Path = path.join(segmentDir, 'segment-000001.json');
      const snapshotPath = path.join(TEST_DATA_DIR, 'event-log-snapshot.json');

      await fs.mkdir(TEST_DATA_DIR, { recursive: true });

      // Criar eventos legados COM HASHES VÁLIDOS
      const timestamp1 = new Date('2024-01-01T10:00:00Z');
      const timestamp2 = new Date('2024-01-01T10:01:00Z');
      const payloadHash1 = computePayloadHash({ test: 1 });
      const payloadHash2 = computePayloadHash({ test: 2 });

      // Genesis event (previous_hash = null)
      const currentHash1 = computeEventHash(
        null,
        timestamp1,
        'Libervia',
        'SITUACAO_CRIADA',
        'SituacaoDecisoria',
        'sit-legacy-1',
        payloadHash1
      );

      // Second event (encadeado)
      const currentHash2 = computeEventHash(
        currentHash1,
        timestamp2,
        'Libervia',
        'EPISODIO_CRIADO',
        'EpisodioDecisao',
        'ep-legacy-1',
        payloadHash2
      );

      const legacyEvents = [
        {
          id: 'evt-legacy-1',
          timestamp: timestamp1.toISOString(),
          actor: 'Libervia',
          evento: 'SITUACAO_CRIADA',
          entidade: 'SituacaoDecisoria',
          entidade_id: 'sit-legacy-1',
          payload_hash: payloadHash1,
          previous_hash: null,
          current_hash: currentHash1
        },
        {
          id: 'evt-legacy-2',
          timestamp: timestamp2.toISOString(),
          actor: 'Libervia',
          evento: 'EPISODIO_CRIADO',
          entidade: 'EpisodioDecisao',
          entidade_id: 'ep-legacy-1',
          payload_hash: payloadHash2,
          previous_hash: currentHash1,
          current_hash: currentHash2
        }
      ];

      await fs.writeFile(legacyPath, JSON.stringify(legacyEvents, null, 2));

      // Inicializar repositório (deve migrar automaticamente)
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      // Verificar que legado foi renomeado para .legacy
      const legacyBackupExists = await fs.access(legacyBackupPath).then(() => true).catch(() => false);
      expect(legacyBackupExists).toBe(true);

      // Verificar que legado original não existe mais
      const legacyExists = await fs.access(legacyPath).then(() => true).catch(() => false);
      expect(legacyExists).toBe(false);

      // Verificar que segment-000001.json foi criado
      const segment1Exists = await fs.access(segment1Path).then(() => true).catch(() => false);
      expect(segment1Exists).toBe(true);

      // Verificar que snapshot foi criado
      const snapshotExists = await fs.access(snapshotPath).then(() => true).catch(() => false);
      expect(snapshotExists).toBe(true);

      // Verificar contagem
      expect(await eventLog.count()).toBe(2);

      // Verificar que getAll retorna os eventos migrados
      const all = await eventLog.getAll();
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('evt-legacy-1');
      expect(all[1].id).toBe('evt-legacy-2');
    });

    test('Migração é idempotente', async () => {
      // Criar legado
      const legacyPath = path.join(TEST_DATA_DIR, 'event-log.json');
      await fs.mkdir(TEST_DATA_DIR, { recursive: true });

      const legacyEvents = [{
        id: 'evt-idem-1',
        timestamp: new Date().toISOString(),
        actor: 'Libervia',
        evento: 'SITUACAO_CRIADA',
        entidade: 'SituacaoDecisoria',
        entidade_id: 'sit-idem-1',
        payload_hash: 'hash1',
        previous_hash: null,
        current_hash: 'hash-idem-1'
      }];

      await fs.writeFile(legacyPath, JSON.stringify(legacyEvents, null, 2));

      // Primeira inicialização - migra
      const eventLog1 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      expect(await eventLog1.count()).toBe(1);

      // Segunda inicialização - não deve duplicar
      const eventLog2 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      expect(await eventLog2.count()).toBe(1);

      // Terceira inicialização
      const eventLog3 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      expect(await eventLog3.count()).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Persistência após restart
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Persistência atravessa restart', () => {
    test('Eventos persistem após recriar repositório', async () => {
      // Primeira instância
      const eventLog1 = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      for (let i = 0; i < 7; i++) {
        await eventLog1.append(
          'Libervia',
          TipoEvento.PROTOCOLO_VALIDADO,
          TipoEntidade.PROTOCOLO,
          `prot-${i}`,
          { index: i }
        );
      }

      // Segunda instância (simula restart)
      const eventLog2 = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 5,
        snapshotEvery: 3
      });

      expect(await eventLog2.count()).toBe(7);

      // Adicionar mais eventos
      await eventLog2.append(
        'Libervia',
        TipoEvento.PROTOCOLO_VALIDADO,
        TipoEntidade.PROTOCOLO,
        'prot-7',
        { index: 7 }
      );

      expect(await eventLog2.count()).toBe(8);

      // Verificar cadeia após restart
      const result = await eventLog2.verifyChainFull();
      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(8);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Compatibilidade com testes existentes
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Compatibilidade com API existente', () => {
    test('getById funciona com segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3
      });

      const entries: string[] = [];
      for (let i = 0; i < 5; i++) {
        const entry = await eventLog.append(
          'Libervia',
          TipoEvento.DECISAO_REGISTRADA,
          TipoEntidade.DECISAO,
          `dec-${i}`,
          { index: i }
        );
        entries.push(entry.id);
      }

      // Buscar evento do primeiro segmento
      const event1 = await eventLog.getById(entries[1]);
      expect(event1).not.toBeNull();
      expect(event1!.entidade_id).toBe('dec-1');

      // Buscar evento do segundo segmento
      const event4 = await eventLog.getById(entries[4]);
      expect(event4).not.toBeNull();
      expect(event4!.entidade_id).toBe('dec-4');
    });

    test('getByEvento funciona com segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3
      });

      for (let i = 0; i < 6; i++) {
        await eventLog.append(
          'Libervia',
          i % 2 === 0 ? TipoEvento.SITUACAO_CRIADA : TipoEvento.EPISODIO_CRIADO,
          i % 2 === 0 ? TipoEntidade.SITUACAO : TipoEntidade.EPISODIO,
          `id-${i}`,
          { index: i }
        );
      }

      const situacoes = await eventLog.getByEvento(TipoEvento.SITUACAO_CRIADA);
      expect(situacoes.length).toBe(3);

      const episodios = await eventLog.getByEvento(TipoEvento.EPISODIO_CRIADO);
      expect(episodios.length).toBe(3);
    });

    test('getByEntidade funciona com segmentos', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3
      });

      for (let i = 0; i < 6; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.SITUACAO_CRIADA,
          TipoEntidade.SITUACAO,
          `sit-${i % 2}`, // Alterna entre sit-0 e sit-1
          { index: i }
        );
      }

      const sit0Events = await eventLog.getByEntidade(TipoEntidade.SITUACAO, 'sit-0');
      expect(sit0Events.length).toBe(3);

      const sit1Events = await eventLog.getByEntidade(TipoEntidade.SITUACAO, 'sit-1');
      expect(sit1Events.length).toBe(3);
    });

    test('getLastEntry funciona após rotação', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR, {
        segmentSize: 3
      });

      for (let i = 0; i < 5; i++) {
        await eventLog.append(
          'Libervia',
          TipoEvento.CONTRATO_EMITIDO,
          TipoEntidade.CONTRATO,
          `cont-${i}`,
          { index: i }
        );
      }

      const last = await eventLog.getLastEntry();
      expect(last).not.toBeNull();
      expect(last!.entidade_id).toBe('cont-4');
    });
  });

});
