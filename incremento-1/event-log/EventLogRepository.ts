// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4: INTERFACE DO REPOSITÓRIO DE EVENT-LOG
// ════════════════════════════════════════════════════════════════════════

import { EventLogEntry, ChainVerificationResult } from './EventLogEntry';

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.3: TIPOS PARA AUDITORIA OPERACIONAL
// ════════════════════════════════════════════════════════════════════════

/**
 * Opções para exportRange()
 */
interface ExportRangeOptions {
  /** Timestamp inicial (inclusivo) */
  fromTs?: Date;
  /** Timestamp final (inclusivo) */
  toTs?: Date;
  /** Segmento inicial (inclusivo) */
  fromSegment?: number;
  /** Segmento final (inclusivo) */
  toSegment?: number;
}

/**
 * Manifesto do export (metadados)
 */
interface ExportManifest {
  fromTs: string | null;
  toTs: string | null;
  fromSegment: number | null;
  toSegment: number | null;
  count: number;
  firstId: string | null;
  lastId: string | null;
  chainValidWithinExport: boolean;
}

/**
 * Resultado do exportRange()
 */
interface ExportRangeResult {
  entries: EventLogEntry[];
  manifest: ExportManifest;
}

/**
 * Opções para replay()
 */
interface ReplayOptions {
  /** Filtrar por tipo de evento */
  evento?: string;
  /** Filtrar por tipo de entidade */
  entidade?: string;
  /** Filtrar por ID de entidade */
  entidadeId?: string;
  /** Timestamp inicial (inclusivo) */
  fromTs?: Date;
  /** Timestamp final (inclusivo) */
  toTs?: Date;
}

/**
 * Inconsistência detectada durante replay
 */
interface ReplayInconsistency {
  index: number;
  id: string;
  reason: string;
}

/**
 * Resultado do replay() - Resumo Operacional
 */
interface ReplayResult {
  totalEventos: number;
  porEvento: Record<string, number>;
  porEntidade: Record<string, number>;
  porAtor: Record<string, number>;
  range: { firstTs: string | null; lastTs: string | null };
  inconsistencias: ReplayInconsistency[];
  truncated: boolean;
}

/**
 * EventLogRepository - Interface para o repositório de eventos encadeados.
 *
 * REGRAS FUNDAMENTAIS:
 * - Append-only (apenas adicionar)
 * - Nunca atualizar eventos existentes
 * - Nunca deletar eventos
 * - O log observa, não governa
 */
interface EventLogRepository {
  /**
   * Inicializa o repositório, carregando eventos do disco.
   */
  init(): Promise<void>;

  /**
   * Adiciona um novo evento ao log.
   * Calcula automaticamente o hash encadeado.
   *
   * @param actor Ator que originou o evento
   * @param evento Tipo do evento
   * @param entidade Tipo da entidade afetada
   * @param entidadeId ID da entidade afetada
   * @param payload Payload da entidade (para cálculo do hash)
   * @returns O evento criado com hashes calculados
   */
  append(
    actor: 'Libervia' | 'Bazari',
    evento: string,
    entidade: string,
    entidadeId: string,
    payload: unknown
  ): Promise<EventLogEntry>;

  /**
   * Retorna todos os eventos em ordem cronológica.
   */
  getAll(): Promise<EventLogEntry[]>;

  /**
   * Retorna um evento pelo ID.
   */
  getById(id: string): Promise<EventLogEntry | null>;

  /**
   * Retorna eventos por tipo de evento.
   */
  getByEvento(evento: string): Promise<EventLogEntry[]>;

  /**
   * Retorna eventos por entidade.
   */
  getByEntidade(entidade: string, entidadeId?: string): Promise<EventLogEntry[]>;

  /**
   * Retorna o último evento da cadeia.
   */
  getLastEntry(): Promise<EventLogEntry | null>;

  /**
   * Retorna o total de eventos no log.
   */
  count(): Promise<number>;

  /**
   * Verifica a integridade da cadeia de hashes.
   * Recalcula hashes em sequência e para na primeira quebra.
   * NUNCA corrige automaticamente.
   */
  verifyChain(): Promise<ChainVerificationResult>;

  // ══════════════════════════════════════════════════════════════════════
  // INCREMENTO 4.3: AUDITORIA OPERACIONAL
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Exporta eventos por intervalo para auditoria externa.
   * Streaming por segmentos, sem carregar tudo em memória.
   *
   * @throws Error se export exceder maxEventsExport
   */
  exportRange(options?: ExportRangeOptions): Promise<ExportRangeResult>;

  /**
   * Gera resumo operacional determinístico (sem opinião).
   * Streaming por segmentos, trunca se exceder limite.
   */
  replay(options?: ReplayOptions): Promise<ReplayResult>;

  /**
   * Verificação rápida a partir do snapshot.
   * Se snapshot não existe, fallback para verifyChain().
   */
  verifyFromSnapshot(): Promise<ChainVerificationResult>;

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export {
  EventLogRepository,
  ExportRangeOptions,
  ExportManifest,
  ExportRangeResult,
  ReplayOptions,
  ReplayInconsistency,
  ReplayResult
};
