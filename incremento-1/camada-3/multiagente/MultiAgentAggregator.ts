/**
 * INCREMENTO 16 — MULTIAGENTE: Agregador
 *
 * Funções puras para aplicar políticas de agregação.
 * Todas as políticas são determinísticas (sem ML).
 *
 * POLÍTICAS IMPLEMENTADAS:
 * - FIRST_VALID: primeira decisão válida na ordem dos agentes
 * - MAJORITY_BY_ALTERNATIVE: alternativa mais votada
 * - WEIGHTED_MAJORITY: idem, ponderado por peso
 * - REQUIRE_CONSENSUS: só decide se todos concordam
 * - HUMAN_OVERRIDE_REQUIRED: retorna candidatos sem decisão final
 *
 * TIE-BREAK DETERMINÍSTICO:
 * 1. Alternativa lexicograficamente menor (string compare)
 * 2. Se ainda empatar, ordem estável dos agentes
 */

import {
  AgentProfile,
  AggregationPolicy,
  AgentProposalResult,
  AggregationDecision,
  NoDecisionReason
} from './MultiAgentTypes';

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Filtra apenas resultados válidos (não bloqueados e com alternativa).
 */
function getValidResults(results: AgentProposalResult[]): AgentProposalResult[] {
  return results.filter(r => !r.blocked && r.alternativaEscolhida !== null);
}

/**
 * Obtém o peso de um agente (default 1).
 */
function getAgentWeight(agents: AgentProfile[], agentId: string): number {
  const agent = agents.find(a => a.agentId === agentId);
  return agent?.peso ?? 1;
}

/**
 * Aplica tie-break determinístico:
 * 1. Alternativa lexicograficamente menor
 * 2. Agente que aparece primeiro na lista de resultados
 */
