/**
 * INCREMENTO 15 — SERVIÇO DE CONSULTA DE CONSEQUÊNCIAS
 *
 * Serviço para consultas à memória de consequências.
 * Permite recuperar observações por contrato, episódio ou range temporal.
 *
 * PRINCÍPIOS:
 * - NÃO faz ranking ou scoring
 * - NÃO interpreta ou reinterpreta consequências
 * - NÃO sugere melhorias ou correções
 * - APENAS retorna dados históricos para análise humana
 */

import { ObservacaoRepository } from '../repositorios/interfaces/ObservacaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import {
  ObservacaoDeConsequencia,
  SinalImpacto
} from '../entidades/ObservacaoDeConsequencia';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS DE CONSULTA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Filtros para consulta de consequências
 */
interface ConsequenciaQuery {
  /** Filtrar por contrato específico */
  contrato_id?: string;

  /** Filtrar por episódio */
  episodio_id?: string;

  /** Filtrar por sinal de impacto */
  sinal?: SinalImpacto;

  /** Range temporal: início */
  data_inicio?: Date;

  /** Range temporal: fim */
  data_fim?: Date;

  /** Limite de resultados */
  limit?: number;
}

/**
 * Estatísticas de consequências para um contrato
 */
interface ConsequenciaStats {
  /** Total de observações */
  total: number;

  /** Contagem por sinal */
  por_sinal: Record<SinalImpacto, number>;

  /** Primeira observação */
  primeira?: Date;

  /** Última observação */
  ultima?: Date;

  /** Se todas as observações indicam limites respeitados */
  limites_sempre_respeitados: boolean;

  /** Se todas as observações indicam condições cumpridas */
  condicoes_sempre_cumpridas: boolean;
}

/**
 * Resultado de consulta de consequências
 */
interface ConsequenciaQueryResult {
  /** Observações encontradas */
  observacoes: ObservacaoDeConsequencia[];

  /** Total encontrado */
  total: number;
}

// ════════════════════════════════════════════════════════════════════════════
// SERVIÇO
// ════════════════════════════════════════════════════════════════════════════

class ConsequenciaQueryService {
  constructor(
    private observacaoRepo: ObservacaoRepository,
    private contratoRepo: ContratoRepository
  ) {}

  /**
   * Busca consequências por contrato
   */
  async getByContrato(contrato_id: string): Promise<ObservacaoDeConsequencia[]> {
    return this.observacaoRepo.getByContratoId(contrato_id);
  }

  /**
   * Busca consequências por episódio
   */
  async getByEpisodio(episodio_id: string): Promise<ObservacaoDeConsequencia[]> {
    return this.observacaoRepo.getByEpisodioId(episodio_id);
  }

  /**
   * Busca consequências por range temporal
   */
  async getByDateRange(start: Date, end: Date): Promise<ObservacaoDeConsequencia[]> {
    return this.observacaoRepo.getByDateRange(start, end);
  }

  /**
   * Busca com filtros combinados
   */
  async find(query: ConsequenciaQuery): Promise<ConsequenciaQueryResult> {
    let observacoes: ObservacaoDeConsequencia[] = [];

    // Estratégia de busca: usar o filtro mais restritivo primeiro
    if (query.contrato_id) {
      observacoes = await this.observacaoRepo.getByContratoId(query.contrato_id);
    } else if (query.episodio_id) {
      observacoes = await this.observacaoRepo.getByEpisodioId(query.episodio_id);
    } else if (query.data_inicio && query.data_fim) {
      observacoes = await this.observacaoRepo.getByDateRange(
        query.data_inicio,
        query.data_fim
      );
    } else {
      // Sem filtro principal, buscar por range amplo (últimos 30 dias)
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      observacoes = await this.observacaoRepo.getByDateRange(start, end);
    }

    // Aplicar filtros adicionais em memória
    if (query.sinal) {
      observacoes = observacoes.filter(o => o.percebida.sinal === query.sinal);
    }

    if (query.data_inicio && !query.contrato_id && !query.episodio_id) {
      observacoes = observacoes.filter(
        o => o.data_registro.getTime() >= query.data_inicio!.getTime()
      );
    }

    if (query.data_fim && !query.contrato_id && !query.episodio_id) {
      observacoes = observacoes.filter(
        o => o.data_registro.getTime() <= query.data_fim!.getTime()
      );
    }

    // Aplicar limite
    const total = observacoes.length;
    if (query.limit && query.limit < observacoes.length) {
      observacoes = observacoes.slice(0, query.limit);
    }

    return {
      observacoes,
      total
    };
  }

  /**
   * Calcula estatísticas de consequências para um contrato
   */
  async getStats(contrato_id: string): Promise<ConsequenciaStats> {
    const observacoes = await this.observacaoRepo.getByContratoId(contrato_id);

    const stats: ConsequenciaStats = {
      total: observacoes.length,
      por_sinal: {
        [SinalImpacto.POSITIVO]: 0,
        [SinalImpacto.NEUTRO]: 0,
        [SinalImpacto.NEGATIVO]: 0,
        [SinalImpacto.INDETERMINADO]: 0
      },
      limites_sempre_respeitados: true,
      condicoes_sempre_cumpridas: true
    };

    for (const obs of observacoes) {
      // Contagem por sinal
      stats.por_sinal[obs.percebida.sinal]++;

      // Verificar limites e condições
      if (!obs.observada.limites_respeitados) {
        stats.limites_sempre_respeitados = false;
      }
      if (!obs.observada.condicoes_cumpridas) {
        stats.condicoes_sempre_cumpridas = false;
      }

      // Primeira e última
      if (!stats.primeira || obs.data_registro < stats.primeira) {
        stats.primeira = obs.data_registro;
      }
      if (!stats.ultima || obs.data_registro > stats.ultima) {
        stats.ultima = obs.data_registro;
      }
    }

    return stats;
  }

  /**
   * Conta observações para um contrato
   */
  async countByContrato(contrato_id: string): Promise<number> {
    return this.observacaoRepo.countByContratoId(contrato_id);
  }

  /**
   * Verifica se contrato existe (antes de registrar consequência)
   */
  async contratoExists(contrato_id: string): Promise<boolean> {
    const contrato = await this.contratoRepo.getById(contrato_id);
    return contrato !== null;
  }

  /**
   * Obtém requisitos mínimos de observação do contrato
   */
  async getObservacaoMinimaRequerida(contrato_id: string): Promise<string[] | null> {
    const contrato = await this.contratoRepo.getById(contrato_id);
    if (!contrato) return null;
    return contrato.observacao_minima_requerida;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS QUE NÃO EXISTEM (por design)
  // ══════════════════════════════════════════════════════════════════════════

  // rankConsequencias() - NÃO EXISTE
  // suggestImprovements() - NÃO EXISTE
  // predictOutcome() - NÃO EXISTE
  // scorePerformance() - NÃO EXISTE
  // recommendAction() - NÃO EXISTE
}

export {
  ConsequenciaQueryService,
  ConsequenciaQuery,
  ConsequenciaStats,
  ConsequenciaQueryResult
};
