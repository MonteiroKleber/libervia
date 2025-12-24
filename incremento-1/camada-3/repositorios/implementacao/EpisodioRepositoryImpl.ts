import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { EpisodioRepository } from '../interfaces/EpisodioRepository';
import {
  EpisodioDecisao,
  EstadoEpisodio,
  MemoryQuery
} from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeEpisodio(e: EpisodioDecisao): any {
  return {
    ...e,
    data_criacao: e.data_criacao.toISOString(),
    data_decisao: e.data_decisao?.toISOString() ?? null,
    data_observacao_iniciada: e.data_observacao_iniciada?.toISOString() ?? null,
    data_encerramento: e.data_encerramento?.toISOString() ?? null
  };
}

function reviveEpisodio(raw: any): EpisodioDecisao {
  return {
    ...raw,
    data_criacao: new Date(raw.data_criacao),
    data_decisao: raw.data_decisao ? new Date(raw.data_decisao) : null,
    data_observacao_iniciada: raw.data_observacao_iniciada ? new Date(raw.data_observacao_iniciada) : null,
    data_encerramento: raw.data_encerramento ? new Date(raw.data_encerramento) : null
  };
}

function cloneEpisodio(e: EpisodioDecisao): EpisodioDecisao {
  return {
    ...e,
    data_criacao: new Date(e.data_criacao),
    data_decisao: e.data_decisao ? new Date(e.data_decisao) : null,
    data_observacao_iniciada: e.data_observacao_iniciada ? new Date(e.data_observacao_iniciada) : null,
    data_encerramento: e.data_encerramento ? new Date(e.data_encerramento) : null
  };
}

// ════════════════════════════════════════════════════════════════════════
// TRANSIÇÕES VÁLIDAS
// ════════════════════════════════════════════════════════════════════════

const TRANSICOES_EPISODIO: Record<EstadoEpisodio, EstadoEpisodio[]> = {
  [EstadoEpisodio.CRIADO]: [EstadoEpisodio.DECIDIDO],
  [EstadoEpisodio.DECIDIDO]: [EstadoEpisodio.EM_OBSERVACAO],
  [EstadoEpisodio.EM_OBSERVACAO]: [EstadoEpisodio.ENCERRADO],
  [EstadoEpisodio.ENCERRADO]: []
};

// ════════════════════════════════════════════════════════════════════════
// CURSOR (PAGINAÇÃO)
// ════════════════════════════════════════════════════════════════════════

interface ParsedCursor {
  ts: number;
  id: string;
}

function parseCursor(cursor?: string): ParsedCursor | null {
  if (!cursor) return null;
  const parts = cursor.split('|');
  if (parts.length !== 2) return null;
  const ts = Number(parts[0]);
  const id = parts[1];
  if (!Number.isFinite(ts) || !id) return null;
  return { ts, id };
}

function makeCursor(e: EpisodioDecisao): string {
  return `${e.data_criacao.getTime()}|${e.id}`;
}

// ════════════════════════════════════════════════════════════════════════
// INDEX MANAGER (INCREMENTO 2)
// Índices locais em memória para consultas eficientes
// Reconstruídos no init(), atualizados em create() e updateEstado()
// ════════════════════════════════════════════════════════════════════════

class IndexManager {
  // Índice por caso_uso: Map<caso_uso, Set<episodio_id>>
  private byCasoUso: Map<number, Set<string>> = new Map();

  // Índice por estado: Map<estado, Set<episodio_id>>
  private byEstado: Map<EstadoEpisodio, Set<string>> = new Map();

  // Índice por domínio (lowercase): Map<dominio_lower, Set<episodio_id>>
  private byDominio: Map<string, Set<string>> = new Map();

  // Índice por data_criacao para paginação eficiente
  // Array ordenado por (timestamp DESC, id DESC) para suportar cursor
  private byDataCriacao: Array<{ ts: number; id: string }> = [];

  constructor() {
    // Inicializar índices por estado com todos os valores possíveis
    for (const estado of Object.values(EstadoEpisodio)) {
      this.byEstado.set(estado, new Set());
    }
  }

  /**
   * Limpa todos os índices (chamado antes de reconstruir)
   */
  clear(): void {
    this.byCasoUso.clear();
    this.byEstado.clear();
    this.byDominio.clear();
    this.byDataCriacao = [];

    // Reinicializar índices por estado
    for (const estado of Object.values(EstadoEpisodio)) {
      this.byEstado.set(estado, new Set());
    }
  }

