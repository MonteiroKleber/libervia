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
