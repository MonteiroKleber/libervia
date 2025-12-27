/**
 * INCREMENTO 13 — CAMADA FECHADA: Validador Principal
 *
 * Função pura que executa todas as regras em sequência.
 * Retorna o PRIMEIRO bloqueio encontrado ou resultado de passagem.
 *
 * PRINCÍPIOS:
 * - Função pura (sem efeitos colaterais)
 * - NÃO persiste nada
 * - NÃO lança exceções
 * - Ordem das regras é determinística
 */

import { SituacaoDecisoria, DecisionProtocol } from '../entidades/tipos';
import { ClosedLayerResult } from './ClosedLayerTypes';
import {
  checkSemRisco,
  checkSemAlternativas,
  checkSemLimites,
  checkConservadorSemCriterios,
  checkSemConsequencia
} from './ClosedLayerRules';

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO PADRÃO (não bloqueado)
// ════════════════════════════════════════════════════════════════════════════

const PASSED: ClosedLayerResult = {
  blocked: false,
  rule: '',
  reason: ''
};

// ════════════════════════════════════════════════════════════════════════════
// VALIDADOR PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valida se uma decisão pode prosseguir.
 *
 * Executa as 5 regras em ordem determinística:
 * 1. BLOQUEAR_SEM_RISCO
 * 2. BLOQUEAR_SEM_ALTERNATIVAS
 * 3. BLOQUEAR_SEM_LIMITES
 * 4. BLOQUEAR_CONSERVADOR_SEM_CRITERIOS
 * 5. BLOQUEAR_SEM_CONSEQUENCIA
 *
 * Retorna o PRIMEIRO bloqueio encontrado ou PASSED se nenhum.
 *
 * @param situacao - A situação decisória sendo avaliada
 * @param protocolo - O protocolo de decisão construído
 * @returns ClosedLayerResult indicando se deve bloquear
 */
function validateClosedLayer(
  situacao: SituacaoDecisoria,
  protocolo: DecisionProtocol
): ClosedLayerResult {
  // Regra 1: Sem risco nem incerteza
  const r1 = checkSemRisco(situacao);
  if (r1.blocked) return r1;

  // Regra 2: Menos de 2 alternativas
  const r2 = checkSemAlternativas(situacao);
  if (r2.blocked) return r2;

  // Regra 3: Sem limites definidos
  const r3 = checkSemLimites(protocolo);
  if (r3.blocked) return r3;

  // Regra 4: Conservador sem critérios
  const r4 = checkConservadorSemCriterios(protocolo);
  if (r4.blocked) return r4;

  // Regra 5: Sem consequência relevante
  const r5 = checkSemConsequencia(situacao);
  if (r5.blocked) return r5;

  // Todas as regras passaram
  return PASSED;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { validateClosedLayer };
