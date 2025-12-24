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
