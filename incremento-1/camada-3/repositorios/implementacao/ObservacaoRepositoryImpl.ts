/**
 * INCREMENTO 15 — IMPLEMENTAÇÃO DO REPOSITÓRIO DE OBSERVAÇÃO
 *
 * Repositório append-only para ObservacaoDeConsequencia.
 * Persiste em JSON com escrita atômica.
 *
 * INVARIANTES:
 * - Apenas create (sem update, sem delete)
 * - Múltiplas observações permitidas por contrato
 * - Imutável após criação
 */

import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { ObservacaoRepository } from '../interfaces/ObservacaoRepository';
import {
  ObservacaoDeConsequencia,
  AnexoEvidencia
} from '../../entidades/ObservacaoDeConsequencia';

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════════

function serializeObservacao(o: ObservacaoDeConsequencia): unknown {
  return {
    ...o,
    data_registro: o.data_registro.toISOString(),
    observada: {
      ...o.observada,
      anexos: o.observada.anexos?.map(a => ({
        ...a,
        data_anexo: a.data_anexo.toISOString()
      }))
    }
  };
}

function reviveObservacao(raw: Record<string, unknown>): ObservacaoDeConsequencia {
  const observada = raw.observada as Record<string, unknown>;
  const anexosRaw = observada.anexos as Array<Record<string, unknown>> | undefined;

  return {
    ...raw,
    data_registro: new Date(raw.data_registro as string),
    observada: {
      ...observada,
      anexos: anexosRaw?.map(a => ({
        ...a,
        data_anexo: new Date(a.data_anexo as string)
      })) as AnexoEvidencia[] | undefined
    }
  } as ObservacaoDeConsequencia;
}

function cloneObservacao(o: ObservacaoDeConsequencia): ObservacaoDeConsequencia {
  return {
    ...o,
    data_registro: new Date(o.data_registro),
    observada: {
      ...o.observada,
      indicadores: o.observada.indicadores?.map(i => ({ ...i })),
      anexos: o.observada.anexos?.map(a => ({
        ...a,
        data_anexo: new Date(a.data_anexo)
      }))
    },
    percebida: {
      ...o.percebida
    },
    evidencias_minimas: [...o.evidencias_minimas]
  };
}

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════════

