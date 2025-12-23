import * as fs from 'fs/promises';
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';
import { computeEventHash, computePayloadHash } from '../utilitarios/HashUtil';

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

const TEST_DATA_DIR = './test-data-inc4-' + Date.now();

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
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(id?: string): SituacaoDecisoria {
  return {
    id: id ?? `situacao-${Date.now()}`,
    dominio: 'Teste',
    contexto: 'Contexto de teste para decisão',
    objetivo: 'Objetivo claro e mensurável',
    incertezas: ['Incerteza real'],
    alternativas: [
      { descricao: 'Alternativa A', riscos_associados: ['risco-1'] },
      { descricao: 'Alternativa B', riscos_associados: ['risco-2'] }
    ],
    riscos: [{ descricao: 'Risco identificado', tipo: 'Operacional', reversibilidade: 'Parcial' }],
    urgencia: 'Média',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequência significativa',
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

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 4
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 4 - Event-Log com Hash Encadeado', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Hash encadeado válido
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Hash encadeado válido', () => {
    test('Eventos consecutivos formam cadeia de hash válida', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      // Adicionar 3 eventos
      const evento1 = await eventLog.append(
        'Libervia',
        TipoEvento.SITUACAO_CRIADA,
        TipoEntidade.SITUACAO,
        'sit-1',
        { id: 'sit-1', nome: 'Teste' }
      );

      const evento2 = await eventLog.append(
        'Libervia',
        TipoEvento.EPISODIO_CRIADO,
        TipoEntidade.EPISODIO,
        'ep-1',
        { id: 'ep-1', situacao: 'sit-1' }
      );

      const evento3 = await eventLog.append(
        'Libervia',
        TipoEvento.DECISAO_REGISTRADA,
        TipoEntidade.DECISAO,
        'dec-1',
        { id: 'dec-1', episodio: 'ep-1' }
      );

      // Verificar encadeamento
      expect(evento1.previous_hash).toBeNull();
      expect(evento2.previous_hash).toBe(evento1.current_hash);
      expect(evento3.previous_hash).toBe(evento2.current_hash);

      // Verificar que hashes são diferentes
      expect(evento1.current_hash).not.toBe(evento2.current_hash);
      expect(evento2.current_hash).not.toBe(evento3.current_hash);

      // Verificar integridade da cadeia
      const result = await eventLog.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(3);
    });

    test('Genesis event tem previous_hash null', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const genesis = await eventLog.append(
        'Bazari',
        TipoEvento.SITUACAO_CRIADA,
        TipoEntidade.SITUACAO,
        'sit-1',
        { id: 'sit-1' }
      );

      expect(genesis.previous_hash).toBeNull();
      expect(genesis.current_hash).toBeDefined();
      expect(genesis.current_hash.length).toBe(64); // SHA-256 hex
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Alteração retroativa quebra cadeia
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Alteração retroativa quebra cadeia', () => {
    test('Modificar evento quebra verificação', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', { id: 'sit-1' });
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', { id: 'ep-1' });
      await eventLog.append('Libervia', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, 'dec-1', { id: 'dec-1' });

      // Corromper o segundo evento
      (eventLog as any)._corruptEntry(1, 'payload_hash', 'hash_corrompido');

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(1);
      expect(result.reason).toContain('Hash mismatch');
    });

    test('Quebrar encadeamento (previous_hash) é detectado', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', { id: 'sit-1' });
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', { id: 'ep-1' });

      // Corromper o encadeamento
      (eventLog as any)._corruptEntry(1, 'previous_hash', 'hash_invalido');

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(1);
      expect(result.reason).toContain('Chain broken');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Ordem cronológica preservada
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Ordem cronológica preservada', () => {
    test('Eventos são retornados em ordem cronológica', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e1 = await eventLog.append('Libervia', 'EVENTO_1', 'Entidade', 'id-1', {});
      await new Promise(resolve => setTimeout(resolve, 10));
      const e2 = await eventLog.append('Libervia', 'EVENTO_2', 'Entidade', 'id-2', {});
      await new Promise(resolve => setTimeout(resolve, 10));
      const e3 = await eventLog.append('Libervia', 'EVENTO_3', 'Entidade', 'id-3', {});

      const todos = await eventLog.getAll();

      expect(todos.length).toBe(3);
      expect(todos[0].id).toBe(e1.id);
      expect(todos[1].id).toBe(e2.id);
      expect(todos[2].id).toBe(e3.id);

      // Verificar que timestamps são crescentes
      expect(todos[0].timestamp.getTime()).toBeLessThan(todos[1].timestamp.getTime());
      expect(todos[1].timestamp.getTime()).toBeLessThan(todos[2].timestamp.getTime());
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Append-only garantido
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Append-only garantido', () => {
    test('EventLogRepository não possui método update', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      expect((eventLog as any).update).toBeUndefined();
      expect((eventLog as any).updateEntry).toBeUndefined();
      expect((eventLog as any).modify).toBeUndefined();
    });

    test('EventLogRepository não possui método delete', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      expect((eventLog as any).delete).toBeUndefined();
      expect((eventLog as any).remove).toBeUndefined();
      expect((eventLog as any).clear).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: verifyChain detecta corrupção
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: verifyChain detecta corrupção', () => {
    test('Cadeia vazia é válida', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(0);
    });

    test('Cadeia com um evento é válida', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', 'TESTE', 'Entidade', 'id-1', { valor: 1 });

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(1);
    });

    test('Corrupção no meio da cadeia é detectada', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      for (let i = 0; i < 10; i++) {
        await eventLog.append('Libervia', `EVENTO_${i}`, 'Entidade', `id-${i}`, { index: i });
      }

      // Corromper evento no índice 5
      (eventLog as any)._corruptEntry(5, 'evento', 'EVENTO_CORROMPIDO');

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(5);
      expect(result.totalVerified).toBe(5);
    });

    test('Genesis com previous_hash não-null é detectado', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', 'TESTE', 'Entidade', 'id-1', {});

      // Corromper genesis
      (eventLog as any)._corruptEntry(0, 'previous_hash', 'hash_invalido');

      const result = await eventLog.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.firstInvalidIndex).toBe(0);
      expect(result.reason).toContain('Genesis');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Compatível com Incrementos 1–3
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Compatibilidade com Incrementos 1-3', () => {
    test('Orquestrador funciona sem EventLog (opcional)', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      // Orquestrador SEM EventLog
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo
        // Sem eventLog
      );

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      expect(episodio).toBeDefined();
      expect(episodio.id).toBeDefined();
    });

    test('Orquestrador registra eventos no EventLog quando configurado', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      // Orquestrador COM EventLog
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLog
      );

      // Executar fluxo completo
      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );

      const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
        alternativa_escolhida: 'Alternativa A',
        criterios: ['Custo', 'Prazo'],
        perfil_risco: PerfilRisco.MODERADO,
        limites: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
        condicoes: ['Condição 1']
      });

      // Verificar que eventos foram registrados
      const eventos = await eventLog.getAll();

      // Esperados: SITUACAO_CRIADA, 3x SITUACAO_STATUS_ALTERADO, EPISODIO_CRIADO,
      // PROTOCOLO_VALIDADO, DECISAO_REGISTRADA, EPISODIO_ESTADO_ALTERADO,
      // SITUACAO_STATUS_ALTERADO, CONTRATO_EMITIDO
      expect(eventos.length).toBeGreaterThan(5);

      // Verificar tipos de eventos
      const tiposEvento = eventos.map(e => e.evento);
      expect(tiposEvento).toContain(TipoEvento.SITUACAO_CRIADA);
      expect(tiposEvento).toContain(TipoEvento.EPISODIO_CRIADO);
      expect(tiposEvento).toContain(TipoEvento.PROTOCOLO_VALIDADO);
      expect(tiposEvento).toContain(TipoEvento.DECISAO_REGISTRADA);
      expect(tiposEvento).toContain(TipoEvento.CONTRATO_EMITIDO);

      // Verificar integridade da cadeia
      const result = await eventLog.verifyChain();
      expect(result.valid).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Persistência do EventLog
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Persistência do EventLog', () => {
    test('Eventos persistem após reinicialização', async () => {
      // Primeira instância
      const eventLog1 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog1.append('Libervia', 'EVENTO_1', 'Entidade', 'id-1', { valor: 1 });
      await eventLog1.append('Libervia', 'EVENTO_2', 'Entidade', 'id-2', { valor: 2 });

      const hash1 = (await eventLog1.getLastEntry())!.current_hash;

      // Segunda instância (simula restart)
      const eventLog2 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const eventos = await eventLog2.getAll();
      expect(eventos.length).toBe(2);

      const hash2 = (await eventLog2.getLastEntry())!.current_hash;
      expect(hash2).toBe(hash1);

      // Cadeia ainda válida
      const result = await eventLog2.verifyChain();
      expect(result.valid).toBe(true);
    });

    test('Novos eventos são adicionados à cadeia existente após reload', async () => {
      const eventLog1 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e1 = await eventLog1.append('Libervia', 'EVENTO_1', 'Entidade', 'id-1', {});

      // Reload
      const eventLog2 = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e2 = await eventLog2.append('Libervia', 'EVENTO_2', 'Entidade', 'id-2', {});

      expect(e2.previous_hash).toBe(e1.current_hash);

      const result = await eventLog2.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Consultas ao EventLog
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Consultas ao EventLog', () => {
    test('getByEvento filtra corretamente', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, 'sit-2', {});

      const situacoes = await eventLog.getByEvento(TipoEvento.SITUACAO_CRIADA);

      expect(situacoes.length).toBe(2);
      expect(situacoes.every(e => e.evento === TipoEvento.SITUACAO_CRIADA)).toBe(true);
    });

    test('getByEntidade filtra corretamente', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      await eventLog.append('Libervia', 'EVENTO_1', TipoEntidade.SITUACAO, 'sit-1', {});
      await eventLog.append('Libervia', 'EVENTO_2', TipoEntidade.EPISODIO, 'ep-1', {});
      await eventLog.append('Libervia', 'EVENTO_3', TipoEntidade.SITUACAO, 'sit-1', {});

      const eventosSit1 = await eventLog.getByEntidade(TipoEntidade.SITUACAO, 'sit-1');

      expect(eventosSit1.length).toBe(2);
      expect(eventosSit1.every(e => e.entidade_id === 'sit-1')).toBe(true);
    });

    test('getById retorna evento correto', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e1 = await eventLog.append('Libervia', 'EVENTO_1', 'Entidade', 'id-1', {});
      await eventLog.append('Libervia', 'EVENTO_2', 'Entidade', 'id-2', {});

      const encontrado = await eventLog.getById(e1.id);

      expect(encontrado).not.toBeNull();
      expect(encontrado!.id).toBe(e1.id);
      expect(encontrado!.current_hash).toBe(e1.current_hash);
    });

    test('count retorna total correto', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      expect(await eventLog.count()).toBe(0);

      await eventLog.append('Libervia', 'EVENTO_1', 'Entidade', 'id-1', {});
      await eventLog.append('Libervia', 'EVENTO_2', 'Entidade', 'id-2', {});
      await eventLog.append('Libervia', 'EVENTO_3', 'Entidade', 'id-3', {});

      expect(await eventLog.count()).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Hash do payload
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: Hash do payload', () => {
    test('Payload diferente gera hash diferente', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e1 = await eventLog.append('Libervia', 'EVENTO', 'Entidade', 'id-1', { valor: 1 });
      const e2 = await eventLog.append('Libervia', 'EVENTO', 'Entidade', 'id-2', { valor: 2 });

      expect(e1.payload_hash).not.toBe(e2.payload_hash);
    });

    test('Payload igual gera hash igual', async () => {
      const payload = { chave: 'valor', numero: 42 };

      const hash1 = computePayloadHash(payload);
      const hash2 = computePayloadHash(payload);

      expect(hash1).toBe(hash2);
    });

    test('Ordem das chaves não afeta hash do payload', async () => {
      const payload1 = { a: 1, b: 2 };
      const payload2 = { b: 2, a: 1 };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: Atores (Libervia e Bazari)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 10: Atores (Libervia e Bazari)', () => {
    test('Actor é registrado corretamente', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const e1 = await eventLog.append('Libervia', 'EVENTO_LIBERVIA', 'Entidade', 'id-1', {});
      const e2 = await eventLog.append('Bazari', 'EVENTO_BAZARI', 'Entidade', 'id-2', {});

      expect(e1.actor).toBe('Libervia');
      expect(e2.actor).toBe('Bazari');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 11: Garantias de Incrementos anteriores preservadas
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 11: Garantias anteriores preservadas', () => {
    test('Fluxo completo funciona com EventLog ativo', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLog
      );

      // Fluxo completo: Situação → Episódio → Protocolo → Decisão → Contrato
      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);
      expect(episodio).toBeDefined();

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );
      expect(protocolo.estado).toBe('VALIDADO');

      const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
        alternativa_escolhida: 'Alternativa A',
        criterios: ['Custo', 'Prazo'],
        perfil_risco: PerfilRisco.MODERADO,
        limites: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
        condicoes: ['Condição 1']
      });
      expect(contrato.emitido_para).toBe('Bazari');

      // Iniciar observação
      await orquestrador.IniciarObservacao(episodio.id);

      // Encerrar episódio
      await orquestrador.EncerrarEpisodio(episodio.id);

      // Verificar que EventLog capturou todo o fluxo
      const eventos = await eventLog.getAll();
      expect(eventos.length).toBeGreaterThan(10);

      // Verificar integridade
      const result = await eventLog.verifyChain();
      expect(result.valid).toBe(true);
    });
  });
});
