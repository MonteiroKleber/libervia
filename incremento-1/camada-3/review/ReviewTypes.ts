/**
 * INCREMENTO 20 — HUMAN REVIEW WORKFLOW: Tipos
 *
 * Define os tipos para o workflow de revisão humana.
 *
 * PRINCÍPIOS:
 * - Append-only: estado controlado por transições
 * - Sem IA/heurística: fila mecânica
 * - Idempotência: mesma observação não duplica caso
 * - Multi-tenant: cada caso pertence a um tenant
 */

import { ConsequenceAction, ConsequenceRuleId } from '../autonomy/consequence/AutonomyConsequenceTypes';

// ════════════════════════════════════════════════════════════════════════════
// STATUS DO CASO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Status do caso de revisão.
 */
type ReviewCaseStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

// ════════════════════════════════════════════════════════════════════════════
// RESOLUÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tipo de resolução do caso.
 */
type ReviewResolution = 'APPROVE' | 'REJECT' | 'NEEDS_MORE_INFO' | 'NO_ACTION';

/**
 * Efeitos que podem ser aplicados na resolução.
 */
type ReviewEffect =
  | 'RESUME_MANDATE'
  | 'REVOKE_MANDATE'
  | 'KEEP_SUSPENDED'
  | 'DEGRADE_MODE';

// ════════════════════════════════════════════════════════════════════════════
// CONTEXTO SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Snapshot mínimo do contexto para triagem.
 * Não reescreve histórico - apenas cópia do momento da criação.
 */
interface ReviewContextSnapshot {
  /** ID do contrato relacionado (se existir) */
  contratoId?: string;

  /** ID do episódio relacionado (se existir) */
  episodioId?: string;

  /** ID do ator que originou (se existir) */
  actorId?: string;

  /** ID do agente cujo mandato foi afetado */
  agentId?: string;

  /** Modo de autonomia no momento */
  autonomyMode?: string;

  /** Modo do mandato no momento (alias para autonomyMode) */
  mandateModo?: string;

  /** Sinal da observação (POSITIVO/NEUTRO/NEGATIVO) */
  observacaoSinal?: string;

  /** Gatilhos de consequência (para contexto) */
  triggers?: unknown;
}

// ════════════════════════════════════════════════════════════════════════════
// GATILHO DO CASO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Informações sobre o que disparou o caso de revisão.
 */
interface ReviewTrigger {
  /** ID da observação de consequência que disparou */
  observacaoId: string;

  /** ID do mandato afetado (se existir) */
  mandateId?: string;

  /** ID da regra que disparou */
  ruleId: ConsequenceRuleId | string;

  /** Severidade da consequência */
  severity?: string;

  /** Categoria da consequência */
  category?: string;

  /** Ação sugerida pela policy */
  actionSuggested: ConsequenceAction;
}

// ════════════════════════════════════════════════════════════════════════════
// DECISÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Decisão tomada pelo revisor humano.
 */
interface ReviewDecision {
  /** Quem decidiu */
  decidedBy: string;

  /** Quando decidiu */
  decisionAt: string; // ISO string

  /** Tipo de resolução */
  resolution: ReviewResolution;

  /** Notas obrigatórias (exceto NO_ACTION) */
  notes: string;

  /** Efeitos aplicados */
  effectsApplied: ReviewEffect[];
}

// ════════════════════════════════════════════════════════════════════════════
// ENTIDADE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * Caso de revisão humana.
 * Entidade append-only com estado controlado.
 */
interface ReviewCase {
  /** ID único (review_xxxxx) */
  id: string;

  /** ID do tenant */
  tenantId: string;

  /** Status atual */
  status: ReviewCaseStatus;

  /** Data de criação */
  createdAt: string; // ISO string

  /** Data de última atualização */
  updatedAt: string; // ISO string

  /** O que disparou o caso */
  triggeredBy: ReviewTrigger;

  /** Snapshot do contexto para triagem */
  contextSnapshot: ReviewContextSnapshot;

  /** Decisão (quando resolvido) */
  decision?: ReviewDecision;
}

// ════════════════════════════════════════════════════════════════════════════
// INPUTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para criar um caso de revisão.
 */
interface CreateReviewCaseInput {
  /** ID do tenant */
  tenantId: string;

  /** Gatilho */
  triggeredBy: ReviewTrigger;

  /** Contexto snapshot */
  contextSnapshot: ReviewContextSnapshot;
}

/**
 * Input para resolver um caso.
 */
interface ResolveReviewCaseInput {
  /** Quem está resolvendo */
  decidedBy: string;

  /** Tipo de resolução */
  resolution: ReviewResolution;

  /** Notas (obrigatório se resolution != NO_ACTION) */
  notes?: string;

  /** Se deve aplicar efeitos */
  applyEffects?: boolean;

  /** Efeitos a aplicar (se applyEffects=true) */
  effects?: ReviewEffect[];
}

/**
 * Input para dispensar um caso.
 */
interface DismissReviewCaseInput {
  /** Quem está dispensando */
  dismissedBy: string;

  /** Notas obrigatórias */
  notes: string;
}

/**
 * Filtros para listagem de casos.
 */
interface ReviewCaseFilters {
  /** Filtrar por status */
  status?: ReviewCaseStatus;

  /** Casos desde (ISO string) */
  since?: string;

  /** Limite de resultados */
  limit?: number;

  /** ID da observação */
  observacaoId?: string;

  /** ID do mandato */
  mandateId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

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
};
