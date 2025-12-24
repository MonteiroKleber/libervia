import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { ContratoRepository } from '../interfaces/ContratoRepository';
import { ContratoDeDecisao } from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeContrato(c: ContratoDeDecisao): any {
  return {
    ...c,
    data_emissao: c.data_emissao.toISOString()
  };
}

function reviveContrato(raw: any): ContratoDeDecisao {
  return {
    ...raw,
    data_emissao: new Date(raw.data_emissao)
  };
}

function cloneContrato(c: ContratoDeDecisao): ContratoDeDecisao {
  return {
    ...c,
    data_emissao: new Date(c.data_emissao),
    limites_execucao: c.limites_execucao.map(l => ({ ...l })),
    condicoes_obrigatorias: [...c.condicoes_obrigatorias],
    observacao_minima_requerida: [...c.observacao_minima_requerida]
  };
}

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class ContratoRepositoryImpl implements ContratoRepository {
  private store: Map<string, ContratoDeDecisao> = new Map();
  private indexByEpisodio: Map<string, string> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;

  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'contratos.json'));
  }

  static async create(dataDir: string = './data'): Promise<ContratoRepositoryImpl> {
    const repo = new ContratoRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    this.indexByEpisodio.clear();
    for (const raw of items) {
      const contrato = reviveContrato(raw);
      this.store.set(contrato.id, contrato);
      this.indexByEpisodio.set(contrato.episodio_id, contrato.id);
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
    const items = Array.from(this.store.values()).map(serializeContrato);
    await this.fileStore.writeAll(items);
  }

  async create(contrato: ContratoDeDecisao): Promise<void> {
    this.checkInitialized();

    if (this.store.has(contrato.id)) {
      throw new Error(`ContratoDeDecisao com id ${contrato.id} já existe`);
    }

    // GARANTIR UNICIDADE POR EPISODIO_ID
    if (this.indexByEpisodio.has(contrato.episodio_id)) {
      throw new Error('Já existe ContratoDeDecisao para este episódio');
    }

    this.validateContrato(contrato);

    // Clonar para não mutar input
    // data_emissao deve vir preenchida pelo Orquestrador
    const clone = cloneContrato(contrato);

    this.store.set(clone.id, clone);
    this.indexByEpisodio.set(clone.episodio_id, clone.id);

    await this.persist();
  }

  async getById(id: string): Promise<ContratoDeDecisao | null> {
    this.checkInitialized();

    const contrato = this.store.get(id);
    if (!contrato) return null;
    return cloneContrato(contrato);
  }

  async getByEpisodioId(episodio_id: string): Promise<ContratoDeDecisao | null> {
    this.checkInitialized();

    const contrato_id = this.indexByEpisodio.get(episodio_id);
    if (!contrato_id) return null;

    const contrato = this.store.get(contrato_id);
    if (!contrato) return null;
    return cloneContrato(contrato);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, ContratoDeDecisao>> {
    this.checkInitialized();

    const result = new Map<string, ContratoDeDecisao>();

    for (const episodio_id of episodio_ids) {
      const contrato_id = this.indexByEpisodio.get(episodio_id);
      if (contrato_id) {
        const contrato = this.store.get(contrato_id);
        if (contrato) {
          result.set(episodio_id, cloneContrato(contrato));
        }
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════

  private validateContrato(contrato: ContratoDeDecisao): void {
    if (!contrato.id) {
      throw new Error('id é obrigatório');
    }
    if (!contrato.episodio_id) {
      throw new Error('episodio_id é obrigatório');
    }
    if (!contrato.decisao_id) {
      throw new Error('decisao_id é obrigatório');
    }
    if (!contrato.alternativa_autorizada) {
      throw new Error('alternativa_autorizada é obrigatório');
    }
    if (!contrato.limites_execucao || contrato.limites_execucao.length === 0) {
      throw new Error('limites_execucao é obrigatório');
    }
    if (!contrato.data_emissao) {
      throw new Error('data_emissao é obrigatório (deve ser fornecida pelo Orquestrador)');
    }
  }

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export { ContratoRepositoryImpl };
