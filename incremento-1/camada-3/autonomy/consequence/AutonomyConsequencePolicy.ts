/**
 * INCREMENTO 19 — POLICY DE AVALIAÇÃO DE CONSEQUÊNCIAS
 *
 * Função pura que avalia o impacto de uma consequência na autonomia.
 * Sem I/O, sem side effects.
 *
 * Esta é a função principal que integra os tipos e regras.
 *
 * PRINCÍPIOS:
 * - Função pura (entrada → saída determinística)
 * - Sem dependências externas (repositórios, eventlog)
 * - Testável isoladamente
 */

import { AutonomyMode, AutonomyMandate } from '../AutonomyTypes';
import { ObservacaoDeConsequencia } from '../../entidades/ObservacaoDeConsequencia';
import { ContratoDeDecisao } from '../../entidades/tipos';
import {
  ConsequenceAutonomyResult,
  ConsequenceAutonomyTriggers,
  ConsequenceEvaluationInput,
  ConsequenceAction,
  ConsequenceRuleId
} from './AutonomyConsequenceTypes';
import { evaluateRules, createRuleContext } from './AutonomyConsequenceRules';

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL DE AVALIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Avalia o impacto de uma consequência na autonomia do agente.
 *
 * Esta é a função principal da policy. Recebe todos os dados necessários
 * e retorna um resultado determinístico.
 *
 * @param input - Dados para avaliação
 * @returns Resultado determinístico com ação, motivo, regra e efeitos
 */
function evaluateConsequenceImpact(input: ConsequenceEvaluationInput): ConsequenceAutonomyResult {
  const { observacao, triggers, mandate, currentMode, now } = input;

  // Determinar modo atual
  const effectiveMode = currentMode ?? mandate?.modo ?? AutonomyMode.ENSINO;

  // Determinar data atual
  const currentTime = now ?? new Date();

  // Verificar se mandato já está em estado terminal
  if (mandate) {
    const terminalCheck = checkMandateTerminalState(mandate);
    if (terminalCheck) {
      return terminalCheck;
    }
  }

  // Criar contexto e avaliar regras
  const ctx = createRuleContext(
    triggers,
    observacao.id,
    mandate?.id,
    effectiveMode,
    currentTime
  );

  return evaluateRules(ctx);
}

// ════════════════════════════════════════════════════════════════════════════
// VERIFICAÇÕES AUXILIARES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verifica se mandato já está em estado terminal.
 * Se já revogado/suspenso/expirado, retorna NO_ACTION com flag alreadyApplied.
 */
function checkMandateTerminalState(mandate: AutonomyMandate): ConsequenceAutonomyResult | null {
  // Mandato já revogado
  if (mandate.revogado || mandate.status === 'revoked') {
    return {
      action: ConsequenceAction.NO_ACTION,
      reason: 'Mandato já revogado. Nenhuma ação adicional necessária.',
      ruleId: ConsequenceRuleId.NO_TRIGGER,
      effects: {},
      alreadyApplied: true
    };
  }

  // Mandato já expirado
  if (mandate.status === 'expired') {
    return {
      action: ConsequenceAction.NO_ACTION,
      reason: 'Mandato já expirado. Nenhuma ação adicional necessária.',
      ruleId: ConsequenceRuleId.NO_TRIGGER,
      effects: {},
      alreadyApplied: true
    };
  }

  // Mandato já suspenso (Inc 19)
  if (mandate.status === 'suspended') {
    return {
      action: ConsequenceAction.NO_ACTION,
      reason: 'Mandato já suspenso. Nenhuma ação adicional necessária.',
      ruleId: ConsequenceRuleId.NO_TRIGGER,
      effects: {},
      alreadyApplied: true
    };
  }

  return null;
}

/**
 * Verifica se uma consequência já foi processada anteriormente.
 * Usado para idempotência - se observação já disparou ação, não duplicar.
 *
 * @param mandate - Mandato atual
 * @param observacaoId - ID da observação
 * @returns true se já processada
 */
function wasConsequenceAlreadyProcessed(
  mandate: AutonomyMandate,
  observacaoId: string
): boolean {
  // Verificar se esta observação já disparou a ação atual
  if (mandate.triggeredByObservacaoId === observacaoId) {
    return true;
  }

  return false;
}

/**
 * Combina múltiplos resultados de avaliação.
 * Usado quando há múltiplas consequências para avaliar.
 * Retorna a ação mais severa.
 *
 * Ordem de severidade:
 * 1. REVOKE_MANDATE (mais severo)
 * 2. SUSPEND_MANDATE
 * 3. DEGRADE_MODE
 * 4. FLAG_HUMAN_REVIEW
 * 5. NO_ACTION (menos severo)
 */
function combineResults(results: ConsequenceAutonomyResult[]): ConsequenceAutonomyResult {
  if (results.length === 0) {
    return {
      action: ConsequenceAction.NO_ACTION,
      reason: 'Nenhuma consequência para avaliar.',
      ruleId: ConsequenceRuleId.NO_TRIGGER,
      effects: {}
    };
  }

  if (results.length === 1) {
    return results[0];
  }

  // Ordenar por severidade e retornar o mais severo
  const severity: Record<ConsequenceAction, number> = {
    [ConsequenceAction.REVOKE_MANDATE]: 4,
    [ConsequenceAction.SUSPEND_MANDATE]: 3,
    [ConsequenceAction.DEGRADE_MODE]: 2,
    [ConsequenceAction.FLAG_HUMAN_REVIEW]: 1,
    [ConsequenceAction.NO_ACTION]: 0
  };

  const sorted = [...results].sort((a, b) => severity[b.action] - severity[a.action]);
  return sorted[0];
}

/**
 * Verifica se o resultado indica necessidade de ação.
 */
function requiresAction(result: ConsequenceAutonomyResult): boolean {
  return result.action !== ConsequenceAction.NO_ACTION;
}

/**
 * Verifica se o resultado indica necessidade de revisão humana.
 */
function requiresHumanReview(result: ConsequenceAutonomyResult): boolean {
  return result.action === ConsequenceAction.FLAG_HUMAN_REVIEW ||
         result.effects.requiresHumanReview === true;
}

/**
 * Verifica se o resultado afeta o status do mandato.
 */
function affectsMandateStatus(result: ConsequenceAutonomyResult): boolean {
  return result.effects.newMandateStatus !== undefined;
}

/**
 * Verifica se o resultado afeta o modo de autonomia.
 */
function affectsAutonomyMode(result: ConsequenceAutonomyResult): boolean {
  return result.effects.newAutonomyMode !== undefined;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  // Função principal
  evaluateConsequenceImpact,

  // Funções auxiliares
  checkMandateTerminalState,
  wasConsequenceAlreadyProcessed,
  combineResults,
  requiresAction,
  requiresHumanReview,
  affectsMandateStatus,
  affectsAutonomyMode
};
