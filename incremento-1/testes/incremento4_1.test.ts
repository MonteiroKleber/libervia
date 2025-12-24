import * as fs from 'fs/promises';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  StatusSituacao,
  PerfilRisco,
  DadosProtocoloInput
} from '../camada-3/entidades/tipos';

const TEST_DATA_DIR = './test-data-inc4_1-' + Date.now();

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
// TESTES DO INCREMENTO 4.1 - PRODUCTION SAFETY
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 4.1 - EventLog Production Safety', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: GetEventLogStatus retorna estado correto
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: GetEventLogStatus retorna estado correto', () => {
    test('Sem EventLog: enabled=false, degraded=false', async () => {
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

      const status = orq.GetEventLogStatus();

      expect(status.enabled).toBe(false);
      expect(status.degraded).toBe(false);
      expect(status.errorCount).toBe(0);
      expect(status.lastErrors).toHaveLength(0);
    });

    test('Com EventLog: enabled=true, degraded=false após init() bem-sucedido', async () => {
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

      await orq.init();

      const status = orq.GetEventLogStatus();

      expect(status.enabled).toBe(true);
      expect(status.degraded).toBe(false);
      expect(status.errorCount).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: init() detecta corrupção e marca degraded=true
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: init() detecta corrupção e marca degraded', () => {
    test('Cadeia corrompida: degraded=true após init()', async () => {
      // Criar eventLog e adicionar eventos válidos
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      await eventLog.append('Libervia', 'EVENTO_1', 'ENTIDADE', 'id-1', { a: 1 });
      await eventLog.append('Libervia', 'EVENTO_2', 'ENTIDADE', 'id-2', { b: 2 });

      // Corromper manualmente o arquivo de segmento
      const segmentPath = `${TEST_DATA_DIR}/event-log/segment-000001.json`;
      const content = await fs.readFile(segmentPath, 'utf-8');
      const events = JSON.parse(content);
      events[1].current_hash = 'HASH_CORROMPIDO_INTENCIONALMENTE';
      await fs.writeFile(segmentPath, JSON.stringify(events, null, 2));

      // Recarregar eventLog corrompido
      const eventLogCorrompido = await EventLogRepositoryImpl.create(TEST_DATA_DIR);

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
        protocoloRepo,
        eventLogCorrompido
      );

      await orq.init();

      const status = orq.GetEventLogStatus();

      expect(status.enabled).toBe(true);
      expect(status.degraded).toBe(true);
      expect(status.errorCount).toBe(1);
      expect(status.lastErrorAt).toBeDefined();
      expect(status.lastErrorMsg).toContain('corruption');
      expect(status.lastErrors).toHaveLength(1);
      expect(status.lastErrors[0].evento).toBe('INIT_VERIFY');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: VerifyEventLogNow() força verificação
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: VerifyEventLogNow força verificação', () => {
    test('Cadeia íntegra: retorna valid=true', async () => {
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      await eventLog.append('Libervia', 'EVENTO_1', 'ENTIDADE', 'id-1', { a: 1 });

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
        protocoloRepo,
        eventLog
      );

      const result = await orq.VerifyEventLogNow();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(1);

      const status = orq.GetEventLogStatus();
      expect(status.degraded).toBe(false);
    });

    test('Sem EventLog: retorna valid=true, totalVerified=0', async () => {
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
      );

      const result = await orq.VerifyEventLogNow();

      expect(result.valid).toBe(true);
      expect(result.totalVerified).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Ring buffer limita erros a MAX_ERROR_BUFFER (20)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Ring buffer limita erros a 20', () => {
    test('Após 25 erros de verificação, lastErrors tem exatamente 20', async () => {
      // Criar eventLog válido
      const eventLog = await EventLogRepositoryImpl.create(TEST_DATA_DIR);
      await eventLog.append('Libervia', 'EVENTO_1', 'ENTIDADE', 'id-1', { a: 1 });

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
        protocoloRepo,
        eventLog
      );

      // Usar método interno para corromper em memória
      for (let i = 0; i < 25; i++) {
        // Corromper em memória (usando método de debug)
        (eventLog as any)._corruptEntry(0, 'current_hash', `CORRUPTED_${i}`);

        // Verificar (vai falhar e adicionar erro)
        await orq.VerifyEventLogNow();
      }

      const status = orq.GetEventLogStatus();

      expect(status.errorCount).toBe(25);
      expect(status.lastErrors).toHaveLength(20); // Ring buffer de 20
      expect(status.degraded).toBe(true);

      // Todos os erros devem ser sobre hash mismatch do genesis
      expect(status.lastErrors[0].msg).toContain('Genesis event hash mismatch');
      expect(status.lastErrors[19].msg).toContain('Genesis event hash mismatch');
      expect(status.lastErrors[0].evento).toBe('VERIFY_NOW');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Fluxo completo funciona com init()
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Fluxo completo com init()', () => {
    test('ProcessarSolicitacao funciona após init()', async () => {
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

      await orq.init();

      const situacao = criarSituacaoValida('sit-test-init');
      const episodio = await orq.ProcessarSolicitacao(situacao);

      expect(episodio).toBeDefined();
      expect(episodio.situacao_referenciada).toBe('sit-test-init');

      const status = orq.GetEventLogStatus();
      expect(status.enabled).toBe(true);
      expect(status.degraded).toBe(false);
      expect(status.errorCount).toBe(0);

      // Verificar que eventos foram logados
      const allEvents = await eventLog.getAll();
      expect(allEvents.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Operações não bloqueiam se EventLog falhar
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Operações continuam se EventLog falhar', () => {
    test('ProcessarSolicitacao funciona mesmo com EventLog degradado', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      // Criar EventLog mock que sempre falha
      const eventLogFailing = {
        append: async () => { throw new Error('EventLog error simulado'); },
        verifyChain: async () => ({ valid: true, totalVerified: 0 }),
        getAll: async () => [],
        getById: async () => null,
        getByEvento: async () => [],
        getByEntidade: async () => [],
        count: async () => 0
      };

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo,
        eventLogFailing as any
      );

      await orq.init();

      // Operação deve funcionar mesmo com EventLog falhando
      const situacao = criarSituacaoValida('sit-failing-log');
      const episodio = await orq.ProcessarSolicitacao(situacao);

      expect(episodio).toBeDefined();

      const status = orq.GetEventLogStatus();
      expect(status.enabled).toBe(true);
      expect(status.degraded).toBe(true); // Marcado como degradado
      expect(status.errorCount).toBeGreaterThan(0); // Erros foram contados
      expect(status.lastErrors.length).toBeGreaterThan(0);
    });
  });

});
