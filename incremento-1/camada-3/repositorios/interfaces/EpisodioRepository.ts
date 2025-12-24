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
   * Busca múltiplos episódios por IDs (batch)
   * INCREMENTO 2: Preparação para otimização de N+1
   * @returns Map de id -> EpisodioDecisao
   */
  getByIds(ids: string[]): Promise<Map<string, EpisodioDecisao>>;

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
   * INCREMENTO 2: Usa índices para eficiência
   */
  find(query: MemoryQuery): Promise<{ episodios: EpisodioDecisao[]; next_cursor?: string }>;

  /**
   * DELETE é PROIBIDO - método não existe
   */
}

export { EpisodioRepository };
