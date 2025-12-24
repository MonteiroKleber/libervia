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

// INCREMENTO 3: Estados do Protocolo de Decisão
enum EstadoProtocolo {
  EM_CONSTRUCAO = 'EM_CONSTRUCAO',
  VALIDADO = 'VALIDADO',
  REJEITADO = 'REJEITADO'
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
// INCREMENTO 3: PROTOCOLO FORMAL DE DECISÃO
// ════════════════════════════════════════════════════════════════════════

/**
 * DecisionProtocol - Formalização do raciocínio institucional mínimo
 *
 * PRINCÍPIOS:
 * - NÃO executa
 * - NÃO recomenda
 * - NÃO aprende
 * - NÃO altera memória
 * - NÃO interpreta resultados
 *
 * APENAS formaliza o raciocínio institucional mínimo exigido
 * antes de uma DecisaoInstitucional poder ser criada.
 */
interface DecisionProtocol {
  id: string;
  episodio_id: string;

  // Elementos mínimos obrigatórios
  criterios_minimos: string[];
  riscos_considerados: string[];
  limites_definidos: Limite[];

  // Perfil de risco explícito
  perfil_risco: PerfilRisco;

  // Alternativas avaliadas e escolha
  alternativas_avaliadas: string[];
  alternativa_escolhida: string;

  // Rastreabilidade
  memoria_consultada_ids: string[];  // IDs de episódios apenas
  anexos_utilizados_ids: string[];

  // Estado do protocolo
  estado: EstadoProtocolo;

  // Validação
  validado_em: Date;
  validado_por: 'Libervia';

  // Motivo de rejeição (se aplicável)
  motivo_rejeicao?: string;
}

/**
 * Input para construção do protocolo
 * (campos que o chamador deve fornecer)
 */
interface DadosProtocoloInput {
  criterios_minimos: string[];
  riscos_considerados: string[];
  limites_definidos: Limite[];
  perfil_risco: PerfilRisco;
  alternativas_avaliadas: string[];
  alternativa_escolhida: string;
  memoria_consultada_ids?: string[];
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
  EstadoProtocolo,
  Alternativa,
  Risco,
  Limite,
  AnexoAnalise,
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  DecisionProtocol,
  DadosProtocoloInput,
  MemoryQuery,
  MemoryHit,
  MemoryQueryResult
};
