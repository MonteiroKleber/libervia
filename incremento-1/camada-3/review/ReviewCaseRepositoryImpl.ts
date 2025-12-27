/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Implementação do Repositório
 *
 * Persistência de casos de revisão usando JsonFileStore.
 *
 * PRINCÍPIOS:
 * - Multi-tenant: casos por tenant em arquivo único
 * - Lock de persistência para evitar races
 * - Transições de estado controladas
 * - Idempotência por observacaoId
 */

import { JsonFileStore } from '../utilitarios/JsonFileStore';
import { ReviewCaseRepository, CreateOrGetResult } from './ReviewCaseRepository';
import {
  ReviewCase,
  ReviewCaseFilters,
  CreateReviewCaseInput,
  ResolveReviewCaseInput,
  DismissReviewCaseInput
} from './ReviewTypes';
import {
  ReviewCaseNotFoundError,
  InvalidReviewTransitionError,
  ReviewNotesRequiredError
} from './ReviewErrors';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Implementação do repositório de casos de revisão.
 * Usa JsonFileStore com lock de persistência.
 */
class ReviewCaseRepositoryImpl implements ReviewCaseRepository {
  private store: JsonFileStore;
  private persistLock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOCK DE PERSISTÊNCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Executa operação com lock de persistência.
   * Garante serialização de escritas para evitar race conditions.
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.persistLock;
    let releaseLock: () => void;

