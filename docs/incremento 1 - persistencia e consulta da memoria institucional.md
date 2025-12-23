INCREMENTO 1 — PERSISTÊNCIA E CONSULTA DA MEMÓRIA INSTITUCIONAL (VERSÃO FINAL CANÔNICA)
ESTRUTURA DO INCREMENTO

incremento-1/
├── utilitarios/
│   └── JsonFileStore.ts        # Base de persistência atômica
├── entidades/
│   └── tipos.ts                # Tipos e enumerações
├── repositorios/
│   ├── interfaces/
│   │   ├── SituacaoRepository.ts
│   │   ├── EpisodioRepository.ts
│   │   ├── DecisaoRepository.ts
│   │   └── ContratoRepository.ts
│   └── implementacao/
│       ├── SituacaoRepositoryImpl.ts
│       ├── EpisodioRepositoryImpl.ts
│       ├── DecisaoRepositoryImpl.ts
│       └── ContratoRepositoryImpl.ts
├── servicos/
│   └── MemoryQueryService.ts
├── orquestrador/
│   └── OrquestradorCognitivo.ts
└── testes/
    └── incremento1.test.ts
1. UTILITÁRIOS BASE
1.1 JsonFileStore (Persistência Atômica com Controle de Concorrência)

// utilitarios/JsonFileStore.ts

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Store genérico para persistência em arquivo JSON
 * - Escrita atômica (via .tmp + rename)
 * - Controle de concorrência via fila interna
 * - Leitura segura com fallback para .tmp (recuperação de crash)
 */
class JsonFileStore {
  private writeChain: Promise<void> = Promise.resolve();
  
  constructor(private filePath: string) {}
  
  /**
   * Lê todos os itens do arquivo
   * Retorna array vazio se arquivo não existe
   * Tenta recuperar de .tmp se arquivo principal não existe mas .tmp existe
   */
  async readAll(): Promise<any[]> {
    const tmpPath = this.filePath + '.tmp';
    
    try {
      // Tentar ler arquivo principal
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Arquivo principal não existe, verificar se há .tmp de crash anterior
        try {
          const tmpExists = await fs.access(tmpPath).then(() => true).catch(() => false);
          if (tmpExists) {
            // Recuperar de .tmp (crash durante rename anterior)
            await fs.rename(tmpPath, this.filePath);
            const raw = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(raw);
          }
        } catch {
          // Ignorar erro de recuperação, retornar vazio
        }
        return [];
      }
      throw error;
    }
  }
  
  /**
   * Escreve todos os itens no arquivo
   * - Escrita atômica: escreve em .tmp e depois renomeia
   * - Fila interna para evitar race conditions
   * - Propaga erros corretamente sem envenenar a fila
   */
  async writeAll(items: any[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    const tmpPath = this.filePath + '.tmp';
    
    // Encadear escrita, capturando erro anterior para não envenenar fila
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(items, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
    });
    
    return this.writeChain;
  }
}

export { JsonFileStore };
2. TIPOS E ENUMERAÇÕES

// entidades/tipos.ts

// ════════════════════════════════════════════════════════════════════════
// ENUMERAÇÕES
// ════════════════════════════════════════════════════════════════════════

enum StatusSituacao {
  RASCUNHO = 'RASCUNHO',
  ABERTA = 'ABERTA',
  ACEITA = 'ACEITA',
  REJEITADA = 'REJEITADA',
  EM_ANALISE = 'EM_ANALISE',
  DECIDIDA = 'DECIDIDA',
  EM_OBSERVACAO = 'EM_OBSERVACAO',
  ENCERRADA = 'ENCERRADA'
}

enum EstadoEpisodio {
  CRIADO = 'CRIADO',
  DECIDIDO = 'DECIDIDO',
  EM_OBSERVACAO = 'EM_OBSERVACAO',
  ENCERRADO = 'ENCERRADO'
}

enum PerfilRisco {
  CONSERVADOR = 'CONSERVADOR',
  MODERADO = 'MODERADO',
  AGRESSIVO = 'AGRESSIVO'
}

// ════════════════════════════════════════════════════════════════════════
// TIPOS AUXILIARES
// ════════════════════════════════════════════════════════════════════════

interface Alternativa {
  descricao: string;
  riscos_associados: string[];
}

interface Risco {
  descricao: string;
  tipo: string;
  reversibilidade: string;
}

interface Limite {
  tipo: string;
  descricao: string;
  valor: string;
}

interface AnexoAnalise {
  tipo: string;
  conteudo: string;
  data_anexo: Date;
}

// ════════════════════════════════════════════════════════════════════════
// ENTIDADES PRINCIPAIS
// ════════════════════════════════════════════════════════════════════════

interface SituacaoDecisoria {
  id: string;
  dominio: string;
  contexto: string;
  objetivo: string;
  incertezas: string[];
  alternativas: Alternativa[];
  riscos: Risco[];
  urgencia: string;
  capacidade_absorcao: string;
  consequencia_relevante: string;
  possibilidade_aprendizado: boolean;
  status: StatusSituacao;
  data_criacao: Date;
  caso_uso_declarado: number;
  anexos_analise: AnexoAnalise[];
}

interface EpisodioDecisao {
  id: string;
  caso_uso: number;
  dominio: string;
  estado: EstadoEpisodio;
  situacao_referenciada: string;
  data_criacao: Date;
  data_decisao: Date | null;
  data_observacao_iniciada: Date | null;
  data_encerramento: Date | null;
}

interface DecisaoInstitucional {
  id: string;
  episodio_id: string;
  alternativa_escolhida: string;
  criterios: string[];
  perfil_risco: PerfilRisco;
  limites: Limite[];
  condicoes: string[];
  data_decisao: Date;
}

interface ContratoDeDecisao {
  id: string;
  episodio_id: string;
  decisao_id: string;
  alternativa_autorizada: string;
  limites_execucao: Limite[];
  condicoes_obrigatorias: string[];
  observacao_minima_requerida: string[];
  data_emissao: Date;
  emitido_para: string;
}

// ════════════════════════════════════════════════════════════════════════
// QUERY E RESULTADO
// ════════════════════════════════════════════════════════════════════════

interface MemoryQuery {
  caso_uso?: number;
  dominio?: string;
  perfil_risco?: PerfilRisco;
  estado?: EstadoEpisodio;
  data_inicio?: Date;
  data_fim?: Date;
  limit?: number;
  cursor?: string;
}

interface MemoryHit {
  episodio_id: string;
  caso_uso: number;
  dominio: string;
  estado: EstadoEpisodio;
  data_criacao: Date;
  data_decisao?: Date;
  perfil_risco?: PerfilRisco;
  alternativa_escolhida?: string;
  criterios?: string[];
  limites?: Limite[];
  contrato_id?: string;
}

interface MemoryQueryResult {
  hits: MemoryHit[];
  next_cursor?: string;
  total_encontrado: number;
}

