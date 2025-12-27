/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Sandbox Runtime
 *
 * O sandbox garante que NENHUMA operação de escrita ocorre.
 * Permite:
 * - Validar estrutura dos dados
 * - Rodar Camada Fechada em modo diagnóstico
 * - Consultar memória (somente-leitura, se habilitado)
 * - Gerar análises textuais
 *
 * NÃO permite:
 * - Persistir episódios, decisões, contratos
 * - Escrever no EventLog
 * - Alterar snapshots ou repositórios
 */

import {
  SituacaoDecisoria,
  DecisionProtocol,
  PerfilRisco,
  EstadoProtocolo,
  MemoryQuery,
  MemoryQueryResult
} from '../entidades/tipos';
import { validateClosedLayer, ClosedLayerResult } from '../camada-fechada';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import {
  ResearchInput,
  ResearchVariation,
  ResearchVariationResult,
  ResearchBaselineSummary,
  ResearchMemorySignals,
  ResearchMemoryMode
} from './ResearchTypes';

// ════════════════════════════════════════════════════════════════════════════
// SANDBOX CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Configuração do sandbox.
 */
interface SandboxConfig {
  /** Serviço de memória (opcional, para modoMemoria=READONLY) */
  memoryService?: MemoryQueryService;

  /** Modo de memória */
  modoMemoria: ResearchMemoryMode;
}

// ════════════════════════════════════════════════════════════════════════════
// RESEARCH SANDBOX
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sandbox de pesquisa - ambiente isolado sem escrita.
 *
 * GUARDRAILS ANTI-ESCRITA:
 * 1. Não recebe dataDir de tenant
 * 2. Não tem acesso a repositórios de escrita
 * 3. Usa apenas validação e leitura
 */
class ResearchSandbox {
  private readonly memoryService?: MemoryQueryService;
  private readonly modoMemoria: ResearchMemoryMode;

