import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { DecisaoRepository } from '../interfaces/DecisaoRepository';
import { DecisaoInstitucional } from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeDecisao(d: DecisaoInstitucional): any {
  return {
    ...d,
    data_decisao: d.data_decisao.toISOString()
  };
}

function reviveDecisao(raw: any): DecisaoInstitucional {
  return {
    ...raw,
    data_decisao: new Date(raw.data_decisao)
  };
}

function cloneDecisao(d: DecisaoInstitucional): DecisaoInstitucional {
  return {
    ...d,
    data_decisao: new Date(d.data_decisao),
    criterios: [...d.criterios],
    limites: d.limites.map(l => ({ ...l })),
    condicoes: [...d.condicoes]
  };
}

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class DecisaoRepositoryImpl implements DecisaoRepository {
  private store: Map<string, DecisaoInstitucional> = new Map();
  private indexByEpisodio: Map<string, string> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;

  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'decisoes.json'));
  }

  static async create(dataDir: string = './data'): Promise<DecisaoRepositoryImpl> {
    const repo = new DecisaoRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    this.indexByEpisodio.clear();
    for (const raw of items) {
      const decisao = reviveDecisao(raw);
      this.store.set(decisao.id, decisao);
      this.indexByEpisodio.set(decisao.episodio_id, decisao.id);
    }
    this.initialized = true;
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Repositório não inicializado. Use static create() ou chame init() antes de usar.'
      );
    }
  }

  private async persist(): Promise<void> {
    const items = Array.from(this.store.values()).map(serializeDecisao);
    await this.fileStore.writeAll(items);
  }

  async create(decisao: DecisaoInstitucional): Promise<void> {
    this.checkInitialized();

    if (this.store.has(decisao.id)) {
      throw new Error(`DecisaoInstitucional com id ${decisao.id} já existe`);
    }

    // GARANTIR UNICIDADE POR EPISODIO_ID
    if (this.indexByEpisodio.has(decisao.episodio_id)) {
      throw new Error('Já existe DecisaoInstitucional para este episódio');
    }

    this.validateDecisao(decisao);

    // Clonar para não mutar input
    // data_decisao deve vir preenchida pelo Orquestrador
    const clone = cloneDecisao(decisao);

    this.store.set(clone.id, clone);
    this.indexByEpisodio.set(clone.episodio_id, clone.id);

    await this.persist();
  }

  async getById(id: string): Promise<DecisaoInstitucional | null> {
    this.checkInitialized();

    const decisao = this.store.get(id);
    if (!decisao) return null;
    return cloneDecisao(decisao);
  }

  async getByEpisodioId(episodio_id: string): Promise<DecisaoInstitucional | null> {
    this.checkInitialized();

    const decisao_id = this.indexByEpisodio.get(episodio_id);
    if (!decisao_id) return null;

    const decisao = this.store.get(decisao_id);
    if (!decisao) return null;
    return cloneDecisao(decisao);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisaoInstitucional>> {
    this.checkInitialized();

    const result = new Map<string, DecisaoInstitucional>();

    for (const episodio_id of episodio_ids) {
      const decisao_id = this.indexByEpisodio.get(episodio_id);
      if (decisao_id) {
        const decisao = this.store.get(decisao_id);
        if (decisao) {
          result.set(episodio_id, cloneDecisao(decisao));
        }
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════

  private validateDecisao(decisao: DecisaoInstitucional): void {
    if (!decisao.id) {
      throw new Error('id é obrigatório');
    }
    if (!decisao.episodio_id) {
      throw new Error('episodio_id é obrigatório');
    }
    if (!decisao.alternativa_escolhida) {
      throw new Error('alternativa_escolhida é obrigatório');
    }
    if (!decisao.criterios || decisao.criterios.length === 0) {
      throw new Error('Decisão institucional requer critérios explícitos');
    }
    if (!decisao.perfil_risco) {
      throw new Error('Perfil de risco deve estar explicitamente definido');
    }
    if (!decisao.limites || decisao.limites.length === 0) {
      throw new Error('Decisão institucional requer limites explícitos');
    }
    if (!decisao.data_decisao) {
      throw new Error('data_decisao é obrigatório (deve ser fornecida pelo Orquestrador)');
    }
  }

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export { DecisaoRepositoryImpl };