export {
  StatusSituacao,
  EstadoEpisodio,
  PerfilRisco,
  Alternativa,
  Risco,
  Limite,
  AnexoAnalise,
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  MemoryQuery,
  MemoryHit,
  MemoryQueryResult
};
3. INTERFACES DOS REPOSITÓRIOS
3.1 SituacaoRepository

// repositorios/interfaces/SituacaoRepository.ts

import { SituacaoDecisoria, StatusSituacao, AnexoAnalise } from '../../entidades/tipos';

interface SituacaoRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;
  
  /**
   * Cria uma nova SituaçãoDecisoria
   * @throws Se id já existe
   */
  create(situacao: SituacaoDecisoria): Promise<void>;
  
  /**
   * Busca SituaçãoDecisoria por ID
   * @returns SituaçãoDecisoria ou null se não encontrado
   */
  getById(id: string): Promise<SituacaoDecisoria | null>;
  
  /**
   * Atualiza status da SituaçãoDecisoria
   * APENAS se transição for válida conforme máquina de estados
   * @throws Se transição inválida
   * @throws Se situação não encontrada
   */
  updateStatus(id: string, novo_status: StatusSituacao): Promise<void>;
  
  /**
   * Adiciona anexo de análise (append-only)
   * APENAS se situacao.status == EM_ANALISE
   * NÃO MUTA o objeto input
   * @throws Se status != EM_ANALISE
   * @throws Se situação não encontrada
   */
  appendAnexoAnalise(id: string, anexo: AnexoAnalise): Promise<void>;
  
  /**
   * DELETE é PROIBIDO - método não existe
   * UPDATE genérico é PROIBIDO - método não existe
   */
}

export { SituacaoRepository };
3.2 EpisodioRepository

// repositorios/interfaces/EpisodioRepository.ts

import { EpisodioDecisao, EstadoEpisodio, MemoryQuery } from '../../entidades/tipos';

interface EpisodioRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;
  
  /**
   * Cria um novo EpisodioDecisao
   * @throws Se id já existe
   */
  create(episodio: EpisodioDecisao): Promise<void>;
  
  /**
   * Busca EpisodioDecisao por ID
   * @returns EpisodioDecisao ou null se não encontrado
   */
  getById(id: string): Promise<EpisodioDecisao | null>;
  
  /**
   * Atualiza estado do EpisodioDecisao
   * APENAS se transição for válida conforme máquina de estados
   * @throws Se transição inválida
   * @throws Se episódio não encontrado
   */
  updateEstado(id: string, novo_estado: EstadoEpisodio): Promise<void>;
  
  /**
   * Consulta episódios com filtros
   * NÃO faz ranking, NÃO opina, apenas filtra
   * Suporta paginação via cursor
   */
  find(query: MemoryQuery): Promise<{ episodios: EpisodioDecisao[]; next_cursor?: string }>;
  
  /**
   * DELETE é PROIBIDO - método não existe
   */
}

export { EpisodioRepository };
3.3 DecisaoRepository

// repositorios/interfaces/DecisaoRepository.ts

import { DecisaoInstitucional } from '../../entidades/tipos';

interface DecisaoRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;
  
  /**
   * Cria uma nova DecisaoInstitucional
   * GARANTE unicidade por episodio_id
   * data_decisao deve ser fornecida pelo Orquestrador
   * @throws Se já existe decisão para episodio_id
   * @throws Se id já existe
   */
  create(decisao: DecisaoInstitucional): Promise<void>;
  
  /**
   * Busca DecisaoInstitucional por ID
   * @returns DecisaoInstitucional ou null se não encontrado
   */
  getById(id: string): Promise<DecisaoInstitucional | null>;
  
  /**
   * Busca DecisaoInstitucional por episodio_id
   * @returns DecisaoInstitucional ou null se não encontrado
   */
  getByEpisodioId(episodio_id: string): Promise<DecisaoInstitucional | null>;
  
  /**
   * Busca múltiplas decisões por episodio_ids (batch)
   * Preparação para otimização futura do N+1
   * @returns Map de episodio_id -> DecisaoInstitucional
   */
  getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisaoInstitucional>>;
  
  /**
   * UPDATE é PROIBIDO - método não existe
   * DELETE é PROIBIDO - método não existe
   */
}

export { DecisaoRepository };
3.4 ContratoRepository

// repositorios/interfaces/ContratoRepository.ts

import { ContratoDeDecisao } from '../../entidades/tipos';

interface ContratoRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;
  
  /**
   * Cria um novo ContratoDeDecisao
   * GARANTE unicidade por episodio_id
   * data_emissao deve ser fornecida pelo Orquestrador
   * @throws Se já existe contrato para episodio_id
   * @throws Se id já existe
   */
  create(contrato: ContratoDeDecisao): Promise<void>;
  
  /**
   * Busca ContratoDeDecisao por ID
   * @returns ContratoDeDecisao ou null se não encontrado
   */
  getById(id: string): Promise<ContratoDeDecisao | null>;
  
  /**
   * Busca ContratoDeDecisao por episodio_id
   * @returns ContratoDeDecisao ou null se não encontrado
   */
  getByEpisodioId(episodio_id: string): Promise<ContratoDeDecisao | null>;
  
  /**
   * Busca múltiplos contratos por episodio_ids (batch)
   * Preparação para otimização futura do N+1
   * @returns Map de episodio_id -> ContratoDeDecisao
   */
  getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, ContratoDeDecisao>>;
  
  /**
   * UPDATE é PROIBIDO - método não existe
   * DELETE é PROIBIDO - método não existe
   */
}

export { ContratoRepository };
4. IMPLEMENTAÇÕES DOS REPOSITÓRIOS
4.1 SituacaoRepositoryImpl

// repositorios/implementacao/SituacaoRepositoryImpl.ts

import * as path from 'path';
import { JsonFileStore } from '../../utilitarios/JsonFileStore';
import { SituacaoRepository } from '../interfaces/SituacaoRepository';
import {
  SituacaoDecisoria,
  StatusSituacao,
  AnexoAnalise
} from '../../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeSituacao(s: SituacaoDecisoria): any {
  return {
    ...s,
    data_criacao: s.data_criacao.toISOString(),
    anexos_analise: (s.anexos_analise ?? []).map(a => ({
      ...a,
      data_anexo: a.data_anexo.toISOString()
    }))
  };
}

function reviveSituacao(raw: any): SituacaoDecisoria {
  return {
    ...raw,
    data_criacao: new Date(raw.data_criacao),
    anexos_analise: (raw.anexos_analise ?? []).map((a: any) => ({
      ...a,
      data_anexo: new Date(a.data_anexo)
    }))
  };
}

