import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { DecisionProtocolRepository } from '../interfaces/DecisionProtocolRepository';
import { DecisionProtocol, EstadoProtocolo, PerfilRisco } from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeProtocol(p: DecisionProtocol): any {
  return {
    ...p,
    validado_em: p.validado_em.toISOString()
  };
}

function reviveProtocol(raw: any): DecisionProtocol {
  return {
    ...raw,
    validado_em: new Date(raw.validado_em)
  };
}

function cloneProtocol(p: DecisionProtocol): DecisionProtocol {
  return {
    ...p,
    validado_em: new Date(p.validado_em),
    criterios_minimos: [...p.criterios_minimos],
    riscos_considerados: [...p.riscos_considerados],
    limites_definidos: p.limites_definidos.map(l => ({ ...l })),
    alternativas_avaliadas: [...p.alternativas_avaliadas],
    memoria_consultada_ids: [...p.memoria_consultada_ids],
    anexos_utilizados_ids: [...p.anexos_utilizados_ids]
  };
}

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class DecisionProtocolRepositoryImpl implements DecisionProtocolRepository {
  private store: Map<string, DecisionProtocol> = new Map();
  private indexByEpisodio: Map<string, string> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;

  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'protocolos.json'));
  }

  static async create(dataDir: string = './data'): Promise<DecisionProtocolRepositoryImpl> {
    const repo = new DecisionProtocolRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    this.indexByEpisodio.clear();
    for (const raw of items) {
      const protocolo = reviveProtocol(raw);
      this.store.set(protocolo.id, protocolo);
      this.indexByEpisodio.set(protocolo.episodio_id, protocolo.id);
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
    const items = Array.from(this.store.values()).map(serializeProtocol);
    await this.fileStore.writeAll(items);
  }

  async create(protocolo: DecisionProtocol): Promise<void> {
    this.checkInitialized();

    if (this.store.has(protocolo.id)) {
      throw new Error(`DecisionProtocol com id ${protocolo.id} já existe`);
    }

    // GARANTIR UNICIDADE POR EPISODIO_ID
    if (this.indexByEpisodio.has(protocolo.episodio_id)) {
      throw new Error('Já existe DecisionProtocol para este episódio');
    }

    this.validateProtocol(protocolo);

    // Clonar para não mutar input
    const clone = cloneProtocol(protocolo);

    this.store.set(clone.id, clone);
    this.indexByEpisodio.set(clone.episodio_id, clone.id);

    await this.persist();
  }

  async getById(id: string): Promise<DecisionProtocol | null> {
    this.checkInitialized();

    const protocolo = this.store.get(id);
    if (!protocolo) return null;
    return cloneProtocol(protocolo);
  }

  async getByEpisodioId(episodio_id: string): Promise<DecisionProtocol | null> {
    this.checkInitialized();

    const protocolo_id = this.indexByEpisodio.get(episodio_id);
    if (!protocolo_id) return null;

    const protocolo = this.store.get(protocolo_id);
    if (!protocolo) return null;
    return cloneProtocol(protocolo);
  }

  async getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisionProtocol>> {
    this.checkInitialized();

    const result = new Map<string, DecisionProtocol>();

    for (const episodio_id of episodio_ids) {
      const protocolo_id = this.indexByEpisodio.get(episodio_id);
      if (protocolo_id) {
        const protocolo = this.store.get(protocolo_id);
        if (protocolo) {
          result.set(episodio_id, cloneProtocol(protocolo));
        }
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════

  private validateProtocol(protocolo: DecisionProtocol): void {
    // Campos sempre obrigatórios (mesmo para REJEITADO)
    if (!protocolo.id) {
      throw new Error('id é obrigatório');
    }
    if (!protocolo.episodio_id) {
      throw new Error('episodio_id é obrigatório');
    }
    if (!protocolo.estado) {
      throw new Error('estado é obrigatório');
    }
    if (!protocolo.validado_em) {
      throw new Error('validado_em é obrigatório');
    }
    if (protocolo.validado_por !== 'Libervia') {
      throw new Error('validado_por deve ser "Libervia"');
    }

    // Protocolos REJEITADOS são persistidos para auditoria,
    // mesmo com campos incompletos (o motivo_rejeicao explica)
    if (protocolo.estado === EstadoProtocolo.REJEITADO) {
      if (!protocolo.motivo_rejeicao) {
        throw new Error('Protocolo REJEITADO deve ter motivo_rejeicao');
      }
      return; // Não validar campos de conteúdo
    }

    // Para VALIDADO, todos os campos de conteúdo são obrigatórios
    if (!protocolo.criterios_minimos || protocolo.criterios_minimos.length === 0) {
      throw new Error('criterios_minimos é obrigatório e não pode ser vazio');
    }
    if (!protocolo.riscos_considerados || protocolo.riscos_considerados.length === 0) {
      throw new Error('riscos_considerados é obrigatório e não pode ser vazio');
    }
    if (!protocolo.limites_definidos || protocolo.limites_definidos.length === 0) {
      throw new Error('limites_definidos é obrigatório e não pode ser vazio');
    }
    if (!protocolo.perfil_risco) {
      throw new Error('perfil_risco é obrigatório');
    }
    if (!protocolo.alternativas_avaliadas || protocolo.alternativas_avaliadas.length < 2) {
      throw new Error('alternativas_avaliadas requer no mínimo 2 alternativas');
    }
    if (!protocolo.alternativa_escolhida) {
      throw new Error('alternativa_escolhida é obrigatório');
    }
    if (!protocolo.alternativas_avaliadas.includes(protocolo.alternativa_escolhida)) {
      throw new Error('alternativa_escolhida deve estar entre as alternativas_avaliadas');
    }
  }

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export { DecisionProtocolRepositoryImpl };
