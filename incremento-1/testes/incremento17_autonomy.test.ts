/**
 * TESTES - Incremento 17: Autonomia Graduada (Ensino vs Vivência)
 *
 * Testa:
 * - Modo ENSINO sempre bloqueia
 * - Vivência sem mandato bloqueia
 * - Mandato válido permite
 * - Mandato com política errada bloqueia
 * - Mandato vencido bloqueia
 * - Perfil agressivo bloqueado por mandato conservador
 * - Closed Layer bloqueia mesmo com mandato
 * - EventLog registra AUTONOMY_CHECK_*
 * - Integração com OrquestradorCognitivo
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Imports de tipos de autonomia
import {
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  AutonomyCheckResult,
  evaluate,
  isMandateValid,
  getEffectiveMode,
  REGRA,
  perfilExcede,
  // Inc 18 - Novos códigos de regra para mandatos
  MANDATE_RULE
} from '../camada-3/autonomy';

import { AutonomyMandateRepositoryImpl } from '../camada-3/autonomy/AutonomyMandateRepositoryImpl';
import { HumanOverrideRequiredError } from '../camada-3/autonomy/AutonomyErrors';

// Imports do Core
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { PerfilRisco } from '../camada-3/entidades/tipos';
import { AggregationPolicy } from '../camada-3/multiagente/MultiAgentTypes';

// Repositórios
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc17';

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

function createValidMandate(overrides?: Partial<AutonomyMandate>): AutonomyMandate {
  return {
    id: `mandate-${Date.now()}`,
    agentId: 'agent-1',
    modo: AutonomyMode.VIVENCIA_AUTONOMA,
    politicas_permitidas: ['FIRST_VALID', 'MAJORITY_BY_ALTERNATIVE'] as AggregationPolicy[],
    perfil_risco_maximo: PerfilRisco.MODERADO,
    limites: [],
    requer_humano_se: [],
    concedido_por: 'admin',
    concedido_em: new Date(),
    revogado: false,
    ...overrides
  };
}

function createCheckInput(overrides?: Partial<AutonomyCheckInput>): AutonomyCheckInput {
  return {
    agentId: 'agent-1',
    policy: 'FIRST_VALID' as AggregationPolicy,
    perfilRisco: PerfilRisco.CONSERVADOR,
    closedLayerBlocked: false,
    ...overrides
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: FUNÇÃO EVALUATE (REGRAS CANÔNICAS)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 17 - AutonomyEvaluator', () => {
  describe('Regra 1: ENSINO nunca decide', () => {
    test('Modo ENSINO sempre bloqueia', () => {
      const mandate = createValidMandate({ modo: AutonomyMode.ENSINO });
      const input = createCheckInput({ mandate });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.ENSINO);
      expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);
    });

    test('Sem mandato = modo ENSINO implícito', () => {
      const input = createCheckInput({ mandate: undefined });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.ENSINO);
      expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);
    });
  });

  describe('Regra 2: Mandato obrigatório fora do ensino', () => {
    test('Vivência sem mandato bloqueia', () => {
      // Sem mandato, modo é ENSINO por padrão
      const input = createCheckInput({ mandate: undefined });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
    });

    test('Mandato válido permite', () => {
      const mandate = createValidMandate();
      const input = createCheckInput({ mandate });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_AUTONOMA);
      expect(result.mandato_id).toBe(mandate.id);
    });

    test('Mandato expirado bloqueia', () => {
      const mandate = createValidMandate({
        valido_ate: new Date(Date.now() - 1000) // Expirou há 1 segundo
      });
      const input = createCheckInput({ mandate });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      // Inc 18: Novo código mais específico para expiração temporal
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.EXPIRED_TIME);
    });

    test('Mandato revogado bloqueia', () => {
      const mandate = createValidMandate({
        revogado: true,
        revogado_em: new Date(),
        revogado_por: 'admin',
        motivo_revogacao: 'Teste de revogação'
      });
      const input = createCheckInput({ mandate });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      // Inc 18: Novo código mais específico para revogação
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.ALREADY_REVOKED);
    });
  });

  describe('requestedMode: Falha explícita quando modo solicitado sem mandato', () => {
    test('VIVENCIA_ASSISTIDA solicitada sem mandato falha com MODO_SOLICITADO_SEM_MANDATO', () => {
      const input = createCheckInput({
        mandate: undefined,
        requestedMode: AutonomyMode.VIVENCIA_ASSISTIDA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_ASSISTIDA); // Modo solicitado no resultado
      expect(result.regra_bloqueio).toBe(REGRA.MODO_SOLICITADO_SEM_MANDATO);
      expect(result.motivo).toContain('nenhum mandato foi fornecido');
    });

    test('VIVENCIA_AUTONOMA solicitada sem mandato falha com MODO_SOLICITADO_SEM_MANDATO', () => {
      const input = createCheckInput({
        mandate: undefined,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_AUTONOMA);
      expect(result.regra_bloqueio).toBe(REGRA.MODO_SOLICITADO_SEM_MANDATO);
    });

    test('VIVENCIA_AUTONOMA solicitada com mandato revogado falha com MANDATO_REVOGADO', () => {
      const mandate = createValidMandate({
        revogado: true,
        motivo_revogacao: 'Violação de protocolo'
      });
      const input = createCheckInput({
        mandate,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_AUTONOMA); // Modo solicitado
      // Inc 18: Novo código mais específico para revogação
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.ALREADY_REVOKED);
      expect(result.motivo).toContain('revogado');
    });

    test('VIVENCIA_AUTONOMA solicitada com mandato expirado falha com MANDATO_EXPIRADO', () => {
      const mandate = createValidMandate({
        valido_ate: new Date(Date.now() - 1000) // Expirado
      });
      const input = createCheckInput({
        mandate,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_AUTONOMA);
      // Inc 18: Novo código mais específico para expiração temporal
      expect(result.regra_bloqueio).toBe(MANDATE_RULE.EXPIRED_TIME);
      // Inc 18: Mensagem usa "expirou" (verbo) ao invés de "expirado" (adjetivo)
      expect(result.motivo).toContain('expirou');
    });

    test('VIVENCIA_AUTONOMA solicitada com mandato ASSISTIDA falha', () => {
      const mandate = createValidMandate({
        modo: AutonomyMode.VIVENCIA_ASSISTIDA // Mandato só autoriza ASSISTIDA
      });
      const input = createCheckInput({
        mandate,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA // Mas pede AUTONOMA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_ASSISTIDA); // Modo do mandato
      expect(result.regra_bloqueio).toBe(REGRA.MODO_SOLICITADO_SEM_MANDATO);
      expect(result.motivo).toContain('só autoriza VIVENCIA_ASSISTIDA');
    });

    test('ENSINO solicitado funciona normalmente (não requer mandato)', () => {
      const input = createCheckInput({
        mandate: undefined,
        requestedMode: AutonomyMode.ENSINO
      });

      const result = evaluate(input);

      // ENSINO bloqueia, mas pela regra normal (não por falta de mandato)
      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);
    });

    test('Sem requestedMode continua funcionando normalmente (backwards compatible)', () => {
      // Sem mandato e sem requestedMode = ENSINO por default
      const input = createCheckInput({
        mandate: undefined
        // requestedMode não especificado
      });

      const result = evaluate(input);

      // Comportamento antigo: ENSINO por default
      expect(result.permitido).toBe(false);
      expect(result.modo).toBe(AutonomyMode.ENSINO);
      expect(result.regra_bloqueio).toBe(REGRA.ENSINO_SEMPRE_BLOQUEIA);
    });

    test('requestedMode com mandato válido e compatível permite', () => {
      const mandate = createValidMandate({
        modo: AutonomyMode.VIVENCIA_AUTONOMA
      });
      const input = createCheckInput({
        mandate,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
      expect(result.modo).toBe(AutonomyMode.VIVENCIA_AUTONOMA);
    });

    test('Closed Layer vence mesmo com requestedMode', () => {
      const mandate = createValidMandate();
      const input = createCheckInput({
        mandate,
        requestedMode: AutonomyMode.VIVENCIA_AUTONOMA,
        closedLayerBlocked: true
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.CLOSED_LAYER_BLOQUEOU);
    });
  });

  describe('Regra 3: Política precisa estar autorizada', () => {
    test('Política autorizada permite', () => {
      const mandate = createValidMandate({
        politicas_permitidas: ['FIRST_VALID', 'MAJORITY_BY_ALTERNATIVE']
      });
      const input = createCheckInput({
        mandate,
        policy: 'FIRST_VALID'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
    });

    test('Política não autorizada bloqueia', () => {
      const mandate = createValidMandate({
        politicas_permitidas: ['FIRST_VALID']
      });
      const input = createCheckInput({
        mandate,
        policy: 'WEIGHTED_MAJORITY' as AggregationPolicy
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.POLITICA_NAO_AUTORIZADA);
    });
  });

  describe('Regra 4: Perfil de risco não pode exceder', () => {
    test('Perfil dentro do limite permite', () => {
      const mandate = createValidMandate({
        perfil_risco_maximo: PerfilRisco.MODERADO
      });
      const input = createCheckInput({
        mandate,
        perfilRisco: PerfilRisco.CONSERVADOR
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
    });

    test('Perfil igual ao limite permite', () => {
      const mandate = createValidMandate({
        perfil_risco_maximo: PerfilRisco.MODERADO
      });
      const input = createCheckInput({
        mandate,
        perfilRisco: PerfilRisco.MODERADO
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
    });

    test('Perfil agressivo bloqueado por mandato conservador', () => {
      const mandate = createValidMandate({
        perfil_risco_maximo: PerfilRisco.CONSERVADOR
      });
      const input = createCheckInput({
        mandate,
        perfilRisco: PerfilRisco.AGRESSIVO
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.PERFIL_EXCEDE_MAXIMO);
    });

    test('Perfil moderado bloqueado por mandato conservador', () => {
      const mandate = createValidMandate({
        perfil_risco_maximo: PerfilRisco.CONSERVADOR
      });
      const input = createCheckInput({
        mandate,
        perfilRisco: PerfilRisco.MODERADO
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.PERFIL_EXCEDE_MAXIMO);
    });
  });

  describe('Regra 5: Closed Layer sempre vence', () => {
    test('Closed Layer bloqueia mesmo com mandato válido', () => {
      const mandate = createValidMandate();
      const input = createCheckInput({
        mandate,
        closedLayerBlocked: true
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.CLOSED_LAYER_BLOQUEOU);
    });

    test('Closed Layer é verificada antes de outras regras', () => {
      // Mesmo sem mandato, Closed Layer deve ser o bloqueio
      const input = createCheckInput({
        mandate: undefined,
        closedLayerBlocked: true
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.CLOSED_LAYER_BLOQUEOU);
    });
  });

  describe('Verificações adicionais do mandato', () => {
    test('Domínio não autorizado bloqueia', () => {
      const mandate = createValidMandate({
        dominios_permitidos: ['financeiro', 'operacional']
      });
      const input = createCheckInput({
        mandate,
        dominio: 'recursos_humanos'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.DOMINIO_NAO_AUTORIZADO);
    });

    test('Domínio autorizado permite', () => {
      const mandate = createValidMandate({
        dominios_permitidos: ['financeiro', 'operacional']
      });
      const input = createCheckInput({
        mandate,
        dominio: 'financeiro'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
    });

    test('Sem restrição de domínio permite qualquer domínio', () => {
      const mandate = createValidMandate({
        dominios_permitidos: undefined
      });
      const input = createCheckInput({
        mandate,
        dominio: 'qualquer_dominio'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(true);
    });

    test('Caso de uso não autorizado bloqueia', () => {
      const mandate = createValidMandate({
        casos_uso_permitidos: [1, 2, 3]
      });
      const input = createCheckInput({
        mandate,
        casoUso: 99
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.CASO_USO_NAO_AUTORIZADO);
    });

    test('Gatilho textual de humano bloqueia', () => {
      const mandate = createValidMandate({
        requer_humano_se: ['urgente', 'crítico', 'alto risco']
      });
      const input = createCheckInput({
        mandate,
        contexto: 'Esta situação é URGENTE e requer atenção imediata'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.GATILHO_HUMANO_ACIONADO);
    });

    test('Gatilho textual é case-insensitive', () => {
      const mandate = createValidMandate({
        requer_humano_se: ['URGENTE']
      });
      const input = createCheckInput({
        mandate,
        contexto: 'situação urgente detectada'
      });

      const result = evaluate(input);

      expect(result.permitido).toBe(false);
      expect(result.regra_bloqueio).toBe(REGRA.GATILHO_HUMANO_ACIONADO);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: HELPERS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 17 - Helpers', () => {
  describe('perfilExcede', () => {
    test('CONSERVADOR não excede CONSERVADOR', () => {
      expect(perfilExcede(PerfilRisco.CONSERVADOR, PerfilRisco.CONSERVADOR)).toBe(false);
    });

    test('CONSERVADOR não excede MODERADO', () => {
      expect(perfilExcede(PerfilRisco.CONSERVADOR, PerfilRisco.MODERADO)).toBe(false);
    });

    test('MODERADO excede CONSERVADOR', () => {
      expect(perfilExcede(PerfilRisco.MODERADO, PerfilRisco.CONSERVADOR)).toBe(true);
    });

    test('AGRESSIVO excede MODERADO', () => {
      expect(perfilExcede(PerfilRisco.AGRESSIVO, PerfilRisco.MODERADO)).toBe(true);
    });

    test('AGRESSIVO não excede AGRESSIVO', () => {
      expect(perfilExcede(PerfilRisco.AGRESSIVO, PerfilRisco.AGRESSIVO)).toBe(false);
    });
  });

  describe('isMandateValid', () => {
    test('Mandato não revogado e não expirado é válido', () => {
      const mandate = createValidMandate();
      expect(isMandateValid(mandate)).toBe(true);
    });

    test('Mandato revogado não é válido', () => {
      const mandate = createValidMandate({ revogado: true });
      expect(isMandateValid(mandate)).toBe(false);
    });

    test('Mandato expirado não é válido', () => {
      const mandate = createValidMandate({
        valido_ate: new Date(Date.now() - 1000)
      });
      expect(isMandateValid(mandate)).toBe(false);
    });

    test('Mandato com validade futura é válido', () => {
      const mandate = createValidMandate({
        valido_ate: new Date(Date.now() + 86400000) // +1 dia
      });
      expect(isMandateValid(mandate)).toBe(true);
    });
  });

  describe('getEffectiveMode', () => {
    test('Sem mandato retorna ENSINO', () => {
      expect(getEffectiveMode(undefined)).toBe(AutonomyMode.ENSINO);
    });

    test('Mandato inválido retorna ENSINO', () => {
      const mandate = createValidMandate({ revogado: true });
      expect(getEffectiveMode(mandate)).toBe(AutonomyMode.ENSINO);
    });

    test('Mandato válido retorna modo do mandato', () => {
      const mandate = createValidMandate({
        modo: AutonomyMode.VIVENCIA_ASSISTIDA
      });
      expect(getEffectiveMode(mandate)).toBe(AutonomyMode.VIVENCIA_ASSISTIDA);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REPOSITÓRIO DE MANDATOS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 17 - AutonomyMandateRepository', () => {
  test('Criar e recuperar mandato', async () => {
    const dir = createTestDir('mandate-create');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const mandate = createValidMandate({ id: 'mandate-test-1' });

    await repo.create(mandate);
    const retrieved = await repo.getById('mandate-test-1');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('mandate-test-1');
    expect(retrieved!.agentId).toBe(mandate.agentId);
    expect(retrieved!.modo).toBe(mandate.modo);
  });

  test('Obter mandatos ativos por agente', async () => {
    const dir = createTestDir('mandate-active');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

    // Criar mandatos
    await repo.create(createValidMandate({
      id: 'mandate-1',
      agentId: 'agent-a'
    }));
    await repo.create(createValidMandate({
      id: 'mandate-2',
      agentId: 'agent-a',
      revogado: true
    }));
    await repo.create(createValidMandate({
      id: 'mandate-3',
      agentId: 'agent-b'
    }));

    const activeA = await repo.getActiveByAgentId('agent-a');

    expect(activeA).toHaveLength(1);
    expect(activeA[0].id).toBe('mandate-1');
  });

  test('Revogar mandato', async () => {
    const dir = createTestDir('mandate-revoke');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));
    const mandate = createValidMandate({ id: 'mandate-revoke-test' });

    await repo.create(mandate);
    await repo.revoke('mandate-revoke-test', 'admin', 'Teste de revogação');

    const retrieved = await repo.getById('mandate-revoke-test');

    expect(retrieved!.revogado).toBe(true);
    expect(retrieved!.revogado_por).toBe('admin');
    expect(retrieved!.motivo_revogacao).toBe('Teste de revogação');
  });

  test('Mandato expirado não aparece em ativos', async () => {
    const dir = createTestDir('mandate-expired');
    await fs.mkdir(dir, { recursive: true });

    const repo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

    await repo.create(createValidMandate({
      id: 'mandate-expired',
      agentId: 'agent-c',
      valido_ate: new Date(Date.now() - 1000) // Expirado
    }));

    const active = await repo.getActiveByAgentId('agent-c');

    expect(active).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ORQUESTRADOR COGNITIVO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 17 - OrquestradorCognitivo', () => {
  async function setupOrquestrador(suffix: string) {
    const dir = createTestDir(suffix);
    await fs.mkdir(dir, { recursive: true });

    const situacaoRepo = new SituacaoRepositoryImpl(path.join(dir, 'situacoes.json'));
    const episodioRepo = new EpisodioRepositoryImpl(path.join(dir, 'episodios.json'));
    const decisaoRepo = new DecisaoRepositoryImpl(path.join(dir, 'decisoes.json'));
    const contratoRepo = new ContratoRepositoryImpl(path.join(dir, 'contratos.json'));
    const protocoloRepo = new DecisionProtocolRepositoryImpl(path.join(dir, 'protocolos.json'));
    // Usar static create() para EventLog
    const eventLog = await EventLogRepositoryImpl.create(path.join(dir, 'events.json'));
    const autonomyRepo = new AutonomyMandateRepositoryImpl(path.join(dir, 'mandates.json'));

    const memoryService = new MemoryQueryService(
      episodioRepo,
      decisaoRepo,
      contratoRepo
    );

    const orquestrador = new OrquestradorCognitivo(
      situacaoRepo,
      episodioRepo,
      decisaoRepo,
      contratoRepo,
      memoryService,
      protocoloRepo,
      eventLog,
      undefined, // observacaoRepo
      autonomyRepo
    );

    return { orquestrador, eventLog, autonomyRepo };
  }

  test('Conceder mandato registra evento', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-conceder');

    const mandate = createValidMandate({
      id: 'mandate-orq-1',
      concedido_por: 'admin-test'
    });

    await orquestrador.ConcederMandato(mandate);

    const events = await eventLog.getAll();
    const grantEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_GRANTED);

    expect(grantEvent).toBeDefined();
    expect(grantEvent!.entidade).toBe(TipoEntidade.AUTONOMY_MANDATE);
    expect(grantEvent!.entidade_id).toBe('mandate-orq-1');
    expect(grantEvent!.actor).toBe('admin-test');
  });

  test('Revogar mandato registra evento', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-revogar');

    const mandate = createValidMandate({ id: 'mandate-orq-2' });
    await orquestrador.ConcederMandato(mandate);

    await orquestrador.RevogarMandato('mandate-orq-2', 'admin-revogador', 'Motivo de teste');

    const events = await eventLog.getAll();
    const revokeEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_REVOKED);

    expect(revokeEvent).toBeDefined();
    expect(revokeEvent!.actor).toBe('admin-revogador');
  });

  test('GetMandatoAtivo retorna mandato ativo', async () => {
    const { orquestrador } = await setupOrquestrador('orq-get-ativo');

    const mandate = createValidMandate({
      id: 'mandate-ativo',
      agentId: 'agent-x'
    });
    await orquestrador.ConcederMandato(mandate);

    const ativo = await orquestrador.GetMandatoAtivo('agent-x');

    expect(ativo).not.toBeNull();
    expect(ativo!.id).toBe('mandate-ativo');
  });

  test('AvaliarAutonomia com mandato válido permite', async () => {
    const { orquestrador } = await setupOrquestrador('orq-avaliar-ok');

    const mandate = createValidMandate({
      id: 'mandate-avaliar',
      agentId: 'agent-y'
    });
    await orquestrador.ConcederMandato(mandate);

    const result = await orquestrador.AvaliarAutonomia({
      agentId: 'agent-y',
      policy: 'FIRST_VALID' as AggregationPolicy,
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    expect(result.permitido).toBe(true);
    expect(result.mandato_id).toBe('mandate-avaliar');
  });

  test('AvaliarAutonomia sem mandato bloqueia (ENSINO)', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-avaliar-ensino');

    const result = await orquestrador.AvaliarAutonomia({
      agentId: 'agent-sem-mandato',
      policy: 'FIRST_VALID' as AggregationPolicy,
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    expect(result.permitido).toBe(false);
    expect(result.modo).toBe(AutonomyMode.ENSINO);

    const events = await eventLog.getAll();
    const failEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_CHECK_FAILED);

    expect(failEvent).toBeDefined();
  });

  test('VerificarAutonomiaOuBloquear lança exceção se não permitido', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-bloquear');

    await expect(
      orquestrador.VerificarAutonomiaOuBloquear({
        agentId: 'agent-sem-permissao',
        policy: 'FIRST_VALID' as AggregationPolicy,
        perfilRisco: PerfilRisco.CONSERVADOR,
        closedLayerBlocked: false
      })
    ).rejects.toThrow(HumanOverrideRequiredError);

    const events = await eventLog.getAll();
    const blockEvent = events.find(e => e.evento === TipoEvento.AUTONOMY_BLOCKED);

    expect(blockEvent).toBeDefined();
  });

  test('GetHistoricoMandatos retorna todos os mandatos', async () => {
    const { orquestrador } = await setupOrquestrador('orq-historico');

    // Criar mandatos
    await orquestrador.ConcederMandato(createValidMandate({
      id: 'mandate-hist-1',
      agentId: 'agent-hist'
    }));

    await orquestrador.ConcederMandato(createValidMandate({
      id: 'mandate-hist-2',
      agentId: 'agent-hist'
    }));

    // Revogar um
    await orquestrador.RevogarMandato('mandate-hist-1', 'admin');

    const historico = await orquestrador.GetHistoricoMandatos('agent-hist');

    expect(historico).toHaveLength(2);
    expect(historico.some(m => m.id === 'mandate-hist-1' && m.revogado)).toBe(true);
    expect(historico.some(m => m.id === 'mandate-hist-2' && !m.revogado)).toBe(true);
  });

  test('verifyChain continua válido após eventos de autonomia', async () => {
    const { orquestrador, eventLog } = await setupOrquestrador('orq-chain');

    // Criar mandato
    await orquestrador.ConcederMandato(createValidMandate({
      id: 'mandate-chain',
      agentId: 'agent-chain'
    }));

    // Avaliar autonomia
    await orquestrador.AvaliarAutonomia({
      agentId: 'agent-chain',
      policy: 'FIRST_VALID' as AggregationPolicy,
      perfilRisco: PerfilRisco.CONSERVADOR,
      closedLayerBlocked: false
    });

    // Revogar mandato
    await orquestrador.RevogarMandato('mandate-chain', 'admin');

    const chainResult = await eventLog.verifyChain();

    expect(chainResult.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: COMPATIBILIDADE COM INCREMENTOS ANTERIORES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 17 - Compatibilidade', () => {
  test('Orquestrador funciona sem autonomyMandateRepo', async () => {
    const dir = createTestDir('compat-no-autonomy');
    await fs.mkdir(dir, { recursive: true });

    const situacaoRepo = new SituacaoRepositoryImpl(path.join(dir, 'situacoes.json'));
    const episodioRepo = new EpisodioRepositoryImpl(path.join(dir, 'episodios.json'));
    const decisaoRepo = new DecisaoRepositoryImpl(path.join(dir, 'decisoes.json'));
    const contratoRepo = new ContratoRepositoryImpl(path.join(dir, 'contratos.json'));
    const protocoloRepo = new DecisionProtocolRepositoryImpl(path.join(dir, 'protocolos.json'));

    const memoryService = new MemoryQueryService(
      episodioRepo,
      decisaoRepo,
      contratoRepo
    );

    // Sem autonomyMandateRepo
    const orquestrador = new OrquestradorCognitivo(
      situacaoRepo,
      episodioRepo,
      decisaoRepo,
      contratoRepo,
      memoryService,
      protocoloRepo
    );

    // GetMandatoAtivo deve retornar null
    const mandato = await orquestrador.GetMandatoAtivo('qualquer-agente');
    expect(mandato).toBeNull();

    // GetHistoricoMandatos deve retornar []
    const historico = await orquestrador.GetHistoricoMandatos('qualquer-agente');
    expect(historico).toEqual([]);
  });

  test('ConcederMandato falha sem repositório', async () => {
    const dir = createTestDir('compat-no-repo');
    await fs.mkdir(dir, { recursive: true });

    const situacaoRepo = new SituacaoRepositoryImpl(path.join(dir, 'situacoes.json'));
    const episodioRepo = new EpisodioRepositoryImpl(path.join(dir, 'episodios.json'));
    const decisaoRepo = new DecisaoRepositoryImpl(path.join(dir, 'decisoes.json'));
    const contratoRepo = new ContratoRepositoryImpl(path.join(dir, 'contratos.json'));

    const memoryService = new MemoryQueryService(
      episodioRepo,
      decisaoRepo,
      contratoRepo
    );

    const orquestrador = new OrquestradorCognitivo(
      situacaoRepo,
      episodioRepo,
      decisaoRepo,
      contratoRepo,
      memoryService
    );

    await expect(
      orquestrador.ConcederMandato(createValidMandate())
    ).rejects.toThrow('AutonomyMandateRepository não configurado');
  });
});
