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
