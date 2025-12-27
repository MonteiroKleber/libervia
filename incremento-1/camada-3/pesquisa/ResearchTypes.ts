/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Tipos
 *
 * Tipos para o ambiente de exploração sandbox.
 * A pesquisa NÃO gera consequência direta, NÃO grava episódios,
 * NÃO emite contratos, NÃO altera EventLog.
 */

import {
  SituacaoDecisoria,
  PerfilRisco,
  Limite,
  Alternativa,
  Risco
} from '../entidades/tipos';
import { ClosedLayerResult } from '../camada-fechada';

// ════════════════════════════════════════════════════════════════════════════
// MODO DE MEMÓRIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Modo de acesso à memória institucional durante pesquisa.
 * - OFF: Não consulta memória (isolamento total)
 * - READONLY: Consulta memória apenas para leitura
 */
type ResearchMemoryMode = 'OFF' | 'READONLY';

// ════════════════════════════════════════════════════════════════════════════
// LIMITES DE PESQUISA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Limites para execução da pesquisa.
 */
interface ResearchLimits {
  /** Máximo de variações a processar (default: 10) */
  maxVariacoes?: number;

  /** Tempo máximo em ms (default: 30000) */
  maxTempoMs?: number;
}

// ════════════════════════════════════════════════════════════════════════════
// VARIAÇÃO DE PESQUISA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Uma variação permite sobrescrever campos da situação/protocolo
 * para explorar hipóteses alternativas.
 */
interface ResearchVariation {
  /** Identificador da variação */
  id: string;

  /** Descrição do que esta variação testa */
  descricao?: string;

  /** Alternativas diferentes */
  alternativas?: Alternativa[];

  /** Incertezas diferentes */
  incertezas?: string[];

  /** Riscos diferentes */
  riscos?: Risco[];

  /** Perfil de risco diferente */
  perfilRisco?: PerfilRisco;

  /** Critérios mínimos diferentes */
  criteriosMinimos?: string[];

  /** Limites definidos diferentes */
  limitesDefinidos?: Limite[];

  /** Consequência relevante diferente */
  consequenciaRelevante?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT DE PESQUISA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para iniciar uma sessão de pesquisa.
 */
interface ResearchInput {
  /** Situação base para análise */
  situacao: SituacaoDecisoria;

  /** Variações a explorar (opcional) */
  variacoes?: ResearchVariation[];

  /** Modo de acesso à memória */
  modoMemoria: ResearchMemoryMode;

  /** Limites de execução */
  limitesPesquisa?: ResearchLimits;
}

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO DE VARIAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da análise de uma variação.
 * NOTA: score é PROIBIDO - não existe otimização/ranking.
 */
interface ResearchVariationResult {
  /** ID da variação */
  variationId: string;

  /** Descrição da variação */
  descricao: string;

  /** Snapshot do que foi aplicado */
  inputApplied: Partial<ResearchVariation>;

  /** Análise textual (sem recomendações de ação) */
  analysis: string;

  /** Postura de risco resultante */
  riskPosture: PerfilRisco;

  /** Bloqueios detectados pela Camada Fechada (modo diagnóstico) */
  closedLayerBlocks: ClosedLayerResult[];

  /** Tempo de processamento em ms */
  processingTimeMs: number;

  /**
   * PROIBIDO: score numérico
   * Pesquisa NÃO otimiza, NÃO ranqueia.
   */
  score?: never;
}

// ════════════════════════════════════════════════════════════════════════════
// SINAIS DE MEMÓRIA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sinais extraídos da memória institucional (somente leitura).
 */
interface ResearchMemorySignals {
  /** IDs de episódios relevantes encontrados */
  episodiosRelevantes: string[];

  /** IDs de decisões relevantes encontradas */
  decisoesRelevantes: string[];

  /** Total de episódios consultados */
  totalConsultado: number;

  /** Modo usado */
  modo: ResearchMemoryMode;
}

// ════════════════════════════════════════════════════════════════════════════
// RELATÓRIO DE PESQUISA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Relatório final da pesquisa.
 * NÃO é persistido no Core, apenas retornado ou salvo em diretório research.
 */
interface ResearchReport {
  /** ID único do relatório */
  reportId: string;

  /** Timestamp de início */
  startedAt: Date;

  /** Timestamp de término */
  finishedAt: Date;

  /** Duração total em ms */
  durationMs: number;

  /** Resumo da situação baseline */
  baselineSummary: ResearchBaselineSummary;

  /** Resultados das variações */
  variations: ResearchVariationResult[];

  /** Sinais de memória (se consultada) */
  memorySignals?: ResearchMemorySignals;

  /** Avisos gerados durante a pesquisa */
  warnings: string[];

  /** Notas adicionais */
  notes: string[];

  /** Limites aplicados */
  limitsApplied: Required<ResearchLimits>;

  /** Se foi truncado por limite de tempo/variações */
  truncated: boolean;

  /** Motivo do truncamento (se aplicável) */
  truncationReason?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// RESUMO BASELINE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resumo da situação baseline.
 */
interface ResearchBaselineSummary {
  /** ID da situação */
  situacaoId: string;

  /** Domínio */
  dominio: string;

  /** Quantidade de alternativas */
  numAlternativas: number;

  /** Quantidade de riscos */
  numRiscos: number;

  /** Quantidade de incertezas */
  numIncertezas: number;

  /** Tem consequência declarada */
  temConsequencia: boolean;

  /** Bloqueios da Camada Fechada no baseline */
  closedLayerBlocks: ClosedLayerResult[];
}

// ════════════════════════════════════════════════════════════════════════════
// ERRO DE ESCRITA PROIBIDA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Código de erro para tentativa de escrita em modo pesquisa.
 */
const RESEARCH_WRITE_FORBIDDEN = 'RESEARCH_WRITE_FORBIDDEN';

/**
 * Erro lançado quando há tentativa de escrita no sandbox.
 */
class ResearchWriteForbiddenError extends Error {
  readonly code = RESEARCH_WRITE_FORBIDDEN;

  constructor(operation: string) {
    super(`Operação de escrita proibida em modo pesquisa: ${operation}`);
    this.name = 'ResearchWriteForbiddenError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  ResearchMemoryMode,
  ResearchLimits,
  ResearchVariation,
  ResearchInput,
  ResearchVariationResult,
  ResearchMemorySignals,
  ResearchReport,
  ResearchBaselineSummary,
  RESEARCH_WRITE_FORBIDDEN,
  ResearchWriteForbiddenError
};
