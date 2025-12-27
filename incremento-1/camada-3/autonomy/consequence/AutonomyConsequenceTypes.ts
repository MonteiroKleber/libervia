/**
 * INCREMENTO 19 — REVOGAÇÃO/DEGRADAÇÃO AUTOMÁTICA POR CONSEQUÊNCIAS
 *
 * Define os tipos para o feedback loop de autonomia baseado em consequências.
 *
 * PRINCÍPIOS:
 * - Determinístico: regras puras, sem IA ou otimização
 * - Auditável: cada ação tem ruleId estável
 * - Retrocompatível: observações antigas sem novos campos funcionam com defaults seguros
 *
 * A autonomia não é um direito, é um mandato condicionado ao histórico observado.
 */

import { AutonomyMode, AutonomyMandate } from '../AutonomyTypes';
import { ObservacaoDeConsequencia } from '../../entidades/ObservacaoDeConsequencia';
import { ContratoDeDecisao } from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════════
// SEVERIDADE DA CONSEQUÊNCIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Severidade da consequência observada.
 * Classificação qualitativa do impacto.
 */
type ConsequenceSeverity = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIA DA CONSEQUÊNCIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Categoria da consequência observada.
 * Domínio do impacto para roteamento de regras.
 */
type ConsequenceCategory =
  | 'OPERACIONAL'
  | 'FINANCEIRA'
  | 'SEGURANCA'
  | 'LEGAL'
  | 'REPUTACAO'
  | 'ETICA'
  | 'OUTRA';

// ════════════════════════════════════════════════════════════════════════════
// CAMPOS ESTRUTURAIS PARA GATILHOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceAutonomyTriggers - Campos estruturais opcionais para gatilhos.
 *
 * Estes campos são adicionados à observação para indicar impactos
 * que afetam a autonomia do agente. Todos são opcionais para
 * retrocompatibilidade com observações existentes.
 *
 * Defaults defensivos:
 * - severidade: 'BAIXA'
 * - violou_limites: false
 * - perda_relevante: false
 * - reversivel: true
 */
interface ConsequenceAutonomyTriggers {
  /** Severidade do impacto */
  severidade?: ConsequenceSeverity;

  /** Categoria do impacto */
  categoria?: ConsequenceCategory;

  /** Se os limites do contrato foram violados */
  violou_limites?: boolean;

  /** Se a consequência é reversível */
  reversivel?: boolean;

  /** Se houve perda financeira/operacional relevante */
  perda_relevante?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// AÇÃO POR CONSEQUÊNCIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceAction - Ação determinística a tomar após consequência.
 */
enum ConsequenceAction {
  /** Nenhuma ação necessária */
  NO_ACTION = 'NO_ACTION',

  /** Degradar modo de autonomia para nível mais restrito */
  DEGRADE_MODE = 'DEGRADE_MODE',

  /** Suspender mandato (novo status) */
  SUSPEND_MANDATE = 'SUSPEND_MANDATE',

  /** Revogar mandato por consequência */
  REVOKE_MANDATE = 'REVOKE_MANDATE',

  /** Exigir override humano para próximas decisões */
  FLAG_HUMAN_REVIEW = 'FLAG_HUMAN_REVIEW'
}

// ════════════════════════════════════════════════════════════════════════════
// ID DE REGRA
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceRuleId - Identificadores estáveis para regras.
 * Usados para auditoria e rastreabilidade.
 */
enum ConsequenceRuleId {
  /** Severidade crítica → revogação imediata */
  SEVERIDADE_CRITICA_REVOKE = 'RULE_19_1_SEVERIDADE_CRITICA_REVOKE',

  /** Violação de limites → suspensão + human review */
  VIOLACAO_LIMITES_SUSPEND = 'RULE_19_2_VIOLACAO_LIMITES_SUSPEND',

  /** Perda relevante com alta severidade → degradação */
  PERDA_RELEVANTE_ALTA_DEGRADE = 'RULE_19_3_PERDA_RELEVANTE_ALTA_DEGRADE',

