/**
 * INCREMENTO 18 + 19 — MANDATOS TEMPORAIS: Serviço de Mandato
 *
 * Funções de domínio para verificação e manipulação de mandatos.
 * Funções puras, sem I/O.
 *
 * INCREMENTO 19 adiciona:
 * - Verificação de status 'suspended'
 * - Código de regra ALREADY_SUSPENDED
 */

import { AutonomyMandate, MandateExpireReason } from './AutonomyTypes';
import { parseIsoDate, isBefore, isAfter } from './AutonomyTime';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS DE RESULTADO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado da verificação de atividade do mandato.
 */
interface MandateActivityResult {
  /** Se o mandato está ativo */
  ok: boolean;
  /** Motivo do bloqueio (se não ativo) */
  reason?: string;
  /** Código da regra de bloqueio */
  code?: string;
  /** Motivo de expiração (se aplicável) */
  expireReason?: MandateExpireReason;
}

// ════════════════════════════════════════════════════════════════════════════
// CÓDIGOS DE REGRA (Inc 18 + 19)
// ════════════════════════════════════════════════════════════════════════════

const MANDATE_RULE = {
  NOT_ACTIVE_YET: 'MANDATE_NOT_ACTIVE_YET',
  EXPIRED_TIME: 'MANDATE_EXPIRED_TIME',
  EXHAUSTED_USES: 'MANDATE_EXHAUSTED_USES',
  ALREADY_EXPIRED: 'MANDATE_ALREADY_EXPIRED',
  ALREADY_REVOKED: 'MANDATE_ALREADY_REVOKED',
  // Inc 19
  ALREADY_SUSPENDED: 'MANDATE_ALREADY_SUSPENDED'
} as const;

// ════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE VERIFICAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o mandato está ativo considerando:
 * - Status (se já expirado ou revogado)
 * - Validade temporal (validFrom, validUntil, valido_ate legado)
 * - Limite de usos (maxUses, uses)
 *
 * @param mandate - Mandato a verificar
 * @param now - Data atual para comparação
 * @returns Resultado da verificação
 */
