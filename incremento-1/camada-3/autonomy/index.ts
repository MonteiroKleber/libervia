/**
 * INCREMENTO 17 + 18 + 19 — AUTONOMIA GRADUADA
 *
 * Barrel export para o módulo de autonomia.
 *
 * Governa QUANDO e COMO a autonomia é permitida:
 * - Ensino: decisão sempre supervisionada
 * - Vivência Assistida: autonomia parcial com limites
 * - Vivência Autônoma: decisão plena dentro de mandatos
 *
 * INCREMENTO 18 adiciona:
 * - Mandatos com validade temporal (validFrom, validUntil)
 * - Mandatos com limite de usos (maxUses, uses)
 * - Expiração automática com auditoria
 *
 * INCREMENTO 19 adiciona:
 * - Status 'suspended' para mandatos
 * - Policy de consequência (revogação/suspensão/degradação automática)
 * - Regras determinísticas baseadas em gatilhos
 * - Feedback loop: consequências afetam autonomia
 */

// Tipos (Inc 17 + 18)
export {
  MandateStatus,
  MandateExpireReason,
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  AutonomyCheckResult,
  PERFIL_RISCO_ORDEM,
  perfilExcede
} from './AutonomyTypes';

// Erros
export {
  AutonomyError,
  HumanOverrideRequiredError,
  EnsinoModeBlockedError,
  MandateRequiredError,
  MandateExpiredError,
  MandateRevokedError,
  PolicyNotAuthorizedError,
  RiskProfileExceededError,
  ClosedLayerBlockedError,
  DomainNotAuthorizedError,
  UseCaseNotAuthorizedError,
  HumanTriggerMatchedError
} from './AutonomyErrors';

// Repositório
export { AutonomyMandateRepository } from './AutonomyMandateRepository';
export { AutonomyMandateRepositoryImpl } from './AutonomyMandateRepositoryImpl';

// Avaliador
export {
  evaluate,
  isMandateValid,
  getEffectiveMode,
  REGRA,
  AutonomyCheckResultExtended
} from './AutonomyEvaluator';

// Serviço de Mandato (Inc 18)
export {
  MandateActivityResult,
  MANDATE_RULE,
  isMandateActive,
  canConsumeUse,
  consumeUse,
  markAsExpired,
  shouldMarkExpired,
  getEffectiveStatus
} from './AutonomyMandateService';

// Helpers de Tempo (Inc 18)
export {
  parseIsoDate,
  isBefore,
  isAfter,
  isBeforeOrEqual,
  isAfterOrEqual,
  nowIso,
  isWithinRange
} from './AutonomyTime';

// Consequência (Inc 19)
export * from './consequence';
