/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Serviço
 *
 * Camada de serviço que orquestra operações de revisão humana.
 * Integra repositório, EventLog e efeitos de autonomia.
 *
 * PRINCÍPIOS:
 * - Idempotência: mesma observação não duplica caso nem evento
 * - Auditoria: todas as operações registradas no EventLog
 * - Efeitos: aplica ações de autonomia quando solicitado
 */

import { ActorId, TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';
import { EventLogRepository } from '../event-log/EventLogRepository';
import { ReviewCaseRepository, CreateOrGetResult } from './ReviewCaseRepository';
import {
  ReviewCase,
  ReviewCaseFilters,
  CreateReviewCaseInput,
  ResolveReviewCaseInput,
  DismissReviewCaseInput,
  ReviewEffect
} from './ReviewTypes';
import {
  ReviewCaseNotFoundError,
  InvalidReviewEffectError
} from './ReviewErrors';
import { AutonomyMandateRepository } from '../autonomy/AutonomyMandateRepository';
import { AutonomyConsequenceService, AutonomyConsequenceContext } from '../autonomy/consequence';

// ════════════════════════════════════════════════════════════════════════════
// CONTEXTO DO SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Contexto para o serviço de revisão.
 */
interface ReviewCaseServiceContext {
  /** Repositório de casos de revisão */
  reviewRepo: ReviewCaseRepository;

  /** EventLog para auditoria (opcional) */
  eventLog?: EventLogRepository;

  /** Repositório de mandatos (para aplicar efeitos) */
  mandateRepo?: AutonomyMandateRepository;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DE OPERAÇÕES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da criação/obtenção de caso.
 */
interface CreateReviewResult {
  /** O caso */
  reviewCase: ReviewCase;

  /** Se foi criado agora */
  created: boolean;

  /** ID do evento emitido (se criou) */
  eventId?: string;
}

/**
 * Resultado da resolução de caso.
 */
interface ResolveReviewResult {
  /** O caso atualizado */
  reviewCase: ReviewCase;

  /** Efeitos aplicados com sucesso */
  effectsApplied: ReviewEffect[];

  /** Erros ao aplicar efeitos */
  effectErrors: string[];

  /** ID do evento emitido */
  eventId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Serviço de casos de revisão humana.
 */
class ReviewCaseService {
  private reviewRepo: ReviewCaseRepository;
  private eventLog?: EventLogRepository;
  private mandateRepo?: AutonomyMandateRepository;

  constructor(context: ReviewCaseServiceContext) {
    this.reviewRepo = context.reviewRepo;
    this.eventLog = context.eventLog;
    this.mandateRepo = context.mandateRepo;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRIAÇÃO DE CASO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria ou obtém caso de revisão para uma observação.
   * Idempotente: mesma observação não duplica caso nem evento.
   *
   * @param input - Dados para criação
   * @param actor - Ator que originou (para auditoria)
   * @returns Resultado com caso e flag de criação
   */
  async createOrGetOpen(
    input: CreateReviewCaseInput,
    actor: ActorId = 'Libervia'
  ): Promise<CreateReviewResult> {
    const result = await this.reviewRepo.createOrGetOpenByObservacaoId(input);

    // Só emite evento se criou novo caso (idempotência)
    if (result.created && this.eventLog) {
      await this.logEvent(
        TipoEvento.HUMAN_REVIEW_CASE_OPENED,
        TipoEntidade.REVIEW_CASE,
        result.reviewCase.id,
        {
          reviewId: result.reviewCase.id,
          tenantId: result.reviewCase.tenantId,
          observacaoId: result.reviewCase.triggeredBy.observacaoId,
          mandateId: result.reviewCase.triggeredBy.mandateId,
          ruleId: result.reviewCase.triggeredBy.ruleId,
          actionSuggested: result.reviewCase.triggeredBy.actionSuggested,
          status: result.reviewCase.status
        },
        actor
      );
    }

    return {
      reviewCase: result.reviewCase,
      created: result.created,
      eventId: result.created ? result.reviewCase.id : undefined
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LISTAGEM E BUSCA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista casos de revisão com filtros.
   */
  async list(tenantId: string, filters?: ReviewCaseFilters): Promise<ReviewCase[]> {
    return this.reviewRepo.list(tenantId, filters);
  }

  /**
   * Busca caso por ID.
   */
  async getById(tenantId: string, reviewId: string): Promise<ReviewCase | null> {
    return this.reviewRepo.getById(tenantId, reviewId);
  }

  /**
   * Conta casos por status.
   */
  async countByStatus(tenantId: string): Promise<Record<string, number>> {
    return this.reviewRepo.countByStatus(tenantId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESOLUÇÃO DE CASO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve um caso de revisão.
   * Opcionalmente aplica efeitos de autonomia.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param input - Dados da resolução
   * @returns Resultado com caso atualizado e efeitos aplicados
   */
  async resolve(
    tenantId: string,
    reviewId: string,
    input: ResolveReviewCaseInput
  ): Promise<ResolveReviewResult> {
    // Buscar caso para obter contexto
    const existingCase = await this.reviewRepo.getById(tenantId, reviewId);
    if (!existingCase) {
      throw new ReviewCaseNotFoundError(reviewId, tenantId);
    }

    // Resolver no repositório
    const resolved = await this.reviewRepo.resolve(tenantId, reviewId, input);

    // Aplicar efeitos se solicitado
    const effectsApplied: ReviewEffect[] = [];
    const effectErrors: string[] = [];

    if (input.applyEffects && input.effects && input.effects.length > 0) {
      for (const effect of input.effects) {
        try {
          await this.applyEffect(effect, resolved, input.decidedBy);
          effectsApplied.push(effect);
        } catch (error) {
          effectErrors.push(`${effect}: ${(error as Error).message}`);
        }
      }
    }

    // Emitir evento
    if (this.eventLog) {
      await this.logEvent(
        TipoEvento.HUMAN_REVIEW_CASE_RESOLVED,
        TipoEntidade.REVIEW_CASE,
        resolved.id,
        {
          reviewId: resolved.id,
          tenantId: resolved.tenantId,
          observacaoId: resolved.triggeredBy.observacaoId,
          mandateId: resolved.triggeredBy.mandateId,
          resolution: input.resolution,
          decidedBy: input.decidedBy,
          effectsApplied,
          effectErrors: effectErrors.length > 0 ? effectErrors : undefined
        },
        input.decidedBy
      );
    }

    return {
      reviewCase: resolved,
      effectsApplied,
      effectErrors
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DISPENSA DE CASO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Dispensa um caso de revisão.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param input - Dados da dispensa
   * @returns Caso atualizado
   */
  async dismiss(
    tenantId: string,
    reviewId: string,
    input: DismissReviewCaseInput
  ): Promise<ReviewCase> {
    const dismissed = await this.reviewRepo.dismiss(tenantId, reviewId, input);

    // Emitir evento
    if (this.eventLog) {
      await this.logEvent(
        TipoEvento.HUMAN_REVIEW_CASE_DISMISSED,
        TipoEntidade.REVIEW_CASE,
        dismissed.id,
        {
          reviewId: dismissed.id,
          tenantId: dismissed.tenantId,
          observacaoId: dismissed.triggeredBy.observacaoId,
          mandateId: dismissed.triggeredBy.mandateId,
          dismissedBy: input.dismissedBy,
          notes: input.notes
        },
        input.dismissedBy
      );
    }

    return dismissed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ATUALIZAÇÃO DE NOTAS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Atualiza notas de um caso.
   *
   * @param tenantId - ID do tenant
   * @param reviewId - ID do caso
   * @param notes - Novas notas
   * @param updatedBy - Quem atualizou
   * @returns Caso atualizado
   */
  async updateNotes(
    tenantId: string,
    reviewId: string,
    notes: string,
    updatedBy: string
  ): Promise<ReviewCase> {
    const updated = await this.reviewRepo.updateNotes(tenantId, reviewId, notes, updatedBy);

    // Emitir evento
    if (this.eventLog) {
      await this.logEvent(
        TipoEvento.HUMAN_REVIEW_CASE_NOTES_UPDATED,
        TipoEntidade.REVIEW_CASE,
        updated.id,
        {
          reviewId: updated.id,
          tenantId: updated.tenantId,
          updatedBy
        },
        updatedBy
      );
    }

    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // APLICAÇÃO DE EFEITOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Aplica um efeito de autonomia.
   */
  private async applyEffect(
    effect: ReviewEffect,
    reviewCase: ReviewCase,
    decidedBy: string
  ): Promise<void> {
    const mandateId = reviewCase.triggeredBy.mandateId;

    // Verificar se temos repositório de mandatos
    if (!this.mandateRepo) {
      throw new InvalidReviewEffectError(effect, 'AutonomyMandateRepository não configurado');
    }

    // Criar serviço de consequência
    const consequenceContext: AutonomyConsequenceContext = {
      mandateRepo: this.mandateRepo,
      eventLog: this.eventLog
    };
    const consequenceService = new AutonomyConsequenceService(consequenceContext);

    switch (effect) {
      case 'RESUME_MANDATE':
        if (!mandateId) {
          throw new InvalidReviewEffectError(effect, 'Caso não tem mandateId');
        }
        // resumeMandate já tem guardas canônicas (RBAC, estado, motivo)
        await consequenceService.resumeMandate(
          mandateId,
          decidedBy,
          `Retomado via revisão humana (caso ${reviewCase.id})`
        );
        break;

      case 'REVOKE_MANDATE':
        if (!mandateId) {
          throw new InvalidReviewEffectError(effect, 'Caso não tem mandateId');
        }
        await consequenceService.revokeByConsequence(
          mandateId,
          `Revogado via revisão humana (caso ${reviewCase.id})`,
          reviewCase.triggeredBy.observacaoId
        );
        break;

      case 'KEEP_SUSPENDED':
        // No-op: apenas registra a decisão (já feito na resolução)
        // Não precisa fazer nada, mas registra para auditoria
        break;

      case 'DEGRADE_MODE':
        // Degradação já aplicada pela policy de consequência
        // Aqui apenas registra a confirmação da decisão
        break;

      default:
        throw new InvalidReviewEffectError(effect, 'Efeito desconhecido');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOGGING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Registra evento no EventLog.
   */
  private async logEvent(
    evento: string,
    entidade: string,
    entidadeId: string,
    payload: unknown,
    actor: ActorId
  ): Promise<void> {
    if (!this.eventLog) return;

    try {
      await this.eventLog.append(actor, evento, entidade, entidadeId, payload);
    } catch (error) {
      console.error('[ReviewCaseService] Falha ao registrar evento:', evento, error);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  ReviewCaseService,
  ReviewCaseServiceContext,
  CreateReviewResult,
  ResolveReviewResult
};