function cloneSituacao(s: SituacaoDecisoria): SituacaoDecisoria {
  return {
    ...s,
    data_criacao: new Date(s.data_criacao),
    incertezas: [...s.incertezas],
    alternativas: s.alternativas.map(a => ({
      ...a,
      riscos_associados: [...a.riscos_associados]
    })),
    riscos: s.riscos.map(r => ({ ...r })),
    anexos_analise: (s.anexos_analise ?? []).map(a => ({
      ...a,
      data_anexo: new Date(a.data_anexo)
    }))
  };
}

// ════════════════════════════════════════════════════════════════════════
// TRANSIÇÕES VÁLIDAS
// ════════════════════════════════════════════════════════════════════════

const TRANSICOES_SITUACAO: Record<StatusSituacao, StatusSituacao[]> = {
  [StatusSituacao.RASCUNHO]: [StatusSituacao.ABERTA],
  [StatusSituacao.ABERTA]: [StatusSituacao.ACEITA, StatusSituacao.REJEITADA],
  [StatusSituacao.ACEITA]: [StatusSituacao.EM_ANALISE],
  [StatusSituacao.REJEITADA]: [],
  [StatusSituacao.EM_ANALISE]: [StatusSituacao.DECIDIDA],
  [StatusSituacao.DECIDIDA]: [StatusSituacao.EM_OBSERVACAO],
  [StatusSituacao.EM_OBSERVACAO]: [StatusSituacao.ENCERRADA],
  [StatusSituacao.ENCERRADA]: []
};

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class SituacaoRepositoryImpl implements SituacaoRepository {
  private store: Map<string, SituacaoDecisoria> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;
  
  /**
   * Constructor é privado conceitualmente
   * USE static create() para criar instâncias
   */
  constructor(dataDir: string = './data') {
    this.fileStore = new JsonFileStore(path.join(dataDir, 'situacoes.json'));
  }
  
  /**
   * Factory method RECOMENDADO para criar instância inicializada
   * Evita o bug de usar repositório sem init()
   */
  static async create(dataDir: string = './data'): Promise<SituacaoRepositoryImpl> {
    const repo = new SituacaoRepositoryImpl(dataDir);
    await repo.init();
    return repo;
  }
  
  async init(): Promise<void> {
    const items = await this.fileStore.readAll();
    this.store.clear();
    for (const raw of items) {
      const situacao = reviveSituacao(raw);
      this.store.set(situacao.id, situacao);
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
    const items = Array.from(this.store.values()).map(serializeSituacao);
    await this.fileStore.writeAll(items);
  }
  
  async create(situacao: SituacaoDecisoria): Promise<void> {
    this.checkInitialized();
    
    if (this.store.has(situacao.id)) {
      throw new Error(`SituaçãoDecisoria com id ${situacao.id} já existe`);
    }
    
    this.validateSituacao(situacao);
    
    // Clonar para não mutar input
    const clone = cloneSituacao(situacao);
    
    this.store.set(clone.id, clone);
    await this.persist();
  }
  
  async getById(id: string): Promise<SituacaoDecisoria | null> {
    this.checkInitialized();
    
    const situacao = this.store.get(id);
    if (!situacao) return null;
    
    // Retornar clone para não expor referência interna
    return cloneSituacao(situacao);
  }
  
  async updateStatus(id: string, novo_status: StatusSituacao): Promise<void> {
    this.checkInitialized();
    
    const situacao = this.store.get(id);
    
    if (!situacao) {
      throw new Error(`SituaçãoDecisoria com id ${id} não encontrada`);
    }
    
    // Estados terminais não podem mudar
    if (situacao.status === StatusSituacao.REJEITADA ||
        situacao.status === StatusSituacao.ENCERRADA) {
      throw new Error(`Situação em estado terminal não pode mudar de status`);
    }
    
    // Validar transição
    const transicoes_validas = TRANSICOES_SITUACAO[situacao.status];
    if (!transicoes_validas.includes(novo_status)) {
      throw new Error(`Transição inválida: ${situacao.status} → ${novo_status}`);
    }
    
    situacao.status = novo_status;
    await this.persist();
  }
  
  async appendAnexoAnalise(id: string, anexo: AnexoAnalise): Promise<void> {
    this.checkInitialized();
    
    const situacao = this.store.get(id);
    
    if (!situacao) {
      throw new Error(`SituaçãoDecisoria com id ${id} não encontrada`);
    }
    
    // APENAS em EM_ANALISE
    if (situacao.status !== StatusSituacao.EM_ANALISE) {
      throw new Error(
        `Anexos só podem ser adicionados quando status = EM_ANALISE. ` +
        `Status atual: ${situacao.status}`
      );
    }
    
    // Validar anexo
    if (!anexo.tipo || !anexo.conteudo) {
      throw new Error('AnexoAnalise requer tipo e conteudo não vazios');
    }
    
    // Criar NOVO objeto (não mutar input)
    const anexado: AnexoAnalise = {
      tipo: anexo.tipo,
      conteudo: anexo.conteudo,
      data_anexo: new Date()
    };
    
    if (!situacao.anexos_analise) {
      situacao.anexos_analise = [];
    }
    
    situacao.anexos_analise.push(anexado);
    await this.persist();
  }
  
  // ══════════════════════════════════════════════════════════════════════
  // VALIDAÇÕES
  // ══════════════════════════════════════════════════════════════════════
  
  private validateSituacao(situacao: SituacaoDecisoria): void {
    if (!situacao.id) {
      throw new Error('id é obrigatório');
    }
    if (!situacao.dominio) {
      throw new Error('dominio é obrigatório');
    }
    if (!situacao.contexto) {
      throw new Error('contexto é obrigatório');
    }
    if (!situacao.objetivo) {
      throw new Error('objetivo é obrigatório');
    }
    if (!situacao.incertezas || situacao.incertezas.length === 0) {
      throw new Error('Não há incerteza real - decisão é determinística');
    }
    if (!situacao.alternativas || situacao.alternativas.length < 2) {
      throw new Error('Decisão requer no mínimo 2 alternativas reais');
    }
    if (!situacao.riscos || situacao.riscos.length === 0) {
      throw new Error('Não há risco real identificado');
    }
    if (!situacao.consequencia_relevante) {
      throw new Error('Não há consequência relevante identificada');
    }
    if (situacao.possibilidade_aprendizado !== true) {
      throw new Error('Não há possibilidade de aprendizado - decisão não qualifica');
    }
    if (situacao.caso_uso_declarado < 1 || situacao.caso_uso_declarado > 5) {
      throw new Error('Caso de uso deve ser entre 1 e 5');
    }
  }
}

export { SituacaoRepositoryImpl };
4.2 EpisodioRepositoryImpl

// repositorios/implementacao/EpisodioRepositoryImpl.ts

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
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class EpisodioRepositoryImpl implements EpisodioRepository {
  private store: Map<string, EpisodioDecisao> = new Map();
  private fileStore: JsonFileStore;
  private initialized: boolean = false;
  
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
    for (const raw of items) {
      const episodio = reviveEpisodio(raw);
      this.store.set(episodio.id, episodio);
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
    await this.persist();
  }
  
  async getById(id: string): Promise<EpisodioDecisao | null> {
    this.checkInitialized();
    
    const episodio = this.store.get(id);
    if (!episodio) return null;
    return cloneEpisodio(episodio);
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
    
    await this.persist();
  }
  
  async find(query: MemoryQuery): Promise<{ episodios: EpisodioDecisao[]; next_cursor?: string }> {
    this.checkInitialized();
    
    let results = Array.from(this.store.values());
    
    // ══════════════════════════════════════════════════════════════════════
    // FILTROS (sem ranking, sem opinião)
    // ══════════════════════════════════════════════════════════════════════
    
    if (query.caso_uso !== undefined) {
      results = results.filter(e => e.caso_uso === query.caso_uso);
    }
    
    if (query.dominio) {
      const dominio_lower = query.dominio.toLowerCase();
      results = results.filter(e =>
        e.dominio.toLowerCase().includes(dominio_lower)
      );
    }
    
    if (query.estado) {
      results = results.filter(e => e.estado === query.estado);
    }
    
    if (query.data_inicio) {
      const inicio = query.data_inicio.getTime();
      results = results.filter(e => e.data_criacao.getTime() >= inicio);
    }
    
    if (query.data_fim) {
      const fim = query.data_fim.getTime();
      results = results.filter(e => e.data_criacao.getTime() <= fim);
    }
    
    // NOTA: filtro por perfil_risco é aplicado no MemoryQueryService
    // após buscar decisões (N+1 aceito para Incremento 1, preparado para batch no Incremento 2)
    
    // ══════════════════════════════════════════════════════════════════════
    // ORDENAÇÃO (apenas por data, do mais recente ao mais antigo)
    // Sem score, sem ranking, sem relevância
    // ══════════════════════════════════════════════════════════════════════
    
    results.sort((a, b) => {
      const diff = b.data_criacao.getTime() - a.data_criacao.getTime();
      if (diff !== 0) return diff;
      return b.id.localeCompare(a.id);
    });
    
    // ══════════════════════════════════════════════════════════════════════
    // CURSOR (paginação real)
    // ══════════════════════════════════════════════════════════════════════
    
    const cur = parseCursor(query.cursor);
    if (cur) {
      results = results.filter(e => {
        const t = e.data_criacao.getTime();
        return (t < cur.ts) || (t === cur.ts && e.id < cur.id);
      });
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // LIMIT
    // ══════════════════════════════════════════════════════════════════════
    
    const limit = Math.min(query.limit ?? 20, 100);
    const hasMore = results.length > limit;
    const page = results.slice(0, limit);
    
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
  
  // DELETE é PROIBIDO - método não existe
}

export { EpisodioRepositoryImpl };
4.3 DecisaoRepositoryImpl

// repositorios/implementacao/DecisaoRepositoryImpl.ts

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
4.4 ContratoRepositoryImpl

// repositorios/implementacao/ContratoRepositoryImpl.ts

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
5. SERVIÇO DE CONSULTA DA MEMÓRIA INSTITUCIONAL

// servicos/MemoryQueryService.ts

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
6. ORQUESTRADOR COGNITIVO ATUALIZADO

// orquestrador/OrquestradorCognitivo.ts

import { SituacaoRepository } from '../repositorios/interfaces/SituacaoRepository';
import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  StatusSituacao,
  EstadoEpisodio,
  MemoryQuery,
  MemoryQueryResult,
  AnexoAnalise
} from '../entidades/tipos';

/**
 * Orquestrador Cognitivo (Camada 4 da Libervia)
 * 
 * PRINCÍPIOS:
 * - NÃO recomenda decisões
 * - NÃO otimiza resultados
 * - NÃO executa ações (isso é Bazari)
 * - ÚNICA saída para Bazari: ContratoDeDecisao
 */
class OrquestradorCognitivo {
  constructor(
    private situacaoRepo: SituacaoRepository,
    private episodioRepo: EpisodioRepository,
    private decisaoRepo: DecisaoRepository,
    private contratoRepo: ContratoRepository,
    private memoryService: MemoryQueryService
  ) {}
  
  // ════════════════════════════════════════════════════════════════════════
  // FUNÇÕES DO INCREMENTO 0 (corrigidas)
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * Processa uma solicitação de decisão
   * 
   * Fluxo:
   * 1. Se situação não existe, cria
   * 2. Se situação está em RASCUNHO, transiciona para ABERTA
   * 3. Valida que está em ABERTA
   * 4. Transiciona para ACEITA e cria episódio
   * 5. Transiciona para EM_ANALISE
   */
  async ProcessarSolicitacao(situacao: SituacaoDecisoria): Promise<EpisodioDecisao> {
    // Verificar se situação existe
    let sit = await this.situacaoRepo.getById(situacao.id);
    
    if (!sit) {
      // Situação nova - criar
      await this.situacaoRepo.create(situacao);
      sit = await this.situacaoRepo.getById(situacao.id);
    }
    
    if (!sit) {
      throw new Error('Falha ao criar/recuperar situação');
    }
    
    // Se está em RASCUNHO, transicionar para ABERTA
    if (sit.status === StatusSituacao.RASCUNHO) {
      await this.situacaoRepo.updateStatus(sit.id, StatusSituacao.ABERTA);
      sit = await this.situacaoRepo.getById(sit.id);
    }
    
    // Validar que está em ABERTA
    if (sit!.status !== StatusSituacao.ABERTA) {
      throw new Error(
        `Situação deve estar ABERTA para ser processada. ` +
        `Status atual: ${sit!.status}`
      );
    }
    
    // Transicionar para ACEITA
    await this.situacaoRepo.updateStatus(sit!.id, StatusSituacao.ACEITA);
    
    // Criar episódio
    const episodio = await this.CriarEpisodio(sit!);
    
    // Transicionar para EM_ANALISE
    await this.situacaoRepo.updateStatus(sit!.id, StatusSituacao.EM_ANALISE);
    
    return episodio;
  }
  
  private async CriarEpisodio(situacao: SituacaoDecisoria): Promise<EpisodioDecisao> {
    const episodio: EpisodioDecisao = {
      id: this.gerarId(),
      caso_uso: situacao.caso_uso_declarado,
      dominio: situacao.dominio,
      estado: EstadoEpisodio.CRIADO,
      situacao_referenciada: situacao.id,
      data_criacao: new Date(),
      data_decisao: null,
      data_observacao_iniciada: null,
      data_encerramento: null
    };
    
    await this.episodioRepo.create(episodio);
    return episodio;
  }
  
  /**
   * Registra uma decisão institucional
   * RETORNA ContratoDeDecisao (única saída para Bazari)
   */
  async RegistrarDecisao(
    episodio_id: string,
    decisaoInput: Omit<DecisaoInstitucional, 'id' | 'episodio_id' | 'data_decisao'>
  ): Promise<ContratoDeDecisao> {
    const episodio = await this.episodioRepo.getById(episodio_id);
    
    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }
    
    if (episodio.estado !== EstadoEpisodio.CRIADO) {
      throw new Error('Decisão só pode ser registrada quando episódio está em CRIADO');
    }
    
    // Criar decisão com dados fornecidos pelo Orquestrador
    const decisao: DecisaoInstitucional = {
      ...decisaoInput,
      id: this.gerarId(),
      episodio_id: episodio_id,
      data_decisao: new Date() // Orquestrador é fonte da data
    };
    
    await this.decisaoRepo.create(decisao);
    
    // Transicionar episódio para DECIDIDO
    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.DECIDIDO);
    
    // Transicionar situação para DECIDIDA
    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.DECIDIDA
    );
    
    // Emitir contrato (ÚNICA saída para Bazari)
    const contrato = await this.EmitirContrato(episodio_id, decisao);
    
    return contrato;
  }
  
  private async EmitirContrato(
    episodio_id: string,
    decisao: DecisaoInstitucional
  ): Promise<ContratoDeDecisao> {
    const contrato: ContratoDeDecisao = {
      id: this.gerarId(),
      episodio_id,
      decisao_id: decisao.id,
      alternativa_autorizada: decisao.alternativa_escolhida,
      limites_execucao: decisao.limites,
      condicoes_obrigatorias: decisao.condicoes,
      observacao_minima_requerida: [
        'Impacto Técnico observado',
        'Impacto Operacional observado',
        'Evidências coletadas',
        'Persistência avaliada'
      ],
      data_emissao: new Date(), // Orquestrador é fonte da data
      emitido_para: 'Bazari'
    };
    
    await this.contratoRepo.create(contrato);
    return contrato;
  }
  
  async IniciarObservacao(episodio_id: string): Promise<void> {
    const episodio = await this.episodioRepo.getById(episodio_id);
    
    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }
    
    if (episodio.estado !== EstadoEpisodio.DECIDIDO) {
      throw new Error('Observação só pode iniciar após estado DECIDIDO');
    }
    
    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.EM_OBSERVACAO);
    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.EM_OBSERVACAO
    );
  }
  
  async EncerrarEpisodio(episodio_id: string): Promise<void> {
    const episodio = await this.episodioRepo.getById(episodio_id);
    
    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }
    
    if (episodio.estado !== EstadoEpisodio.EM_OBSERVACAO) {
      throw new Error('Episódio só pode ser encerrado após observação');
    }
    
    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.ENCERRADO);
    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.ENCERRADA
    );
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // FUNÇÕES DO INCREMENTO 1
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * Consulta memória institucional durante análise
   * APENAS em EM_ANALISE
   * Registra consulta como AnexoAnalise (append-only)
   * NÃO recomenda, NÃO ranqueia, apenas consulta e registra
   */
  async ConsultarMemoriaDuranteAnalise(
    situacao_id: string,
    query: MemoryQuery
  ): Promise<MemoryQueryResult> {
    // Verificar que situação existe
    const situacao = await this.situacaoRepo.getById(situacao_id);
    
    if (!situacao) {
      throw new Error(`SituaçãoDecisoria com id ${situacao_id} não encontrada`);
    }
    
    // APENAS em EM_ANALISE
    if (situacao.status !== StatusSituacao.EM_ANALISE) {
      throw new Error(
        `Consulta de memória só é permitida em EM_ANALISE. ` +
        `Status atual: ${situacao.status}`
      );
    }
    
    // Executar consulta (sem ranking, sem recomendação)
    const resultado = await this.memoryService.find(query);
    
    // Registrar consulta como anexo (append-only)
    await this.RegistrarMemoriaConsultada(situacao_id, query, resultado);
    
    return resultado;
  }
  
  /**
   * Registra memória consultada como AnexoAnalise (append-only)
   * PRIVADO - chamado internamente por ConsultarMemoriaDuranteAnalise
   */
  private async RegistrarMemoriaConsultada(
    situacao_id: string,
    query: MemoryQuery,
    resultado: MemoryQueryResult
  ): Promise<void> {
    const conteudo = this.serializarConsultaMemoria(query, resultado);
    
    const anexo: AnexoAnalise = {
      tipo: 'Memória consultada',
      conteudo,
      data_anexo: new Date()
    };
    
    await this.situacaoRepo.appendAnexoAnalise(situacao_id, anexo);
  }
  
  private serializarConsultaMemoria(
    query: MemoryQuery,
    resultado: MemoryQueryResult
  ): string {
    const linhas: string[] = ['### CONSULTA À MEMÓRIA INSTITUCIONAL'];
    
    linhas.push('\n**Query aplicada:**');
    if (query.caso_uso !== undefined) linhas.push(`- caso_uso: ${query.caso_uso}`);
    if (query.dominio) linhas.push(`- dominio: ${query.dominio}`);
    if (query.perfil_risco) linhas.push(`- perfil_risco: ${query.perfil_risco}`);
    if (query.estado) linhas.push(`- estado: ${query.estado}`);
    if (query.data_inicio) linhas.push(`- data_inicio: ${query.data_inicio.toISOString()}`);
    if (query.data_fim) linhas.push(`- data_fim: ${query.data_fim.toISOString()}`);
    linhas.push(`- limit: ${query.limit ?? 20}`);
    if (query.cursor) linhas.push(`- cursor: ${query.cursor}`);
    
    linhas.push(`\n**Total encontrado:** ${resultado.total_encontrado}`);
    
    linhas.push('\n**Episódios retornados (IDs apenas):**');
    if (resultado.hits.length === 0) {
      linhas.push('- Nenhum episódio encontrado');
    } else {
      resultado.hits.forEach(hit => {
        linhas.push(`- ${hit.episodio_id} (caso_uso: ${hit.caso_uso}, estado: ${hit.estado})`);
      });
    }
    
    if (resultado.next_cursor) {
      linhas.push(`\n**Próximo cursor:** ${resultado.next_cursor}`);
    }
    
    // IMPORTANTE: Não adicionar interpretação, resumo ou recomendação
    // Apenas dados factuais da consulta
    
    return linhas.join('\n');
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ════════════════════════════════════════════════════════════════════════
  
  private gerarId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

export { OrquestradorCognitivo };
7. TESTES AUTOMATIZADOS

// testes/incremento1.test.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  StatusSituacao,
  EstadoEpisodio,
  PerfilRisco,
  MemoryQuery,
  AnexoAnalise
} from '../entidades/tipos';

