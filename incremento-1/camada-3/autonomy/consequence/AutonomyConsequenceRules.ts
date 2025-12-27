/**
 * INCREMENTO 19 — REGRAS DETERMINÍSTICAS DE CONSEQUÊNCIA
 *
 * Funções puras que avaliam gatilhos e determinam ações.
 * Cada regra é uma função pura, testável independentemente.
 *
 * REGRAS MVP (ordem de prioridade):
 * 1. SEVERIDADE_CRITICA → REVOKE
 * 2. VIOLACAO_DE_LIMITES → SUSPEND + HUMAN_REVIEW
 * 3. PERDA_RELEVANTE (ALTA/CRITICA) → DEGRADE
 * 4. LEGAL/ETICA (ALTA/CRITICA) → HUMAN_REVIEW
 * 5. SEM FLAGS → NO_ACTION
 *
 * PRINCÍPIOS:
 * - Todas as regras são determinísticas
 * - Sem heurística, sem IA, sem otimização
 * - Cada regra retorna resultado canônico
 */

import { AutonomyMode } from '../AutonomyTypes';
import {
  ConsequenceAction,
  ConsequenceRuleId,
  ConsequenceAutonomyResult,
  ConsequenceAutonomyTriggers,
  ConsequenceEffects,
  applyTriggerDefaults,
  getDegradedMode
} from './AutonomyConsequenceTypes';

// ════════════════════════════════════════════════════════════════════════════
// TIPO DE CONTEXTO PARA REGRAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Contexto para avaliação de regras.
 */
interface RuleContext {
  /** Gatilhos com defaults aplicados */
  triggers: Required<ConsequenceAutonomyTriggers>;

  /** ID da observação que disparou */
  observacaoId: string;

  /** ID do mandato (se existir) */
  mandateId?: string;

  /** Modo de autonomia atual */
  currentMode: AutonomyMode;