function isMandateActive(mandate: AutonomyMandate, now: Date = new Date()): MandateActivityResult {
  // Verificar status explícito primeiro
  if (mandate.status === 'expired') {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} já expirou${mandate.expireReason ? ` (${mandate.expireReason})` : ''}`,
      code: MANDATE_RULE.ALREADY_EXPIRED,
      expireReason: mandate.expireReason
    };
  }

  if (mandate.status === 'revoked' || mandate.revogado) {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} foi revogado${mandate.motivo_revogacao ? `: ${mandate.motivo_revogacao}` : ''}`,
      code: MANDATE_RULE.ALREADY_REVOKED
    };
  }

  // Inc 19: Verificar status suspenso
  if (mandate.status === 'suspended') {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} está suspenso${mandate.suspendReason ? `: ${mandate.suspendReason}` : ''}`,
      code: MANDATE_RULE.ALREADY_SUSPENDED
    };
  }

  // Verificar validFrom (ainda não ativo)
  const validFrom = parseIsoDate(mandate.validFrom);
  if (validFrom && isBefore(now, validFrom)) {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} ainda não ativo (válido a partir de ${mandate.validFrom})`,
      code: MANDATE_RULE.NOT_ACTIVE_YET
    };
  }

  // Verificar validUntil (expirado por tempo - novo campo Inc 18)
  const validUntil = parseIsoDate(mandate.validUntil);
  if (validUntil && isAfter(now, validUntil)) {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} expirou em ${mandate.validUntil}`,
      code: MANDATE_RULE.EXPIRED_TIME,
      expireReason: 'TIME'
    };
  }

  // Verificar valido_ate (campo legado do Inc 17)
  const validoAte = parseIsoDate(mandate.valido_ate);
  if (validoAte && isAfter(now, validoAte)) {
    return {
      ok: false,
      reason: `Mandato ${mandate.id} expirou em ${mandate.valido_ate}`,
      code: MANDATE_RULE.EXPIRED_TIME,
      expireReason: 'TIME'
    };
  }

  // Verificar limite de usos
  if (mandate.maxUses !== undefined && mandate.maxUses > 0) {
    const currentUses = mandate.uses ?? 0;
    if (currentUses >= mandate.maxUses) {
      return {
        ok: false,
        reason: `Mandato ${mandate.id} esgotou limite de usos (${currentUses}/${mandate.maxUses})`,
        code: MANDATE_RULE.EXHAUSTED_USES,
        expireReason: 'USES'
      };
    }
  }

  return { ok: true };
}

/**
 * Verifica se o mandato pode consumir mais um uso.
 * Retorna false se maxUses definido e uses >= maxUses.
 */
function canConsumeUse(mandate: AutonomyMandate): boolean {
  if (mandate.maxUses === undefined || mandate.maxUses <= 0) {
    return true; // Sem limite de usos
  }

  const currentUses = mandate.uses ?? 0;
  return currentUses < mandate.maxUses;
}

/**
 * Retorna uma cópia do mandato com uso incrementado.
 * NÃO modifica o mandato original (imutabilidade).
 *
 * @param mandate - Mandato original
 * @param now - Data do uso
 * @returns Mandato com uso incrementado
 */
function consumeUse(mandate: AutonomyMandate, now: Date = new Date()): AutonomyMandate {
  const currentUses = mandate.uses ?? 0;
  const newUses = currentUses + 1;

  const updated: AutonomyMandate = {
    ...mandate,
    uses: newUses,
    lastUsedAt: now.toISOString()
  };

  // Verificar se atingiu limite de usos
  if (mandate.maxUses !== undefined && newUses >= mandate.maxUses) {
    updated.status = 'expired';
    updated.expiredAt = now.toISOString();
    updated.expireReason = 'USES';
  }

  return updated;
}

/**
 * Retorna uma cópia do mandato marcado como expirado.
 * NÃO modifica o mandato original (imutabilidade).
 *
 * @param mandate - Mandato original
 * @param reason - Motivo da expiração
 * @param now - Data da expiração
 * @returns Mandato marcado como expirado
 */
function markAsExpired(
  mandate: AutonomyMandate,
  reason: MandateExpireReason,
  now: Date = new Date()
): AutonomyMandate {
  return {
    ...mandate,
    status: 'expired',
    expiredAt: now.toISOString(),
    expireReason: reason
  };
}

/**
 * Verifica se o mandato precisa ser marcado como expirado.
 * Útil para detectar expiração durante avaliação.
 */
function shouldMarkExpired(mandate: AutonomyMandate, now: Date = new Date()): MandateExpireReason | null {
  // Já está expirado ou revogado
  if (mandate.status === 'expired' || mandate.status === 'revoked' || mandate.revogado) {
    return null;
  }

  // Verificar expiração por tempo
  const validUntil = parseIsoDate(mandate.validUntil);
  if (validUntil && isAfter(now, validUntil)) {
    return 'TIME';
  }

  const validoAte = parseIsoDate(mandate.valido_ate);
  if (validoAte && isAfter(now, validoAte)) {
    return 'TIME';
  }

  // Verificar expiração por usos
  if (mandate.maxUses !== undefined && mandate.maxUses > 0) {
    const currentUses = mandate.uses ?? 0;
    if (currentUses >= mandate.maxUses) {
      return 'USES';
    }
  }

  return null;
}

/**
 * Obtém o status efetivo do mandato.
 * Considera campos legados (revogado) para retrocompatibilidade.
 *
 * Inc 19: Adicionado status 'suspended'.
 */
function getEffectiveStatus(mandate: AutonomyMandate): 'active' | 'expired' | 'revoked' | 'suspended' {
  if (mandate.status) {
    return mandate.status;
  }

  // Retrocompatibilidade com campo revogado do Inc 17
  if (mandate.revogado) {
    return 'revoked';
  }

  return 'active';
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  MandateActivityResult,
  MANDATE_RULE,
  isMandateActive,
  canConsumeUse,
  consumeUse,
  markAsExpired,
  shouldMarkExpired,
  getEffectiveStatus
};