const TEST_DATA_DIR = './test-data-' + Date.now();

// ════════════════════════════════════════════════════════════════════════
// SETUP E TEARDOWN
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorioTeste(): Promise<void> {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Ignorar se não existe
  }
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(id: string = 'situacao-1'): SituacaoDecisoria {
  return {
    id,
    dominio: 'Teste',
    contexto: 'Contexto de teste',
    objetivo: 'Objetivo de teste',
    incertezas: ['Incerteza 1'],
    alternativas: [
      { descricao: 'Alt 1', riscos_associados: ['Risco 1'] },
      { descricao: 'Alt 2', riscos_associados: ['Risco 2'] }
    ],
    riscos: [{ descricao: 'Risco 1', tipo: 'Técnico', reversibilidade: 'Alta' }],
    urgencia: 'Média',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequência relevante',
    possibilidade_aprendizado: true,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    caso_uso_declarado: 1,
    anexos_analise: []
  };
}

function criarEpisodioValido(
  id: string = 'episodio-1',
  situacao_id: string = 'situacao-1'
): EpisodioDecisao {
  return {
    id,
    caso_uso: 1,
    dominio: 'Teste',
    estado: EstadoEpisodio.CRIADO,
    situacao_referenciada: situacao_id,
    data_criacao: new Date(),
    data_decisao: null,
    data_observacao_iniciada: null,
    data_encerramento: null
  };
}

