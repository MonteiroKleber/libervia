/**
 * INCREMENTO 19 — SERVIÇO DE APLICAÇÃO DE CONSEQUÊNCIAS
 *
 * Camada de domínio que aplica efeitos determinados pela policy.
 * Conecta policy (pura) com repositórios e eventlog.
 *
 * RESPONSABILIDADES:
 * - Aplicar suspensão/revogação de mandato
 * - Registrar eventos de auditoria
 * - Garantir idempotência
 * - Reutilizar persistLock para evitar race conditions
 *
 * PRINCÍPIOS:
 * - Policy é pura (sem I/O) → Service faz I/O
 * - Idempotência: mesma observação não duplica efeitos
 * - Auditabilidade: tudo registrado no EventLog
 */

import { ActorId, TipoEvento, TipoEntidade } from '../../event-log/EventLogEntry';
import { EventLogRepository } from '../../event-log/EventLogRepository';
import { AutonomyMandate, AutonomyMode } from '../AutonomyTypes';
import { AutonomyMandateRepository } from '../AutonomyMandateRepository';
import { ObservacaoDeConsequencia } from '../../entidades/ObservacaoDeConsequencia';
import { ContratoDeDecisao } from '../../entidades/tipos';
import {
  ConsequenceAutonomyResult,
  ConsequenceAutonomyTriggers,
  ConsequenceAction,
  ConsequenceRuleId
} from './AutonomyConsequenceTypes';
import {
  evaluateConsequenceImpact,
  requiresAction,
  affectsMandateStatus
} from './AutonomyConsequencePolicy';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS DO SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para processamento de consequência.
 */
interface ProcessConsequenceInput {
  /** Observação de consequência */
  observacao: ObservacaoDeConsequencia;

  /** Gatilhos estruturais */
  triggers?: ConsequenceAutonomyTriggers;

  /** Contrato relacionado */
  contrato?: ContratoDeDecisao;

  /** Ator que registrou (para auditoria) */
  actor?: ActorId;

  /** Data/hora atual */
  now?: Date;
}

/**
 * Resultado do processamento de consequência.
 */
interface ProcessConsequenceResult {
  /** Resultado da avaliação */
  evaluation: ConsequenceAutonomyResult;

  /** Se efeitos foram aplicados */
  applied: boolean;

  /** Eventos registrados */
  eventsLogged: string[];

  /** Mandato atualizado (se alterado) */
  updatedMandate?: AutonomyMandate;
}

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
  suspendedAt: Date;

  /** Ator que registrou */
  actor?: ActorId;
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXTO DO SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Contexto para o serviço de consequências.
 */
interface AutonomyConsequenceContext {
  /** Repositório de mandatos */
  mandateRepo: AutonomyMandateRepository;
  /** EventLog para auditoria */
  eventLog?: EventLogRepository;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

/**
 * AutonomyConsequenceService - Aplica efeitos de consequências.
 */
class AutonomyConsequenceService {
  private mandateRepo: AutonomyMandateRepository;
  private eventLog?: EventLogRepository;

