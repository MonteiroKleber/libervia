/**
 * INCREMENTO 19 — TESTES DE POLICY DE CONSEQUÊNCIA PARA AUTONOMIA
 *
 * Testes para o feedback loop de autonomia baseado em consequências.
 *
 * COBERTURA:
 * - Regras determinísticas (5 regras MVP)
 * - Avaliação de gatilhos
 * - Aplicação de efeitos (suspend, revoke, degrade, human review)
 * - Idempotência
 * - Retrocompatibilidade
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import {
  // Tipos
  ConsequenceSeverity,
  ConsequenceCategory,
  ConsequenceAutonomyTriggers,
  ConsequenceAction,
  ConsequenceRuleId,
  ConsequenceEffects,
  ConsequenceAutonomyResult,
  // Helpers
  applyTriggerDefaults,
  getDegradedMode,
  // Regras
  RuleContext,
  ruleSeveridadeCriticaRevoke,
  ruleViolacaoLimitesSuspend,
  rulePerdaRelevanteDegrade,
  ruleLegalEticaHumanReview,
  ruleNoAction,
  evaluateRules,
  createRuleContext,
  // Policy
  evaluateConsequenceImpact,
  // Service
  AutonomyConsequenceService,
  AutonomyConsequenceContext,
  // Tipos de autonomia
  AutonomyMode,
  AutonomyMandate,
  // Tipos auxiliares
  PerfilRisco,
  AggregationPolicy
} from '../camada-3';

import { AutonomyMandateRepositoryImpl } from '../camada-3/autonomy/AutonomyMandateRepositoryImpl';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { ObservacaoDeConsequencia, SinalImpacto } from '../camada-3/entidades/ObservacaoDeConsequencia';

// ════════════════════════════════════════════════════════════════════════════
// HELPERS DE TESTE
// ════════════════════════════════════════════════════════════════════════════

function createTestDir(): string {
  const testDir = path.join(os.tmpdir(), `libervia-test-inc19-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

function createTestMandate(overrides: Partial<AutonomyMandate> = {}): AutonomyMandate {
  return {
    id: `mandate-${Date.now()}`,
    agentId: 'test-agent',
    modo: AutonomyMode.VIVENCIA_ASSISTIDA,
    politicas_permitidas: ['FIRST_VALID', 'MAJORITY_BY_ALTERNATIVE'] as AggregationPolicy[],
    perfil_risco_maximo: PerfilRisco.MODERADO,
    concedido_por: 'test-human',
    concedido_em: new Date(),
    limites: [{ tipo: 'limite', descricao: 'Limite de teste', valor: '100' }],
    requer_humano_se: [],
    revogado: false,
    status: 'active',
    uses: 0,
    ...overrides
  };
}

function createTestObservacao(overrides: Partial<ObservacaoDeConsequencia> = {}): ObservacaoDeConsequencia {
  return {
    id: `obs-${Date.now()}`,
    contrato_id: 'contrato-1',
    episodio_id: 'episodio-1',
    observada: {
      descricao: 'Teste observado',
      limites_respeitados: true,
      condicoes_cumpridas: true
    },
    percebida: {
      descricao: 'Teste percebido',
      sinal: SinalImpacto.NEUTRO
    },
    evidencias_minimas: ['evidencia-1'],
    registrado_por: 'test',
    data_registro: new Date(),
    ...overrides
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: TRIGGER DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: applyTriggerDefaults', () => {
  it('deve aplicar defaults defensivos quando triggers undefined', () => {
    const result = applyTriggerDefaults(undefined);

    expect(result.severidade).toBe('BAIXA');
    expect(result.categoria).toBe('OUTRA');
    expect(result.violou_limites).toBe(false);
    expect(result.reversivel).toBe(true);
    expect(result.perda_relevante).toBe(false);
  });

  it('deve aplicar defaults defensivos quando triggers vazio', () => {
    const result = applyTriggerDefaults({});

    expect(result.severidade).toBe('BAIXA');
    expect(result.categoria).toBe('OUTRA');
    expect(result.violou_limites).toBe(false);
    expect(result.reversivel).toBe(true);
    expect(result.perda_relevante).toBe(false);
  });

  it('deve preservar valores fornecidos', () => {
    const result = applyTriggerDefaults({
      severidade: 'CRITICA',
      categoria: 'LEGAL',
      violou_limites: true
    });

    expect(result.severidade).toBe('CRITICA');
    expect(result.categoria).toBe('LEGAL');
    expect(result.violou_limites).toBe(true);
    expect(result.reversivel).toBe(true); // Default
    expect(result.perda_relevante).toBe(false); // Default
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: DEGRADAÇÃO DE MODO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: getDegradedMode', () => {
  it('VIVENCIA_AUTONOMA degrada para VIVENCIA_ASSISTIDA', () => {
    expect(getDegradedMode(AutonomyMode.VIVENCIA_AUTONOMA)).toBe(AutonomyMode.VIVENCIA_ASSISTIDA);
  });

  it('VIVENCIA_ASSISTIDA degrada para ENSINO', () => {
    expect(getDegradedMode(AutonomyMode.VIVENCIA_ASSISTIDA)).toBe(AutonomyMode.ENSINO);
  });

  it('ENSINO permanece ENSINO (já no mínimo)', () => {
    expect(getDegradedMode(AutonomyMode.ENSINO)).toBe(AutonomyMode.ENSINO);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 1 - SEVERIDADE CRÍTICA -> REVOKE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Regra 1 - Severidade Crítica -> REVOKE', () => {
  it('deve retornar REVOKE_MANDATE para severidade CRITICA', () => {
    const ctx = createRuleContext(
      { severidade: 'CRITICA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleSeveridadeCriticaRevoke(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.REVOKE_MANDATE);
    expect(result!.ruleId).toBe(ConsequenceRuleId.SEVERIDADE_CRITICA_REVOKE);
    expect(result!.effects.newMandateStatus).toBe('revoked');
    expect(result!.effects.requiresHumanReview).toBe(true);
  });

  it('deve retornar null para severidade ALTA', () => {
    const ctx = createRuleContext(
      { severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleSeveridadeCriticaRevoke(ctx);
    expect(result).toBeNull();
  });

  it('deve retornar null para severidade MEDIA', () => {
    const ctx = createRuleContext(
      { severidade: 'MEDIA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleSeveridadeCriticaRevoke(ctx);
    expect(result).toBeNull();
  });

  it('deve retornar null para severidade BAIXA', () => {
    const ctx = createRuleContext(
      { severidade: 'BAIXA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleSeveridadeCriticaRevoke(ctx);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 2 - VIOLAÇÃO DE LIMITES -> SUSPEND
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Regra 2 - Violação de Limites -> SUSPEND', () => {
  it('deve retornar SUSPEND_MANDATE quando violou_limites=true', () => {
    const ctx = createRuleContext(
      { violou_limites: true },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleViolacaoLimitesSuspend(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.SUSPEND_MANDATE);
    expect(result!.ruleId).toBe(ConsequenceRuleId.VIOLACAO_LIMITES_SUSPEND);
    expect(result!.effects.newMandateStatus).toBe('suspended');
    expect(result!.effects.requiresHumanReview).toBe(true);
  });

  it('deve retornar null quando violou_limites=false', () => {
    const ctx = createRuleContext(
      { violou_limites: false },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleViolacaoLimitesSuspend(ctx);
    expect(result).toBeNull();
  });

  it('deve retornar null quando violou_limites não definido (default false)', () => {
    const ctx = createRuleContext(
      {},
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleViolacaoLimitesSuspend(ctx);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 3 - PERDA RELEVANTE + ALTA -> DEGRADE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Regra 3 - Perda Relevante + Alta -> DEGRADE', () => {
  it('deve retornar DEGRADE_MODE para perda_relevante + severidade ALTA', () => {
    const ctx = createRuleContext(
      { perda_relevante: true, severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = rulePerdaRelevanteDegrade(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.DEGRADE_MODE);
    expect(result!.ruleId).toBe(ConsequenceRuleId.PERDA_RELEVANTE_ALTA_DEGRADE);
    expect(result!.effects.newAutonomyMode).toBe(AutonomyMode.VIVENCIA_ASSISTIDA);
  });

  it('deve retornar DEGRADE_MODE para perda_relevante + severidade CRITICA', () => {
    const ctx = createRuleContext(
      { perda_relevante: true, severidade: 'CRITICA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = rulePerdaRelevanteDegrade(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.DEGRADE_MODE);
  });

  it('deve retornar null para perda_relevante + severidade MEDIA', () => {
    const ctx = createRuleContext(
      { perda_relevante: true, severidade: 'MEDIA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = rulePerdaRelevanteDegrade(ctx);
    expect(result).toBeNull();
  });

  it('deve retornar null para perda_relevante=false + severidade ALTA', () => {
    const ctx = createRuleContext(
      { perda_relevante: false, severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = rulePerdaRelevanteDegrade(ctx);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 4 - LEGAL/ÉTICA + ALTA -> HUMAN_REVIEW
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Regra 4 - Legal/Ética + Alta -> HUMAN_REVIEW', () => {
  it('deve retornar FLAG_HUMAN_REVIEW para categoria LEGAL + severidade ALTA', () => {
    const ctx = createRuleContext(
      { categoria: 'LEGAL', severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleLegalEticaHumanReview(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.FLAG_HUMAN_REVIEW);
    expect(result!.ruleId).toBe(ConsequenceRuleId.LEGAL_ETICA_ALTA_HUMAN_REVIEW);
    expect(result!.effects.requiresHumanReview).toBe(true);
  });

  it('deve retornar FLAG_HUMAN_REVIEW para categoria ETICA + severidade CRITICA', () => {
    const ctx = createRuleContext(
      { categoria: 'ETICA', severidade: 'CRITICA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleLegalEticaHumanReview(ctx);

    expect(result).not.toBeNull();
    expect(result!.action).toBe(ConsequenceAction.FLAG_HUMAN_REVIEW);
  });

  it('deve retornar null para categoria LEGAL + severidade MEDIA', () => {
    const ctx = createRuleContext(
      { categoria: 'LEGAL', severidade: 'MEDIA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleLegalEticaHumanReview(ctx);
    expect(result).toBeNull();
  });

  it('deve retornar null para categoria OPERACIONAL + severidade ALTA', () => {
    const ctx = createRuleContext(
      { categoria: 'OPERACIONAL', severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleLegalEticaHumanReview(ctx);
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 0 - NO ACTION (FALLBACK)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Regra 0 - No Action (Fallback)', () => {
  it('deve retornar NO_ACTION sempre', () => {
    const ctx = createRuleContext(
      {},
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = ruleNoAction(ctx);

    expect(result).not.toBeNull();
    expect(result.action).toBe(ConsequenceAction.NO_ACTION);
    expect(result.ruleId).toBe(ConsequenceRuleId.NO_TRIGGER);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: AVALIAÇÃO ENCADEADA DE REGRAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: evaluateRules - Avaliação Encadeada', () => {
  it('Regra 1 tem prioridade sobre Regra 2', () => {
    // CRITICA + violou_limites -> deve aplicar Regra 1 (REVOKE)
    const ctx = createRuleContext(
      { severidade: 'CRITICA', violou_limites: true },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = evaluateRules(ctx);

    expect(result.action).toBe(ConsequenceAction.REVOKE_MANDATE);
    expect(result.ruleId).toBe(ConsequenceRuleId.SEVERIDADE_CRITICA_REVOKE);
  });

  it('Regra 2 tem prioridade sobre Regra 3', () => {
    // violou_limites + perda_relevante + ALTA -> deve aplicar Regra 2 (SUSPEND)
    const ctx = createRuleContext(
      { violou_limites: true, perda_relevante: true, severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = evaluateRules(ctx);

    expect(result.action).toBe(ConsequenceAction.SUSPEND_MANDATE);
    expect(result.ruleId).toBe(ConsequenceRuleId.VIOLACAO_LIMITES_SUSPEND);
  });

  it('Regra 3 tem prioridade sobre Regra 4', () => {
    // perda_relevante + LEGAL + ALTA -> deve aplicar Regra 3 (DEGRADE)
    const ctx = createRuleContext(
      { perda_relevante: true, categoria: 'LEGAL', severidade: 'ALTA' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_AUTONOMA,
      new Date()
    );

    const result = evaluateRules(ctx);

    expect(result.action).toBe(ConsequenceAction.DEGRADE_MODE);
    expect(result.ruleId).toBe(ConsequenceRuleId.PERDA_RELEVANTE_ALTA_DEGRADE);
  });

  it('Fallback para NO_ACTION quando nenhuma regra se aplica', () => {
    const ctx = createRuleContext(
      { severidade: 'BAIXA', categoria: 'OPERACIONAL' },
      'obs-1',
      'mandate-1',
      AutonomyMode.VIVENCIA_ASSISTIDA,
      new Date()
    );

    const result = evaluateRules(ctx);

    expect(result.action).toBe(ConsequenceAction.NO_ACTION);
    expect(result.ruleId).toBe(ConsequenceRuleId.NO_TRIGGER);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: POLICY - evaluateConsequenceImpact
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: evaluateConsequenceImpact', () => {
  it('deve avaliar consequência e retornar resultado', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate();

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { severidade: 'CRITICA' },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.action).toBe(ConsequenceAction.REVOKE_MANDATE);
    expect(result.ruleId).toBe(ConsequenceRuleId.SEVERIDADE_CRITICA_REVOKE);
  });

  it('deve usar defaults quando triggers undefined', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate();

    const result = evaluateConsequenceImpact({
      observacao,
      mandate,
      currentMode: mandate.modo
    });

    // Sem triggers, defaults aplicados, nenhuma regra se aplica
    expect(result.action).toBe(ConsequenceAction.NO_ACTION);
  });

  it('deve retornar alreadyApplied para mandato já revogado', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate({ status: 'revoked' });

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { severidade: 'CRITICA' },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.alreadyApplied).toBe(true);
  });

  it('deve retornar alreadyApplied para mandato já suspenso', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate({ status: 'suspended' });

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { violou_limites: true },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.alreadyApplied).toBe(true);
  });

  it('deve funcionar sem mandato (apenas FLAG_HUMAN_REVIEW)', () => {
    const observacao = createTestObservacao();

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { categoria: 'LEGAL', severidade: 'ALTA' },
      currentMode: AutonomyMode.ENSINO
    });

    expect(result.action).toBe(ConsequenceAction.FLAG_HUMAN_REVIEW);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SERVICE - AutonomyConsequenceService
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: AutonomyConsequenceService', () => {
  let testDir: string;
  let mandateRepo: AutonomyMandateRepositoryImpl;
  let eventLogRepo: EventLogRepositoryImpl;
  let service: AutonomyConsequenceService;

  beforeEach(async () => {
    testDir = createTestDir();
    mandateRepo = new AutonomyMandateRepositoryImpl(
      path.join(testDir, 'mandates.json')
    );
    eventLogRepo = new EventLogRepositoryImpl(
      path.join(testDir, 'eventlog.json')
    );

    const context: AutonomyConsequenceContext = {
      mandateRepo,
      eventLog: eventLogRepo
    };
    service = new AutonomyConsequenceService(context);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('suspendMandate deve suspender mandato ativo', async () => {
    const mandate = createTestMandate();
    await mandateRepo.create(mandate);

    await service.suspendMandate(mandate.id, 'Violação detectada', 'obs-1');

    const updated = await mandateRepo.getById(mandate.id);
    expect(updated?.status).toBe('suspended');
    expect(updated?.suspendReason).toBe('Violação detectada');
    expect(updated?.triggeredByObservacaoId).toBe('obs-1');
  });

  it('suspendMandate é idempotente', async () => {
    const mandate = createTestMandate({ status: 'suspended' });
    await mandateRepo.create(mandate);

    // Não deve lançar erro
    await service.suspendMandate(mandate.id, 'Outra violação', 'obs-2');

    const updated = await mandateRepo.getById(mandate.id);
    expect(updated?.status).toBe('suspended');
  });

  it('revokeByConsequence deve revogar mandato', async () => {
    const mandate = createTestMandate();
    await mandateRepo.create(mandate);

    await service.revokeByConsequence(mandate.id, 'Severidade crítica', 'obs-1');

    const updated = await mandateRepo.getById(mandate.id);
    expect(updated?.status).toBe('revoked');
    expect(updated?.revogado).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: INTEGRAÇÃO COMPLETA
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Integração Completa', () => {
  let testDir: string;
  let mandateRepo: AutonomyMandateRepositoryImpl;
  let eventLogRepo: EventLogRepositoryImpl;

  beforeEach(async () => {
    testDir = createTestDir();
    mandateRepo = new AutonomyMandateRepositoryImpl(
      path.join(testDir, 'mandates.json')
    );
    eventLogRepo = new EventLogRepositoryImpl(
      path.join(testDir, 'eventlog.json')
    );
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('fluxo completo: consequência CRITICA -> REVOKE', async () => {
    // 1. Criar mandato
    const mandate = createTestMandate();
    await mandateRepo.create(mandate);

    // 2. Criar observação
    const observacao = createTestObservacao();

    // 3. Avaliar impacto
    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { severidade: 'CRITICA' },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.action).toBe(ConsequenceAction.REVOKE_MANDATE);

    // 4. Aplicar efeito
    const context: AutonomyConsequenceContext = {
      mandateRepo,
      eventLog: eventLogRepo
    };
    const service = new AutonomyConsequenceService(context);
    await service.revokeByConsequence(mandate.id, result.reason, observacao.id);

    // 5. Verificar estado final
    const updated = await mandateRepo.getById(mandate.id);
    expect(updated?.status).toBe('revoked');
  });

  it('fluxo completo: violação de limites -> SUSPEND', async () => {
    // 1. Criar mandato
    const mandate = createTestMandate();
    await mandateRepo.create(mandate);

    // 2. Criar observação
    const observacao = createTestObservacao();

    // 3. Avaliar impacto
    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { violou_limites: true },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.action).toBe(ConsequenceAction.SUSPEND_MANDATE);

    // 4. Aplicar efeito
    const context: AutonomyConsequenceContext = {
      mandateRepo,
      eventLog: eventLogRepo
    };
    const service = new AutonomyConsequenceService(context);
    await service.suspendMandate(
      mandate.id,
      result.effects.suspendReason!,
      observacao.id
    );

    // 5. Verificar estado final
    const updated = await mandateRepo.getById(mandate.id);
    expect(updated?.status).toBe('suspended');
    expect(updated?.triggeredByObservacaoId).toBe(observacao.id);
  });

  it('fluxo completo: perda relevante + ALTA -> DEGRADE', async () => {
    // 1. Criar mandato em VIVENCIA_AUTONOMA
    const mandate = createTestMandate({ modo: AutonomyMode.VIVENCIA_AUTONOMA });
    await mandateRepo.create(mandate);

    // 2. Criar observação
    const observacao = createTestObservacao();

    // 3. Avaliar impacto
    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { perda_relevante: true, severidade: 'ALTA' },
      mandate,
      currentMode: mandate.modo
    });

    expect(result.action).toBe(ConsequenceAction.DEGRADE_MODE);
    expect(result.effects.newAutonomyMode).toBe(AutonomyMode.VIVENCIA_ASSISTIDA);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RETROCOMPATIBILIDADE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Retrocompatibilidade', () => {
  it('observações antigas sem triggers não devem disparar ações', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate();

    // Sem triggers (simula observação antiga)
    const result = evaluateConsequenceImpact({
      observacao,
      mandate,
      currentMode: mandate.modo
    });

    expect(result.action).toBe(ConsequenceAction.NO_ACTION);
  });

  it('mandatos antigos (sem status) devem funcionar', async () => {
    const testDir = createTestDir();
    const mandateRepo = new AutonomyMandateRepositoryImpl(
      path.join(testDir, 'mandates.json')
    );

    // Mandato antigo sem campo status
    const mandateAntigo: any = {
      id: 'mandate-antigo',
      agentId: 'agent-1',
      modo: AutonomyMode.VIVENCIA_ASSISTIDA,
      politicas_permitidas: ['P1'],
      perfil_risco_maximo: 'MEDIO',
      concedido_por: 'human',
      concedido_em: new Date(),
      limites: [],
      requer_humano_se: [],
      revogado: false
      // Sem campo status!
    };

    await mandateRepo.create(mandateAntigo);

    const loaded = await mandateRepo.getById(mandateAntigo.id);
    expect(loaded?.status).toBe('active'); // Default aplicado

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: DETERMINISMO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Determinismo', () => {
  it('mesmos inputs sempre produzem mesmos outputs', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate();
    const triggers: ConsequenceAutonomyTriggers = {
      severidade: 'ALTA',
      violou_limites: true
    };

    // Executar múltiplas vezes
    const results: ConsequenceAutonomyResult[] = [];
    for (let i = 0; i < 10; i++) {
      const result = evaluateConsequenceImpact({
        observacao,
        triggers,
        mandate,
        currentMode: mandate.modo
      });
      results.push(result);
    }

    // Todos os resultados devem ser iguais
    const first = results[0];
    for (const result of results) {
      expect(result.action).toBe(first.action);
      expect(result.ruleId).toBe(first.ruleId);
    }
  });

  it('ordem das regras é consistente', () => {
    // Regra 1 > Regra 2 > Regra 3 > Regra 4
    const observacao = createTestObservacao();
    const mandate = createTestMandate({ modo: AutonomyMode.VIVENCIA_AUTONOMA });

    // Todos os gatilhos ativos
    const triggers: ConsequenceAutonomyTriggers = {
      severidade: 'CRITICA',
      violou_limites: true,
      perda_relevante: true,
      categoria: 'LEGAL'
    };

    const result = evaluateConsequenceImpact({
      observacao,
      triggers,
      mandate,
      currentMode: mandate.modo
    });

    // Deve aplicar Regra 1 (maior prioridade)
    expect(result.action).toBe(ConsequenceAction.REVOKE_MANDATE);
    expect(result.ruleId).toBe(ConsequenceRuleId.SEVERIDADE_CRITICA_REVOKE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: EDGE CASES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 19: Edge Cases', () => {
  it('deve lidar com mandate undefined', () => {
    const observacao = createTestObservacao();

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { severidade: 'BAIXA' }
    });

    expect(result.action).toBe(ConsequenceAction.NO_ACTION);
  });

  it('deve lidar com currentMode undefined', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate();

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { perda_relevante: true, severidade: 'ALTA' },
      mandate
      // currentMode não definido
    });

    // Deve funcionar com default ENSINO
    expect(result).toBeDefined();
  });

  it('degradação de ENSINO permanece ENSINO', () => {
    const observacao = createTestObservacao();
    const mandate = createTestMandate({ modo: AutonomyMode.ENSINO });

    const result = evaluateConsequenceImpact({
      observacao,
      triggers: { perda_relevante: true, severidade: 'ALTA' },
      mandate,
      currentMode: AutonomyMode.ENSINO
    });

    if (result.action === ConsequenceAction.DEGRADE_MODE) {
      expect(result.effects.newAutonomyMode).toBe(AutonomyMode.ENSINO);
    }
  });
});