  constructor(config: SandboxConfig) {
    this.memoryService = config.memoryService;
    this.modoMemoria = config.modoMemoria;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANÁLISE DE BASELINE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Analisa a situação baseline.
   * Não persiste nada, apenas retorna análise.
   */
  analyzeBaseline(situacao: SituacaoDecisoria): ResearchBaselineSummary {
    // Criar protocolo fictício para validação da Camada Fechada
    const protocoloFicticio = this.criarProtocoloFicticio(situacao);

    // Rodar Camada Fechada em modo diagnóstico
    const closedLayerResult = validateClosedLayer(situacao, protocoloFicticio);
    const closedLayerBlocks: ClosedLayerResult[] = closedLayerResult.blocked
      ? [closedLayerResult]
      : [];

    return {
      situacaoId: situacao.id,
      dominio: situacao.dominio,
      numAlternativas: (situacao.alternativas ?? []).length,
      numRiscos: (situacao.riscos ?? []).length,
      numIncertezas: (situacao.incertezas ?? []).length,
      temConsequencia: ((situacao.consequencia_relevante ?? '').trim().length > 0),
      closedLayerBlocks
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANÁLISE DE VARIAÇÃO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Analisa uma variação da situação.
   * Não persiste nada, apenas retorna análise.
   */
  analyzeVariation(
    baseSituacao: SituacaoDecisoria,
    variation: ResearchVariation
  ): ResearchVariationResult {
    const startTime = Date.now();

    // Aplicar variação sobre a situação base
    const situacaoModificada = this.aplicarVariacao(baseSituacao, variation);

    // Determinar perfil de risco
    const perfilRisco = variation.perfilRisco ?? PerfilRisco.MODERADO;

    // Criar protocolo fictício com variação
    const protocoloFicticio = this.criarProtocoloFicticioComVariacao(
      situacaoModificada,
      variation
    );

    // Rodar Camada Fechada em modo diagnóstico
    const closedLayerResult = validateClosedLayer(situacaoModificada, protocoloFicticio);
    const closedLayerBlocks: ClosedLayerResult[] = closedLayerResult.blocked
      ? [closedLayerResult]
      : [];

    // Gerar análise textual
    const analysis = this.gerarAnaliseTextual(situacaoModificada, closedLayerBlocks, variation);

    const endTime = Date.now();

    return {
      variationId: variation.id,
      descricao: variation.descricao ?? `Variação ${variation.id}`,
      inputApplied: {
        alternativas: variation.alternativas,
        incertezas: variation.incertezas,
        riscos: variation.riscos,
        perfilRisco: variation.perfilRisco,
        criteriosMinimos: variation.criteriosMinimos,
        limitesDefinidos: variation.limitesDefinidos,
        consequenciaRelevante: variation.consequenciaRelevante
      },
      analysis,
      riskPosture: perfilRisco,
      closedLayerBlocks,
      processingTimeMs: endTime - startTime
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONSULTA DE MEMÓRIA (SOMENTE-LEITURA)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Consulta memória institucional em modo somente-leitura.
   * Retorna null se modoMemoria=OFF ou memoryService não disponível.
   */
  async consultarMemoria(
    situacao: SituacaoDecisoria
  ): Promise<ResearchMemorySignals | null> {
    // Se modo OFF, não consulta
    if (this.modoMemoria === 'OFF') {
      return null;
    }

    // Se não tem memoryService, não pode consultar
    if (!this.memoryService) {
      return null;
    }

    // Consulta apenas leitura
    const query: MemoryQuery = {
      dominio: situacao.dominio,
      caso_uso: situacao.caso_uso_declarado,
      limit: 20
    };

    const resultado: MemoryQueryResult = await this.memoryService.find(query);

    return {
      episodiosRelevantes: resultado.hits.map(h => h.episodio_id),
      decisoesRelevantes: resultado.hits
        .filter(h => h.alternativa_escolhida)
        .map(h => h.episodio_id),
      totalConsultado: resultado.total_encontrado,
      modo: this.modoMemoria
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS PRIVADOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria protocolo fictício para validação da Camada Fechada.
   * Não persiste - apenas para diagnóstico.
   */
  private criarProtocoloFicticio(situacao: SituacaoDecisoria): DecisionProtocol {
    const alternativas = situacao.alternativas ?? [];
    const riscos = situacao.riscos ?? [];

    return {
      id: `research-proto-${Date.now()}`,
      episodio_id: 'research-ep-ficticio',
      criterios_minimos: ['Critério de pesquisa'],
      riscos_considerados: riscos.map(r => r.descricao),
      limites_definidos: [{ tipo: 'pesquisa', descricao: 'Limite fictício', valor: 'N/A' }],
      perfil_risco: PerfilRisco.MODERADO,
      alternativas_avaliadas: alternativas.map(a => a.descricao),
      alternativa_escolhida: alternativas[0]?.descricao ?? '',
      memoria_consultada_ids: [],
      anexos_utilizados_ids: [],
      estado: EstadoProtocolo.EM_CONSTRUCAO,
      validado_em: new Date(),
      validado_por: 'Libervia'
    };
  }

  /**
   * Cria protocolo fictício com variação aplicada.
   */
  private criarProtocoloFicticioComVariacao(
    situacao: SituacaoDecisoria,
    variation: ResearchVariation
  ): DecisionProtocol {
    const alternativas = situacao.alternativas ?? [];
    const riscos = situacao.riscos ?? [];

    return {
      id: `research-proto-var-${variation.id}`,
      episodio_id: 'research-ep-ficticio',
      criterios_minimos: variation.criteriosMinimos ?? ['Critério de pesquisa'],
      riscos_considerados: riscos.map(r => r.descricao),
      limites_definidos: variation.limitesDefinidos ?? [
        { tipo: 'pesquisa', descricao: 'Limite fictício', valor: 'N/A' }
      ],
      perfil_risco: variation.perfilRisco ?? PerfilRisco.MODERADO,
      alternativas_avaliadas: alternativas.map(a => a.descricao),
      alternativa_escolhida: alternativas[0]?.descricao ?? '',
      memoria_consultada_ids: [],
      anexos_utilizados_ids: [],
      estado: EstadoProtocolo.EM_CONSTRUCAO,
      validado_em: new Date(),
      validado_por: 'Libervia'
    };
  }

  /**
   * Aplica variação sobre situação base.
   * Retorna cópia modificada (não altera original).
   */
  private aplicarVariacao(
    base: SituacaoDecisoria,
    variation: ResearchVariation
  ): SituacaoDecisoria {
    return {
      ...base,
      alternativas: variation.alternativas ?? base.alternativas,
      incertezas: variation.incertezas ?? base.incertezas,
      riscos: variation.riscos ?? base.riscos,
      consequencia_relevante: variation.consequenciaRelevante ?? base.consequencia_relevante
    };
  }

  /**
   * Gera análise textual sem recomendações de ação.
   * Descreve o cenário, não prescreve.
   */
  private gerarAnaliseTextual(
    situacao: SituacaoDecisoria,
    bloqueios: ClosedLayerResult[],
    variation: ResearchVariation
  ): string {
    const linhas: string[] = [];

    linhas.push(`### Análise da Variação: ${variation.id}`);
    linhas.push('');

    // Resumo das modificações
    if (variation.alternativas) {
      linhas.push(`- Alternativas modificadas: ${variation.alternativas.length}`);
    }
    if (variation.riscos) {
      linhas.push(`- Riscos modificados: ${variation.riscos.length}`);
    }
    if (variation.incertezas) {
      linhas.push(`- Incertezas modificadas: ${variation.incertezas.length}`);
    }
    if (variation.perfilRisco) {
      linhas.push(`- Perfil de risco: ${variation.perfilRisco}`);
    }
    if (variation.criteriosMinimos) {
      linhas.push(`- Critérios mínimos: ${variation.criteriosMinimos.length}`);
    }
    if (variation.limitesDefinidos) {
      linhas.push(`- Limites definidos: ${variation.limitesDefinidos.length}`);
    }
    if (variation.consequenciaRelevante) {
      linhas.push(`- Consequência relevante modificada`);
    }

    linhas.push('');

    // Diagnóstico da Camada Fechada
    if (bloqueios.length > 0) {
      linhas.push('**Bloqueios detectados pela Camada Fechada:**');
      for (const bloqueio of bloqueios) {
        linhas.push(`- ${bloqueio.rule}: ${bloqueio.reason}`);
      }
    } else {
      linhas.push('**Nenhum bloqueio detectado pela Camada Fechada.**');
    }

    linhas.push('');

    // Estado resultante
    linhas.push('**Estado resultante:**');
    linhas.push(`- Alternativas: ${(situacao.alternativas ?? []).length}`);
    linhas.push(`- Riscos: ${(situacao.riscos ?? []).length}`);
    linhas.push(`- Incertezas: ${(situacao.incertezas ?? []).length}`);
    linhas.push(`- Consequência declarada: ${((situacao.consequencia_relevante ?? '').trim().length > 0) ? 'Sim' : 'Não'}`);

    return linhas.join('\n');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ResearchSandbox, SandboxConfig };
