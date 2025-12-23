import { DecisionProtocol } from '../../entidades/tipos';

/**
 * Repositório para DecisionProtocol
 *
 * REGRAS INVIOLÁVEIS:
 * - create apenas (sem update, sem delete)
 * - Imutável após criação
 * - Unicidade por episodio_id
 */
interface DecisionProtocolRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;

  /**
   * Cria um novo DecisionProtocol
   * GARANTE unicidade por episodio_id
   * @throws Se já existe protocolo para episodio_id
   * @throws Se id já existe
   */
  create(protocolo: DecisionProtocol): Promise<void>;

  /**
   * Busca DecisionProtocol por ID
   * @returns DecisionProtocol ou null se não encontrado
   */
  getById(id: string): Promise<DecisionProtocol | null>;

  /**
   * Busca DecisionProtocol por episodio_id
   * @returns DecisionProtocol ou null se não encontrado
   */
  getByEpisodioId(episodio_id: string): Promise<DecisionProtocol | null>;

  /**
   * Busca múltiplos protocolos por episodio_ids (batch)
   * @returns Map de episodio_id -> DecisionProtocol
   */
  getByEpisodioIds(episodio_ids: string[]): Promise<Map<string, DecisionProtocol>>;

  /**
   * UPDATE é PROIBIDO - método não existe
   * DELETE é PROIBIDO - método não existe
   */
}

export { DecisionProtocolRepository };
