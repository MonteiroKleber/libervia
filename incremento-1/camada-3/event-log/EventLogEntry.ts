// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4: MODELO DO EVENTO (CANÔNICO)
// ════════════════════════════════════════════════════════════════════════

/**
 * ActorId - Identificador do ator que originou o evento.
 *
 * Valores conhecidos:
 * - 'Libervia': Sistema interno (orquestrador, serviços)
 * - Outros: Sistemas externos/integrações (ex: 'external', 'tenant-xyz')
 */
type ActorId = string;

/**
 * EventLogEntry - Registro imutável de evento no log encadeado.
 *
 * PRINCÍPIOS:
 * - Nunca recalcular
 * - Nunca atualizar
 * - Nunca deletar
 * - Append-only
 *
 * O hash encadeado garante que qualquer alteração retroativa
 * quebra a cadeia de verificação.
 */
interface EventLogEntry {
  /** ID único do evento */
  id: string;

  /** Timestamp do evento (fonte: sistema) */
  timestamp: Date;

  /** Ator que originou o evento */
  actor: ActorId;

  /** Tipo do evento (ex: 'SITUACAO_CRIADA', 'DECISAO_REGISTRADA') */
  evento: string;

  /** Tipo da entidade afetada */
  entidade: string;

  /** ID da entidade afetada */
  entidade_id: string;

  /** Hash SHA-256 do payload da entidade no momento do evento */
  payload_hash: string;

  /** Hash do evento anterior (null apenas no genesis) */
  previous_hash: string | null;

  /** Hash deste evento (calculado a partir dos campos acima) */
  current_hash: string;
}

/**
 * Tipos de eventos suportados pelo EventLog.
 */
enum TipoEvento {
  // Situação
  SITUACAO_CRIADA = 'SITUACAO_CRIADA',
  SITUACAO_STATUS_ALTERADO = 'SITUACAO_STATUS_ALTERADO',

  // Episódio
  EPISODIO_CRIADO = 'EPISODIO_CRIADO',
  EPISODIO_ESTADO_ALTERADO = 'EPISODIO_ESTADO_ALTERADO',

  // Protocolo
  PROTOCOLO_VALIDADO = 'PROTOCOLO_VALIDADO',
  PROTOCOLO_REJEITADO = 'PROTOCOLO_REJEITADO',

  // Decisão
  DECISAO_REGISTRADA = 'DECISAO_REGISTRADA',

  // Contrato
  CONTRATO_EMITIDO = 'CONTRATO_EMITIDO',

  // Consulta
  MEMORIA_CONSULTADA = 'MEMORIA_CONSULTADA',

  // Consequência (Incremento 15)
  CONSEQUENCIA_REGISTRADA = 'CONSEQUENCIA_REGISTRADA',

  // Multiagente (Incremento 16)
  MULTIAGENT_RUN_STARTED = 'MULTIAGENT_RUN_STARTED',
  AGENT_PROTOCOL_PROPOSED = 'AGENT_PROTOCOL_PROPOSED',
  AGENT_DECISION_PROPOSED = 'AGENT_DECISION_PROPOSED',
  MULTIAGENT_AGGREGATION_SELECTED = 'MULTIAGENT_AGGREGATION_SELECTED',
  MULTIAGENT_NO_DECISION = 'MULTIAGENT_NO_DECISION',

  // Autonomia (Incremento 17)
  AUTONOMY_GRANTED = 'AUTONOMY_GRANTED',
  AUTONOMY_REVOKED = 'AUTONOMY_REVOKED',
  AUTONOMY_BLOCKED = 'AUTONOMY_BLOCKED',
  AUTONOMY_CHECK_PASSED = 'AUTONOMY_CHECK_PASSED',
  AUTONOMY_CHECK_FAILED = 'AUTONOMY_CHECK_FAILED',

  // Autonomia - Expiração (Incremento 18)
  AUTONOMY_EXPIRED = 'AUTONOMY_EXPIRED',
  AUTONOMY_USE_CONSUMED = 'AUTONOMY_USE_CONSUMED',

  // Autonomia - Consequências (Incremento 19)
  AUTONOMY_SUSPENDED = 'AUTONOMY_SUSPENDED',
  AUTONOMY_RESUMED = 'AUTONOMY_RESUMED',
  AUTONOMY_DEGRADED = 'AUTONOMY_DEGRADED',
  AUTONOMY_REVOKED_BY_CONSEQUENCE = 'AUTONOMY_REVOKED_BY_CONSEQUENCE',
  AUTONOMY_HUMAN_REVIEW_FLAGGED = 'AUTONOMY_HUMAN_REVIEW_FLAGGED'
}

/**
 * Tipos de entidades rastreadas pelo EventLog.
 */
enum TipoEntidade {
  SITUACAO = 'SituacaoDecisoria',
  EPISODIO = 'EpisodioDecisao',
  PROTOCOLO = 'DecisionProtocol',
  DECISAO = 'DecisaoInstitucional',
  CONTRATO = 'ContratoDeDecisao',
  CONSULTA = 'MemoryQuery',
  OBSERVACAO = 'ObservacaoDeConsequencia',
  MULTIAGENT_RUN = 'MultiAgentRun',
  AUTONOMY_MANDATE = 'AutonomyMandate'
}

/**
 * Resultado da verificação da cadeia de eventos.
 */
interface ChainVerificationResult {
  /** Se a cadeia está íntegra */
  valid: boolean;

  /** Índice do primeiro evento inválido (se houver) */
  firstInvalidIndex?: number;

  /** ID do primeiro evento inválido (se houver) */
  firstInvalidId?: string;

  /** Motivo da falha (se houver) */
  reason?: string;

  /** Total de eventos verificados */
  totalVerified: number;
}

export { ActorId, EventLogEntry, TipoEvento, TipoEntidade, ChainVerificationResult };
