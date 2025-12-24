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
// UTILITÁRIOS
// ════════════════════════════════════════════════════════════════════════════

export { JsonFileStore } from './utilitarios/JsonFileStore';
export { computeEventHash, computePayloadHash } from './utilitarios/HashUtil';