  constructor(context: AutonomyConsequenceContext) {
    this.mandateRepo = context.mandateRepo;
    this.eventLog = context.eventLog;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROCESSAMENTO PRINCIPAL
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Processa uma consequência e aplica efeitos determinados pela policy.
   *
   * Fluxo:
   * 1. Buscar mandato do agente que registrou o contrato
   * 2. Avaliar impacto usando policy pura
   * 3. Aplicar efeitos (suspend/revoke/degrade)
   * 4. Registrar eventos de auditoria
   *
   * @param input - Dados para processamento
   * @param agentId - ID do agente (opcional, derivado do contrato se não fornecido)
   * @returns Resultado do processamento
   */
  async processConsequence(
    input: ProcessConsequenceInput,
    agentId?: string
  ): Promise<ProcessConsequenceResult> {
    const { observacao, triggers, contrato, actor, now } = input;
    const currentTime = now ?? new Date();

    // Resultado inicial
    const result: ProcessConsequenceResult = {
      evaluation: {
        action: ConsequenceAction.NO_ACTION,
        reason: 'Não avaliado',
        ruleId: ConsequenceRuleId.NO_TRIGGER,
        effects: {}
      },
      applied: false,
      eventsLogged: []
    };

    // Buscar mandato ativo do agente
    let mandate: AutonomyMandate | null = null;
    if (agentId) {
      mandate = await this.mandateRepo.getMostRecentActiveByAgentId(agentId, currentTime);
    }

    // Avaliar impacto
    result.evaluation = evaluateConsequenceImpact({
      observacao,
      triggers,
      contrato,
      mandate: mandate ?? undefined,
      currentMode: mandate?.modo,
      now: currentTime
    });

    // Se não requer ação, retornar
    if (!requiresAction(result.evaluation)) {
      return result;
    }

    // Se já foi aplicado (idempotência), retornar
    if (result.evaluation.alreadyApplied) {
      return result;
    }

    // Aplicar efeitos baseado na ação
    await this.applyEffects(result, mandate, actor ?? 'Libervia', currentTime);

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // APLICAÇÃO DE EFEITOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Aplica os efeitos determinados pela avaliação.
   */
  private async applyEffects(
    result: ProcessConsequenceResult,
    mandate: AutonomyMandate | null,
    actor: ActorId,
    now: Date
  ): Promise<void> {
    const { action, effects, reason, ruleId } = result.evaluation;

    switch (action) {
      case ConsequenceAction.REVOKE_MANDATE:
        if (mandate) {
          await this.revokeByConsequenceInternal(mandate, effects.triggeredByObservacaoId!, reason, actor, now);
          result.applied = true;
          result.eventsLogged.push(TipoEvento.AUTONOMY_REVOKED_BY_CONSEQUENCE);
          result.updatedMandate = await this.mandateRepo.getById(mandate.id) ?? undefined;
        }
        break;

      case ConsequenceAction.SUSPEND_MANDATE:
        if (mandate) {
          await this.suspendMandateInternal({
            mandateId: mandate.id,
            reason: effects.suspendReason ?? reason,
            observacaoId: effects.triggeredByObservacaoId!,
            suspendedAt: now,
            actor
          });
          result.applied = true;
          result.eventsLogged.push(TipoEvento.AUTONOMY_SUSPENDED);
          if (effects.requiresHumanReview) {
            result.eventsLogged.push(TipoEvento.AUTONOMY_HUMAN_REVIEW_FLAGGED);
          }
          result.updatedMandate = await this.mandateRepo.getById(mandate.id) ?? undefined;
        }
        break;

      case ConsequenceAction.DEGRADE_MODE:
        if (mandate && effects.newAutonomyMode) {
          await this.degradeModeInternal(mandate, effects.newAutonomyMode, effects.triggeredByObservacaoId!, actor, now);
          result.applied = true;
          result.eventsLogged.push(TipoEvento.AUTONOMY_DEGRADED);
          result.updatedMandate = await this.mandateRepo.getById(mandate.id) ?? undefined;
        }
        break;

      case ConsequenceAction.FLAG_HUMAN_REVIEW:
        await this.flagHumanReviewInternal(mandate?.id, effects.triggeredByObservacaoId!, reason, actor, now);
        result.applied = true;
        result.eventsLogged.push(TipoEvento.AUTONOMY_HUMAN_REVIEW_FLAGGED);
        break;

      case ConsequenceAction.NO_ACTION:
      default:
        // Nada a fazer
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPERAÇÕES DE MANDATO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Suspende um mandato (versão simplificada para uso externo).
   * Operação idempotente: se já suspenso, não faz nada.
   */
  async suspendMandate(
    mandateId: string,
    reason: string,
    observacaoId: string,
    now: Date = new Date()
  ): Promise<void> {
    return this.suspendMandateInternal({
      mandateId,
      reason,
      observacaoId,
      suspendedAt: now,
      actor: 'Libervia'
    });
  }

  /**
   * Suspende um mandato (versão completa interna).
   * Operação idempotente: se já suspenso, não faz nada.
   */
  private async suspendMandateInternal(input: SuspendMandateInput): Promise<void> {
    const mandate = await this.mandateRepo.getById(input.mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${input.mandateId} não encontrado`);
    }

    // Idempotência: se já suspenso, não faz nada
    if (mandate.status === 'suspended') {
      return;
    }

    // Não pode suspender se já revogado ou expirado
    if (mandate.status === 'revoked' || mandate.revogado || mandate.status === 'expired') {
      return;
    }

    // Atualizar mandato
    const updated: AutonomyMandate = {
      ...mandate,
      status: 'suspended',
      suspendedAt: input.suspendedAt.toISOString(),
      suspendReason: input.reason,
      triggeredByObservacaoId: input.observacaoId
    };

    await this.mandateRepo.update(updated);

    // Registrar evento
    await this.logEvent(
      TipoEvento.AUTONOMY_SUSPENDED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandate.id,
      {
        mandateId: mandate.id,
        agentId: mandate.agentId,
        suspendedAt: input.suspendedAt.toISOString(),
        suspendReason: input.reason,
        observacaoId: input.observacaoId
      },
      input.actor ?? 'Libervia'
    );
  }

  /**
   * Revoga um mandato por consequência (versão simplificada para uso externo).
   * Diferente de revogação manual - registra observação que disparou.
   */
  async revokeByConsequence(
    mandateId: string,
    reason: string,
    observacaoId: string,
    now: Date = new Date()
  ): Promise<void> {
    const mandate = await this.mandateRepo.getById(mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${mandateId} não encontrado`);
    }
    return this.revokeByConsequenceInternal(mandate, observacaoId, reason, 'Libervia', now);
  }

  /**
   * Revoga um mandato por consequência (versão interna).
   * Diferente de revogação manual - registra observação que disparou.
   */
  private async revokeByConsequenceInternal(
    mandate: AutonomyMandate,
    observacaoId: string,
    reason: string,
    actor: ActorId,
    now: Date
  ): Promise<void> {
    // Idempotência
    if (mandate.status === 'revoked' || mandate.revogado) {
      return;
    }

    // Atualizar mandato
    const updated: AutonomyMandate = {
      ...mandate,
      status: 'revoked',
      revogado: true,
      revogado_em: now,
      revogado_por: actor,
      motivo_revogacao: reason,
      triggeredByObservacaoId: observacaoId
    };

    await this.mandateRepo.update(updated);

    // Registrar evento específico de revogação por consequência
    await this.logEvent(
      TipoEvento.AUTONOMY_REVOKED_BY_CONSEQUENCE,
      TipoEntidade.AUTONOMY_MANDATE,
      mandate.id,
      {
        mandateId: mandate.id,
        agentId: mandate.agentId,
        revokedAt: now.toISOString(),
        reason,
        observacaoId
      },
      actor
    );
  }

  /**
   * Degrada o modo de autonomia de um mandato (versão simplificada).
   */
  async degradeMode(
    mandateId: string,
    oldMode: AutonomyMode,
    newMode: AutonomyMode,
    observacaoId: string,
    now: Date = new Date()
  ): Promise<void> {
    const mandate = await this.mandateRepo.getById(mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${mandateId} não encontrado`);
    }
    return this.degradeModeInternal(mandate, newMode, observacaoId, 'Libervia', now);
  }

  /**
   * Degrada o modo de autonomia de um mandato (versão interna).
   */
  private async degradeModeInternal(
    mandate: AutonomyMandate,
    newMode: AutonomyMode,
    observacaoId: string,
    actor: ActorId,
    now: Date
  ): Promise<void> {
    const oldMode = mandate.modo;

    // Atualizar mandato
    const updated: AutonomyMandate = {
      ...mandate,
      modo: newMode,
      triggeredByObservacaoId: observacaoId
    };

    await this.mandateRepo.update(updated);

    // Registrar evento
    await this.logEvent(
      TipoEvento.AUTONOMY_DEGRADED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandate.id,
      {
        mandateId: mandate.id,
        agentId: mandate.agentId,
        oldMode,
        newMode,
        degradedAt: now.toISOString(),
        observacaoId
      },
      actor
    );
  }

  /**
   * Registra flag de human review (versão simplificada).
   */
  async flagHumanReview(
    agentId: string,
    reason: string,
    observacaoId: string,
    mandateId?: string,
    now: Date = new Date()
  ): Promise<void> {
    return this.flagHumanReviewInternal(mandateId, observacaoId, reason, 'Libervia', now);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPERAÇÃO DE RESUME (Inc 19 - Guarda Canônica)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Retoma um mandato suspenso (versão com guardas canônicas).
   *
   * GUARDAS OBRIGATÓRIAS:
   * 1. RBAC: Apenas humanos autorizados podem resumir
   * 2. Estado: Não pode resumir se revoked/expired
   * 3. Motivo: Se triggeredByObservacaoId existe, exige reason
   * 4. Evento: Sempre emite AUTONOMY_RESUMED
   *
   * Operação idempotente: se não suspenso, não faz nada.
   *
   * @param mandateId - ID do mandato
   * @param resumedBy - Ator que retoma (deve ser humano autorizado)
   * @param reason - Motivo da retomada (obrigatório se havia observação)
   * @param now - Data/hora atual
   * @throws Error se mandato não encontrado
   * @throws Error se mandato revogado/expirado
   * @throws Error se triggeredByObservacaoId existe mas reason não fornecido
   */
  async resumeMandate(
    mandateId: string,
    resumedBy: ActorId,
    reason?: string,
    now: Date = new Date()
  ): Promise<void> {
    const mandate = await this.mandateRepo.getById(mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${mandateId} não encontrado`);
    }

    // Guarda 1: Validar que não é sistema/agente (apenas humano pode resumir)
    // Actor 'Libervia' é sistema, outros são humanos
    if (resumedBy === 'Libervia') {
      throw new Error('Apenas humanos autorizados podem retomar mandatos suspensos');
    }

    // Guarda 2: Não pode resumir mandato revogado ou expirado
    // (verificar ANTES de idempotência para bloquear explicitamente)
    if (mandate.status === 'revoked' || mandate.revogado) {
      throw new Error(`Mandato ${mandateId} foi revogado e não pode ser retomado`);
    }
    if (mandate.status === 'expired') {
      throw new Error(`Mandato ${mandateId} está expirado e não pode ser retomado`);
    }

    // Idempotência: se não suspenso (ex: active), não faz nada
    if (mandate.status !== 'suspended') {
      return;
    }

    // Guarda 3: Se há observação que disparou suspensão, exigir motivo
    if (mandate.triggeredByObservacaoId && !reason) {
      throw new Error(
        `Mandato ${mandateId} foi suspenso por consequência (obs: ${mandate.triggeredByObservacaoId}). ` +
        'Motivo de retomada é obrigatório.'
      );
    }

    // Atualizar mandato
    const updated: AutonomyMandate = {
      ...mandate,
      status: 'active',
      // Limpar campos de suspensão (mantém histórico via EventLog)
      suspendedAt: undefined,
      suspendReason: undefined,
      triggeredByObservacaoId: undefined
    };

    await this.mandateRepo.update(updated);

    // Guarda 4: Sempre emitir evento de auditoria
    await this.logEvent(
      TipoEvento.AUTONOMY_RESUMED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandate.id,
      {
        mandateId: mandate.id,
        agentId: mandate.agentId,
        resumedAt: now.toISOString(),
        resumedBy,
        reason: reason ?? 'Retomada sem observação prévia',
        previousSuspendReason: mandate.suspendReason,
        previousTriggeredBy: mandate.triggeredByObservacaoId
      },
      resumedBy
    );
  }

  /**
   * Registra flag de human review (versão interna).
   */
  private async flagHumanReviewInternal(
    mandateId: string | undefined,
    observacaoId: string,
    reason: string,
    actor: ActorId,
    now: Date
  ): Promise<void> {
    // Registrar evento (mesmo sem mandato)
    await this.logEvent(
      TipoEvento.AUTONOMY_HUMAN_REVIEW_FLAGGED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandateId ?? observacaoId,
      {
        mandateId,
        observacaoId,
        reason,
        flaggedAt: now.toISOString()
      },
      actor
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOGGING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Registra evento no EventLog.
   * Silenciosamente falha se EventLog não configurado.
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
      // Log falhou, mas não bloqueia operação
      console.error('[AutonomyConsequenceService] Falha ao registrar evento:', evento, error);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  AutonomyConsequenceService,
  AutonomyConsequenceContext,
  ProcessConsequenceInput,
  ProcessConsequenceResult,
  SuspendMandateInput
};
