/**
 * INCREMENTO 17 + 18 + 19 — AUTONOMIA GRADUADA: Avaliador de Autonomia
 *
 * Implementa as regras canônicas de avaliação de autonomia.
 *
 * ORDEM DE VERIFICAÇÃO (Inc 18 + 19):
 * 1. Closed Layer (se bloqueado, para tudo) - REGRA 5
 * 2. requestedMode sem mandato (Ajuste A do Inc 17)
 * 3. Mandato suspenso por consequência - REGRA 6 (Inc 19)
 * 4. Mandato ainda não ativo (validFrom) - NOVO Inc 18
 * 5. Mandato expirado por tempo (validUntil) - NOVO Inc 18
 * 6. Mandato esgotado por usos (maxUses) - NOVO Inc 18
 * 7. ENSINO nunca decide - REGRA 1
 * 8. Mandato obrigatório fora do ensino - REGRA 2
 * 9. Mandato revogado - REGRA 2
 * 10. Mandato expirado (valido_ate legado) - REGRA 2
 * 11. Política autorizada - REGRA 3
 * 12. Perfil risco máximo - REGRA 4
 * 13. Verificações adicionais (domínio, caso de uso, gatilhos)
 *
 * Inc 19: Mandato suspenso exige revisão humana para retomada.
 *
 * PRINCÍPIOS:
 * - Função pura (sem side effects)
 * - Determinística
 * - Auditável (retorna motivo claro)
 */

import {
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  AutonomyCheckResult,
  MandateExpireReason,
  perfilExcede
} from './AutonomyTypes';

import { isMandateActive, MANDATE_RULE } from './AutonomyMandateService';

// ════════════════════════════════════════════════════════════════════════════
// CÓDIGOS DE REGRA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Códigos de regras de bloqueio.
 */
const REGRA = {
  // Regras Inc 17
  ENSINO_SEMPRE_BLOQUEIA: 'REGRA_1_ENSINO_SEMPRE_BLOQUEIA',
  MANDATO_OBRIGATORIO: 'REGRA_2_MANDATO_OBRIGATORIO',
  MANDATO_EXPIRADO: 'REGRA_2_MANDATO_EXPIRADO',
  MANDATO_REVOGADO: 'REGRA_2_MANDATO_REVOGADO',
  POLITICA_NAO_AUTORIZADA: 'REGRA_3_POLITICA_NAO_AUTORIZADA',
  PERFIL_EXCEDE_MAXIMO: 'REGRA_4_PERFIL_EXCEDE_MAXIMO',
  CLOSED_LAYER_BLOQUEOU: 'REGRA_5_CLOSED_LAYER_BLOQUEOU',
  DOMINIO_NAO_AUTORIZADO: 'DOMINIO_NAO_AUTORIZADO',
  CASO_USO_NAO_AUTORIZADO: 'CASO_USO_NAO_AUTORIZADO',
  GATILHO_HUMANO_ACIONADO: 'GATILHO_HUMANO_ACIONADO',
  MODO_SOLICITADO_SEM_MANDATO: 'MODO_SOLICITADO_SEM_MANDATO',

  // Regras Inc 18 - Validade Temporal e Limite de Usos
  MANDATO_NAO_ATIVO_AINDA: MANDATE_RULE.NOT_ACTIVE_YET,
  MANDATO_EXPIRADO_TEMPO: MANDATE_RULE.EXPIRED_TIME,
  MANDATO_ESGOTADO_USOS: MANDATE_RULE.EXHAUSTED_USES,

  // Regra Inc 19 - Suspensão por Consequência
  MANDATO_SUSPENSO: 'REGRA_6_MANDATO_SUSPENSO'
} as const;

// ════════════════════════════════════════════════════════════════════════════
// RESULTADO ESTENDIDO (Inc 18 + 19)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado estendido com informações de expiração e suspensão.
 */
