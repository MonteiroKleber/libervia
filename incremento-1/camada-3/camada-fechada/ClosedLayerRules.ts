/**
 * INCREMENTO 13 — CAMADA FECHADA: Regras de Bloqueio
 *
 * 5 regras de bloqueio que verificam se uma decisão pode prosseguir.
 * Cada regra é uma função pura que recebe dados e retorna ClosedLayerResult.
 *
 * PRINCÍPIOS:
 * - NÃO altera dados
 * - NÃO persiste nada
 * - NÃO lança exceções
 * - Usa defaults defensivos (?? [])
 */

import { SituacaoDecisoria, DecisionProtocol, PerfilRisco } from '../entidades/tipos';
import { ClosedLayerResult, ClosedLayerRuleId } from './ClosedLayerTypes';

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO PADRÃO (não bloqueado)
// ════════════════════════════════════════════════════════════════════════════

const PASSED: ClosedLayerResult = {
  blocked: false,
  rule: '',
  reason: ''
};

// ════════════════════════════════════════════════════════════════════════════
// REGRA 1 — BLOQUEAR_SEM_RISCO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bloqueia se não há riscos OU incertezas declarados.
 *
 * Lógica: Se riscos.length === 0 E incertezas.length === 0 → BLOQUEAR
 *
 * Motivo: Uma decisão sem risco nem incerteza não precisa do sistema.
 */
function checkSemRisco(situacao: SituacaoDecisoria): ClosedLayerResult {
  const riscos = situacao.riscos ?? [];
  const incertezas = situacao.incertezas ?? [];

  if (riscos.length === 0 && incertezas.length === 0) {
    return {
      blocked: true,
      rule: ClosedLayerRuleId.SEM_RISCO,
      reason: 'Decisão sem risco nem incerteza declarados não requer deliberação institucional'
    };
  }

  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 2 — BLOQUEAR_SEM_ALTERNATIVAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bloqueia se há menos de 2 alternativas.
 *
 * Lógica: Se alternativas.length < 2 → BLOQUEAR
 *
 * Motivo: Decisão exige escolha; escolha exige opções.
 */
function checkSemAlternativas(situacao: SituacaoDecisoria): ClosedLayerResult {
  const alternativas = situacao.alternativas ?? [];

  if (alternativas.length < 2) {
    return {
      blocked: true,
      rule: ClosedLayerRuleId.SEM_ALTERNATIVAS,
      reason: 'Decisão requer ao menos 2 alternativas para haver escolha institucional'
    };
  }

  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 3 — BLOQUEAR_SEM_LIMITES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bloqueia se nenhum limite foi definido no protocolo.
 *
 * Lógica: Se limites_definidos.length === 0 → BLOQUEAR
 *
 * Motivo: Toda decisão institucional precisa de limites explícitos.
 */
function checkSemLimites(protocolo: DecisionProtocol): ClosedLayerResult {
  const limites = protocolo.limites_definidos ?? [];

  if (limites.length === 0) {
    return {
      blocked: true,
      rule: ClosedLayerRuleId.SEM_LIMITES,
      reason: 'Protocolo sem limites definidos não pode gerar decisão institucional'
    };
  }

  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 4 — BLOQUEAR_CONSERVADOR_SEM_CRITERIOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bloqueia se perfil é CONSERVADOR e não há critérios mínimos.
 *
 * Lógica: Se perfil === CONSERVADOR E criterios_minimos.length === 0 → BLOQUEAR
 *
 * Motivo: Perfil conservador exige critérios explícitos de avaliação.
 */
function checkConservadorSemCriterios(protocolo: DecisionProtocol): ClosedLayerResult {
  const criterios = protocolo.criterios_minimos ?? [];
  const perfil = protocolo.perfil_risco;

  if (perfil === PerfilRisco.CONSERVADOR && criterios.length === 0) {
    return {
      blocked: true,
      rule: ClosedLayerRuleId.CONSERVADOR_SEM_CRITERIOS,
      reason: 'Perfil CONSERVADOR exige critérios mínimos explícitos'
    };
  }

  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// REGRA 5 — BLOQUEAR_SEM_CONSEQUENCIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bloqueia se consequência relevante não foi declarada.
 *
 * Lógica: Se consequencia_relevante está vazia ou apenas whitespace → BLOQUEAR
 *
 * Motivo: Decisão institucional precisa explicitar o que está em jogo.
 */
function checkSemConsequencia(situacao: SituacaoDecisoria): ClosedLayerResult {
  const consequencia = (situacao.consequencia_relevante ?? '').trim();

  if (consequencia.length === 0) {
    return {
      blocked: true,
      rule: ClosedLayerRuleId.SEM_CONSEQUENCIA,
      reason: 'Situação sem consequência relevante declarada não justifica decisão institucional'
    };
  }

  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  checkSemRisco,
  checkSemAlternativas,
  checkSemLimites,
  checkConservadorSemCriterios,
  checkSemConsequencia
};
