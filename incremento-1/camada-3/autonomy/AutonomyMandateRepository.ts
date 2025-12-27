/**
 * INCREMENTO 17 + 18 + 19 — AUTONOMIA GRADUADA: Interface do Repositório de Mandatos
 *
 * Define a interface para persistência de mandatos de autonomia.
 *
 * PRINCÍPIOS:
 * - Append-only (mandatos não são alterados, apenas revogados/expirados/suspensos)
 * - Auditável (todas as operações são rastreáveis)
 * - Imutável após criação (exceto revogação, expiração, suspensão e incremento de uso)
 *
 * INCREMENTO 18 adiciona:
 * - markExpired: marca mandato como expirado
 * - incrementUses: incrementa contador de usos
 * - update: atualização genérica (uso interno)
 *
 * INCREMENTO 19 adiciona:
 * - suspend: suspende mandato por consequência
 * - resume: retoma mandato suspenso (opcional para MVP)
 */

import { AutonomyMandate, MandateExpireReason } from './AutonomyTypes';

// ════════════════════════════════════════════════════════════════════════════
// INTERFACE DO REPOSITÓRIO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Interface para repositório de mandatos de autonomia.
 */
interface AutonomyMandateRepository {
  /**
   * Cria um novo mandato.
   * @param mandate - Mandato a criar
   */
  create(mandate: AutonomyMandate): Promise<void>;

  /**
   * Obtém mandato por ID.
   * @param id - ID do mandato
   * @returns Mandato ou null se não encontrado
   */
  getById(id: string): Promise<AutonomyMandate | null>;

  /**
   * Obtém mandatos ativos para um agente.
   * Mandatos ativos: não revogados e não expirados.
   * @param agentId - ID do agente
   * @param now - Data atual para verificação (Inc 18)
   * @returns Lista de mandatos ativos
   */
  getActiveByAgentId(agentId: string, now?: Date): Promise<AutonomyMandate[]>;

  /**
   * Obtém o mandato ativo mais recente para um agente.
   * @param agentId - ID do agente
   * @param now - Data atual para verificação (Inc 18)
   * @returns Mandato mais recente ou null
   */
  getMostRecentActiveByAgentId(agentId: string, now?: Date): Promise<AutonomyMandate | null>;

  /**
   * Obtém todos os mandatos de um agente (incluindo revogados/expirados).
   * @param agentId - ID do agente
   * @returns Histórico completo de mandatos
   */
  getAllByAgentId(agentId: string): Promise<AutonomyMandate[]>;

  /**
   * Revoga um mandato.
   * @param id - ID do mandato
   * @param revogadoPor - Ator que revogou
   * @param motivo - Motivo da revogação
   */
  revoke(id: string, revogadoPor: string, motivo?: string): Promise<void>;

  /**
   * Lista todos os mandatos.
   * @param includeRevoked - Incluir mandatos revogados (default: false)
   * @returns Lista de mandatos
   */
  getAll(includeRevoked?: boolean): Promise<AutonomyMandate[]>;

  /**
   * Verifica se existe mandato ativo para agente.
   * @param agentId - ID do agente
   * @returns true se existe mandato ativo
   */
  hasActiveMandate(agentId: string): Promise<boolean>;

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DO INCREMENTO 18 - VALIDADE TEMPORAL E LIMITE DE USOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Marca mandato como expirado.
   * @param id - ID do mandato
   * @param reason - Motivo da expiração ('TIME' ou 'USES')
   * @param now - Data da expiração
   */
  markExpired(id: string, reason: MandateExpireReason, now?: Date): Promise<void>;

  /**
   * Incrementa contador de usos do mandato.
   * Operação atômica e serializada para evitar race conditions.
   * @param id - ID do mandato
   * @param now - Data do uso
   * @returns Mandato atualizado
   */
  incrementUses(id: string, now?: Date): Promise<AutonomyMandate>;

  /**
   * Atualiza mandato (uso interno).
   * Usado por markExpired e incrementUses.
   * @param mandate - Mandato atualizado
   */
  update(mandate: AutonomyMandate): Promise<void>;

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DO INCREMENTO 19 - SUSPENSÃO POR CONSEQUÊNCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Suspende um mandato por consequência.
   * Operação idempotente: se já suspenso, não faz nada.
   * @param id - ID do mandato
   * @param reason - Motivo da suspensão
   * @param observacaoId - ID da observação que disparou
   * @param now - Data da suspensão
   */
  suspend(id: string, reason: string, observacaoId: string, now?: Date): Promise<void>;

  /**
   * Retoma um mandato suspenso.
   * Operação idempotente: se não suspenso, não faz nada.
   * @param id - ID do mandato
   * @param resumedBy - Ator que retomou
   * @param now - Data da retomada
   */
  resume?(id: string, resumedBy: string, now?: Date): Promise<void>;
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT PARA SUSPENSÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para suspensão de mandato.
 */
interface SuspendMandateInput {
  /** ID do mandato */
  mandateId: string;

  /** Motivo da suspensão */
  reason: string;

  /** ID da observação que disparou */
  observacaoId: string;

  /** Data da suspensão */
  suspendedAt?: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { AutonomyMandateRepository, SuspendMandateInput };
