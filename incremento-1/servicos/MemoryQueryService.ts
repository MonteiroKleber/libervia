import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import {
  MemoryQuery,
  MemoryHit,
  MemoryQueryResult,
  EstadoEpisodio
} from '../entidades/tipos';

/**
 * Serviço de consulta à memória institucional
 *
 * PRINCÍPIOS:
 * - NÃO faz ranking "inteligente"
 * - NÃO recomenda decisões
 * - NÃO calcula score
 * - NÃO infere "melhor alternativa"
 * - APENAS filtra e retorna resultados compatíveis
 */
class MemoryQueryService {
  constructor(
    private episodioRepo: EpisodioRepository,
    private decisaoRepo: DecisaoRepository,
    private contratoRepo: ContratoRepository
  ) {}

  async find(query: MemoryQuery): Promise<MemoryQueryResult> {
    // Buscar episódios com filtros básicos
    // INCREMENTO 2: Agora usa índices internamente
    const { episodios, next_cursor } = await this.episodioRepo.find(query);

    // Extrair IDs para batch lookup (preparação para otimização futura)
    const episodio_ids = episodios.map(e => e.id);

    // Buscar decisões e contratos em batch
    const decisoesMap = await this.decisaoRepo.getByEpisodioIds(episodio_ids);
    const contratosMap = await this.contratoRepo.getByEpisodioIds(episodio_ids);

    // Enriquecer hits
    const hits: MemoryHit[] = [];

    for (const episodio of episodios) {
      const hit: MemoryHit = {
        episodio_id: episodio.id,
        caso_uso: episodio.caso_uso,
        dominio: episodio.dominio,
        estado: episodio.estado,
        data_criacao: episodio.data_criacao,
        data_decisao: episodio.data_decisao ?? undefined
      };

      // Buscar decisão do batch
      const decisao = decisoesMap.get(episodio.id);
      if (decisao) {
        // Filtrar por perfil_risco se fornecido
        if (query.perfil_risco && decisao.perfil_risco !== query.perfil_risco) {
          continue; // Pular este episódio
        }

        hit.perfil_risco = decisao.perfil_risco;
        hit.alternativa_escolhida = decisao.alternativa_escolhida;
        hit.criterios = decisao.criterios;
        hit.limites = decisao.limites;
      } else {
        // Se filtro por perfil_risco e não há decisão, pular
        if (query.perfil_risco) {
          continue;
        }
      }

      // Buscar contrato do batch
      const contrato = contratosMap.get(episodio.id);
      if (contrato) {
        hit.contrato_id = contrato.id;
      }

      hits.push(hit);
    }

    return {
      hits,
      next_cursor,
      total_encontrado: hits.length
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // MÉTODOS QUE NÃO EXISTEM (por design)
  // ════════════════════════════════════════════════════════════════════════

  // rankResults() - NÃO EXISTE
  // recommendDecision() - NÃO EXISTE
  // scoreAlternatives() - NÃO EXISTE
  // predictOutcome() - NÃO EXISTE
  // suggestBestOption() - NÃO EXISTE
}

export { MemoryQueryService };