    this.persistLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    await previousLock;
    try {
      return await operation();
    } finally {
      releaseLock!();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPERAÇÕES CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async createOrGetOpenByObservacaoId(input: CreateReviewCaseInput): Promise<CreateOrGetResult> {
    return this.withLock(async () => {
      const cases = await this.store.readAll() as ReviewCase[];

      // Buscar caso OPEN existente para esta observação + tenant
      const existing = cases.find(
        c => c.tenantId === input.tenantId &&
             c.triggeredBy.observacaoId === input.triggeredBy.observacaoId &&
             c.status === 'OPEN'
      );

      if (existing) {
        return { reviewCase: existing, created: false };
      }

      // Criar novo caso
      const now = new Date().toISOString();
      const newCase: ReviewCase = {
        id: this.generateId(),
        tenantId: input.tenantId,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        triggeredBy: input.triggeredBy,
        contextSnapshot: input.contextSnapshot
      };

      cases.push(newCase);
      await this.store.writeAll(cases);

      return { reviewCase: newCase, created: true };
    });
  }

  async list(tenantId: string, filters?: ReviewCaseFilters): Promise<ReviewCase[]> {
    const cases = await this.store.readAll() as ReviewCase[];

    let filtered = cases.filter(c => c.tenantId === tenantId);

    if (filters?.status) {
      filtered = filtered.filter(c => c.status === filters.status);
    }

    if (filters?.since) {
      filtered = filtered.filter(c => c.createdAt >= filters.since!);
    }

    if (filters?.observacaoId) {
      filtered = filtered.filter(c => c.triggeredBy.observacaoId === filters.observacaoId);
    }

    if (filters?.mandateId) {
      filtered = filtered.filter(c => c.triggeredBy.mandateId === filters.mandateId);
    }

    // Ordenar por createdAt desc (mais recente primeiro)
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (filters?.limit && filters.limit > 0) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  async getById(tenantId: string, reviewId: string): Promise<ReviewCase | null> {
    const cases = await this.store.readAll() as ReviewCase[];
    return cases.find(c => c.id === reviewId && c.tenantId === tenantId) ?? null;
  }

  async getOpenByObservacaoId(tenantId: string, observacaoId: string): Promise<ReviewCase | null> {
    const cases = await this.store.readAll() as ReviewCase[];
    return cases.find(
      c => c.tenantId === tenantId &&
           c.triggeredBy.observacaoId === observacaoId &&
           c.status === 'OPEN'
    ) ?? null;
  }

  async resolve(
    tenantId: string,
    reviewId: string,
    input: ResolveReviewCaseInput
  ): Promise<ReviewCase> {
    return this.withLock(async () => {
      const cases = await this.store.readAll() as ReviewCase[];
      const index = cases.findIndex(c => c.id === reviewId && c.tenantId === tenantId);

      if (index === -1) {
        throw new ReviewCaseNotFoundError(reviewId, tenantId);
      }

      const reviewCase = cases[index];

      // Validar transição
      if (reviewCase.status !== 'OPEN') {
        throw new InvalidReviewTransitionError(reviewId, reviewCase.status, 'RESOLVED');
      }

      // Validar notas (obrigatório se resolution != NO_ACTION)
      if (input.resolution !== 'NO_ACTION' && (!input.notes || input.notes.trim() === '')) {
        throw new ReviewNotesRequiredError(input.resolution);
      }

      // Atualizar caso
      const now = new Date().toISOString();
      const updated: ReviewCase = {
        ...reviewCase,
        status: 'RESOLVED',
        updatedAt: now,
        decision: {
          decidedBy: input.decidedBy,
          decisionAt: now,
          resolution: input.resolution,
          notes: input.notes || '',
          effectsApplied: input.effects || []
        }
      };

      cases[index] = updated;
      await this.store.writeAll(cases);

      return updated;
    });
  }

  async dismiss(
    tenantId: string,
    reviewId: string,
    input: DismissReviewCaseInput
  ): Promise<ReviewCase> {
    return this.withLock(async () => {
      const cases = await this.store.readAll() as ReviewCase[];
      const index = cases.findIndex(c => c.id === reviewId && c.tenantId === tenantId);

      if (index === -1) {
        throw new ReviewCaseNotFoundError(reviewId, tenantId);
      }

      const reviewCase = cases[index];

      // Validar transição
      if (reviewCase.status !== 'OPEN') {
        throw new InvalidReviewTransitionError(reviewId, reviewCase.status, 'DISMISSED');
      }

      // Validar notas (sempre obrigatório para dismiss)
      if (!input.notes || input.notes.trim() === '') {
        throw new ReviewNotesRequiredError('DISMISS');
      }

      // Atualizar caso
      const now = new Date().toISOString();
      const updated: ReviewCase = {
        ...reviewCase,
        status: 'DISMISSED',
        updatedAt: now,
        decision: {
          decidedBy: input.dismissedBy,
          decisionAt: now,
          resolution: 'NO_ACTION',
          notes: input.notes,
          effectsApplied: []
        }
      };

      cases[index] = updated;
      await this.store.writeAll(cases);

      return updated;
    });
  }

  async updateNotes(
    tenantId: string,
    reviewId: string,
    notes: string,
    updatedBy: string
  ): Promise<ReviewCase> {
    return this.withLock(async () => {
      const cases = await this.store.readAll() as ReviewCase[];
      const index = cases.findIndex(c => c.id === reviewId && c.tenantId === tenantId);

      if (index === -1) {
        throw new ReviewCaseNotFoundError(reviewId, tenantId);
      }

      const reviewCase = cases[index];
      const now = new Date().toISOString();

      // Atualizar notas
      const updated: ReviewCase = {
        ...reviewCase,
        updatedAt: now,
        decision: reviewCase.decision
          ? { ...reviewCase.decision, notes }
          : {
              decidedBy: updatedBy,
              decisionAt: now,
              resolution: 'NO_ACTION',
              notes,
              effectsApplied: []
            }
      };

      cases[index] = updated;
      await this.store.writeAll(cases);

      return updated;
    });
  }

  async countByStatus(tenantId: string): Promise<Record<string, number>> {
    const cases = await this.store.readAll() as ReviewCase[];
    const tenantCases = cases.filter(c => c.tenantId === tenantId);

    const counts: Record<string, number> = {
      OPEN: 0,
      RESOLVED: 0,
      DISMISSED: 0
    };

    for (const c of tenantCases) {
      counts[c.status] = (counts[c.status] || 0) + 1;
    }

    return counts;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private generateId(): string {
    return `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ReviewCaseRepositoryImpl };
