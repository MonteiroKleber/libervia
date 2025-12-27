/**
 * TESTES - Incremento 16: Multiagente (Camada de Decisão)
 *
 * Testa:
 * - Políticas de agregação (FIRST_VALID, MAJORITY, WEIGHTED, CONSENSUS, HUMAN_OVERRIDE)
 * - Bloqueio por Closed Layer em agentes individuais
 * - EventLog registra eventos multiagente
 * - Tie-break determinístico
 * - Compatibilidade com fluxo single-agent
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Imports de tipos multiagente
import {
  AgentProfile,
  AggregationPolicy,
  MultiAgentRunInput,
  AgentProposalResult,
  MultiAgentRunResult,
  MultiAgentError,
  aggregate,
  aggregateFirstValid,
  aggregateMajorityByAlternative,
  aggregateWeightedMajority,
  aggregateRequireConsensus,
  aggregateHumanOverrideRequired,
  applyTieBreak,
  selectAlternativeForAgent
} from '../camada-3/multiagente';

// Imports do Core
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { ClosedLayerResult } from '../camada-3/camada-fechada';

// Repositórios
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';

// Tipos
import {
  StatusSituacao,
  EstadoEpisodio,
  PerfilRisco,
  SituacaoDecisoria,
  Limite
} from '../camada-3/entidades/tipos';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc16';

beforeAll(async () => {
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function createTestDir(suffix: string): string {
  return path.join(TEST_DATA_DIR, suffix);
}

function createValidSituacao(id: string): SituacaoDecisoria {
  return {
    id,
    dominio: 'teste',
    contexto: 'Contexto de teste para multiagente',
    objetivo: 'Objetivo de teste',
    incertezas: ['Incerteza 1', 'Incerteza 2'],
    alternativas: [
      { descricao: 'Alternativa A', riscos_associados: ['risco-1'] },
      { descricao: 'Alternativa B', riscos_associados: ['risco-2'] },
      { descricao: 'Alternativa C', riscos_associados: ['risco-3'] }
    ],
    riscos: [{ descricao: 'Risco identificado', tipo: 'Operacional', reversibilidade: 'Parcial' }],
    urgencia: 'Média',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequência significativa para a organização',
    possibilidade_aprendizado: true,
    caso_uso_declarado: 1,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    anexos_analise: []
  };
}

function createValidLimite(): Limite {
  return { tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' };
}

function createAgentProfiles(): AgentProfile[] {
  return [
    { agentId: 'conservador-1', perfilRisco: PerfilRisco.CONSERVADOR, peso: 1 },
    { agentId: 'moderado-1', perfilRisco: PerfilRisco.MODERADO, peso: 2 },
    { agentId: 'agressivo-1', perfilRisco: PerfilRisco.AGRESSIVO, peso: 1 }
  ];
}

function createMultiAgentInput(
  agents: AgentProfile[],
  policy: AggregationPolicy
): MultiAgentRunInput {
  return {
    agents,
    aggregationPolicy: policy,
    protocoloBase: {
      criterios_minimos: ['Critério 1', 'Critério 2'],
      riscos_considerados: ['Risco 1'],
      limites_definidos: [createValidLimite()],
      alternativas_avaliadas: ['Alternativa A', 'Alternativa B', 'Alternativa C']
    },
    decisaoBase: {
      criterios: ['Critério 1'],
      limites: [createValidLimite()],
      condicoes: ['Condição 1']
    }
  };
}

async function setupOrquestrador(testName: string) {
  const dir = createTestDir(testName);
  await fs.mkdir(dir, { recursive: true });

  const situacaoRepo = await SituacaoRepositoryImpl.create(dir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dir);
  const contratoRepo = await ContratoRepositoryImpl.create(dir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dir);
  const eventLog = await EventLogRepositoryImpl.create(dir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );

  await orquestrador.init();

  return {
    orquestrador,
    eventLog,
    dir
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: AGREGADOR (FUNÇÕES PURAS)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - Agregador (funções puras)', () => {
  const mockClosedLayerPassed: ClosedLayerResult = {
    blocked: false,
    rule: '',
    reason: ''
  };

  const mockClosedLayerBlocked: ClosedLayerResult = {
    blocked: true,
    rule: 'BLOQUEAR_SEM_RISCO',
    reason: 'Situação sem risco identificado'
  };

  function createMockResult(
    agentId: string,
    perfilRisco: PerfilRisco,
    alternativa: string | null,
    blocked: boolean = false
  ): AgentProposalResult {
    return {
      agentId,
      perfilRisco,
      closedLayerResult: blocked ? mockClosedLayerBlocked : mockClosedLayerPassed,
      blocked,
      protocolo: null,
      alternativaEscolhida: alternativa,
      decisaoId: blocked ? null : `dec-${agentId}`,
      contratoCandidato: null
    };
  }

  describe('FIRST_VALID', () => {
    test('Escolhe a primeira decisão não bloqueada', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, null, true), // bloqueado
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa B'),
        createMockResult('agent-3', PerfilRisco.AGRESSIVO, 'Alternativa C')
      ];

      const decision = aggregateFirstValid(results);

      expect(decision.decided).toBe(true);
      expect(decision.selectedAgentId).toBe('agent-2');
      expect(decision.alternativaFinal).toBe('Alternativa B');
    });

    test('Retorna ALL_AGENTS_BLOCKED se todos bloqueados', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, null, true),
        createMockResult('agent-2', PerfilRisco.MODERADO, null, true)
      ];

      const decision = aggregateFirstValid(results);

      expect(decision.decided).toBe(false);
      expect(decision.noDecisionReason).toBe('ALL_AGENTS_BLOCKED');
    });
  });

  describe('MAJORITY_BY_ALTERNATIVE', () => {
    test('Vence alternativa mais votada', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alternativa A'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa B'),
        createMockResult('agent-3', PerfilRisco.AGRESSIVO, 'Alternativa B')
      ];

      const decision = aggregateMajorityByAlternative(results);

      expect(decision.decided).toBe(true);
      expect(decision.alternativaFinal).toBe('Alternativa B');
      expect(decision.votesByAlternative).toEqual({
        'Alternativa A': 1,
        'Alternativa B': 2
      });
    });

    test('Tie-break por ordem lexicográfica', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Zebra'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alfa')
      ];

      const decision = aggregateMajorityByAlternative(results);

      expect(decision.decided).toBe(true);
      expect(decision.alternativaFinal).toBe('Alfa'); // Lexicograficamente menor
      expect(decision.tieBreakDetails).toContain('lexicographic');
    });
  });

  describe('WEIGHTED_MAJORITY', () => {
    test('Usa peso dos agentes', () => {
      const agents: AgentProfile[] = [
        { agentId: 'agent-1', perfilRisco: PerfilRisco.CONSERVADOR, peso: 1 },
        { agentId: 'agent-2', perfilRisco: PerfilRisco.MODERADO, peso: 5 }
      ];

      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alternativa A'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa B')
      ];

      const decision = aggregateWeightedMajority(results, agents);

      expect(decision.decided).toBe(true);
      expect(decision.alternativaFinal).toBe('Alternativa B'); // Peso 5 > 1
      expect(decision.votesByAlternative).toEqual({
        'Alternativa A': 1,
        'Alternativa B': 5
      });
    });
  });

  describe('REQUIRE_CONSENSUS', () => {
    test('Decide se todos concordam', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alternativa A'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa A'),
        createMockResult('agent-3', PerfilRisco.AGRESSIVO, 'Alternativa A')
      ];

      const decision = aggregateRequireConsensus(results);

      expect(decision.decided).toBe(true);
      expect(decision.alternativaFinal).toBe('Alternativa A');
    });

    test('Retorna NO_CONSENSUS se divergente', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alternativa A'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa B')
      ];

      const decision = aggregateRequireConsensus(results);

      expect(decision.decided).toBe(false);
      expect(decision.noDecisionReason).toBe('NO_CONSENSUS');
    });
  });

  describe('HUMAN_OVERRIDE_REQUIRED', () => {
    test('Retorna candidatos sem decisão final', () => {
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alternativa A'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alternativa B')
      ];

      const decision = aggregateHumanOverrideRequired(results);

      expect(decision.decided).toBe(false);
      expect(decision.noDecisionReason).toBe('HUMAN_OVERRIDE_PENDING');
      expect(decision.votesByAlternative).toEqual({
        'Alternativa A': 1,
        'Alternativa B': 1
      });
    });
  });

  describe('Tie-break determinístico', () => {
    test('Alternativa lexicograficamente menor vence', () => {
      const candidates = [
        { agentId: 'agent-2', alternativa: 'Zebra' },
        { agentId: 'agent-1', alternativa: 'Alfa' }
      ];
      const results: AgentProposalResult[] = [];

      const result = applyTieBreak(candidates, results);

      expect(result.alternativa).toBe('Alfa');
    });

    test('Se alternativas iguais, usa ordem dos agentes', () => {
      const candidates = [
        { agentId: 'agent-2', alternativa: 'Alfa' },
        { agentId: 'agent-1', alternativa: 'Alfa' }
      ];
      const results: AgentProposalResult[] = [
        createMockResult('agent-1', PerfilRisco.CONSERVADOR, 'Alfa'),
        createMockResult('agent-2', PerfilRisco.MODERADO, 'Alfa')
      ];

      const result = applyTieBreak(candidates, results);

      expect(result.agentId).toBe('agent-1'); // Primeiro na ordem
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SELEÇÃO DE ALTERNATIVA POR PERFIL
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - Seleção de alternativa por perfil', () => {
  const alternativas = ['Alternativa A', 'Alternativa B', 'Alternativa C'];

  test('CONSERVADOR escolhe primeira alternativa', () => {
    const agent: AgentProfile = { agentId: 'cons', perfilRisco: PerfilRisco.CONSERVADOR };
    const result = selectAlternativeForAgent(agent, alternativas);
    expect(result).toBe('Alternativa A');
  });

  test('MODERADO escolhe alternativa do meio', () => {
    const agent: AgentProfile = { agentId: 'mod', perfilRisco: PerfilRisco.MODERADO };
    const result = selectAlternativeForAgent(agent, alternativas);
    expect(result).toBe('Alternativa B');
  });

  test('AGRESSIVO escolhe última alternativa', () => {
    const agent: AgentProfile = { agentId: 'agr', perfilRisco: PerfilRisco.AGRESSIVO };
    const result = selectAlternativeForAgent(agent, alternativas);
    expect(result).toBe('Alternativa C');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ORQUESTRADOR MULTIAGENTE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - OrquestradorCognitivo.ProcessarSolicitacaoMultiAgente', () => {
  test('FIRST_VALID retorna primeira decisão válida', async () => {
    const { orquestrador } = await setupOrquestrador('orq-first-valid');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    expect(result.runId).toBeDefined();
    expect(result.episodioId).toBeDefined();
    expect(result.agentResults.length).toBe(3);
    expect(result.aggregation.decided).toBe(true);
    expect(result.contratoFinal).not.toBeNull();
  });

  test('MAJORITY_BY_ALTERNATIVE resolve com votação', async () => {
    const { orquestrador } = await setupOrquestrador('orq-majority');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'MAJORITY_BY_ALTERNATIVE');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    expect(result.aggregation.decided).toBe(true);
    expect(result.aggregation.votesByAlternative).toBeDefined();
    expect(result.contratoFinal).not.toBeNull();
  });

  test('WEIGHTED_MAJORITY usa pesos', async () => {
    const { orquestrador } = await setupOrquestrador('orq-weighted');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents: AgentProfile[] = [
      { agentId: 'light', perfilRisco: PerfilRisco.CONSERVADOR, peso: 1 },
      { agentId: 'heavy', perfilRisco: PerfilRisco.AGRESSIVO, peso: 10 }
    ];
    const input = createMultiAgentInput(agents, 'WEIGHTED_MAJORITY');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    expect(result.aggregation.decided).toBe(true);
    // Heavy tem peso 10, então sua alternativa deve vencer
    expect(result.aggregation.votesByAlternative).toBeDefined();
  });

  test('REQUIRE_CONSENSUS retorna NO_CONSENSUS se divergente', async () => {
    const { orquestrador } = await setupOrquestrador('orq-consensus');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles(); // Perfis diferentes = alternativas diferentes
    const input = createMultiAgentInput(agents, 'REQUIRE_CONSENSUS');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    // Com 3 perfis diferentes, cada um escolhe alternativa diferente
    expect(result.aggregation.decided).toBe(false);
    expect(result.aggregation.noDecisionReason).toBe('NO_CONSENSUS');
    expect(result.contratoFinal).toBeNull();
  });

  test('HUMAN_OVERRIDE_REQUIRED não emite contrato final', async () => {
    const { orquestrador } = await setupOrquestrador('orq-human');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'HUMAN_OVERRIDE_REQUIRED');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    expect(result.aggregation.decided).toBe(false);
    expect(result.aggregation.noDecisionReason).toBe('HUMAN_OVERRIDE_PENDING');
    expect(result.contratoFinal).toBeNull();
    // Mas candidatos devem existir
    expect(result.agentResults.some(r => !r.blocked)).toBe(true);
  });

  test('Bloqueio em um agente não bloqueia outros', async () => {
    const { orquestrador } = await setupOrquestrador('orq-partial-block');

    // Criar situação que vai causar bloqueio para conservador
    // (sem riscos suficientes para conservador)
    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    const result = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    // Deve ter pelo menos um agente válido
    const validResults = result.agentResults.filter(r => !r.blocked);
    expect(validResults.length).toBeGreaterThan(0);
    expect(result.aggregation.decided).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: EVENTLOG
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - EventLog registra eventos multiagente', () => {
  test('Eventos multiagente são registrados', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-events');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    const allEvents = await eventLog.getAll();

    // Verificar presença de eventos multiagente (sem depender de ordem)
    const eventTypes = allEvents.map(e => e.evento);

    expect(eventTypes).toContain(TipoEvento.MULTIAGENT_RUN_STARTED);
    expect(eventTypes).toContain(TipoEvento.AGENT_PROTOCOL_PROPOSED);
    expect(eventTypes).toContain(TipoEvento.AGENT_DECISION_PROPOSED);

    // Deve ter agregação selecionada (FIRST_VALID decide)
    expect(eventTypes).toContain(TipoEvento.MULTIAGENT_AGGREGATION_SELECTED);
  });

  test('MULTIAGENT_NO_DECISION registrado quando não decide', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-no-decision-events');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'HUMAN_OVERRIDE_REQUIRED');

    await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    const allEvents = await eventLog.getAll();
    const eventTypes = allEvents.map(e => e.evento);

    expect(eventTypes).toContain(TipoEvento.MULTIAGENT_NO_DECISION);
  });

  test('verifyChain continua válido após multiagente', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-chain');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    await orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input);

    const chainResult = await eventLog.verifyChain();
    expect(chainResult.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: COMPATIBILIDADE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - Compatibilidade com fluxo single-agent', () => {
  test('ProcessarSolicitacao single-agent ainda funciona', async () => {
    const { orquestrador } = await setupOrquestrador('orq-compat-single');

    const situacao = createValidSituacao(`sit-${Date.now()}`);

    // Fluxo single-agent tradicional
    const episodio = await orquestrador.ProcessarSolicitacao(situacao);
    expect(episodio).toBeDefined();
    expect(episodio.id).toBeDefined();

    // Construir protocolo
    await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
      criterios_minimos: ['Critério 1'],
      riscos_considerados: ['Risco 1'],
      limites_definidos: [createValidLimite()],
      perfil_risco: PerfilRisco.MODERADO,
      alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
      alternativa_escolhida: 'Alternativa A'
    });

    // Registrar decisão
    const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
      alternativa_escolhida: 'Alternativa A',
      criterios: ['Critério 1'],
      limites: [createValidLimite()],
      condicoes: ['Condição 1'],
      perfil_risco: PerfilRisco.MODERADO
    });

    expect(contrato).toBeDefined();
    expect(contrato.id).toBeDefined();
  });

  test('Multiagente não quebra fluxo existente', async () => {
    const { orquestrador } = await setupOrquestrador('orq-compat-both');

    // Primeiro: multiagente
    const situacao1 = createValidSituacao(`sit-multi-${Date.now()}`);
    const agents = createAgentProfiles();
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    const multiResult = await orquestrador.ProcessarSolicitacaoMultiAgente(situacao1, input);
    expect(multiResult.contratoFinal).not.toBeNull();

    // Depois: single-agent (deve funcionar)
    const situacao2 = createValidSituacao(`sit-single-${Date.now()}`);
    const episodio = await orquestrador.ProcessarSolicitacao(situacao2);

    await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
      criterios_minimos: ['Critério 1'],
      riscos_considerados: ['Risco 1'],
      limites_definidos: [createValidLimite()],
      perfil_risco: PerfilRisco.MODERADO,
      alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
      alternativa_escolhida: 'Alternativa A'
    });

    const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
      alternativa_escolhida: 'Alternativa A',
      criterios: ['Critério 1'],
      limites: [createValidLimite()],
      condicoes: ['Condição 1'],
      perfil_risco: PerfilRisco.MODERADO
    });

    expect(contrato).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: VALIDAÇÕES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 16 - Validações', () => {
  test('Erro se nenhum agente habilitado', async () => {
    const { orquestrador } = await setupOrquestrador('orq-no-agents');

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const agents: AgentProfile[] = [
      { agentId: 'disabled', perfilRisco: PerfilRisco.CONSERVADOR, enabled: false }
    ];
    const input = createMultiAgentInput(agents, 'FIRST_VALID');

    await expect(
      orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input)
    ).rejects.toThrow('Nenhum agente habilitado');
  });

  test('Erro se protocoloRepo não configurado', async () => {
    const dir = createTestDir('orq-no-protocol');
    await fs.mkdir(dir, { recursive: true });

    const situacaoRepo = await SituacaoRepositoryImpl.create(dir);
    const episodioRepo = await EpisodioRepositoryImpl.create(dir);
    const decisaoRepo = await DecisaoRepositoryImpl.create(dir);
    const contratoRepo = await ContratoRepositoryImpl.create(dir);
    const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

    // Orquestrador SEM protocoloRepo
    const orquestrador = new OrquestradorCognitivo(
      situacaoRepo,
      episodioRepo,
      decisaoRepo,
      contratoRepo,
      memoryService
      // protocoloRepo não passado
    );

    const situacao = createValidSituacao(`sit-${Date.now()}`);
    const input = createMultiAgentInput(createAgentProfiles(), 'FIRST_VALID');

    await expect(
      orquestrador.ProcessarSolicitacaoMultiAgente(situacao, input)
    ).rejects.toThrow('DecisionProtocolRepository não configurado');
  });
});
