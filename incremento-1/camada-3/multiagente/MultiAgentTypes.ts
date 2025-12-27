/**
 * INCREMENTO 16 — MULTIAGENTE: Tipos Principais
 *
 * Define os tipos para execução multiagente de decisões.
 *
 * Multiagente = múltiplos agentes decisores processam a mesma situação
 * sob perfis/mandatos distintos, produzindo propostas candidatas
 * e uma agregação institucional final.
 *
 * PRINCÍPIOS:
 * - NÃO é LLM, nem otimizador, nem previsão
 * - É divergência deliberada de perfis com rastreabilidade
 * - Closed Layer continua soberana (valida antes de cada proposta)
 * - Core permanece agnóstico a integrações
 */

import { PerfilRisco, DecisionProtocol, ContratoDeDecisao, Limite } from '../entidades/tipos';
import { ClosedLayerResult } from '../camada-fechada';

// ════════════════════════════════════════════════════════════════════════════
// PERFIL DE AGENTE
// ════════════════════════════════════════════════════════════════════════════

/**
 * AgentProfile - Define um agente decisor com perfil específico.
 *
 * Cada agente processa a mesma situação sob seu perfil de risco
 * e mandato, produzindo propostas potencialmente diferentes.
 */
interface AgentProfile {
  /** Identificador único do agente (ex: "conservador-1", "moderado-1") */
  agentId: string;

  /** Perfil de risco do agente */
  perfilRisco: PerfilRisco;

  /** Mandato adicional: frases/limites humanos opcionais */
  mandato?: string[];

  /** Peso para agregação (default: 1) */
  peso?: number;

  /** Se o agente está habilitado (default: true) */
  enabled?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICAS DE AGREGAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * AggregationPolicy - Políticas determinísticas de agregação.
 *
 * Nenhuma usa ML ou estatística - todas são regras determinísticas.
 */
type AggregationPolicy =
  | 'FIRST_VALID'              // Primeira decisão válida na ordem dos agentes
  | 'MAJORITY_BY_ALTERNATIVE'  // Alternativa mais votada (por agente)
  | 'WEIGHTED_MAJORITY'        // Idem, mas ponderado por peso
  | 'REQUIRE_CONSENSUS'        // Só decide se todos escolhem a mesma alternativa
  | 'HUMAN_OVERRIDE_REQUIRED'; // Retorna candidatos sem contrato final

// ════════════════════════════════════════════════════════════════════════════
// INPUT DO MULTIAGENTE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para execução multiagente.
 */
interface MultiAgentRunInput {
  /** Lista de agentes que vão processar a situação */
  agents: AgentProfile[];

  /** Política de agregação para escolha final */
  aggregationPolicy: AggregationPolicy;

  /**
   * Dados comuns para construção de protocolo.
   * Cada agente usará seu próprio perfilRisco, mas os demais dados são comuns.
   */
  protocoloBase: {
    criterios_minimos: string[];
    riscos_considerados: string[];
    limites_definidos: Limite[];
    alternativas_avaliadas: string[];
  };

  /**
   * Dados comuns para registro de decisão.
   * Cada agente pode escolher alternativa diferente baseado em seu perfil.
   */
  decisaoBase: {
    criterios: string[];
    limites: Limite[];
    condicoes: string[];
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO POR AGENTE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da proposta de um agente individual.
 */
interface AgentProposalResult {
  /** ID do agente */
  agentId: string;

  /** Perfil de risco usado */
  perfilRisco: PerfilRisco;

  /** Resultado da validação da Camada Fechada */
  closedLayerResult: ClosedLayerResult;

  /** Se foi bloqueado pela Camada Fechada */
  blocked: boolean;

  /** Protocolo proposto (null se bloqueado) */
  protocolo: DecisionProtocol | null;

  /** Alternativa escolhida pelo agente (null se bloqueado) */
  alternativaEscolhida: string | null;

  /** ID da decisão candidata (null se bloqueado) */
  decisaoId: string | null;

  /**
   * Decisão candidata em memória (não persistida).
   * Apenas a decisão do agente selecionado será persistida ao final.
   */
  decisaoCandidato?: {
    id: string;
    alternativa_escolhida: string;
    criterios: string[];
    limites: Limite[];
    condicoes: string[];
    perfil_risco: PerfilRisco;
  };

  /** Contrato candidato (null se bloqueado ou não emitido) */
  contratoCandidato: ContratoDeDecisao | null;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DA AGREGAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Motivos pelos quais a agregação não produziu decisão final.
 */
type NoDecisionReason =
  | 'ALL_AGENTS_BLOCKED'        // Todos os agentes foram bloqueados
  | 'NO_CONSENSUS'              // REQUIRE_CONSENSUS e agentes divergiram
  | 'HUMAN_OVERRIDE_PENDING'    // HUMAN_OVERRIDE_REQUIRED ativo
  | 'NO_VALID_AGENTS'           // Nenhum agente habilitado
  | 'AGGREGATION_FAILED';       // Falha na agregação (erro interno)

/**
 * Decisão de agregação.
 */
interface AggregationDecision {
  /** Se uma decisão final foi tomada */
  decided: boolean;

  /** Agente selecionado (null se não decidido) */
  selectedAgentId: string | null;

  /** Alternativa final escolhida (null se não decidido) */
  alternativaFinal: string | null;

  /** Razão de não decisão (null se decidido) */
  noDecisionReason: NoDecisionReason | null;

  /** Detalhes do tie-break se houve empate */
  tieBreakDetails?: string;

  /** Votos por alternativa (para políticas de votação) */
  votesByAlternative?: Record<string, number>;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO COMPLETO DO MULTIAGENTE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado completo da execução multiagente.
 */
interface MultiAgentRunResult {
  /** ID único desta execução */
  runId: string;

  /** ID do episódio (único para a situação) */
  episodioId: string;

  /** Política de agregação usada */
  aggregationPolicy: AggregationPolicy;

  /** Resultados por agente */
  agentResults: AgentProposalResult[];

  /** Decisão de agregação */
  aggregation: AggregationDecision;

  /** Contrato final emitido (null se não decidido) */
  contratoFinal: ContratoDeDecisao | null;

  /** Timestamp de início */
  startedAt: Date;

  /** Timestamp de término */
  finishedAt: Date;
}

// ════════════════════════════════════════════════════════════════════════════
// ERROS ESPECÍFICOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Erro específico do módulo multiagente.
 */
class MultiAgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MultiAgentError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  AgentProfile,
  AggregationPolicy,
  MultiAgentRunInput,
  AgentProposalResult,
  NoDecisionReason,
  AggregationDecision,
  MultiAgentRunResult,
  MultiAgentError
};
