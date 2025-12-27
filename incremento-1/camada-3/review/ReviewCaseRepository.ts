/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Interface do Repositório
 *
 * Define a interface para persistência de casos de revisão.
 *
 * PRINCÍPIOS:
 * - Multi-tenant: cada operação recebe tenantId
 * - Append-only com transições controladas
 * - Idempotência: createOrGetOpen não duplica casos
 */

import {
  ReviewCase,
  ReviewCaseFilters,
  CreateReviewCaseInput,
  ResolveReviewCaseInput,
  DismissReviewCaseInput
} from './ReviewTypes';

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DE OPERAÇÕES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da operação createOrGetOpen.
 */
interface CreateOrGetResult {
  /** O caso (novo ou existente) */
  reviewCase: ReviewCase;

  /** Se foi criado agora (true) ou já existia (false) */
  created: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// INTERFACE DO REPOSITÓRIO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Repositório de casos de revisão humana.
 */
interface ReviewCaseRepository {
  /**
   * Cria um novo caso ou retorna o existente (OPEN) para a observação.
   * Idempotente: mesma observacaoId não duplica caso OPEN.
   *
   * @param input - Dados para criação
   * @returns Caso criado ou existente + flag indicando se criou
   */
  createOrGetOpenByObservacaoId(input: CreateReviewCaseInput): Promise<CreateOrGetResult>;

  /**
   * Lista casos de revisão com filtros.
   *
   * @param tenantId - ID do tenant
   * @param filters - Filtros opcionais
   * @returns Lista de casos ordenada por createdAt desc
   */
  list(tenantId: string, filters?: ReviewCaseFilters): Promise<ReviewCase[]>;

  /**
   * Busca caso por ID.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @returns Caso ou null
   */
  getById(tenantId: string, reviewId: string): Promise<ReviewCase | null>;

  /**
   * Busca caso OPEN por observacaoId.
   *
   * @param tenantId - ID do tenant
   * @param observacaoId - ID da observação
   * @returns Caso OPEN ou null
   */
  getOpenByObservacaoId(tenantId: string, observacaoId: string): Promise<ReviewCase | null>;

  /**
   * Resolve um caso (OPEN → RESOLVED).
   * Apenas transição OPEN → RESOLVED é permitida.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param input - Dados da resolução
   * @returns Caso atualizado
   * @throws InvalidReviewTransitionError se não estiver OPEN
   * @throws ReviewNotesRequiredError se notes vazio e resolution != NO_ACTION
   */
  resolve(tenantId: string, reviewId: string, input: ResolveReviewCaseInput): Promise<ReviewCase>;

  /**
   * Dispensa um caso (OPEN → DISMISSED).
   * Apenas transição OPEN → DISMISSED é permitida.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param input - Dados da dispensa
   * @returns Caso atualizado
   * @throws InvalidReviewTransitionError se não estiver OPEN
   * @throws ReviewNotesRequiredError se notes vazio
   */
  dismiss(tenantId: string, reviewId: string, input: DismissReviewCaseInput): Promise<ReviewCase>;

  /**
   * Atualiza notas de um caso (qualquer status).
   * Operação auditável.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param notes - Novas notas
   * @param updatedBy - Quem atualizou
   * @returns Caso atualizado
   */
  updateNotes(tenantId: string, reviewId: string, notes: string, updatedBy: string): Promise<ReviewCase>;

  /**
   * Conta casos por status.
   *
   * @param tenantId - ID do tenant
   * @returns Contagem por status
   */
  countByStatus(tenantId: string): Promise<Record<string, number>>;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ReviewCaseRepository, CreateOrGetResult };
