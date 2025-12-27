/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Wrappers ReadOnly
 *
 * Wrappers que expõem apenas métodos de leitura dos repositórios.
 * Qualquer tentativa de escrita lança ResearchWriteForbiddenError.
 *
 * GUARDRAIL ANTI-ESCRITA: Estes wrappers garantem que a pesquisa
 * NUNCA modifica o estado do Core.
 */

import { SituacaoRepository } from '../repositorios/interfaces/SituacaoRepository';
import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import { DecisionProtocolRepository } from '../repositorios/interfaces/DecisionProtocolRepository';
import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  DecisionProtocol,
  StatusSituacao,
  EstadoEpisodio,
  AnexoAnalise,
  MemoryQuery
} from '../entidades/tipos';
import { ResearchWriteForbiddenError } from './ResearchTypes';

// ════════════════════════════════════════════════════════════════════════════
// READONLY SITUACAO REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper somente-leitura para SituacaoRepository.
 */
class ReadOnlySituacaoRepository implements SituacaoRepository {
  constructor(private readonly inner: SituacaoRepository) {}

  async init(): Promise<void> {
    return this.inner.init();
  }

  async getById(id: string): Promise<SituacaoDecisoria | null> {
    return this.inner.getById(id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE ESCRITA - BLOQUEADOS
  // ══════════════════════════════════════════════════════════════════════════

  async create(_situacao: SituacaoDecisoria): Promise<void> {
    throw new ResearchWriteForbiddenError('SituacaoRepository.create');
  }

  async updateStatus(_id: string, _status: StatusSituacao): Promise<void> {
    throw new ResearchWriteForbiddenError('SituacaoRepository.updateStatus');
  }

  async appendAnexoAnalise(_id: string, _anexo: AnexoAnalise): Promise<void> {
    throw new ResearchWriteForbiddenError('SituacaoRepository.appendAnexoAnalise');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// READONLY EPISODIO REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper somente-leitura para EpisodioRepository.
 */
class ReadOnlyEpisodioRepository implements EpisodioRepository {
  constructor(private readonly inner: EpisodioRepository) {}

  async init(): Promise<void> {
    return this.inner.init();
  }

  async getById(id: string): Promise<EpisodioDecisao | null> {
    return this.inner.getById(id);
  }

  async getByIds(ids: string[]): Promise<Map<string, EpisodioDecisao>> {
    return this.inner.getByIds(ids);
  }

  async find(query: MemoryQuery): Promise<{ episodios: EpisodioDecisao[]; next_cursor?: string }> {
    return this.inner.find(query);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE ESCRITA - BLOQUEADOS
  // ══════════════════════════════════════════════════════════════════════════

  async create(_episodio: EpisodioDecisao): Promise<void> {
    throw new ResearchWriteForbiddenError('EpisodioRepository.create');
  }

  async updateEstado(_id: string, _estado: EstadoEpisodio): Promise<void> {
    throw new ResearchWriteForbiddenError('EpisodioRepository.updateEstado');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// READONLY DECISAO REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper somente-leitura para DecisaoRepository.
 */
class ReadOnlyDecisaoRepository implements DecisaoRepository {
  constructor(private readonly inner: DecisaoRepository) {}

  async init(): Promise<void> {
    return this.inner.init();
  }

  async getById(id: string): Promise<DecisaoInstitucional | null> {
    return this.inner.getById(id);
  }

  async getByEpisodioId(episodio_id: string): Promise<DecisaoInstitucional | null> {
    return this.inner.getByEpisodioId(episodio_id);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisaoInstitucional>> {
    return this.inner.getByEpisodioIds(episodio_ids);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE ESCRITA - BLOQUEADOS
  // ══════════════════════════════════════════════════════════════════════════

  async create(_decisao: DecisaoInstitucional): Promise<void> {
    throw new ResearchWriteForbiddenError('DecisaoRepository.create');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// READONLY CONTRATO REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper somente-leitura para ContratoRepository.
 */
class ReadOnlyContratoRepository implements ContratoRepository {
  constructor(private readonly inner: ContratoRepository) {}

  async init(): Promise<void> {
    return this.inner.init();
  }

  async getById(id: string): Promise<ContratoDeDecisao | null> {
    return this.inner.getById(id);
  }

  async getByEpisodioId(episodio_id: string): Promise<ContratoDeDecisao | null> {
    return this.inner.getByEpisodioId(episodio_id);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, ContratoDeDecisao>> {
    return this.inner.getByEpisodioIds(episodio_ids);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE ESCRITA - BLOQUEADOS
  // ══════════════════════════════════════════════════════════════════════════

  async create(_contrato: ContratoDeDecisao): Promise<void> {
    throw new ResearchWriteForbiddenError('ContratoRepository.create');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// READONLY PROTOCOL REPOSITORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper somente-leitura para DecisionProtocolRepository.
 */
class ReadOnlyProtocolRepository implements DecisionProtocolRepository {
  constructor(private readonly inner: DecisionProtocolRepository) {}

  async init(): Promise<void> {
    return this.inner.init();
  }

  async getById(id: string): Promise<DecisionProtocol | null> {
    return this.inner.getById(id);
  }

  async getByEpisodioId(episodio_id: string): Promise<DecisionProtocol | null> {
    return this.inner.getByEpisodioId(episodio_id);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisionProtocol>> {
    return this.inner.getByEpisodioIds(episodio_ids);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE ESCRITA - BLOQUEADOS
  // ══════════════════════════════════════════════════════════════════════════

  async create(_protocolo: DecisionProtocol): Promise<void> {
    throw new ResearchWriteForbiddenError('DecisionProtocolRepository.create');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY PARA CRIAR WRAPPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Contexto de repositórios somente-leitura para pesquisa.
 */
interface ReadOnlyRepositoryContext {
  situacaoRepo: ReadOnlySituacaoRepository;
  episodioRepo: ReadOnlyEpisodioRepository;
  decisaoRepo: ReadOnlyDecisaoRepository;
  contratoRepo: ReadOnlyContratoRepository;
  protocoloRepo: ReadOnlyProtocolRepository;
}

/**
 * Cria wrappers somente-leitura para todos os repositórios.
 */
function createReadOnlyContext(
  situacaoRepo: SituacaoRepository,
  episodioRepo: EpisodioRepository,
  decisaoRepo: DecisaoRepository,
  contratoRepo: ContratoRepository,
  protocoloRepo: DecisionProtocolRepository
): ReadOnlyRepositoryContext {
  return {
    situacaoRepo: new ReadOnlySituacaoRepository(situacaoRepo),
    episodioRepo: new ReadOnlyEpisodioRepository(episodioRepo),
    decisaoRepo: new ReadOnlyDecisaoRepository(decisaoRepo),
    contratoRepo: new ReadOnlyContratoRepository(contratoRepo),
    protocoloRepo: new ReadOnlyProtocolRepository(protocoloRepo)
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  ReadOnlySituacaoRepository,
  ReadOnlyEpisodioRepository,
  ReadOnlyDecisaoRepository,
  ReadOnlyContratoRepository,
  ReadOnlyProtocolRepository,
  ReadOnlyRepositoryContext,
  createReadOnlyContext
};
