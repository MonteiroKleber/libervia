/**
 * CAMADA 3 — NÚCLEO COGNITIVO (CORE)
 *
 * Barrel export para todos os módulos do Core.
 * Este arquivo permite importação unificada dos componentes do núcleo.
 *
 * Exemplo de uso:
 * import { OrquestradorCognitivo, SituacaoDecisoria } from './camada-3';
 */

// ════════════════════════════════════════════════════════════════════════════
// ORQUESTRADOR
// ════════════════════════════════════════════════════════════════════════════

export { OrquestradorCognitivo } from './orquestrador/OrquestradorCognitivo';

// ════════════════════════════════════════════════════════════════════════════
// ENTIDADES (TIPOS)
// ════════════════════════════════════════════════════════════════════════════

export * from './entidades/tipos';

// ════════════════════════════════════════════════════════════════════════════
// REPOSITÓRIOS - INTERFACES
// ════════════════════════════════════════════════════════════════════════════

export { SituacaoRepository } from './repositorios/interfaces/SituacaoRepository';
export { EpisodioRepository } from './repositorios/interfaces/EpisodioRepository';
export { DecisaoRepository } from './repositorios/interfaces/DecisaoRepository';
export { ContratoRepository } from './repositorios/interfaces/ContratoRepository';
export { DecisionProtocolRepository } from './repositorios/interfaces/DecisionProtocolRepository';

// ════════════════════════════════════════════════════════════════════════════
// REPOSITÓRIOS - IMPLEMENTAÇÕES
// ════════════════════════════════════════════════════════════════════════════

export { SituacaoRepositoryImpl } from './repositorios/implementacao/SituacaoRepositoryImpl';
export { EpisodioRepositoryImpl } from './repositorios/implementacao/EpisodioRepositoryImpl';
export { DecisaoRepositoryImpl } from './repositorios/implementacao/DecisaoRepositoryImpl';
export { ContratoRepositoryImpl } from './repositorios/implementacao/ContratoRepositoryImpl';
export { DecisionProtocolRepositoryImpl } from './repositorios/implementacao/DecisionProtocolRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// SERVIÇOS
// ════════════════════════════════════════════════════════════════════════════

export { MemoryQueryService } from './servicos/MemoryQueryService';

// ════════════════════════════════════════════════════════════════════════════
// EVENT LOG
// ════════════════════════════════════════════════════════════════════════════

export {
  EventLogEntry,
  ActorId,
  TipoEvento,
  TipoEntidade,
  ChainVerificationResult
} from './event-log/EventLogEntry';

export {
  EventLogRepository,
  ExportRangeOptions,
  ExportRangeResult,
  ReplayOptions,
  ReplayResult
} from './event-log/EventLogRepository';

export { EventLogRepositoryImpl } from './event-log/EventLogRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// CAMADA FECHADA (INCREMENTO 13)
// ════════════════════════════════════════════════════════════════════════════

export {
  validateClosedLayer,
  ClosedLayerResult,
  ClosedLayerRuleId,
  ClosedLayerRuleIdType
} from './camada-fechada';

// ════════════════════════════════════════════════════════════════════════════
// CAMADA DE PESQUISA (INCREMENTO 14)
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos
  ResearchMemoryMode,
  ResearchLimits,
  ResearchVariation,
  ResearchInput,
  ResearchVariationResult,
  ResearchMemorySignals,
  ResearchReport,
  ResearchBaselineSummary,
  RESEARCH_WRITE_FORBIDDEN,
  ResearchWriteForbiddenError,
  // Sandbox
  ResearchSandbox,
  SandboxConfig,
  // Runner
  ResearchRunner,
  DEFAULT_MAX_VARIACOES,
  DEFAULT_MAX_TEMPO_MS,
  // Store
  ResearchStore,
  // ReadOnly Wrappers
  ReadOnlySituacaoRepository,
  ReadOnlyEpisodioRepository,
  ReadOnlyDecisaoRepository,
  ReadOnlyContratoRepository,
  ReadOnlyProtocolRepository,
  ReadOnlyRepositoryContext,
  createReadOnlyContext
} from './pesquisa';

