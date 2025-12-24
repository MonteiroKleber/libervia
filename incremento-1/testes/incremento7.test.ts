/**
 * ════════════════════════════════════════════════════════════════════════════
 * TESTES DO INCREMENTO 7: INTERFACE CONTROLADA BAZARI <-> LIBERVIA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cobertura:
 * 1. Fluxo completo via BazariAdapter
 * 2. Validacao de token de integracao
 * 3. Unica saida = ContratoDeDecisao
 * 4. Nenhum vazamento de dados internos
 * 5. Nenhuma operacao de delete/update em decisoes/contratos
 * 6. Stress test reduzido (N=20)
 * 7. Replay deterministico pos-stress
 *
 * NOTA: Usa diretorios isolados por teste via createTestDataDir
 */

import {
  BazariAdapter,
  SituacaoInput,
  ContratoComMetadados,
  UnauthorizedError,
  ProtocoloRejeitadoError,
  createBazariAdapter
} from '../integracoes/bazari/Adapter';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import {
  DadosProtocoloInput,
  PerfilRisco,
  ContratoDeDecisao
} from '../camada-3/entidades/tipos';
import { createTestDataDir, TestDataDir } from './helpers/testDataDir';

// ════════════════════════════════════════════════════════════════════════════
// FIXTURES
// ════════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(index: number = 0): SituacaoInput {
  return {
    dominio: 'tecnologico',
    contexto: `Contexto de teste ${index}`,
    objetivo: `Objetivo de teste ${index}`,
    incertezas: ['Incerteza A', 'Incerteza B'],
    alternativas: [
      {
        descricao: 'Alternativa 1',
        riscos_associados: ['Risco A1']
      },
      {
        descricao: 'Alternativa 2',
        riscos_associados: ['Risco A2']
      }
    ],
    riscos: [
      {
        descricao: 'Risco principal',
        tipo: 'operacional',
        reversibilidade: 'reversivel'
      }
    ],
    urgencia: 'media',
    capacidade_absorcao: 'alta',
    consequencia_relevante: 'Consequencia relevante',
    possibilidade_aprendizado: true,
    caso_uso_declarado: 1
  };
}

function criarProtocoloValido(situacao: SituacaoInput): DadosProtocoloInput {
  return {
    criterios_minimos: [
      'Criterio de viabilidade',
      'Criterio de risco aceitavel',
      'Criterio de alinhamento'
    ],
    riscos_considerados: situacao.riscos.map(r => r.descricao),
    limites_definidos: [
      { tipo: 'tempo', descricao: 'Prazo maximo', valor: '30 dias' }
    ],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: situacao.alternativas.map(a => a.descricao),
    alternativa_escolhida: situacao.alternativas[0].descricao,
    memoria_consultada_ids: []
  };
}