class ObservacaoRepositoryImpl implements ObservacaoRepository {
  private store: Map<string, ObservacaoDeConsequencia> = new Map();
  private indexByContrato: Map<string, string[]> = new Map();
  private indexByEpisodio: Map<string, string[]> = new Map();
  private fileStore: JsonFileStore;
  private initialized = false;

  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'observacoes.json'));
  }

  static async create(dataDir: string = './data'): Promise<ObservacaoRepositoryImpl> {
    const repo = new ObservacaoRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    this.indexByContrato.clear();
    this.indexByEpisodio.clear();

    for (const raw of items) {
      const observacao = reviveObservacao(raw as Record<string, unknown>);
      this.store.set(observacao.id, observacao);
      this.addToIndex(observacao);
    }

    this.initialized = true;
  }

  private addToIndex(observacao: ObservacaoDeConsequencia): void {
    // Index por contrato
    const contratoIds = this.indexByContrato.get(observacao.contrato_id) ?? [];
    contratoIds.push(observacao.id);
    this.indexByContrato.set(observacao.contrato_id, contratoIds);

    // Index por episódio
    const episodioIds = this.indexByEpisodio.get(observacao.episodio_id) ?? [];
    episodioIds.push(observacao.id);
    this.indexByEpisodio.set(observacao.episodio_id, episodioIds);
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Repositório não inicializado. Use static create() ou chame init() antes de usar.'
      );
    }
  }

  private async persist(): Promise<void> {
    const items = Array.from(this.store.values()).map(serializeObservacao);
    await this.fileStore.writeAll(items);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE (APPEND-ONLY)
  // ══════════════════════════════════════════════════════════════════════════

  async create(observacao: ObservacaoDeConsequencia): Promise<void> {
    this.checkInitialized();

    if (this.store.has(observacao.id)) {
      throw new Error(`ObservacaoDeConsequencia com id ${observacao.id} já existe`);
    }

    this.validateObservacao(observacao);

    // Clonar para não mutar input
    const clone = cloneObservacao(observacao);

    this.store.set(clone.id, clone);
    this.addToIndex(clone);

    await this.persist();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READ
  // ══════════════════════════════════════════════════════════════════════════

  async getById(id: string): Promise<ObservacaoDeConsequencia | null> {
    this.checkInitialized();

    const observacao = this.store.get(id);
    if (!observacao) return null;
    return cloneObservacao(observacao);
  }

  async getByContratoId(contrato_id: string): Promise<ObservacaoDeConsequencia[]> {
    this.checkInitialized();

    const ids = this.indexByContrato.get(contrato_id) ?? [];
    const result: ObservacaoDeConsequencia[] = [];

    for (const id of ids) {
      const observacao = this.store.get(id);
      if (observacao) {
        result.push(cloneObservacao(observacao));
      }
    }

    // Ordenar por data_registro (mais antiga primeiro)
    result.sort((a, b) => a.data_registro.getTime() - b.data_registro.getTime());

    return result;
  }

  async getByEpisodioId(episodio_id: string): Promise<ObservacaoDeConsequencia[]> {
    this.checkInitialized();

    const ids = this.indexByEpisodio.get(episodio_id) ?? [];
    const result: ObservacaoDeConsequencia[] = [];

    for (const id of ids) {
      const observacao = this.store.get(id);
      if (observacao) {
        result.push(cloneObservacao(observacao));
      }
    }

    // Ordenar por data_registro (mais antiga primeiro)
    result.sort((a, b) => a.data_registro.getTime() - b.data_registro.getTime());

    return result;
  }

  async getByDateRange(start: Date, end: Date): Promise<ObservacaoDeConsequencia[]> {
    this.checkInitialized();

    const result: ObservacaoDeConsequencia[] = [];
    const startTs = start.getTime();
    const endTs = end.getTime();

    for (const observacao of this.store.values()) {
      const ts = observacao.data_registro.getTime();
      if (ts >= startTs && ts <= endTs) {
        result.push(cloneObservacao(observacao));
      }
    }

    // Ordenar por data_registro
    result.sort((a, b) => a.data_registro.getTime() - b.data_registro.getTime());

    return result;
  }

  async countByContratoId(contrato_id: string): Promise<number> {
    this.checkInitialized();

    const ids = this.indexByContrato.get(contrato_id);
    return ids?.length ?? 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════════

  private validateObservacao(o: ObservacaoDeConsequencia): void {
    if (!o.id) {
      throw new Error('id é obrigatório');
    }
    if (!o.contrato_id) {
      throw new Error('contrato_id é obrigatório');
    }
    if (!o.episodio_id) {
      throw new Error('episodio_id é obrigatório');
    }
    if (!o.observada) {
      throw new Error('observada é obrigatório');
    }
    if (!o.observada.descricao) {
      throw new Error('observada.descricao é obrigatório');
    }
    if (!o.percebida) {
      throw new Error('percebida é obrigatório');
    }
    if (!o.percebida.descricao) {
      throw new Error('percebida.descricao é obrigatório');
    }
    if (!o.percebida.sinal) {
      throw new Error('percebida.sinal é obrigatório');
    }
    if (!o.evidencias_minimas || o.evidencias_minimas.length === 0) {
      throw new Error('evidencias_minimas é obrigatório e deve ter ao menos 1 item');
    }
    if (!o.registrado_por) {
      throw new Error('registrado_por é obrigatório');
    }
    if (!o.data_registro) {
      throw new Error('data_registro é obrigatório');
    }
  }

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export { ObservacaoRepositoryImpl };