  /** Legal/Ética com alta severidade → human review */
  LEGAL_ETICA_ALTA_HUMAN_REVIEW = 'RULE_19_4_LEGAL_ETICA_ALTA_HUMAN_REVIEW',

  /** Nenhum gatilho → sem ação */
  NO_TRIGGER = 'RULE_19_0_NO_TRIGGER'
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT PARA AVALIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceEvaluationInput - Dados para avaliação de impacto.
 */
interface ConsequenceEvaluationInput {
  /** Observação de consequência registrada */
  observacao: ObservacaoDeConsequencia;

  /** Gatilhos estruturais (opcionais) */
  triggers?: ConsequenceAutonomyTriggers;

  /** Contrato relacionado (para ler limites) */
  contrato?: ContratoDeDecisao;

  /** Mandato atual (se existir) */
  mandate?: AutonomyMandate;

  /** Modo de autonomia atual */
  currentMode?: AutonomyMode;

  /** Data/hora atual para avaliação */
  now?: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// EFEITOS DA AÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceEffects - Campos de atualização resultantes da avaliação.
 */
interface ConsequenceEffects {
  /** Novo status do mandato (se alterado) */
  newMandateStatus?: 'active' | 'expired' | 'revoked' | 'suspended';

  /** Novo modo de autonomia (se degradado) */
  newAutonomyMode?: AutonomyMode;

  /** Se exige human review para próximas decisões */
  requiresHumanReview?: boolean;

  /** Data da suspensão (se aplicável) */
  suspendedAt?: string;

  /** Motivo da suspensão (se aplicável) */
  suspendReason?: string;

  /** ID da observação que disparou a ação */
  triggeredByObservacaoId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DA AVALIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * ConsequenceAutonomyResult - Resultado determinístico da avaliação.
 */
interface ConsequenceAutonomyResult {
  /** Ação determinada */
  action: ConsequenceAction;

  /** Motivo canônico da ação */
  reason: string;

  /** ID da regra que disparou */
  ruleId: ConsequenceRuleId;

  /** Efeitos a aplicar */
  effects: ConsequenceEffects;

  /** Se ação já foi aplicada anteriormente (idempotência) */
  alreadyApplied?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS PARA DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aplica defaults defensivos aos gatilhos.
 * Observações antigas sem campos novos recebem valores seguros.
 */
function applyTriggerDefaults(triggers?: ConsequenceAutonomyTriggers): Required<ConsequenceAutonomyTriggers> {
  return {
    severidade: triggers?.severidade ?? 'BAIXA',
    categoria: triggers?.categoria ?? 'OUTRA',
    violou_limites: triggers?.violou_limites ?? false,
    reversivel: triggers?.reversivel ?? true,
    perda_relevante: triggers?.perda_relevante ?? false
  };
}

/**
 * Determina o modo degradado a partir do modo atual.
 * VIVENCIA_AUTONOMA → VIVENCIA_ASSISTIDA
 * VIVENCIA_ASSISTIDA → ENSINO
 * ENSINO → ENSINO (já no mínimo)
 */
function getDegradedMode(currentMode: AutonomyMode): AutonomyMode {
  switch (currentMode) {
    case AutonomyMode.VIVENCIA_AUTONOMA:
      return AutonomyMode.VIVENCIA_ASSISTIDA;
    case AutonomyMode.VIVENCIA_ASSISTIDA:
      return AutonomyMode.ENSINO;
    case AutonomyMode.ENSINO:
    default:
      return AutonomyMode.ENSINO;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  // Tipos de classificação
  ConsequenceSeverity,
  ConsequenceCategory,
  ConsequenceAutonomyTriggers,

  // Ações e regras
  ConsequenceAction,
  ConsequenceRuleId,

  // Input/Output
  ConsequenceEvaluationInput,
  ConsequenceEffects,
  ConsequenceAutonomyResult,

  // Helpers
  applyTriggerDefaults,
  getDegradedMode
};
