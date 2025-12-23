// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4: MODELO DO EVENTO (CANÔNICO)
// ════════════════════════════════════════════════════════════════════════

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
  actor: 'Libervia' | 'Bazari';

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
  MEMORIA_CONSULTADA = 'MEMORIA_CONSULTADA'
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
  CONSULTA = 'MemoryQuery'
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

export { EventLogEntry, TipoEvento, TipoEntidade, ChainVerificationResult };
