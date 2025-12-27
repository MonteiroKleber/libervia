/**
 * INCREMENTO 16 — MULTIAGENTE
 *
 * Barrel export para o módulo multiagente.
 *
 * Permite que múltiplos agentes decisores processem a mesma situação
 * sob perfis/mandatos distintos, produzindo propostas candidatas
 * e uma agregação institucional final.
 */

// Tipos
export {
  AgentProfile,
  AggregationPolicy,
  MultiAgentRunInput,
  AgentProposalResult,
  NoDecisionReason,
  AggregationDecision,
  MultiAgentRunResult,
  MultiAgentError
} from './MultiAgentTypes';

// Agregador
export {
  aggregate,
  aggregateFirstValid,
  aggregateMajorityByAlternative,
  aggregateWeightedMajority,
  aggregateRequireConsensus,
  aggregateHumanOverrideRequired,
  getValidResults,
  applyTieBreak
} from './MultiAgentAggregator';

// Runner
export {
  runMultiAgent,
  MultiAgentContext,
  selectAlternativeForAgent
} from './MultiAgentRunner';
