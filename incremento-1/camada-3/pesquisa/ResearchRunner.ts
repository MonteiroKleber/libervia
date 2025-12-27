/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Runner
 *
 * O Runner coordena a execução da pesquisa:
 * - Baseline (situação original)
 * - N variações
 * - Coleta de sinais de memória (se habilitado)
 * - Consolida tudo em ResearchReport
 *
 * Execução sequencial para evitar flakiness.
 * Respeita limites de tempo e variações.
 */

import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { ResearchSandbox } from './ResearchSandbox';
import {
  ResearchInput,
  ResearchReport,
  ResearchVariationResult,
  ResearchLimits,
  ResearchMemorySignals
} from './ResearchTypes';

// ════════════════════════════════════════════════════════════════════════════
// DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_VARIACOES = 10;
const DEFAULT_MAX_TEMPO_MS = 30000;

// ════════════════════════════════════════════════════════════════════════════
// RESEARCH RUNNER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Runner de pesquisa - coordena execução e gera relatório.
 */
class ResearchRunner {
  private readonly memoryService?: MemoryQueryService;

  constructor(memoryService?: MemoryQueryService) {
    this.memoryService = memoryService;
  }

  /**
   * Executa pesquisa completa e retorna relatório.
   * Execução sequencial, respeita limites.
   */
  async run(input: ResearchInput): Promise<ResearchReport> {
    const startedAt = new Date();
    const startTime = Date.now();

    // Aplicar limites
    const limits: Required<ResearchLimits> = {
      maxVariacoes: input.limitesPesquisa?.maxVariacoes ?? DEFAULT_MAX_VARIACOES,
      maxTempoMs: input.limitesPesquisa?.maxTempoMs ?? DEFAULT_MAX_TEMPO_MS
    };

    // Criar sandbox
    const sandbox = new ResearchSandbox({
      memoryService: this.memoryService,
      modoMemoria: input.modoMemoria
    });

    // Arrays para resultados
    const variationResults: ResearchVariationResult[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];

    let truncated = false;
    let truncationReason: string | undefined;

    // ════════════════════════════════════════════════════════════════════════
    // 1) ANÁLISE DO BASELINE
    // ════════════════════════════════════════════════════════════════════════

    const baselineSummary = sandbox.analyzeBaseline(input.situacao);

    if (baselineSummary.closedLayerBlocks.length > 0) {
      warnings.push(
        `Baseline tem ${baselineSummary.closedLayerBlocks.length} bloqueio(s) da Camada Fechada`
      );
    }

    notes.push(`Baseline analisado: ${baselineSummary.situacaoId}`);

    // ════════════════════════════════════════════════════════════════════════
    // 2) ANÁLISE DAS VARIAÇÕES
    // ════════════════════════════════════════════════════════════════════════

    const variacoes = input.variacoes ?? [];
    const variacoesParaProcessar = variacoes.slice(0, limits.maxVariacoes);

    if (variacoes.length > limits.maxVariacoes) {
      truncated = true;
      truncationReason = `Limite de variações excedido: ${variacoes.length} > ${limits.maxVariacoes}`;
      warnings.push(truncationReason);
    }

    for (const variation of variacoesParaProcessar) {
      // Verificar timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= limits.maxTempoMs) {
        truncated = true;
        truncationReason = `Tempo limite excedido: ${elapsed}ms >= ${limits.maxTempoMs}ms`;
        warnings.push(truncationReason);
        break;
      }

      // Executar análise da variação
      const result = sandbox.analyzeVariation(input.situacao, variation);
      variationResults.push(result);

      if (result.closedLayerBlocks.length > 0) {
        notes.push(
          `Variação ${variation.id}: ${result.closedLayerBlocks.length} bloqueio(s)`
        );
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3) CONSULTA DE MEMÓRIA (SE HABILITADO)
    // ════════════════════════════════════════════════════════════════════════

    let memorySignals: ResearchMemorySignals | undefined;

    if (input.modoMemoria === 'READONLY') {
      const signals = await sandbox.consultarMemoria(input.situacao);
      if (signals) {
        memorySignals = signals;
        notes.push(`Memória consultada: ${signals.totalConsultado} episódios encontrados`);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 4) GERAR RELATÓRIO FINAL
    // ════════════════════════════════════════════════════════════════════════

    const finishedAt = new Date();
    const durationMs = Date.now() - startTime;

    const report: ResearchReport = {
      reportId: this.gerarReportId(),
      startedAt,
      finishedAt,
      durationMs,
      baselineSummary,
      variations: variationResults,
      memorySignals,
      warnings,
      notes,
      limitsApplied: limits,
      truncated,
      truncationReason
    };

    return report;
  }

  /**
   * Gera ID único para o relatório.
   */
  private gerarReportId(): string {
    return `research-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ResearchRunner, DEFAULT_MAX_VARIACOES, DEFAULT_MAX_TEMPO_MS };