interface AutonomyCheckResultExtended extends AutonomyCheckResult {
  /** Se o mandato precisa ser marcado como expirado */
  shouldExpire?: boolean;
  /** Motivo da expiração */
  expireReason?: MandateExpireReason;
  /** Inc 19: Se exige revisão humana para retomada */
  requiresHumanReview?: boolean;
  /** Inc 19: ID da observação que causou suspensão */
  triggeredByObservacaoId?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// AVALIADOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Avalia se a autonomia é permitida para a decisão.
 *
 * @param input - Input de avaliação
 * @returns Resultado da avaliação (estendido com info de expiração)
 */
function evaluate(input: AutonomyCheckInput): AutonomyCheckResultExtended {
  const { agentId, policy, perfilRisco, closedLayerBlocked, mandate, dominio, casoUso, contexto, requestedMode, now } = input;

  // Data atual para avaliação (permite testes determinísticos)
  const currentTime = now ?? new Date();

  // Determinar modo de autonomia
  const modo = mandate?.modo ?? AutonomyMode.ENSINO;

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 5: Camada Fechada sempre vence (verificar primeiro)
  // ══════════════════════════════════════════════════════════════════════════
  if (closedLayerBlocked) {
    return {
      permitido: false,
      modo,
      motivo: `Camada Fechada bloqueou agente ${agentId}`,
      mandato_id: mandate?.id,
      regra_bloqueio: REGRA.CLOSED_LAYER_BLOQUEOU
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DE MODO SOLICITADO (antes da Regra 1)
  // Se chamador pediu VIVENCIA_* mas não tem mandato válido, falha explicitamente
  // ══════════════════════════════════════════════════════════════════════════
  if (requestedMode && requestedMode !== AutonomyMode.ENSINO) {
    // Chamador solicitou modo de vivência - mandato é obrigatório
    if (!mandate) {
      return {
        permitido: false,
        modo: requestedMode,
        motivo: `Modo ${requestedMode} solicitado mas nenhum mandato foi fornecido para agente ${agentId}`,
        regra_bloqueio: REGRA.MODO_SOLICITADO_SEM_MANDATO
      };
    }

    // Verificar validade do mandato com regras Inc 18
    const activityCheck = isMandateActive(mandate, currentTime);
    if (!activityCheck.ok) {
      return {
        permitido: false,
        modo: requestedMode,
        motivo: `Modo ${requestedMode} solicitado mas ${activityCheck.reason}`,
        mandato_id: mandate.id,
        regra_bloqueio: activityCheck.code ?? REGRA.MANDATO_EXPIRADO,
        shouldExpire: !!activityCheck.expireReason,
        expireReason: activityCheck.expireReason
      };
    }

    // Mandato existe e é válido, mas é de modo inferior ao solicitado
    if (requestedMode === AutonomyMode.VIVENCIA_AUTONOMA && mandate.modo !== AutonomyMode.VIVENCIA_AUTONOMA) {
      return {
        permitido: false,
        modo: mandate.modo,
        motivo: `Modo ${requestedMode} solicitado mas mandato ${mandate.id} só autoriza ${mandate.modo}`,
        mandato_id: mandate.id,
        regra_bloqueio: REGRA.MODO_SOLICITADO_SEM_MANDATO
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 6 (Inc 19): Mandato suspenso por consequência
  // Suspensão exige revisão humana para retomada
  // ══════════════════════════════════════════════════════════════════════════
  if (mandate && mandate.status === 'suspended') {
    return {
      permitido: false,
      modo,
      motivo: `Mandato ${mandate.id} está suspenso${mandate.suspendReason ? `: ${mandate.suspendReason}` : ''}. Revisão humana obrigatória.`,
      mandato_id: mandate.id,
      regra_bloqueio: REGRA.MANDATO_SUSPENSO,
      requiresHumanReview: true,
      triggeredByObservacaoId: mandate.triggeredByObservacaoId
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRAS INC 18: Validade Temporal e Limite de Usos
  // Verificar ANTES da Regra 1 para detectar expiração mesmo sem mandato ativo
  // ══════════════════════════════════════════════════════════════════════════
  if (mandate) {
    const activityCheck = isMandateActive(mandate, currentTime);
    if (!activityCheck.ok) {
      // Inc 19: Verificar se é suspensão (já tratado acima, mas por segurança)
      const isSuspended = activityCheck.code === MANDATE_RULE.ALREADY_SUSPENDED;
      return {
        permitido: false,
        modo,
        motivo: activityCheck.reason!,
        mandato_id: mandate.id,
        regra_bloqueio: isSuspended ? REGRA.MANDATO_SUSPENSO : (activityCheck.code ?? REGRA.MANDATO_EXPIRADO),
        shouldExpire: !!activityCheck.expireReason,
        expireReason: activityCheck.expireReason,
        requiresHumanReview: isSuspended ? true : undefined,
        triggeredByObservacaoId: isSuspended ? mandate.triggeredByObservacaoId : undefined
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 1: Ensino nunca decide
  // ══════════════════════════════════════════════════════════════════════════
  if (modo === AutonomyMode.ENSINO) {
    return {
      permitido: false,
      modo: AutonomyMode.ENSINO,
      motivo: `Modo ENSINO: decisão requer supervisão humana`,
      regra_bloqueio: REGRA.ENSINO_SEMPRE_BLOQUEIA
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 2: Mandato é obrigatório fora do ensino
  // ══════════════════════════════════════════════════════════════════════════
  if (!mandate) {
    return {
      permitido: false,
      modo,
      motivo: `Mandato obrigatório para agente ${agentId} no modo ${modo}`,
      regra_bloqueio: REGRA.MANDATO_OBRIGATORIO
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 3: Política precisa estar autorizada
  // ══════════════════════════════════════════════════════════════════════════
  if (!mandate.politicas_permitidas.includes(policy)) {
    return {
      permitido: false,
      modo,
      motivo: `Política ${policy} não autorizada no mandato ${mandate.id}`,
      mandato_id: mandate.id,
      regra_bloqueio: REGRA.POLITICA_NAO_AUTORIZADA
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGRA 4: Perfil de risco não pode exceder
  // ══════════════════════════════════════════════════════════════════════════
  if (perfilExcede(perfilRisco, mandate.perfil_risco_maximo)) {
    return {
      permitido: false,
      modo,
      motivo: `Perfil de risco ${perfilRisco} excede máximo permitido ${mandate.perfil_risco_maximo}`,
      mandato_id: mandate.id,
      regra_bloqueio: REGRA.PERFIL_EXCEDE_MAXIMO
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERIFICAÇÕES ADICIONAIS DO MANDATO
  // ══════════════════════════════════════════════════════════════════════════

  // Verificar domínio autorizado (se restrição existe)
  if (dominio && mandate.dominios_permitidos && mandate.dominios_permitidos.length > 0) {
    if (!mandate.dominios_permitidos.includes(dominio)) {
      return {
        permitido: false,
        modo,
        motivo: `Domínio ${dominio} não autorizado no mandato ${mandate.id}`,
        mandato_id: mandate.id,
        regra_bloqueio: REGRA.DOMINIO_NAO_AUTORIZADO
      };
    }
  }

  // Verificar caso de uso autorizado (se restrição existe)
  if (casoUso !== undefined && mandate.casos_uso_permitidos && mandate.casos_uso_permitidos.length > 0) {
    if (!mandate.casos_uso_permitidos.includes(casoUso)) {
      return {
        permitido: false,
        modo,
        motivo: `Caso de uso ${casoUso} não autorizado no mandato ${mandate.id}`,
        mandato_id: mandate.id,
        regra_bloqueio: REGRA.CASO_USO_NAO_AUTORIZADO
      };
    }
  }

  // Verificar gatilhos textuais de supervisão humana
  if (contexto && mandate.requer_humano_se && mandate.requer_humano_se.length > 0) {
    const contextoLower = contexto.toLowerCase();
    for (const gatilho of mandate.requer_humano_se) {
      if (contextoLower.includes(gatilho.toLowerCase())) {
        return {
          permitido: false,
          modo,
          motivo: `Gatilho de supervisão humana acionado: "${gatilho}"`,
          mandato_id: mandate.id,
          regra_bloqueio: REGRA.GATILHO_HUMANO_ACIONADO
        };
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUTONOMIA PERMITIDA
  // ══════════════════════════════════════════════════════════════════════════
  return {
    permitido: true,
    modo,
    mandato_id: mandate.id
  };
}

/**
 * Verifica se um mandato está válido (não revogado e não expirado).
 * Considera campos Inc 17 e Inc 18.
 */
function isMandateValid(mandate: AutonomyMandate, now: Date = new Date()): boolean {
  const activityCheck = isMandateActive(mandate, now);
  return activityCheck.ok;
}

/**
 * Obtém o modo de autonomia efetivo para um agente.
 * Retorna ENSINO se não houver mandato válido.
 */
function getEffectiveMode(mandate?: AutonomyMandate, now: Date = new Date()): AutonomyMode {
  if (!mandate) {
    return AutonomyMode.ENSINO;
  }

  if (!isMandateValid(mandate, now)) {
    return AutonomyMode.ENSINO;
  }

  return mandate.modo;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  evaluate,
  isMandateValid,
  getEffectiveMode,
  REGRA,
  AutonomyCheckResultExtended
};
