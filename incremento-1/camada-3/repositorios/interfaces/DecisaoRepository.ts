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
