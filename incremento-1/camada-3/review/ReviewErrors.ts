/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Erros
 *
 * Erros específicos do módulo de revisão humana.
 */

// ════════════════════════════════════════════════════════════════════════════
// CLASSE BASE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Erro base para operações de revisão.
 */
class ReviewError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ERROS ESPECÍFICOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Caso de revisão não encontrado.
 */
class ReviewCaseNotFoundError extends ReviewError {
  constructor(reviewId: string, tenantId?: string) {
    const msg = tenantId
      ? `Caso de revisão ${reviewId} não encontrado no tenant ${tenantId}`
      : `Caso de revisão ${reviewId} não encontrado`;
    super(msg, 'REVIEW_CASE_NOT_FOUND');
    this.name = 'ReviewCaseNotFoundError';
  }
}

/**
 * Transição de status inválida.
 */
class InvalidReviewTransitionError extends ReviewError {
  constructor(reviewId: string, currentStatus: string, targetStatus: string) {
    super(
      `Transição inválida para caso ${reviewId}: ${currentStatus} → ${targetStatus}`,
      'INVALID_REVIEW_TRANSITION'
    );
    this.name = 'InvalidReviewTransitionError';
  }
}

/**
 * Notas obrigatórias não fornecidas.
 */
class ReviewNotesRequiredError extends ReviewError {
  constructor(resolution: string) {
    super(
      `Notas são obrigatórias para resolução ${resolution}`,
      'REVIEW_NOTES_REQUIRED'
    );
    this.name = 'ReviewNotesRequiredError';
  }
}

/**
 * Caso já existe para a observação.
 */
class ReviewCaseAlreadyExistsError extends ReviewError {
  readonly existingCaseId: string;

  constructor(observacaoId: string, existingCaseId: string) {
    super(
      `Já existe caso de revisão ${existingCaseId} para observação ${observacaoId}`,
      'REVIEW_CASE_ALREADY_EXISTS'
    );
    this.name = 'ReviewCaseAlreadyExistsError';
    this.existingCaseId = existingCaseId;
  }
}

/**
 * Efeito inválido para o contexto.
 */
class InvalidReviewEffectError extends ReviewError {
  constructor(effect: string, reason: string) {
    super(
      `Efeito ${effect} inválido: ${reason}`,
      'INVALID_REVIEW_EFFECT'
    );
    this.name = 'InvalidReviewEffectError';
  }
}

/**
 * Acesso negado ao caso de revisão.
 */
class ReviewAccessDeniedError extends ReviewError {
  constructor(reviewId: string, tenantId: string) {
    super(
      `Acesso negado ao caso ${reviewId} no tenant ${tenantId}`,
      'REVIEW_ACCESS_DENIED'
    );
    this.name = 'ReviewAccessDeniedError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CÓDIGOS DE REGRA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Códigos de regra para operações de revisão.
 */
const REVIEW_RULE = {
  CASE_NOT_FOUND: 'REVIEW_CASE_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_REVIEW_TRANSITION',
  NOTES_REQUIRED: 'REVIEW_NOTES_REQUIRED',
  ALREADY_EXISTS: 'REVIEW_CASE_ALREADY_EXISTS',
  INVALID_EFFECT: 'INVALID_REVIEW_EFFECT',
  ACCESS_DENIED: 'REVIEW_ACCESS_DENIED'
} as const;

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  ReviewError,
  ReviewCaseNotFoundError,
  InvalidReviewTransitionError,
  ReviewNotesRequiredError,
  ReviewCaseAlreadyExistsError,
  InvalidReviewEffectError,
  ReviewAccessDeniedError,
  REVIEW_RULE
};
