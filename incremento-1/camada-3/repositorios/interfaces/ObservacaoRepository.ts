/**
 * INCREMENTO 15 — REPOSITÓRIO DE OBSERVAÇÃO DE CONSEQUÊNCIA
 *
 * Interface para repositório append-only de consequências.
 *
 * REGRAS INVIOLÁVEIS:
 * - Apenas create (append) - sem update, sem delete
 * - Imutável após criação
 * - Múltiplas observações permitidas por contrato (follow-ups)
 */

import { ObservacaoDeConsequencia } from '../../entidades/ObservacaoDeConsequencia';

interface ObservacaoRepository {
  /**
   * Inicializa o repositório (carrega dados do disco)
   * OBRIGATÓRIO chamar antes de usar qualquer outro método
   * Prefira usar static create() ao invés de constructor + init()
   */
  init(): Promise<void>;

  /**
   * Cria uma nova ObservacaoDeConsequencia (append-only)
   * @throws Se id já existe
   */
  create(observacao: ObservacaoDeConsequencia): Promise<void>;

  /**
   * Busca ObservacaoDeConsequencia por ID
   * @returns ObservacaoDeConsequencia ou null se não encontrado
   */
  getById(id: string): Promise<ObservacaoDeConsequencia | null>;

  /**
   * Busca todas as observações de um contrato
   * Ordenadas por data_registro (mais antiga primeiro)
   * @returns Array de observações (pode ser vazio)
   */
  getByContratoId(contrato_id: string): Promise<ObservacaoDeConsequencia[]>;

  /**
   * Busca todas as observações de um episódio
   * Ordenadas por data_registro (mais antiga primeiro)
   * @returns Array de observações (pode ser vazio)
   */
  getByEpisodioId(episodio_id: string): Promise<ObservacaoDeConsequencia[]>;

  /**
   * Busca observações em um range temporal
   * @param start Data inicial (inclusive)
   * @param end Data final (inclusive)
   * @returns Array de observações (pode ser vazio)
   */
  getByDateRange(start: Date, end: Date): Promise<ObservacaoDeConsequencia[]>;

  /**
   * Conta total de observações por contrato
   * Útil para saber quantos follow-ups existem
   */
  countByContratoId(contrato_id: string): Promise<number>;

  /**
   * UPDATE é PROIBIDO - método não existe
   * DELETE é PROIBIDO - método não existe
   */
}

export { ObservacaoRepository };
