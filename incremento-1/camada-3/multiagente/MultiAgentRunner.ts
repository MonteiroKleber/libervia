/**
 * INCREMENTO 16 — MULTIAGENTE: Runner
 *
 * Coordena a execução multiagente:
 * 1. Cria episódio único para a situação
 * 2. Para cada agente habilitado:
 *    - Valida Closed Layer
 *    - Constrói protocolo candidato
 *    - Registra decisão candidata (se não bloqueado)
 * 3. Aplica agregação
 * 4. Emite contrato final (se agregação decidiu)
 * 5. Registra eventos de auditoria
 *
 * PRINCÍPIOS:
 * - Reutiliza métodos existentes do OrquestradorCognitivo
 * - NÃO duplica lógica
 * - Closed Layer é soberana (valida antes de cada proposta)
 * - Um episódio por situação (não fragmentar vivência)
 */

import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisionProtocol,
  DecisaoInstitucional,
  ContratoDeDecisao,
  DadosProtocoloInput,
  StatusSituacao,
  EstadoEpisodio,
  EstadoProtocolo,
  Limite
} from '../entidades/tipos';
import { ActorId, TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';
import { EventLogRepository } from '../event-log/EventLogRepository';
import { validateClosedLayer, ClosedLayerResult } from '../camada-fechada';
import { SituacaoRepository } from '../repositorios/interfaces/SituacaoRepository';
import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import { DecisionProtocolRepository } from '../repositorios/interfaces/DecisionProtocolRepository';
import { aggregate } from './MultiAgentAggregator';
import {
  AgentProfile,
  AggregationPolicy,
  MultiAgentRunInput,
  AgentProposalResult,
  MultiAgentRunResult,
  AggregationDecision,
  MultiAgentError
} from './MultiAgentTypes';

// ════════════════════════════════════════════════════════════════════════════
// CONTEXTO DE EXECUÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Contexto necessário para execução do MultiAgentRunner.
 * Evita acoplamento direto com OrquestradorCognitivo.
 */
interface MultiAgentContext {
  situacaoRepo: SituacaoRepository;
  episodioRepo: EpisodioRepository;
  decisaoRepo: DecisaoRepository;
  contratoRepo: ContratoRepository;
  protocoloRepo: DecisionProtocolRepository;
  eventLog?: EventLogRepository;
  gerarId: () => string;
}

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Executa fluxo multiagente completo.
 *
 * @param situacao - Situação decisória a processar
 * @param input - Configuração do multiagente (agentes, política, dados base)
 * @param context - Contexto de repositórios e dependências
 * @param options - Opções adicionais (actor, emitidoPara)
 * @returns Resultado completo da execução multiagente
 */
async function runMultiAgent(
  situacao: SituacaoDecisoria,
  input: MultiAgentRunInput,
  context: MultiAgentContext,
  options?: { actor?: ActorId; emitidoPara?: string }
): Promise<MultiAgentRunResult> {
  const actor = options?.actor ?? 'Libervia';
  const emitidoPara = options?.emitidoPara ?? 'external';
  const runId = context.gerarId();
  const startedAt = new Date();

  // ══════════════════════════════════════════════════════════════════════════
  // VALIDAÇÃO INICIAL
  // ══════════════════════════════════════════════════════════════════════════

  const enabledAgents = input.agents.filter(a => a.enabled !== false);

  if (enabledAgents.length === 0) {
    throw new MultiAgentError(
      'Nenhum agente habilitado para execução',
      'NO_ENABLED_AGENTS'
    );
  }

  if (!input.aggregationPolicy) {
    throw new MultiAgentError(
      'aggregationPolicy é obrigatório',
      'MISSING_AGGREGATION_POLICY'
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 1: CRIAR/OBTER SITUAÇÃO E EPISÓDIO
  // ══════════════════════════════════════════════════════════════════════════

  // Garantir que situação existe
  let sit = await context.situacaoRepo.getById(situacao.id);

  if (!sit) {
    await context.situacaoRepo.create(situacao);
    sit = await context.situacaoRepo.getById(situacao.id);

    await logEvent(context, TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, situacao.id, situacao, actor);
  }

  if (!sit) {
    throw new MultiAgentError('Falha ao criar/recuperar situação', 'SITUACAO_CREATE_FAILED');
  }

  // Transicionar situação se necessário
  if (sit.status === StatusSituacao.RASCUNHO) {
    await context.situacaoRepo.updateStatus(sit.id, StatusSituacao.ABERTA);
    sit = await context.situacaoRepo.getById(sit.id);
  }

  if (sit!.status === StatusSituacao.ABERTA) {
    await context.situacaoRepo.updateStatus(sit!.id, StatusSituacao.ACEITA);
    await context.situacaoRepo.updateStatus(sit!.id, StatusSituacao.EM_ANALISE);
    sit = await context.situacaoRepo.getById(sit!.id);
  }

  // Criar episódio único
  const episodio = await criarEpisodio(sit!, context, actor);

  // Log de início do multiagente
  await logEvent(
    context,
    TipoEvento.MULTIAGENT_RUN_STARTED,
    TipoEntidade.MULTIAGENT_RUN,
    runId,
    {
      situacao_id: situacao.id,
      episodio_id: episodio.id,
      agents: enabledAgents.map(a => a.agentId),
      aggregationPolicy: input.aggregationPolicy
    },
    actor
  );

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 2: PROCESSAR CADA AGENTE
  // ══════════════════════════════════════════════════════════════════════════

  const agentResults: AgentProposalResult[] = [];

  for (const agent of enabledAgents) {
    const result = await processAgent(
      agent,
      sit!,
      episodio,
      input,
      context,
      actor
    );
    agentResults.push(result);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 3: AGREGAÇÃO
  // ══════════════════════════════════════════════════════════════════════════

  const aggregation = aggregate(input.aggregationPolicy, agentResults, input.agents);

  // ══════════════════════════════════════════════════════════════════════════
  // FASE 4: EMITIR CONTRATO FINAL (SE DECIDIDO)
  // ══════════════════════════════════════════════════════════════════════════

  let contratoFinal: ContratoDeDecisao | null = null;

  if (aggregation.decided && aggregation.selectedAgentId) {
    const selectedResult = agentResults.find(r => r.agentId === aggregation.selectedAgentId);

    if (selectedResult && selectedResult.decisaoCandidato && !selectedResult.blocked) {
      // Usar a decisão candidata do agente selecionado
      const candidato = selectedResult.decisaoCandidato;

      // Construir decisão final para persistência
      const decisaoFinal: DecisaoInstitucional = {
        id: candidato.id,
        episodio_id: episodio.id,
        alternativa_escolhida: candidato.alternativa_escolhida,
        criterios: candidato.criterios,
        limites: candidato.limites,
        condicoes: candidato.condicoes,
        perfil_risco: candidato.perfil_risco,
        data_decisao: new Date()
      };

      // Agora sim, persistir APENAS a decisão do agente selecionado
      await context.decisaoRepo.create(decisaoFinal);

      // Log da decisão registrada
      await logEvent(
        context,
        TipoEvento.DECISAO_REGISTRADA,
        TipoEntidade.DECISAO,
        decisaoFinal.id,
        decisaoFinal,
        actor
      );

      contratoFinal = await emitirContratoFinal(episodio.id, decisaoFinal, emitidoPara, context, actor);

      // Atualizar estado do episódio e situação
      await context.episodioRepo.updateEstado(episodio.id, EstadoEpisodio.DECIDIDO);
      await context.situacaoRepo.updateStatus(sit!.id, StatusSituacao.DECIDIDA);

      // Log de agregação selecionada
      await logEvent(
        context,
        TipoEvento.MULTIAGENT_AGGREGATION_SELECTED,
        TipoEntidade.MULTIAGENT_RUN,
        runId,
        {
          selectedAgentId: aggregation.selectedAgentId,
          alternativaFinal: aggregation.alternativaFinal,
          contratoId: contratoFinal.id,
          aggregationPolicy: input.aggregationPolicy,
          votesByAlternative: aggregation.votesByAlternative,
          tieBreakDetails: aggregation.tieBreakDetails
        },
        actor
      );
    }
  } else {
    // Nenhuma decisão tomada
    await logEvent(
      context,
      TipoEvento.MULTIAGENT_NO_DECISION,
      TipoEntidade.MULTIAGENT_RUN,
      runId,
      {
        reason: aggregation.noDecisionReason,
        aggregationPolicy: input.aggregationPolicy,
        votesByAlternative: aggregation.votesByAlternative,
        blockedAgents: agentResults.filter(r => r.blocked).map(r => r.agentId)
      },
      actor
    );
  }

  const finishedAt = new Date();

  return {
    runId,
    episodioId: episodio.id,
    aggregationPolicy: input.aggregationPolicy,
    agentResults,
    aggregation,
    contratoFinal,
    startedAt,
    finishedAt
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ════════════════════════════════════════════════════════════════════════════

async function criarEpisodio(
  situacao: SituacaoDecisoria,
  context: MultiAgentContext,
  actor: ActorId
): Promise<EpisodioDecisao> {
  const episodio: EpisodioDecisao = {
    id: context.gerarId(),
    caso_uso: situacao.caso_uso_declarado,
    dominio: situacao.dominio,
    estado: EstadoEpisodio.CRIADO,
    situacao_referenciada: situacao.id,
    data_criacao: new Date(),
    data_decisao: null,
    data_observacao_iniciada: null,
    data_encerramento: null
  };

  await context.episodioRepo.create(episodio);
  await logEvent(context, TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, episodio.id, episodio, actor);

  return episodio;
}

async function processAgent(
  agent: AgentProfile,
  situacao: SituacaoDecisoria,
  episodio: EpisodioDecisao,
  input: MultiAgentRunInput,
  context: MultiAgentContext,
  actor: ActorId
): Promise<AgentProposalResult> {
  // Construir protocolo para este agente
  const protocoloData: DadosProtocoloInput = {
    criterios_minimos: input.protocoloBase.criterios_minimos,
    riscos_considerados: input.protocoloBase.riscos_considerados,
    limites_definidos: input.protocoloBase.limites_definidos,
    perfil_risco: agent.perfilRisco, // Usa perfil do agente
    alternativas_avaliadas: input.protocoloBase.alternativas_avaliadas,
    alternativa_escolhida: selectAlternativeForAgent(agent, input.protocoloBase.alternativas_avaliadas)
  };

  // Criar protocolo candidato
  const protocolo = await criarProtocoloCandidato(
    episodio.id,
    protocoloData,
    context,
    agent.agentId
  );

  // Validar Closed Layer
  const closedLayerResult = validateClosedLayer(situacao, protocolo);

  // Log do protocolo proposto
  await logEvent(
    context,
    TipoEvento.AGENT_PROTOCOL_PROPOSED,
    TipoEntidade.PROTOCOLO,
    protocolo.id,
    {
      agentId: agent.agentId,
      perfilRisco: agent.perfilRisco,
      alternativaEscolhida: protocoloData.alternativa_escolhida,
      blocked: closedLayerResult.blocked,
      blockRule: closedLayerResult.rule || undefined
    },
    actor
  );

  if (closedLayerResult.blocked) {
    // Agente bloqueado pela Closed Layer
    return {
      agentId: agent.agentId,
      perfilRisco: agent.perfilRisco,
      closedLayerResult,
      blocked: true,
      protocolo,
      alternativaEscolhida: null,
      decisaoId: null,
      contratoCandidato: null
    };
  }

  // Criar decisão candidata (em memória, não persistida)
  const decisao = criarDecisaoCandidato(
    episodio.id,
    protocoloData.alternativa_escolhida,
    input.decisaoBase,
    agent.perfilRisco,
    context
  );

  // Log da decisão proposta
  await logEvent(
    context,
    TipoEvento.AGENT_DECISION_PROPOSED,
    TipoEntidade.DECISAO,
    decisao.id,
    {
      agentId: agent.agentId,
      perfilRisco: agent.perfilRisco,
      alternativaEscolhida: decisao.alternativa_escolhida
    },
    actor
  );

  // Criar contrato candidato (não emitido como final ainda)
  const contratoCandidato = criarContratoCandidato(episodio.id, decisao, context);

  return {
    agentId: agent.agentId,
    perfilRisco: agent.perfilRisco,
    closedLayerResult,
    blocked: false,
    protocolo,
    alternativaEscolhida: decisao.alternativa_escolhida,
    decisaoId: decisao.id,
    decisaoCandidato: {
      id: decisao.id,
      alternativa_escolhida: decisao.alternativa_escolhida,
      criterios: decisao.criterios,
      limites: decisao.limites,
      condicoes: decisao.condicoes,
      perfil_risco: decisao.perfil_risco
    },
    contratoCandidato
  };
}

/**
 * Seleciona alternativa baseada no perfil do agente.
 * Lógica determinística: perfis diferentes podem escolher alternativas diferentes.
 *
 * REGRA SIMPLES (determinística):
 * - CONSERVADOR: primeira alternativa (mais segura por convenção)
 * - MODERADO: alternativa do meio
 * - AGRESSIVO: última alternativa (mais arrojada por convenção)
 */
function selectAlternativeForAgent(
  agent: AgentProfile,
  alternativas: string[]
): string {
  if (alternativas.length === 0) {
    return '';
  }

  if (alternativas.length === 1) {
    return alternativas[0];
  }

  const { perfilRisco } = agent;

  switch (perfilRisco) {
    case 'CONSERVADOR':
      return alternativas[0];
    case 'MODERADO':
      return alternativas[Math.floor(alternativas.length / 2)];
    case 'AGRESSIVO':
      return alternativas[alternativas.length - 1];
    default:
      return alternativas[0];
  }
}

async function criarProtocoloCandidato(
  episodioId: string,
  dados: DadosProtocoloInput,
  context: MultiAgentContext,
  agentId: string
): Promise<DecisionProtocol> {
  const protocolo: DecisionProtocol = {
    id: context.gerarId(),
    episodio_id: episodioId,
    criterios_minimos: dados.criterios_minimos,
    riscos_considerados: dados.riscos_considerados,
    limites_definidos: dados.limites_definidos,
    perfil_risco: dados.perfil_risco,
    alternativas_avaliadas: dados.alternativas_avaliadas,
    alternativa_escolhida: dados.alternativa_escolhida,
    memoria_consultada_ids: dados.memoria_consultada_ids ?? [],
    anexos_utilizados_ids: [],
    estado: EstadoProtocolo.VALIDADO, // Assumido válido para multiagente
    validado_em: new Date(),
    validado_por: 'Libervia'
  };

  // Nota: Não persistimos no protocoloRepo para evitar conflitos
  // O protocolo é mantido apenas em memória para o fluxo multiagente
  // Apenas o protocolo do agente selecionado será persistido (via contrato final)

  return protocolo;
}

function criarDecisaoCandidato(
  episodioId: string,
  alternativaEscolhida: string,
  decisaoBase: { criterios: string[]; limites: Limite[]; condicoes: string[] },
  perfilRisco: string,
  context: MultiAgentContext
): DecisaoInstitucional {
  // Decisão candidata - NÃO persistida ainda
  // Apenas a decisão do agente selecionado será persistida ao final
  const decisao: DecisaoInstitucional = {
    id: context.gerarId(),
    episodio_id: episodioId,
    alternativa_escolhida: alternativaEscolhida,
    criterios: decisaoBase.criterios,
    perfil_risco: perfilRisco as any,
    limites: decisaoBase.limites,
    condicoes: decisaoBase.condicoes,
    data_decisao: new Date()
  };

  return decisao;
}

function criarContratoCandidato(
  episodioId: string,
  decisao: DecisaoInstitucional,
  context: MultiAgentContext
): ContratoDeDecisao {
  // Contrato candidato - não persistido ainda
  return {
    id: context.gerarId(),
    episodio_id: episodioId,
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
    data_emissao: new Date(),
    emitido_para: 'pending' // Será atualizado na emissão final
  };
}

async function emitirContratoFinal(
  episodioId: string,
  decisao: DecisaoInstitucional,
  emitidoPara: string,
  context: MultiAgentContext,
  actor: ActorId
): Promise<ContratoDeDecisao> {
  const contrato: ContratoDeDecisao = {
    id: context.gerarId(),
    episodio_id: episodioId,
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
    data_emissao: new Date(),
    emitido_para: emitidoPara
  };

  await context.contratoRepo.create(contrato);
  await logEvent(context, TipoEvento.CONTRATO_EMITIDO, TipoEntidade.CONTRATO, contrato.id, contrato, actor);

  return contrato;
}

async function logEvent(
  context: MultiAgentContext,
  evento: string,
  entidade: string,
  entidadeId: string,
  payload: unknown,
  actor: ActorId
): Promise<void> {
  if (!context.eventLog) return;

  try {
    await context.eventLog.append(actor, evento, entidade, entidadeId, payload);
  } catch (error) {
    // Log falhou, mas não bloqueia operação
    console.error('[MultiAgent] Falha ao registrar evento:', evento, error);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  runMultiAgent,
  MultiAgentContext,
  selectAlternativeForAgent
};
