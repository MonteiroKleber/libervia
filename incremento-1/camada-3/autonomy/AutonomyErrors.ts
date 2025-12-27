/**
 * INCREMENTO 17 — AUTONOMIA GRADUADA: Erros
 *
 * Erros específicos do módulo de autonomia.
 */

import { AutonomyMode } from './AutonomyTypes';

// ════════════════════════════════════════════════════════════════════════════
// ERRO BASE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Erro base para o módulo de autonomia.
 */
class AutonomyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AutonomyError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ERROS ESPECÍFICOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Erro quando intervenção humana é requerida.
 * Usado quando a autonomia é bloqueada e um humano deve decidir.
 */
class HumanOverrideRequiredError extends AutonomyError {
  constructor(
    motivo: string,
    public readonly modo: AutonomyMode,
    public readonly agentId?: string,
    public readonly mandateId?: string
  ) {
    super(
      `Intervenção humana requerida: ${motivo}`,
      'HUMAN_OVERRIDE_REQUIRED',
      { motivo, modo, agentId, mandateId }
    );
    this.name = 'HumanOverrideRequiredError';
  }
}

/**
 * Erro quando o modo é ENSINO (sempre bloqueia).
 */
class EnsinoModeBlockedError extends AutonomyError {
  constructor(agentId: string) {
    super(
      `Modo ENSINO ativo para agente ${agentId}: decisão requer supervisão humana`,
      'ENSINO_MODE_BLOCKED',
      { agentId }
    );
    this.name = 'EnsinoModeBlockedError';
  }
}

/**
 * Erro quando não existe mandato válido.
 */
class MandateRequiredError extends AutonomyError {
  constructor(agentId: string, modo: AutonomyMode) {
    super(
      `Mandato obrigatório para agente ${agentId} no modo ${modo}`,
      'MANDATE_REQUIRED',
      { agentId, modo }
    );
    this.name = 'MandateRequiredError';
  }
}

/**
 * Erro quando mandato expirou.
 */
class MandateExpiredError extends AutonomyError {
  constructor(mandateId: string, validoAte: Date) {
    super(
      `Mandato ${mandateId} expirou em ${validoAte.toISOString()}`,
      'MANDATE_EXPIRED',
      { mandateId, validoAte: validoAte.toISOString() }
    );
    this.name = 'MandateExpiredError';
  }
}

/**
 * Erro quando mandato foi revogado.
 */
class MandateRevokedError extends AutonomyError {
  constructor(mandateId: string, motivo?: string) {
    super(
      `Mandato ${mandateId} foi revogado${motivo ? `: ${motivo}` : ''}`,
      'MANDATE_REVOKED',
      { mandateId, motivo }
    );
    this.name = 'MandateRevokedError';
  }
}

/**
 * Erro quando política não está autorizada no mandato.
 */
class PolicyNotAuthorizedError extends AutonomyError {
  constructor(
    policy: string,
    mandateId: string,
    politicasPermitidas: string[]
  ) {
    super(
      `Política ${policy} não autorizada no mandato ${mandateId}`,
      'POLICY_NOT_AUTHORIZED',
      { policy, mandateId, politicasPermitidas }
    );
    this.name = 'PolicyNotAuthorizedError';
  }
}

/**
 * Erro quando perfil de risco excede o permitido.
 */
class RiskProfileExceededError extends AutonomyError {
  constructor(
    perfilAtual: string,
    perfilMaximo: string,
    mandateId: string
  ) {
    super(
      `Perfil de risco ${perfilAtual} excede máximo permitido ${perfilMaximo}`,
      'RISK_PROFILE_EXCEEDED',
      { perfilAtual, perfilMaximo, mandateId }
    );
    this.name = 'RiskProfileExceededError';
  }
}

/**
 * Erro quando Camada Fechada bloqueou (sempre vence).
 */
class ClosedLayerBlockedError extends AutonomyError {
  constructor(agentId: string) {
    super(
      `Camada Fechada bloqueou agente ${agentId}: autonomia negada`,
      'CLOSED_LAYER_BLOCKED',
      { agentId }
    );
    this.name = 'ClosedLayerBlockedError';
  }
}

/**
 * Erro quando domínio não está autorizado.
 */
class DomainNotAuthorizedError extends AutonomyError {
  constructor(
    dominio: string,
    mandateId: string,
    dominiosPermitidos: string[]
  ) {
    super(
      `Domínio ${dominio} não autorizado no mandato ${mandateId}`,
      'DOMAIN_NOT_AUTHORIZED',
      { dominio, mandateId, dominiosPermitidos }
    );
    this.name = 'DomainNotAuthorizedError';
  }
}

/**
 * Erro quando caso de uso não está autorizado.
 */
class UseCaseNotAuthorizedError extends AutonomyError {
  constructor(
    casoUso: number,
    mandateId: string,
    casosPermitidos: number[]
  ) {
    super(
      `Caso de uso ${casoUso} não autorizado no mandato ${mandateId}`,
      'USE_CASE_NOT_AUTHORIZED',
      { casoUso, mandateId, casosPermitidos }
    );
    this.name = 'UseCaseNotAuthorizedError';
  }
}

/**
 * Erro quando gatilho textual de humano foi acionado.
 */
class HumanTriggerMatchedError extends AutonomyError {
  constructor(
    gatilho: string,
    mandateId: string
  ) {
    super(
      `Gatilho de supervisão humana acionado: "${gatilho}"`,
      'HUMAN_TRIGGER_MATCHED',
      { gatilho, mandateId }
    );
    this.name = 'HumanTriggerMatchedError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  AutonomyError,
  HumanOverrideRequiredError,
  EnsinoModeBlockedError,
  MandateRequiredError,
  MandateExpiredError,
  MandateRevokedError,
  PolicyNotAuthorizedError,
  RiskProfileExceededError,
  ClosedLayerBlockedError,
  DomainNotAuthorizedError,
  UseCaseNotAuthorizedError,
  HumanTriggerMatchedError
};
