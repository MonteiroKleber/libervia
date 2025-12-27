/**
 * INCREMENTO 13 — CAMADA FECHADA: Tipos Internos
 *
 * Tipos auxiliares usados APENAS internamente pela Camada Fechada.
 * NÃO expostos publicamente, NÃO alteram tipos existentes.
 */

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DA VALIDAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da validação da Camada Fechada.
 *
 * Se blocked === true, a decisão NÃO deve prosseguir.
 */
interface ClosedLayerResult {
  /** Se o fluxo deve ser bloqueado */
  blocked: boolean;

  /** Identificador da regra que causou o bloqueio (vazio se não bloqueado) */
  rule: string;

  /** Motivo legível do bloqueio (vazio se não bloqueado) */
  reason: string;
}

// ════════════════════════════════════════════════════════════════════════════
// IDENTIFICADORES DE REGRAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Identificadores das regras da Camada Fechada.
 * Usados para rastreabilidade e testes.
 */
const ClosedLayerRuleId = {
  SEM_RISCO: 'BLOQUEAR_SEM_RISCO',
  SEM_ALTERNATIVAS: 'BLOQUEAR_SEM_ALTERNATIVAS',
  SEM_LIMITES: 'BLOQUEAR_SEM_LIMITES',
  CONSERVADOR_SEM_CRITERIOS: 'BLOQUEAR_CONSERVADOR_SEM_CRITERIOS',
  SEM_CONSEQUENCIA: 'BLOQUEAR_SEM_CONSEQUENCIA'
} as const;

type ClosedLayerRuleIdType = typeof ClosedLayerRuleId[keyof typeof ClosedLayerRuleId];

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ClosedLayerResult, ClosedLayerRuleId, ClosedLayerRuleIdType };