function criarProtocoloInvalido(): DadosProtocoloInput {
  return {
    criterios_minimos: [], // Vazio - invalido
    riscos_considerados: [],
    limites_definidos: [],
    perfil_risco: PerfilRisco.CONSERVADOR,
    alternativas_avaliadas: ['Alt 1'],
    alternativa_escolhida: 'Alt inexistente', // Nao esta em avaliadas
    memoria_consultada_ids: []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP HELPERS
// ════════════════════════════════════════════════════════════════════════════

async function criarOrquestradorCompleto(dataDir: string): Promise<{
  orquestrador: OrquestradorCognitivo;
  eventLog: EventLogRepositoryImpl;
  situacaoRepo: SituacaoRepositoryImpl;
  episodioRepo: EpisodioRepositoryImpl;
  decisaoRepo: DecisaoRepositoryImpl;
  contratoRepo: ContratoRepositoryImpl;
  protocoloRepo: DecisionProtocolRepositoryImpl;
}> {
  const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
  const eventLog = await EventLogRepositoryImpl.create(dataDir);

  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );

  return {
    orquestrador,
    eventLog,
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    protocoloRepo
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 7: Interface Controlada Bazari <-> Libervia', () => {

  describe('1. Fluxo Completo via Adapter', () => {
    let adapter: BazariAdapter;
    let orquestrador: OrquestradorCognitivo;
    let testDir: TestDataDir;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-fluxo');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      orquestrador = deps.orquestrador;
      await orquestrador.init();
      adapter = createBazariAdapter(orquestrador);
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('solicitarDecisao retorna ContratoComMetadados', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);

      expect(resultado).toBeDefined();
      expect(resultado.contrato).toBeDefined();
      expect(resultado.metadados).toBeDefined();
    });

    test('Contrato possui todos os campos obrigatorios', async () => {
      const situacao = criarSituacaoValida(1);
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      const contrato = resultado.contrato;

      expect(contrato.id).toBeDefined();
      expect(contrato.episodio_id).toBeDefined();
      expect(contrato.decisao_id).toBeDefined();
      expect(contrato.alternativa_autorizada).toBe(situacao.alternativas[0].descricao);
      expect(contrato.limites_execucao).toBeDefined();
      expect(contrato.condicoes_obrigatorias).toBeDefined();
      expect(contrato.observacao_minima_requerida).toBeDefined();
      expect(contrato.data_emissao).toBeDefined();
      expect(contrato.emitido_para).toBe('Bazari');
    });

    test('Metadados possuem informacoes de rastreio', async () => {
      const situacao = criarSituacaoValida(2);
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      const metadados = resultado.metadados;

      expect(metadados.request_id).toBeDefined();
      expect(metadados.request_id).toMatch(/^req-/);
      expect(metadados.timestamp_solicitacao).toBeDefined();
      expect(metadados.timestamp_emissao).toBeDefined();
      expect(metadados.versao_contrato).toBe('v1');
    });

    test('consultarStatusDoContrato retorna status publico do contrato', async () => {
      const situacao = criarSituacaoValida(3);
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      const status = adapter.consultarStatusDoContrato(resultado.contrato);

      expect(status).toBeDefined();
      expect(status.episodio_id).toBe(resultado.contrato.episodio_id);
      expect(status.estado).toBe('DECIDIDO');
      expect(status.tem_contrato).toBe(true);
    });
  });

  describe('2. Validacao de Token', () => {
    let adapter: BazariAdapter;
    let testDir: TestDataDir;
    const TOKEN_SECRETO = 'token-secreto-teste';

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-token');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      adapter = createBazariAdapter(deps.orquestrador, TOKEN_SECRETO);
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('Requisicao sem token falha quando token configurado', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      await expect(
        adapter.solicitarDecisao(situacao, protocolo)
      ).rejects.toThrow(UnauthorizedError);
    });

    test('Requisicao com token invalido falha', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      await expect(
        adapter.solicitarDecisao(situacao, protocolo, 'token-errado')
      ).rejects.toThrow(UnauthorizedError);
    });

    test('Requisicao com token correto sucede', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo, TOKEN_SECRETO);

      expect(resultado.contrato).toBeDefined();
    });

    test('consultarStatusDoContrato requer token quando configurado', () => {
      const contratoFake: ContratoDeDecisao = {
        id: 'test-id',
        episodio_id: 'ep-id',
        decisao_id: 'dec-id',
        alternativa_autorizada: 'Alt 1',
        limites_execucao: [],
        condicoes_obrigatorias: [],
        observacao_minima_requerida: [],
        data_emissao: new Date(),
        emitido_para: 'Bazari'
      };

      expect(() => {
        adapter.consultarStatusDoContrato(contratoFake);
      }).toThrow(UnauthorizedError);
    });
  });

  describe('3. Protocolo Rejeitado', () => {
    let adapter: BazariAdapter;
    let testDir: TestDataDir;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-protocolo');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      adapter = createBazariAdapter(deps.orquestrador);
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('Protocolo invalido gera ProtocoloRejeitadoError', async () => {
      const situacao = criarSituacaoValida();
      const protocoloInvalido = criarProtocoloInvalido();

      await expect(
        adapter.solicitarDecisao(situacao, protocoloInvalido)
      ).rejects.toThrow(ProtocoloRejeitadoError);
    });

    test('Erro contem motivo da rejeicao', async () => {
      const situacao = criarSituacaoValida();
      const protocoloInvalido = criarProtocoloInvalido();

      try {
        await adapter.solicitarDecisao(situacao, protocoloInvalido);
        fail('Deveria ter lancado erro');
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocoloRejeitadoError);
        expect((error as ProtocoloRejeitadoError).motivo).toBeDefined();
      }
    });
  });

  describe('4. Sem Vazamento de Dados', () => {
    let adapter: BazariAdapter;
    let testDir: TestDataDir;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-vazamento');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      adapter = createBazariAdapter(deps.orquestrador);
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('Resultado nao contem campos internos do orquestrador', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      const json = JSON.stringify(resultado);

      // Campos que NAO devem aparecer
      expect(json).not.toContain('"eventLog"');
      expect(json).not.toContain('"situacaoRepo"');
      expect(json).not.toContain('"episodioRepo"');
      expect(json).not.toContain('"decisaoRepo"');
      expect(json).not.toContain('"protocoloRepo"');
      expect(json).not.toContain('"memoryService"');
      expect(json).not.toContain('"errorBuffer"');
      expect(json).not.toContain('"degraded"');
    });

    test('Status publico nao expoe detalhes internos', async () => {
      const situacao = criarSituacaoValida();
      const protocolo = criarProtocoloValido(situacao);

      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      const status = adapter.consultarStatusDoContrato(resultado.contrato);
      const json = JSON.stringify(status);

      // Apenas campos publicos
      expect(status).toHaveProperty('episodio_id');
      expect(status).toHaveProperty('estado');
      expect(status).toHaveProperty('tem_contrato');
      expect(status).toHaveProperty('data_criacao');

      // Nao deve ter campos internos
      expect(json).not.toContain('"situacao_referenciada"');
    });
  });

  describe('5. Garantias de Imutabilidade (Sem Delete/Update)', () => {
    let situacaoRepo: SituacaoRepositoryImpl;
    let episodioRepo: EpisodioRepositoryImpl;
    let decisaoRepo: DecisaoRepositoryImpl;
    let contratoRepo: ContratoRepositoryImpl;
    let protocoloRepo: DecisionProtocolRepositoryImpl;
    let testDir: TestDataDir;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-imutabilidade');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      situacaoRepo = deps.situacaoRepo;
      episodioRepo = deps.episodioRepo;
      decisaoRepo = deps.decisaoRepo;
      contratoRepo = deps.contratoRepo;
      protocoloRepo = deps.protocoloRepo;
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('DecisaoRepository nao possui metodo delete', () => {
      expect((decisaoRepo as any).delete).toBeUndefined();
    });

    test('DecisaoRepository nao possui metodo update', () => {
      expect((decisaoRepo as any).update).toBeUndefined();
    });

    test('ContratoRepository nao possui metodo delete', () => {
      expect((contratoRepo as any).delete).toBeUndefined();
    });

    test('ContratoRepository nao possui metodo update', () => {
      expect((contratoRepo as any).update).toBeUndefined();
    });

    test('DecisionProtocolRepository nao possui metodo delete', () => {
      expect((protocoloRepo as any).delete).toBeUndefined();
    });

    test('DecisionProtocolRepository nao possui metodo update', () => {
      expect((protocoloRepo as any).update).toBeUndefined();
    });

    test('EpisodioRepository nao possui metodo delete', () => {
      expect((episodioRepo as any).delete).toBeUndefined();
    });
  });

  describe('6. Stress Test Reduzido (N=20)', () => {
    let adapter: BazariAdapter;
    let eventLog: EventLogRepositoryImpl;
    let testDir: TestDataDir;
    const N = 20;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-stress');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      adapter = createBazariAdapter(deps.orquestrador);
      eventLog = deps.eventLog;
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test(`Processar ${N} requisicoes com sucesso`, async () => {
      const resultados: ContratoComMetadados[] = [];

      for (let i = 0; i < N; i++) {
        const situacao = criarSituacaoValida(i);
        const protocolo = criarProtocoloValido(situacao);
        const resultado = await adapter.solicitarDecisao(situacao, protocolo);
        resultados.push(resultado);
      }

      expect(resultados.length).toBe(N);
      expect(resultados.every(r => r.contrato && r.contrato.id)).toBe(true);
    });

    test('Todos os contratos sao unicos', async () => {
      const situacao = criarSituacaoValida(100);
      const protocolo = criarProtocoloValido(situacao);

      const resultado1 = await adapter.solicitarDecisao(situacao, protocolo);

      const situacao2 = criarSituacaoValida(101);
      const protocolo2 = criarProtocoloValido(situacao2);
      const resultado2 = await adapter.solicitarDecisao(situacao2, protocolo2);

      expect(resultado1.contrato.id).not.toBe(resultado2.contrato.id);
      expect(resultado1.metadados.request_id).not.toBe(resultado2.metadados.request_id);
    });

    test('Request counter incrementa corretamente', async () => {
      const countBefore = adapter.getRequestCount();

      const situacao = criarSituacaoValida(200);
      const protocolo = criarProtocoloValido(situacao);
      await adapter.solicitarDecisao(situacao, protocolo);

      const countAfter = adapter.getRequestCount();
      expect(countAfter).toBe(countBefore + 1);
    });
  });

  describe('7. Replay Deterministico Pos-Stress', () => {
    let eventLog: EventLogRepositoryImpl;
    let adapter: BazariAdapter;
    let testDir: TestDataDir;
    const N = 10;

    beforeAll(async () => {
      testDir = await createTestDataDir('inc7-replay');
      const deps = await criarOrquestradorCompleto(testDir.dir);
      await deps.orquestrador.init();
      adapter = createBazariAdapter(deps.orquestrador);
      eventLog = deps.eventLog;

      // Gerar alguns eventos
      for (let i = 0; i < N; i++) {
        const situacao = criarSituacaoValida(i);
        const protocolo = criarProtocoloValido(situacao);
        await adapter.solicitarDecisao(situacao, protocolo);
      }
    });

    afterAll(async () => {
      await testDir.cleanup();
    });

    test('verifyChain retorna valid=true', async () => {
      const result = await eventLog.verifyChain();
      expect(result.valid).toBe(true);
    });

    test('replay e deterministico', async () => {
      const replay1 = await eventLog.replay();
      const replay2 = await eventLog.replay();

      expect(replay1.totalEventos).toBe(replay2.totalEventos);
      expect(JSON.stringify(replay1.porEvento)).toBe(JSON.stringify(replay2.porEvento));
      expect(JSON.stringify(replay1.porAtor)).toBe(JSON.stringify(replay2.porAtor));
    });

    test('replay contem eventos esperados', async () => {
      const replay = await eventLog.replay();

      // Cada decisao gera multiplos eventos
      expect(replay.totalEventos).toBeGreaterThan(0);
      expect(replay.porEvento).toHaveProperty('SITUACAO_CRIADA');
      expect(replay.porEvento).toHaveProperty('EPISODIO_CRIADO');
      expect(replay.porEvento).toHaveProperty('PROTOCOLO_VALIDADO');
      expect(replay.porEvento).toHaveProperty('DECISAO_REGISTRADA');
      expect(replay.porEvento).toHaveProperty('CONTRATO_EMITIDO');
    });

    test('replay nao possui inconsistencias', async () => {
      const replay = await eventLog.replay();
      expect(replay.inconsistencias).toEqual([]);
    });
  });

  describe('8. Factory Function', () => {
    test('createBazariAdapter cria instancia corretamente', async () => {
      const testDir = await createTestDataDir('inc7-factory');

      try {
        const deps = await criarOrquestradorCompleto(testDir.dir);
        await deps.orquestrador.init();

        const adapter = createBazariAdapter(deps.orquestrador, 'token-teste');

        expect(adapter).toBeInstanceOf(BazariAdapter);
      } finally {
        await testDir.cleanup();
      }
    });
  });

});
