/**
 * INCREMENTO 15 + 19 — OBSERVAÇÃO DE CONSEQUÊNCIA
 *
 * Representa o registro de consequências de uma decisão já executada.
 * A consequência é pós-execução, vinculada a um ContratoDeDecisao.
 *
 * PRINCÍPIOS:
 * - Append-only: nunca editar, nunca deletar
 * - Separação clara: observada (fatos) vs percebida (avaliação)
 * - Trilha imutável: cada registro é permanente
 * - Anti-fraude: exige observacao_minima_requerida do contrato
 *
 * INCREMENTO 19:
 * - Adiciona autonomyTriggers para feedback loop de autonomia
 * - Gatilhos determinísticos que afetam mandatos e modos de autonomia
 */

// ════════════════════════════════════════════════════════════════════════════
// SINAL DE IMPACTO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sinal qualitativo do impacto da consequência.
 * NÃO é score, NÃO é ranking - apenas classificação qualitativa.
 */
enum SinalImpacto {
  /** Impacto positivo claro */
  POSITIVO = 'POSITIVO',

  /** Impacto neutro ou dentro do esperado */
  NEUTRO = 'NEUTRO',

  /** Impacto negativo claro */
  NEGATIVO = 'NEGATIVO',

  /** Impacto ainda não determinável */
  INDETERMINADO = 'INDETERMINADO'
}

// ════════════════════════════════════════════════════════════════════════════
// CONSEQUÊNCIA OBSERVADA (FATOS)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Indicador simples para consequência observada.
 */
interface IndicadorObservado {
  /** Nome do indicador (ex: "tempo_execucao", "custo_real") */
  nome: string;

  /** Valor observado (texto, para flexibilidade) */
  valor: string;

  /** Unidade (opcional) */
  unidade?: string;
}

/**
 * Anexo de evidência para consequência observada.
 */
interface AnexoEvidencia {
  /** Tipo do anexo (ex: "log", "captura", "relatorio") */
  tipo: string;

  /** Conteúdo ou referência */
  conteudo: string;

  /** Timestamp do anexo */
  data_anexo: Date;
}

/**
 * Consequência observada: fatos objetivos e mensuráveis.
 * O que aconteceu de fato após a execução da decisão.
 */
interface ConsequenciaObservada {
  /** Descrição textual dos fatos observados */
  descricao: string;

  /** Indicadores mensuráveis (opcional) */
  indicadores?: IndicadorObservado[];

  /** Anexos de evidência (opcional) */
  anexos?: AnexoEvidencia[];

  /** Se os limites do contrato foram respeitados */
  limites_respeitados: boolean;

  /** Se as condições obrigatórias foram cumpridas */
  condicoes_cumpridas: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// CONSEQUÊNCIA PERCEBIDA (AVALIAÇÃO)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Consequência percebida: avaliação do impacto sistêmico.
 * Como o sistema/organização interpreta o resultado.
 */
interface ConsequenciaPercebida {
  /** Descrição textual da avaliação */
  descricao: string;

  /** Sinal qualitativo do impacto */
  sinal: SinalImpacto;

  /** Risco percebido pós-execução (texto) */
  risco_percebido?: string;

  /** Lições aprendidas (texto) */
  licoes?: string;

  /** Contexto adicional para a avaliação */
  contexto_adicional?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// OBSERVAÇÃO DE CONSEQUÊNCIA (ENTIDADE PRINCIPAL)
// ════════════════════════════════════════════════════════════════════════════

/**
 * ObservacaoDeConsequencia - Registro imutável de consequência.
 *
 * INVARIANTES:
 * - Só pode ser criada para contrato existente
 * - Nunca pode ser editada
 * - Nunca pode ser deletada
 * - Pode ter follow-ups (novas observações para mesmo contrato)
 */
interface ObservacaoDeConsequencia {
  /** ID único da observação */
  id: string;

  /** ID do contrato ao qual esta consequência se refere */
  contrato_id: string;

  /** ID do episódio (derivado do contrato, para consultas) */
  episodio_id: string;

  /** Consequência observada (fatos) */
  observada: ConsequenciaObservada;

  /** Consequência percebida (avaliação) */
  percebida: ConsequenciaPercebida;

  /** Evidências mínimas fornecidas (conforme observacao_minima_requerida) */
  evidencias_minimas: string[];

  /** Ator que registrou (para auditoria) */
  registrado_por: string;

  /** Timestamp do registro (fonte: sistema) */
  data_registro: Date;

  /** ID da observação anterior (para follow-ups, null se primeira) */
  observacao_anterior_id?: string;

  /** Notas adicionais (opcional) */
  notas?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT PARA REGISTRO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gatilhos de autonomia para consequência (Inc 19).
 * Campos estruturais opcionais que afetam a autonomia do agente.
 *
 * Defaults defensivos (retrocompatibilidade):
 * - severidade: 'BAIXA'
 * - violou_limites: false
 * - perda_relevante: false
 * - reversivel: true
 */
interface ConsequenceAutonomyTriggers {
  /** Severidade do impacto */
  severidade?: 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

  /** Categoria do impacto */
  categoria?: 'OPERACIONAL' | 'FINANCEIRA' | 'SEGURANCA' | 'LEGAL' | 'REPUTACAO' | 'ETICA' | 'OUTRA';

  /** Se os limites do contrato foram violados */
  violou_limites?: boolean;

  /** Se a consequência é reversível */
  reversivel?: boolean;

  /** Se houve perda financeira/operacional relevante */
  perda_relevante?: boolean;
}

/**
 * Input para registrar uma consequência.
 * O chamador fornece os dados, o sistema adiciona id, timestamps, etc.
 */
interface RegistroConsequenciaInput {
  /** Consequência observada (obrigatório) */
  observada: ConsequenciaObservada;

  /** Consequência percebida (obrigatório) */
  percebida: ConsequenciaPercebida;

  /** Evidências mínimas (deve conter itens da observacao_minima_requerida) */
  evidencias_minimas: string[];

  /** ID de observação anterior (se for follow-up) */
  observacao_anterior_id?: string;

  /** Notas adicionais */
  notas?: string;

  /**
   * Inc 19: Gatilhos de autonomia (opcional).
   * Se fornecidos, a policy de consequência é avaliada após registro.
   */
  autonomyTriggers?: ConsequenceAutonomyTriggers;

  /**
   * Inc 19: ID do agente que executou a ação (opcional).
   * Necessário para aplicar efeitos de autonomia.
   */
  agentId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  SinalImpacto,
  IndicadorObservado,
  AnexoEvidencia,
  ConsequenciaObservada,
  ConsequenciaPercebida,
  ObservacaoDeConsequencia,
  RegistroConsequenciaInput,
  ConsequenceAutonomyTriggers
};