function applyTieBreak(
  candidates: { agentId: string; alternativa: string }[],
  results: AgentProposalResult[]
): { agentId: string; alternativa: string; details: string } {
  if (candidates.length === 0) {
    throw new Error('No candidates for tie-break');
  }

  if (candidates.length === 1) {
    return {
      agentId: candidates[0].agentId,
      alternativa: candidates[0].alternativa,
      details: 'No tie-break needed (single candidate)'
    };
  }

  // Ordenar por alternativa lexicograficamente
  const sorted = [...candidates].sort((a, b) =>
    a.alternativa.localeCompare(b.alternativa)
  );

  const minAlternativa = sorted[0].alternativa;
  const withMinAlternativa = sorted.filter(c => c.alternativa === minAlternativa);

  if (withMinAlternativa.length === 1) {
    return {
      agentId: withMinAlternativa[0].agentId,
      alternativa: withMinAlternativa[0].alternativa,
      details: `Tie-break by lexicographic order: "${minAlternativa}"`
    };
  }

  // Ainda empate: usar ordem dos agentes nos resultados
  const agentOrder = results.map(r => r.agentId);
  const firstByOrder = withMinAlternativa.sort((a, b) =>
    agentOrder.indexOf(a.agentId) - agentOrder.indexOf(b.agentId)
  )[0];

  return {
    agentId: firstByOrder.agentId,
    alternativa: firstByOrder.alternativa,
    details: `Tie-break by agent order: "${firstByOrder.agentId}" comes first`
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA: FIRST_VALID
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retorna a primeira decisão válida na ordem dos agentes.
 */
function aggregateFirstValid(
  results: AgentProposalResult[]
): AggregationDecision {
  const valid = getValidResults(results);

  if (valid.length === 0) {
    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'ALL_AGENTS_BLOCKED'
    };
  }

  // Primeiro válido na ordem
  const first = valid[0];
  return {
    decided: true,
    selectedAgentId: first.agentId,
    alternativaFinal: first.alternativaEscolhida,
    noDecisionReason: null
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA: MAJORITY_BY_ALTERNATIVE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retorna a alternativa mais votada (cada agente = 1 voto).
 */
function aggregateMajorityByAlternative(
  results: AgentProposalResult[]
): AggregationDecision {
  const valid = getValidResults(results);

  if (valid.length === 0) {
    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'ALL_AGENTS_BLOCKED'
    };
  }

  // Contar votos por alternativa
  const votes: Record<string, number> = {};
  for (const r of valid) {
    const alt = r.alternativaEscolhida!;
    votes[alt] = (votes[alt] ?? 0) + 1;
  }

  // Encontrar máximo
  const maxVotes = Math.max(...Object.values(votes));
  const winners = Object.entries(votes)
    .filter(([, count]) => count === maxVotes)
    .map(([alt]) => alt);

  // Se empate, aplicar tie-break
  const candidates = valid
    .filter(r => winners.includes(r.alternativaEscolhida!))
    .map(r => ({ agentId: r.agentId, alternativa: r.alternativaEscolhida! }));

  const tieBreak = applyTieBreak(candidates, results);

  return {
    decided: true,
    selectedAgentId: tieBreak.agentId,
    alternativaFinal: tieBreak.alternativa,
    noDecisionReason: null,
    tieBreakDetails: winners.length > 1 ? tieBreak.details : undefined,
    votesByAlternative: votes
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA: WEIGHTED_MAJORITY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retorna a alternativa mais votada, ponderada por peso dos agentes.
 */
function aggregateWeightedMajority(
  results: AgentProposalResult[],
  agents: AgentProfile[]
): AggregationDecision {
  const valid = getValidResults(results);

  if (valid.length === 0) {
    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'ALL_AGENTS_BLOCKED'
    };
  }

  // Contar votos ponderados por alternativa
  const votes: Record<string, number> = {};
  for (const r of valid) {
    const alt = r.alternativaEscolhida!;
    const weight = getAgentWeight(agents, r.agentId);
    votes[alt] = (votes[alt] ?? 0) + weight;
  }

  // Encontrar máximo
  const maxVotes = Math.max(...Object.values(votes));
  const winners = Object.entries(votes)
    .filter(([, count]) => count === maxVotes)
    .map(([alt]) => alt);

  // Se empate, aplicar tie-break
  const candidates = valid
    .filter(r => winners.includes(r.alternativaEscolhida!))
    .map(r => ({ agentId: r.agentId, alternativa: r.alternativaEscolhida! }));

  const tieBreak = applyTieBreak(candidates, results);

  return {
    decided: true,
    selectedAgentId: tieBreak.agentId,
    alternativaFinal: tieBreak.alternativa,
    noDecisionReason: null,
    tieBreakDetails: winners.length > 1 ? tieBreak.details : undefined,
    votesByAlternative: votes
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA: REQUIRE_CONSENSUS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Só decide se todos os agentes válidos escolhem a mesma alternativa.
 */
function aggregateRequireConsensus(
  results: AgentProposalResult[]
): AggregationDecision {
  const valid = getValidResults(results);

  if (valid.length === 0) {
    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'ALL_AGENTS_BLOCKED'
    };
  }

  // Verificar se todos escolheram a mesma alternativa
  const alternativas = new Set(valid.map(r => r.alternativaEscolhida));

  if (alternativas.size !== 1) {
    // Divergência - não há consenso
    const votes: Record<string, number> = {};
    for (const r of valid) {
      const alt = r.alternativaEscolhida!;
      votes[alt] = (votes[alt] ?? 0) + 1;
    }

    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'NO_CONSENSUS',
      votesByAlternative: votes
    };
  }

  // Consenso alcançado - usar primeiro agente
  const first = valid[0];
  return {
    decided: true,
    selectedAgentId: first.agentId,
    alternativaFinal: first.alternativaEscolhida,
    noDecisionReason: null
  };
}

// ════════════════════════════════════════════════════════════════════════════
// POLÍTICA: HUMAN_OVERRIDE_REQUIRED
// ════════════════════════════════════════════════════════════════════════════

/**
 * Sempre retorna candidatos sem decisão final (modo supervisão).
 */
function aggregateHumanOverrideRequired(
  results: AgentProposalResult[]
): AggregationDecision {
  const valid = getValidResults(results);

  // Coletar votos para informação
  const votes: Record<string, number> = {};
  for (const r of valid) {
    const alt = r.alternativaEscolhida!;
    votes[alt] = (votes[alt] ?? 0) + 1;
  }

  return {
    decided: false,
    selectedAgentId: null,
    alternativaFinal: null,
    noDecisionReason: 'HUMAN_OVERRIDE_PENDING',
    votesByAlternative: Object.keys(votes).length > 0 ? votes : undefined
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL DE AGREGAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aplica a política de agregação aos resultados dos agentes.
 *
 * @param policy - Política de agregação
 * @param results - Resultados dos agentes
 * @param agents - Perfis dos agentes (para pesos)
 * @returns Decisão de agregação
 */
function aggregate(
  policy: AggregationPolicy,
  results: AgentProposalResult[],
  agents: AgentProfile[]
): AggregationDecision {
  // Validar que temos resultados
  if (results.length === 0) {
    return {
      decided: false,
      selectedAgentId: null,
      alternativaFinal: null,
      noDecisionReason: 'NO_VALID_AGENTS'
    };
  }

  switch (policy) {
    case 'FIRST_VALID':
      return aggregateFirstValid(results);

    case 'MAJORITY_BY_ALTERNATIVE':
      return aggregateMajorityByAlternative(results);

    case 'WEIGHTED_MAJORITY':
      return aggregateWeightedMajority(results, agents);

    case 'REQUIRE_CONSENSUS':
      return aggregateRequireConsensus(results);

    case 'HUMAN_OVERRIDE_REQUIRED':
      return aggregateHumanOverrideRequired(results);

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = policy;
      return {
        decided: false,
        selectedAgentId: null,
        alternativaFinal: null,
        noDecisionReason: 'AGGREGATION_FAILED'
      };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  aggregate,
  aggregateFirstValid,
  aggregateMajorityByAlternative,
  aggregateWeightedMajority,
  aggregateRequireConsensus,
  aggregateHumanOverrideRequired,
  getValidResults,
  applyTieBreak
};