// ════════════════════════════════════════════════════════════════════════════
// MULTIAGENTE (INCREMENTO 16)
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos
  AgentProfile,
  AggregationPolicy,
  MultiAgentRunInput,
  AgentProposalResult,
  NoDecisionReason,
  AggregationDecision,
  MultiAgentRunResult,
  MultiAgentError,
  // Agregador
  aggregate,
  aggregateFirstValid,
  aggregateMajorityByAlternative,
  aggregateWeightedMajority,
  aggregateRequireConsensus,
  aggregateHumanOverrideRequired,
  getValidResults,
  applyTieBreak,
  // Runner
  runMultiAgent,
  MultiAgentContext,
  selectAlternativeForAgent
} from './multiagente';

// ════════════════════════════════════════════════════════════════════════════
// AUTONOMIA GRADUADA (INCREMENTO 17 + 18 + 19)
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos (Inc 17 + 18)
  MandateStatus,
  MandateExpireReason,
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  AutonomyCheckResult,
  PERFIL_RISCO_ORDEM,
  perfilExcede,
  // Erros
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
  HumanTriggerMatchedError,
  // Repositório
  AutonomyMandateRepository,
  AutonomyMandateRepositoryImpl,
  // Avaliador
  evaluate,
  isMandateValid,
  getEffectiveMode,
  REGRA,
  AutonomyCheckResultExtended,
  // Serviço de Mandato (Inc 18)
  MandateActivityResult,
  MANDATE_RULE,
  isMandateActive,
  canConsumeUse,
  consumeUse,
  markAsExpired,
  shouldMarkExpired,
  getEffectiveStatus,
  // Helpers de Tempo (Inc 18)
  parseIsoDate,
  isBefore,
  isAfter,
  isBeforeOrEqual,
  isAfterOrEqual,
  nowIso,
  isWithinRange,
  // Consequência (Inc 19)
  ConsequenceSeverity,
  ConsequenceCategory,
  ConsequenceAutonomyTriggers,
  ConsequenceAction,
  ConsequenceRuleId,
  ConsequenceEvaluationInput,
  ConsequenceEffects,
  ConsequenceAutonomyResult,
  applyTriggerDefaults,
  getDegradedMode,
  RuleContext,
  ruleSeveridadeCriticaRevoke,
  ruleViolacaoLimitesSuspend,
  rulePerdaRelevanteDegrade,
  ruleLegalEticaHumanReview,
  ruleNoAction,
  RULES_IN_ORDER,
  evaluateRules,
  createRuleContext,
  evaluateConsequenceImpact,
  AutonomyConsequenceService,
  AutonomyConsequenceContext
} from './autonomy';

// ════════════════════════════════════════════════════════════════════════════
// HUMAN REVIEW WORKFLOW (INCREMENTO 20)
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos
  ReviewCaseStatus,
  ReviewResolution,
  ReviewEffect,
  ReviewContextSnapshot,
  ReviewTrigger,
  ReviewDecision,
  ReviewCase,
  CreateReviewCaseInput,
  ResolveReviewCaseInput,
  DismissReviewCaseInput,
  ReviewCaseFilters,
  // Erros
  ReviewError,
  ReviewCaseNotFoundError,
  InvalidReviewTransitionError,
  ReviewNotesRequiredError,
  ReviewCaseAlreadyExistsError,
  InvalidReviewEffectError,
  ReviewAccessDeniedError,
  REVIEW_RULE,
  // Repositório
  ReviewCaseRepository,
  CreateOrGetResult,
  ReviewCaseRepositoryImpl,
  // Serviço
  ReviewCaseService,
  ReviewCaseServiceContext,
  CreateReviewResult,
  ResolveReviewResult
} from './review';

// ════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ════════════════════════════════════════════════════════════════════════════

export { JsonFileStore } from './utilitarios/JsonFileStore';
export { computeEventHash, computePayloadHash } from './utilitarios/HashUtil';