  /** Data atual */
  now: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 1: SEVERIDADE CRÍTICA → REVOKE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regra 1: Severidade CRÍTICA revoga mandato imediatamente.
 *
 * Consequências críticas indicam falha grave que invalida
 * a confiança depositada no agente.
 */
function ruleSeveridadeCriticaRevoke(ctx: RuleContext): ConsequenceAutonomyResult | null {
  if (ctx.triggers.severidade !== 'CRITICA') {
    return null;
  }

  const effects: ConsequenceEffects = {
    newMandateStatus: 'revoked',
    requiresHumanReview: true,
    triggeredByObservacaoId: ctx.observacaoId
  };

  return {
    action: ConsequenceAction.REVOKE_MANDATE,
    reason: 'Consequência com severidade CRÍTICA detectada. Mandato revogado.',
    ruleId: ConsequenceRuleId.SEVERIDADE_CRITICA_REVOKE,
    effects
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 2: VIOLAÇÃO DE LIMITES → SUSPEND + HUMAN_REVIEW
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regra 2: Violação de limites suspende mandato e exige human review.
 *
 * Limites são invioláveis. Qualquer violação suspende
 * a autonomia até revisão humana.
 */
function ruleViolacaoLimitesSuspend(ctx: RuleContext): ConsequenceAutonomyResult | null {
  if (!ctx.triggers.violou_limites) {
    return null;
  }

  const effects: ConsequenceEffects = {
    newMandateStatus: 'suspended',
    requiresHumanReview: true,
    suspendedAt: ctx.now.toISOString(),
    suspendReason: 'Violação de limites do contrato detectada',
    triggeredByObservacaoId: ctx.observacaoId
  };

  return {
    action: ConsequenceAction.SUSPEND_MANDATE,
    reason: 'Violação de limites do contrato. Mandato suspenso. Revisão humana obrigatória.',
    ruleId: ConsequenceRuleId.VIOLACAO_LIMITES_SUSPEND,
    effects
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 3: PERDA RELEVANTE + ALTA/CRITICA → DEGRADE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regra 3: Perda relevante com severidade ALTA ou CRÍTICA degrada modo.
 *
 * Perdas significativas indicam necessidade de mais supervisão.
 * CRÍTICA já é tratada pela Regra 1, mas incluímos para completude.
 */
function rulePerdaRelevanteDegrade(ctx: RuleContext): ConsequenceAutonomyResult | null {
  if (!ctx.triggers.perda_relevante) {
    return null;
  }

  if (ctx.triggers.severidade !== 'ALTA' && ctx.triggers.severidade !== 'CRITICA') {
    return null;
  }

  const newMode = getDegradedMode(ctx.currentMode);

  const effects: ConsequenceEffects = {
    newAutonomyMode: newMode,
    triggeredByObservacaoId: ctx.observacaoId
  };

  return {
    action: ConsequenceAction.DEGRADE_MODE,
    reason: `Perda relevante com severidade ${ctx.triggers.severidade}. Modo degradado de ${ctx.currentMode} para ${newMode}.`,
    ruleId: ConsequenceRuleId.PERDA_RELEVANTE_ALTA_DEGRADE,
    effects
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 4: LEGAL/ÉTICA + ALTA/CRITICA → HUMAN_REVIEW
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regra 4: Consequências legais ou éticas com severidade ALTA ou CRÍTICA
 * exigem revisão humana obrigatória.
 *
 * Questões legais e éticas requerem julgamento humano.
 */
function ruleLegalEticaHumanReview(ctx: RuleContext): ConsequenceAutonomyResult | null {
  const categoriasRelevantes = ['LEGAL', 'ETICA'];
  if (!categoriasRelevantes.includes(ctx.triggers.categoria)) {
    return null;
  }

  if (ctx.triggers.severidade !== 'ALTA' && ctx.triggers.severidade !== 'CRITICA') {
    return null;
  }

  const effects: ConsequenceEffects = {
    requiresHumanReview: true,
    triggeredByObservacaoId: ctx.observacaoId
  };

  return {
    action: ConsequenceAction.FLAG_HUMAN_REVIEW,
    reason: `Consequência ${ctx.triggers.categoria} com severidade ${ctx.triggers.severidade}. Revisão humana obrigatória.`,
    ruleId: ConsequenceRuleId.LEGAL_ETICA_ALTA_HUMAN_REVIEW,
    effects
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 0: SEM GATILHOS → NO_ACTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Regra 0: Sem gatilhos relevantes, nenhuma ação.
 *
 * Esta regra é o fallback quando nenhuma outra se aplica.
 */
function ruleNoAction(ctx: RuleContext): ConsequenceAutonomyResult {
  return {
    action: ConsequenceAction.NO_ACTION,
    reason: 'Nenhum gatilho de autonomia identificado. Nenhuma ação necessária.',
    ruleId: ConsequenceRuleId.NO_TRIGGER,
    effects: {}
  };
}

// ════════════════════════════════════════════════════════════════════════════
// AVALIAÇÃO ENCADEADA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lista ordenada de regras (ordem de prioridade).
 * Primeira regra que retorna resultado não-null é aplicada.
 */
const RULES_IN_ORDER = [
  ruleSeveridadeCriticaRevoke,
  ruleViolacaoLimitesSuspend,
  rulePerdaRelevanteDegrade,
  ruleLegalEticaHumanReview
];

/**
 * Avalia todas as regras em ordem de prioridade.
 * Retorna o resultado da primeira regra que se aplica.
 *
 * @param ctx - Contexto de avaliação
 * @returns Resultado determinístico
 */
function evaluateRules(ctx: RuleContext): ConsequenceAutonomyResult {
  for (const rule of RULES_IN_ORDER) {
    const result = rule(ctx);
    if (result !== null) {
      return result;
    }
  }

  // Nenhuma regra se aplicou
  return ruleNoAction(ctx);
}

/**
 * Cria contexto de avaliação a partir dos dados de entrada.
 */
function createRuleContext(
  triggers: ConsequenceAutonomyTriggers | undefined,
  observacaoId: string,
  mandateId: string | undefined,
  currentMode: AutonomyMode,
  now: Date
): RuleContext {
  return {
    triggers: applyTriggerDefaults(triggers),
    observacaoId,
    mandateId,
    currentMode,
    now
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  RuleContext,
  // Regras individuais (para testes)
  ruleSeveridadeCriticaRevoke,
  ruleViolacaoLimitesSuspend,
  rulePerdaRelevanteDegrade,
  ruleLegalEticaHumanReview,
  ruleNoAction,
  // Avaliação encadeada
  RULES_IN_ORDER,
  evaluateRules,
  createRuleContext
};
