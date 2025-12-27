/**
 * INCREMENTO 14 — CAMADA DE PESQUISA
 *
 * Barrel export para a Camada de Pesquisa.
 * Expõe tipos, sandbox, runner, store e wrappers readonly.
 */

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

export {
  ResearchMemoryMode,
  ResearchLimits,
  ResearchVariation,
  ResearchInput,
  ResearchVariationResult,
  ResearchMemorySignals,
  ResearchReport,
  ResearchBaselineSummary,
  RESEARCH_WRITE_FORBIDDEN,
  ResearchWriteForbiddenError
} from './ResearchTypes';

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX
// ════════════════════════════════════════════════════════════════════════════

export { ResearchSandbox, SandboxConfig } from './ResearchSandbox';

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════

export {
  ResearchRunner,
  DEFAULT_MAX_VARIACOES,
  DEFAULT_MAX_TEMPO_MS
} from './ResearchRunner';

// ════════════════════════════════════════════════════════════════════════════
// STORE
// ════════════════════════════════════════════════════════════════════════════

export { ResearchStore } from './ResearchStore';

// ════════════════════════════════════════════════════════════════════════════
// READONLY WRAPPERS
// ════════════════════════════════════════════════════════════════════════════

export {
  ReadOnlySituacaoRepository,
  ReadOnlyEpisodioRepository,
  ReadOnlyDecisaoRepository,
  ReadOnlyContratoRepository,
  ReadOnlyProtocolRepository,
  ReadOnlyRepositoryContext,
  createReadOnlyContext
} from './ReadOnlyRepositories';
