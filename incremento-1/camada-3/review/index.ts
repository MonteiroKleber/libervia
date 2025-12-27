/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW
 *
 * Barrel export para o módulo de revisão humana.
 *
 * Implementa workflow determinístico e auditável para revisão humana:
 * - Quando consequência gera FLAG_HUMAN_REVIEW, cria caso de revisão
 * - tenant_admin/global_admin pode listar, resolver, dispensar
 * - Multi-tenant, RBAC enforced, idempotente e auditado
 */

// Tipos
export {
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
  ReviewCaseFilters
} from './ReviewTypes';

// Erros
export {
  ReviewError,
  ReviewCaseNotFoundError,
  InvalidReviewTransitionError,
  ReviewNotesRequiredError,
  ReviewCaseAlreadyExistsError,
  InvalidReviewEffectError,
  ReviewAccessDeniedError,
  REVIEW_RULE
} from './ReviewErrors';

// Repositório
export { ReviewCaseRepository, CreateOrGetResult } from './ReviewCaseRepository';
export { ReviewCaseRepositoryImpl } from './ReviewCaseRepositoryImpl';

// Serviço
export {
  ReviewCaseService,
  ReviewCaseServiceContext,
  CreateReviewResult,
  ResolveReviewResult
} from './ReviewCaseService';