  /**
   * Adiciona um episódio aos índices
   */
  addEpisodio(e: EpisodioDecisao): void {
    // Índice por caso_uso
    if (!this.byCasoUso.has(e.caso_uso)) {
      this.byCasoUso.set(e.caso_uso, new Set());
    }
    this.byCasoUso.get(e.caso_uso)!.add(e.id);

    // Índice por estado
    this.byEstado.get(e.estado)!.add(e.id);

    // Índice por domínio (case-insensitive)
    const dominioLower = e.dominio.toLowerCase();
    if (!this.byDominio.has(dominioLower)) {
      this.byDominio.set(dominioLower, new Set());
    }
    this.byDominio.get(dominioLower)!.add(e.id);

    // Índice por data_criacao
    this.byDataCriacao.push({ ts: e.data_criacao.getTime(), id: e.id });
  }

  /**
   * Atualiza o estado de um episódio nos índices
   */
  updateEstado(id: string, estadoAntigo: EstadoEpisodio, estadoNovo: EstadoEpisodio): void {
    // Remover do índice de estado antigo
    this.byEstado.get(estadoAntigo)?.delete(id);

    // Adicionar ao índice de estado novo
    this.byEstado.get(estadoNovo)!.add(id);
  }

  /**
   * Ordena o índice de data_criacao (chamado após carregar todos os episódios)
   * Ordenação: timestamp DESC, id DESC (mais recente primeiro)
   */
  sortByDataCriacao(): void {
    this.byDataCriacao.sort((a, b) => {
      const diff = b.ts - a.ts;
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
  }

  /**
   * Obtém IDs de episódios por caso_uso
   */
  getIdsByCasoUso(caso_uso: number): Set<string> | undefined {
    return this.byCasoUso.get(caso_uso);
  }

  /**
   * Obtém IDs de episódios por estado
   */
  getIdsByEstado(estado: EstadoEpisodio): Set<string> {
    return this.byEstado.get(estado) ?? new Set();
  }

  /**
   * Obtém IDs de episódios por domínio (case-insensitive, match parcial)
   * Retorna todos os IDs cujo domínio contém o termo buscado
   */
  getIdsByDominio(dominio: string): Set<string> {
    const termLower = dominio.toLowerCase();
    const result = new Set<string>();

    for (const [dominioKey, ids] of this.byDominio.entries()) {
      if (dominioKey.includes(termLower)) {
        for (const id of ids) {
          result.add(id);
        }
      }
    }

    return result;
  }

  /**
   * Obtém IDs ordenados por data_criacao (mais recente primeiro)
   * Aplica cursor se fornecido
   */
  getIdsOrdenadosPorData(cursor?: ParsedCursor): string[] {
    let items = this.byDataCriacao;

    if (cursor) {
      // Filtrar itens após o cursor (mais antigos que o cursor)
      items = items.filter(item => {
        return (item.ts < cursor.ts) || (item.ts === cursor.ts && item.id < cursor.id);
      });
    }

    return items.map(item => item.id);
  }

  /**
   * Obtém todos os IDs (para fallback quando não há filtros de índice)
   */
  getAllIds(): string[] {
    return this.byDataCriacao.map(item => item.id);
  }
}

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 2.1: DEBUG STATS (SOMENTE PARA TESTES)
// ════════════════════════════════════════════════════════════════════════

interface FindDebugStats {
  usedIndexCasoUso: boolean;
  usedIndexEstado: boolean;
  usedIndexDominio: boolean;
  usedOrderedByDataIndex: boolean;
  candidatesAfterIndexes: number;
  candidatesBeforeDateFilter: number;
  totalIds: number;
}

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class EpisodioRepositoryImpl implements EpisodioRepository {
  private store: Map<string, EpisodioDecisao> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;

  // INCREMENTO 2: IndexManager interno
  private indexes: IndexManager = new IndexManager();

  // INCREMENTO 2.1: Debug stats (atualizado a cada find())
  private _lastFindDebug: FindDebugStats | null = null;

  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'episodios.json'));
  }

  static async create(dataDir: string = './data'): Promise<EpisodioRepositoryImpl> {
    const repo = new EpisodioRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    this.indexes.clear();

    for (const raw of items) {
      const episodio = reviveEpisodio(raw);
      this.store.set(episodio.id, episodio);
      // INCREMENTO 2: Popular índices
      this.indexes.addEpisodio(episodio);
    }

    // INCREMENTO 2: Ordenar índice de data após carregar todos
    this.indexes.sortByDataCriacao();

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
    const items = Array.from(this.store.values()).map(serializeEpisodio);
    await this.fileStore.writeAll(items);
  }

  async create(episodio: EpisodioDecisao): Promise<void> {
    this.checkInitialized();

    if (this.store.has(episodio.id)) {
      throw new Error(`EpisodioDecisao com id ${episodio.id} já existe`);
    }

    this.validateEpisodio(episodio);

    // Clonar para não mutar input
    const clone = cloneEpisodio(episodio);

    this.store.set(clone.id, clone);

    // INCREMENTO 2: Atualizar índices
    this.indexes.addEpisodio(clone);
    this.indexes.sortByDataCriacao();

    await this.persist();
  }

  async getById(id: string): Promise<EpisodioDecisao | null> {
    this.checkInitialized();

    const episodio = this.store.get(id);
    if (!episodio) return null;
    return cloneEpisodio(episodio);
  }

  /**
   * INCREMENTO 2: Busca múltiplos episódios por IDs (batch)
   */
  async getByIds(ids: string[]): Promise<Map<string, EpisodioDecisao>> {
    this.checkInitialized();

    const result = new Map<string, EpisodioDecisao>();

    for (const id of ids) {
      const episodio = this.store.get(id);
      if (episodio) {
        result.set(id, cloneEpisodio(episodio));
      }
    }

    return result;
  }

  async updateEstado(id: string, novo_estado: EstadoEpisodio): Promise<void> {
    this.checkInitialized();

    const episodio = this.store.get(id);

    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${id} não encontrado`);
    }

    // Estado terminal não pode mudar
    if (episodio.estado === EstadoEpisodio.ENCERRADO) {
      throw new Error('Episódio encerrado não pode mudar de estado');
    }

    // Validar transição
    const transicoes_validas = TRANSICOES_EPISODIO[episodio.estado];
    if (!transicoes_validas.includes(novo_estado)) {
      throw new Error(`Transição inválida: ${episodio.estado} → ${novo_estado}`);
    }

    const estadoAntigo = episodio.estado;
    episodio.estado = novo_estado;

    // Atualizar datas conforme estado
    const now = new Date();
    switch (novo_estado) {
      case EstadoEpisodio.DECIDIDO:
        episodio.data_decisao = now;
        break;
      case EstadoEpisodio.EM_OBSERVACAO:
        episodio.data_observacao_iniciada = now;
        break;
      case EstadoEpisodio.ENCERRADO:
        episodio.data_encerramento = now;
        break;
    }

    // INCREMENTO 2: Atualizar índice de estado
    this.indexes.updateEstado(id, estadoAntigo, novo_estado);

    await this.persist();
  }

  /**
   * INCREMENTO 2: find() otimizado com índices
   *
   * Estratégia de otimização:
   * 1. Se há filtro por caso_uso OU estado OU domínio, usa índice para obter candidatos
   * 2. Se há múltiplos filtros indexados, usa intersecção de conjuntos
   * 3. Filtros não indexados (data_inicio, data_fim) são aplicados depois
   * 4. Cursor é aplicado no final para paginação eficiente
   */
  async find(query: MemoryQuery): Promise<{ episodios: EpisodioDecisao[]; next_cursor?: string }> {
    this.checkInitialized();

    // INCREMENTO 2.1: Inicializar debug stats
    const debugStats: FindDebugStats = {
      usedIndexCasoUso: false,
      usedIndexEstado: false,
      usedIndexDominio: false,
      usedOrderedByDataIndex: true, // Sempre usa
      candidatesAfterIndexes: 0,
      candidatesBeforeDateFilter: 0,
      totalIds: this.store.size
    };

    // ══════════════════════════════════════════════════════════════════════
    // FASE 1: Obter candidatos via índices
    // ══════════════════════════════════════════════════════════════════════

    let candidateIds: Set<string> | null = null;

    // Filtro por caso_uso (índice exato)
    if (query.caso_uso !== undefined) {
      debugStats.usedIndexCasoUso = true;
      const ids = this.indexes.getIdsByCasoUso(query.caso_uso);
      if (!ids || ids.size === 0) {
        this._lastFindDebug = debugStats;
        return { episodios: [] };
      }
      candidateIds = new Set(ids);
    }

    // Filtro por estado (índice exato)
    if (query.estado) {
      debugStats.usedIndexEstado = true;
      const ids = this.indexes.getIdsByEstado(query.estado);
      if (ids.size === 0) {
        this._lastFindDebug = debugStats;
        return { episodios: [] };
      }
      if (candidateIds === null) {
        candidateIds = new Set(ids);
      } else {
        // Intersecção
        candidateIds = new Set([...candidateIds].filter(id => ids.has(id)));
        if (candidateIds.size === 0) {
          this._lastFindDebug = debugStats;
          return { episodios: [] };
        }
      }
    }

    // Filtro por domínio (índice parcial, case-insensitive)
    if (query.dominio) {
      debugStats.usedIndexDominio = true;
      const ids = this.indexes.getIdsByDominio(query.dominio);
      if (ids.size === 0) {
        this._lastFindDebug = debugStats;
        return { episodios: [] };
      }
      if (candidateIds === null) {
        candidateIds = new Set(ids);
      } else {
        // Intersecção
        candidateIds = new Set([...candidateIds].filter(id => ids.has(id)));
        if (candidateIds.size === 0) {
          this._lastFindDebug = debugStats;
          return { episodios: [] };
        }
      }
    }

    // INCREMENTO 2.1: Registrar candidatos após índices
    debugStats.candidatesAfterIndexes = candidateIds?.size ?? this.store.size;

    // ══════════════════════════════════════════════════════════════════════
    // FASE 2: Obter episódios ordenados por data
    // ══════════════════════════════════════════════════════════════════════

    const cur = parseCursor(query.cursor);
    const idsOrdenados = this.indexes.getIdsOrdenadosPorData(cur ?? undefined);

    // Se temos candidatos filtrados, manter apenas os que estão na ordem
    let idsFinais: string[];
    if (candidateIds !== null) {
      idsFinais = idsOrdenados.filter(id => candidateIds!.has(id));
    } else {
      idsFinais = idsOrdenados;
    }

    // INCREMENTO 2.1: Registrar candidatos antes do filtro de data
    debugStats.candidatesBeforeDateFilter = idsFinais.length;

    // ══════════════════════════════════════════════════════════════════════
    // FASE 3: Aplicar filtros não indexados (data_inicio, data_fim)
    // ══════════════════════════════════════════════════════════════════════

    let results: EpisodioDecisao[] = [];

    for (const id of idsFinais) {
      const episodio = this.store.get(id);
      if (!episodio) continue;

      // Filtro por data_inicio
      if (query.data_inicio) {
        const inicio = query.data_inicio.getTime();
        if (episodio.data_criacao.getTime() < inicio) {
          continue;
        }
      }

      // Filtro por data_fim
      if (query.data_fim) {
        const fim = query.data_fim.getTime();
        if (episodio.data_criacao.getTime() > fim) {
          continue;
        }
      }

      results.push(episodio);
    }

    // NOTA: filtro por perfil_risco é aplicado no MemoryQueryService
    // após buscar decisões (conforme design do Incremento 1)

    // ══════════════════════════════════════════════════════════════════════
    // FASE 4: LIMIT e próximo cursor
    // ══════════════════════════════════════════════════════════════════════

    const limit = Math.min(query.limit ?? 20, 100);
    const hasMore = results.length > limit;
    const page = results.slice(0, limit);

    // INCREMENTO 2.1: Salvar debug stats
    this._lastFindDebug = debugStats;

    // ══════════════════════════════════════════════════════════════════════
    // RESULTADO
    // ══════════════════════════════════════════════════════════════════════

    return {
      episodios: page.map(cloneEpisodio),
      next_cursor: hasMore && page.length > 0 ? makeCursor(page[page.length - 1]) : undefined
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════

  private validateEpisodio(episodio: EpisodioDecisao): void {
    if (!episodio.id) {
      throw new Error('id é obrigatório');
    }
    if (episodio.caso_uso < 1 || episodio.caso_uso > 5) {
      throw new Error('caso_uso deve estar entre 1 e 5');
    }
    if (!episodio.dominio) {
      throw new Error('dominio é obrigatório');
    }
    if (!episodio.situacao_referenciada) {
      throw new Error('situacao_referenciada é obrigatório');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // INCREMENTO 2.1: DEBUG STATS (SOMENTE PARA TESTES)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Retorna estatísticas de debug da última chamada find().
   * SOMENTE PARA TESTES - não exposto na interface pública.
   * Não altera estado, não persiste nada.
   */
  _debugIndexStats(): FindDebugStats | null {
    return this._lastFindDebug ? { ...this._lastFindDebug } : null;
  }

  // DELETE é PROIBIDO - método não existe
}

export { EpisodioRepositoryImpl };