function criarDecisaoValida(
  id: string = 'decisao-1',
  episodio_id: string = 'episodio-1'
): DecisaoInstitucional {
  return {
    id,
    episodio_id,
    alternativa_escolhida: 'Alt 1',
    criterios: ['Critério 1'],
    perfil_risco: PerfilRisco.MODERADO,
    limites: [{ tipo: 'Financeiro', descricao: 'Máximo R$ 1000', valor: '1000' }],
    condicoes: ['Condição 1'],
    data_decisao: new Date()
  };
}

function criarContratoValido(
  id: string = 'contrato-1',
  episodio_id: string = 'episodio-1',
  decisao_id: string = 'decisao-1'
): ContratoDeDecisao {
  return {
    id,
    episodio_id,
    decisao_id,
    alternativa_autorizada: 'Alt 1',
    limites_execucao: [{ tipo: 'Financeiro', descricao: 'Máximo R$ 1000', valor: '1000' }],
    condicoes_obrigatorias: ['Condição 1'],
    observacao_minima_requerida: ['Impacto Técnico observado'],
    data_emissao: new Date(),
    emitido_para: 'Bazari'
  };
}

// ════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 1 - Persistência e Consulta da Memória', () => {
  
  beforeEach(async () => {
    await limparDiretorioTeste();
  });
  
  afterAll(async () => {
    await limparDiretorioTeste();
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Episódio não pode ser deletado
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 1: Episódio não pode ser deletado', () => {
    test('EpisodioRepository não possui método delete', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      
      expect((repo as any).delete).toBeUndefined();
      expect((repo as any).remove).toBeUndefined();
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Decisão não pode ser alterada
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 2: Decisão não pode ser alterada', () => {
    test('DecisaoRepository não possui método update', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      
      expect((repo as any).update).toBeUndefined();
      expect((repo as any).updateDecisao).toBeUndefined();
    });
    
    test('Tentativa de criar segunda decisão para mesmo episódio falha', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const decisao1 = criarDecisaoValida('decisao-1', 'episodio-1');
      await repo.create(decisao1);
      
      const decisao2 = criarDecisaoValida('decisao-2', 'episodio-1');
      
      await expect(repo.create(decisao2)).rejects.toThrow(
        'Já existe DecisaoInstitucional para este episódio'
      );
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Contrato não pode ser alterado
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 3: Contrato não pode ser alterado', () => {
    test('ContratoRepository não possui método update', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      
      expect((repo as any).update).toBeUndefined();
    });
    
    test('ContratoRepository não possui método delete', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      
      expect((repo as any).delete).toBeUndefined();
    });
    
    test('Apenas um contrato por episódio', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      
      const contrato1 = criarContratoValido('contrato-1', 'episodio-1');
      await repo.create(contrato1);
      
      const contrato2 = criarContratoValido('contrato-2', 'episodio-1');
      
      await expect(repo.create(contrato2)).rejects.toThrow(
        'Já existe ContratoDeDecisao para este episódio'
      );
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Núcleo da situação trava a partir de ACEITA
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 4: Núcleo da situação trava a partir de ACEITA', () => {
    test('SituacaoRepository não possui método update genérico', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      
      expect((repo as any).update).toBeUndefined();
      expect((repo as any).updateContexto).toBeUndefined();
      expect((repo as any).updateNucleo).toBeUndefined();
    });
    
    test('Transições de estado seguem regras rígidas', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const situacao = criarSituacaoValida();
      await repo.create(situacao);
      
      // Transição válida: RASCUNHO → ABERTA
      await repo.updateStatus(situacao.id, StatusSituacao.ABERTA);
      
      // Transição inválida: ABERTA → EM_ANALISE (deve ser ACEITA primeiro)
      await expect(
        repo.updateStatus(situacao.id, StatusSituacao.EM_ANALISE)
      ).rejects.toThrow('Transição inválida');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Anexo é append-only
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 5: Anexo é append-only', () => {
    test('Anexo só pode ser adicionado em EM_ANALISE', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const situacao = criarSituacaoValida();
      await repo.create(situacao);
      
      const anexo: AnexoAnalise = {
        tipo: 'Teste',
        conteudo: 'conteúdo de teste',
        data_anexo: new Date()
      };
      
      // Tentar adicionar em RASCUNHO - deve falhar
      await expect(
        repo.appendAnexoAnalise(situacao.id, anexo)
      ).rejects.toThrow('Anexos só podem ser adicionados quando status = EM_ANALISE');
      
      // Transicionar para EM_ANALISE
      await repo.updateStatus(situacao.id, StatusSituacao.ABERTA);
      await repo.updateStatus(situacao.id, StatusSituacao.ACEITA);
      await repo.updateStatus(situacao.id, StatusSituacao.EM_ANALISE);
      
      // Agora deve funcionar
      await expect(
        repo.appendAnexoAnalise(situacao.id, anexo)
      ).resolves.not.toThrow();
      
      // Verificar que foi adicionado
      const recuperada = await repo.getById(situacao.id);
      expect(recuperada!.anexos_analise).toHaveLength(1);
      expect(recuperada!.anexos_analise[0].tipo).toBe('Teste');
    });
    
    test('Anexo não muta objeto input', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.EM_ANALISE;
      await repo.create(situacao);
      
      const dataOriginal = new Date('2020-01-01');
      const anexo: AnexoAnalise = {
        tipo: 'Teste',
        conteudo: 'conteúdo',
        data_anexo: dataOriginal
      };
      
      await repo.appendAnexoAnalise(situacao.id, anexo);
      
      // Verificar que data_anexo do input não foi mutada
      expect(anexo.data_anexo.getFullYear()).toBe(2020);
      
      // Verificar que anexo persistido tem data atual
      const recuperada = await repo.getById(situacao.id);
      expect(recuperada!.anexos_analise[0].data_anexo.getFullYear()).toBeGreaterThanOrEqual(2024);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Consulta de memória só ocorre em EM_ANALISE
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 6: Consulta de memória só ocorre em EM_ANALISE', () => {
    test('Consulta fora de EM_ANALISE é rejeitada', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );
      
      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.ABERTA;
      await situacaoRepo.create(situacao);
      
      const query: MemoryQuery = { caso_uso: 1 };
      
      await expect(
        orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, query)
      ).rejects.toThrow('Consulta de memória só é permitida em EM_ANALISE');
    });
    
    test('Consulta em EM_ANALISE funciona', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );
      
      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.EM_ANALISE;
      await situacaoRepo.create(situacao);
      
      const query: MemoryQuery = { caso_uso: 1 };
      
      const resultado = await orquestrador.ConsultarMemoriaDuranteAnalise(
        situacao.id,
        query
      );
      
      expect(resultado).toHaveProperty('hits');
      expect(resultado).toHaveProperty('total_encontrado');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Consulta registra AnexoAnalise com IDs
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 7: Consulta registra AnexoAnalise com IDs', () => {
    test('Consulta adiciona anexo "Memória consultada"', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );
      
      // Criar episódio para ser encontrado na consulta
      const episodio = criarEpisodioValido('ep-consulta', 'sit-outra');
      episodio.caso_uso = 2;
      await episodioRepo.create(episodio);
      
      // Criar situação em análise
      const situacao = criarSituacaoValida('situacao-analise');
      situacao.status = StatusSituacao.EM_ANALISE;
      await situacaoRepo.create(situacao);
      
      const query: MemoryQuery = { caso_uso: 2 };
      
      await orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, query);
      
      // Verificar que anexo foi adicionado
      const situacaoAtualizada = await situacaoRepo.getById(situacao.id);
      
      expect(situacaoAtualizada!.anexos_analise).toHaveLength(1);
      expect(situacaoAtualizada!.anexos_analise[0].tipo).toBe('Memória consultada');
      expect(situacaoAtualizada!.anexos_analise[0].conteudo).toContain('ep-consulta');
      expect(situacaoAtualizada!.anexos_analise[0].conteudo).toContain('caso_uso: 2');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Consulta não ranqueia nem recomenda
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 8: Consulta não ranqueia nem recomenda', () => {
    test('MemoryQueryService não possui métodos de ranking', async () => {
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const service = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      
      expect((service as any).rankResults).toBeUndefined();
      expect((service as any).recommendDecision).toBeUndefined();
      expect((service as any).scoreAlternatives).toBeUndefined();
      expect((service as any).predictOutcome).toBeUndefined();
      expect((service as any).suggestBestOption).toBeUndefined();
    });
    
    test('Resultado é ordenado apenas por data, sem score', async () => {
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const service = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      
      // Criar episódios com datas diferentes
      const ep1 = criarEpisodioValido('ep-1', 'sit-1');
      ep1.data_criacao = new Date('2024-01-01');
      await episodioRepo.create(ep1);
      
      const ep2 = criarEpisodioValido('ep-2', 'sit-2');
      ep2.data_criacao = new Date('2024-01-02');
      await episodioRepo.create(ep2);
      
      const resultado = await service.find({});
      
      // Mais recente primeiro (ep-2)
      expect(resultado.hits[0].episodio_id).toBe('ep-2');
      expect(resultado.hits[1].episodio_id).toBe('ep-1');
      
      // Não há campo de score
      expect(resultado.hits[0]).not.toHaveProperty('score');
      expect(resultado.hits[0]).not.toHaveProperty('relevance');
      expect(resultado.hits[0]).not.toHaveProperty('ranking');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Unicidade - uma decisão por episódio, um contrato por episódio
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 9: Unicidade', () => {
    test('Apenas uma decisão por episódio', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const decisao1 = criarDecisaoValida('decisao-a', 'episodio-x');
      await repo.create(decisao1);
      
      const decisao2 = criarDecisaoValida('decisao-b', 'episodio-x');
      
      await expect(repo.create(decisao2)).rejects.toThrow(
        'Já existe DecisaoInstitucional para este episódio'
      );
    });
    
    test('Apenas um contrato por episódio', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      
      const contrato1 = criarContratoValido('contrato-a', 'episodio-y');
      await repo.create(contrato1);
      
      const contrato2 = criarContratoValido('contrato-b', 'episodio-y');
      
      await expect(repo.create(contrato2)).rejects.toThrow(
        'Já existe ContratoDeDecisao para este episódio'
      );
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: Persistência e re-hidratação de datas
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 10: Persistência e re-hidratação de datas', () => {
    test('Datas são preservadas após reload', async () => {
      const dataOriginal = new Date('2024-06-15T10:30:00.000Z');
      
      // Criar e salvar
      const repo1 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const episodio = criarEpisodioValido('ep-data');
      episodio.data_criacao = dataOriginal;
      await repo1.create(episodio);
      
      // Criar nova instância (simula reinício da aplicação)
      const repo2 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const recuperado = await repo2.getById('ep-data');
      
      // Verificar que data foi preservada
      expect(recuperado!.data_criacao).toBeInstanceOf(Date);
      expect(recuperado!.data_criacao.getTime()).toBe(dataOriginal.getTime());
    });
    
    test('Comparação de datas funciona após reload', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      
      const ep1 = criarEpisodioValido('ep-old', 'sit-1');
      ep1.data_criacao = new Date('2024-01-01');
      await repo.create(ep1);
      
      const ep2 = criarEpisodioValido('ep-new', 'sit-2');
      ep2.data_criacao = new Date('2024-12-01');
      await repo.create(ep2);
      
      // Buscar com filtro de data
      const resultado = await repo.find({
        data_inicio: new Date('2024-06-01')
      });
      
      expect(resultado.episodios).toHaveLength(1);
      expect(resultado.episodios[0].id).toBe('ep-new');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 11: Cursor funciona corretamente
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 11: Paginação com cursor', () => {
    test('Cursor retorna próxima página corretamente', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      
      // Criar 5 episódios
      for (let i = 1; i <= 5; i++) {
        const ep = criarEpisodioValido(`ep-${i}`, `sit-${i}`);
        ep.data_criacao = new Date(`2024-01-0${i}`);
        await repo.create(ep);
      }
      
      // Primeira página (limit 2)
      const page1 = await repo.find({ limit: 2 });
      expect(page1.episodios).toHaveLength(2);
      expect(page1.episodios[0].id).toBe('ep-5'); // Mais recente
      expect(page1.episodios[1].id).toBe('ep-4');
      expect(page1.next_cursor).toBeDefined();
      
      // Segunda página
      const page2 = await repo.find({ limit: 2, cursor: page1.next_cursor });
      expect(page2.episodios).toHaveLength(2);
      expect(page2.episodios[0].id).toBe('ep-3');
      expect(page2.episodios[1].id).toBe('ep-2');
      
      // Terceira página
      const page3 = await repo.find({ limit: 2, cursor: page2.next_cursor });
      expect(page3.episodios).toHaveLength(1);
      expect(page3.episodios[0].id).toBe('ep-1');
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 12: Repositório não inicializado gera erro
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 12: Verificação de inicialização', () => {
    test('Usar repositório sem init() gera erro', async () => {
      const repo = new EpisodioRepositoryImpl(TEST_DATA_DIR);
      // NÃO chamando init()
      
      await expect(repo.getById('qualquer')).rejects.toThrow(
        'Repositório não inicializado'
      );
    });
    
    test('static create() já retorna repositório inicializado', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      
      // Deve funcionar sem erros
      const resultado = await repo.getById('nao-existe');
      expect(resultado).toBeNull();
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 13: ProcessarSolicitacao aceita situação em RASCUNHO
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 13: ProcessarSolicitacao fluxo completo', () => {
    test('Aceita situação nova em RASCUNHO e transiciona corretamente', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );
      
      const situacao = criarSituacaoValida('sit-nova');
      // Status é RASCUNHO por padrão
      
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);
      
      expect(episodio).toBeDefined();
      expect(episodio.situacao_referenciada).toBe('sit-nova');
      
      // Verificar que situação foi transicionada para EM_ANALISE
      const situacaoAtualizada = await situacaoRepo.getById('sit-nova');
      expect(situacaoAtualizada!.status).toBe(StatusSituacao.EM_ANALISE);
    });
  });
  
  // ══════════════════════════════════════════════════════════════════════
  // TESTE 14: Batch lookup (getByEpisodioIds)
  // ══════════════════════════════════════════════════════════════════════
  
  describe('TESTE 14: Batch lookup', () => {
    test('getByEpisodioIds retorna decisões corretas', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      
      const decisao1 = criarDecisaoValida('decisao-1', 'ep-1');
      const decisao2 = criarDecisaoValida('decisao-2', 'ep-2');
      await repo.create(decisao1);
      await repo.create(decisao2);
      
      const result = await repo.getByEpisodioIds(['ep-1', 'ep-2', 'ep-inexistente']);
      
      expect(result.size).toBe(2);
      expect(result.get('ep-1')!.id).toBe('decisao-1');
      expect(result.get('ep-2')!.id).toBe('decisao-2');
      expect(result.has('ep-inexistente')).toBe(false);
    });
    
    test('getByEpisodioIds para contratos', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      
      const contrato1 = criarContratoValido('contrato-1', 'ep-1');
      const contrato2 = criarContratoValido('contrato-2', 'ep-2');
      await repo.create(contrato1);
      await repo.create(contrato2);
      
      const result = await repo.getByEpisodioIds(['ep-1', 'ep-2']);
      
      expect(result.size).toBe(2);
      expect(result.get('ep-1')!.id).toBe('contrato-1');
      expect(result.get('ep-2')!.id).toBe('contrato-2');
    });
  });
});
8. DOCUMENTAÇÃO DO INCREMENTO 1 (VERSÃO FINAL CANÔNICA)
8.1 O que foi entregue
✓ JsonFileStore - Base de persistência atômica com:
Escrita atômica (.tmp + rename)
Controle de concorrência (writeChain)
Recuperação de crash (fallback para .tmp)
Propagação correta de erros sem envenenar fila
✓ 4 Repositórios com:
Interfaces stack-agnósticas
Implementação de referência robusta
static create() como factory recomendada
checkInitialized() para prevenir uso sem init
Batch lookup (getByEpisodioIds) preparado para otimização
✓ MemoryQueryService para consulta sem opinião/ranking usando batch lookup ✓ OrquestradorCognitivo atualizado com:
ProcessarSolicitacao aceitando RASCUNHO e transicionando corretamente
RegistrarDecisao com Orquestrador como fonte das datas
ConsultarMemoriaDuranteAnalise com registro auditável
✓ 14 testes automatizados cobrindo todas as garantias
8.2 Correções aplicadas
✓ ProcessarSolicitacao - Agora aceita situação em RASCUNHO e transiciona RASCUNHO → ABERTA automaticamente ✓ Datas gerenciadas pelo Orquestrador - DecisaoRepository e ContratoRepository não mais tentam preencher datas (validação exige data fornecida) ✓ JsonFileStore.readAll() - Recuperação de .tmp em caso de crash ✓ JsonFileStore.writeAll() - Propagação correta de erros com .catch(() => {}) antes do encadeamento ✓ checkInitialized() - Validação em todos os métodos públicos dos repositórios ✓ Batch lookup - getByEpisodioIds() implementado para preparar otimização do N+1
8.3 Garantias preservadas do Incremento 0
✓ Episódios nunca podem ser deletados
✓ Decisões nunca podem ser alteradas ou deletadas
✓ Contratos nunca podem ser alterados ou deletados
✓ Núcleo da SituaçãoDecisoria imutável a partir de ACEITA
✓ anexos_analise é append-only
✓ Máquinas de estados rígidas (transições validadas)
✓ Unicidade: uma decisão por episódio, um contrato por episódio
✓ Saída única para Bazari: ContratoDeDecisao
✓ 5 gatilhos canônicos validados
8.4 Novas capacidades do Incremento 1
✓ Persistência durável com escrita atômica
✓ Recuperação de crash (fallback para .tmp)
✓ Consulta de memória institucional por filtros simples
✓ Paginação real com cursor
✓ Batch lookup preparado para otimização
✓ Registro auditável de consultas via anexos_analise
✓ Consulta apenas em EM_ANALISE (validação rigorosa)
✓ Resultados sem ranking, score ou recomendação
✓ Ordenação apenas por data (mais recente primeiro)
✓ Datas preservadas após reload
✓ Validação de inicialização obrigatória
8.5 Limitações conhecidas (documentadas para incrementos futuros)
⚠️ Filtro por perfil_risco ainda requer lookup adicional (já usando batch, mas pós-filtro)
⚠️ Índices não implementados (volume pequeno aceito para Incremento 1)
⚠️ Sem transações distribuídas (aceito para implementação de referência)
8.6 Status Final
INCREMENTO 1 ESTÁ COMPLETO, TESTADO E CANÔNICO. Todas as correções críticas aplicadas:
✓ ProcessarSolicitacao aceita RASCUNHO
✓ Datas gerenciadas pelo Orquestrador
✓ Recuperação de crash no JsonFileStore
✓ Propagação correta de erros
✓ Validação de inicialização
✓ Batch lookup preparado
Todas as garantias do Incremento 0 preservadas.
Persistência robusta e auditável.
Memória institucional consultável sem opinião.
Aguardando instrução para próximo incremento.