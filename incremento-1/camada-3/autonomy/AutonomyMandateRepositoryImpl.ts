/**
 * INCREMENTO 17 + 18 + 19 — AUTONOMIA GRADUADA: Implementação do Repositório de Mandatos
 *
 * Implementação baseada em arquivo JSON com escrita atômica.
 *
 * PRINCÍPIOS:
 * - Append-only (mandatos não são alterados, apenas revogados/expirados/suspensos)
 * - Auditável (todas as operações são rastreáveis)
 * - Imutável após criação (exceto revogação, expiração, suspensão e incremento de uso)
 *
 * INCREMENTO 18 adiciona:
 * - Lock de persistência para evitar race conditions
 * - Métodos markExpired e incrementUses
 * - Suporte a novos campos (validFrom, validUntil, maxUses, uses, status)
 *
 * INCREMENTO 19 adiciona:
 * - Método suspend para suspender mandato por consequência
 * - Método resume para retomar mandato suspenso
 * - Suporte a novos campos (suspendedAt, suspendReason, triggeredByObservacaoId)
 */

import { JsonFileStore } from '../utilitarios/JsonFileStore';
import { AutonomyMandate, MandateExpireReason } from './AutonomyTypes';
import { AutonomyMandateRepository } from './AutonomyMandateRepository';
import { consumeUse, markAsExpired, getEffectiveStatus } from './AutonomyMandateService';
import { parseIsoDate, isAfter, isBefore } from './AutonomyTime';

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Implementação do repositório de mandatos usando JsonFileStore.
 * Inclui lock de persistência para operações atômicas (Inc 18).
 */
class AutonomyMandateRepositoryImpl implements AutonomyMandateRepository {
  private store: JsonFileStore;
  private persistLock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.store = new JsonFileStore(filePath);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOCK DE PERSISTÊNCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Executa operação com lock de persistência.
   * Garante serialização de escritas para evitar race conditions.
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previousLock = this.persistLock;
    let resolve: () => void;
    this.persistLock = new Promise(r => { resolve = r; });

    try {
      await previousLock;
      return await operation();
    } finally {
      resolve!();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS BÁSICOS (Inc 17)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria um novo mandato.
   */
  async create(mandate: AutonomyMandate): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();

      // Verificar se ID já existe
      if (mandates.some((m: AutonomyMandate) => m.id === mandate.id)) {
        throw new Error(`Mandato com ID ${mandate.id} já existe`);
      }

      // Garantir defaults do Inc 18 (respeitando campo revogado para retrocompatibilidade)
      const mandateWithDefaults: AutonomyMandate = {
        ...mandate,
        uses: mandate.uses ?? 0,
        status: mandate.status ?? (mandate.revogado ? 'revoked' : 'active')
      };

      // Serializar datas
      const serialized = this.serializeMandate(mandateWithDefaults);
      mandates.push(serialized);

      await this.store.writeAll(mandates);
    });
  }

  /**
   * Obtém mandato por ID.
   */
  async getById(id: string): Promise<AutonomyMandate | null> {
    const mandates = await this.store.readAll();
    const mandate = mandates.find((m: AutonomyMandate) => m.id === id);
    return mandate ? this.deserializeMandate(mandate) : null;
  }

  /**
   * Obtém mandatos ativos para um agente.
   * Considera: status, revogado, validFrom, validUntil, valido_ate, maxUses.
   */
  async getActiveByAgentId(agentId: string, now: Date = new Date()): Promise<AutonomyMandate[]> {
    const mandates = await this.store.readAll();

    return mandates
      .map((m: any) => this.deserializeMandate(m))
      .filter((m: AutonomyMandate) => {
        // Filtrar por agente
        if (m.agentId !== agentId) return false;

        // Verificar status explícito
        const status = getEffectiveStatus(m);
        if (status !== 'active') return false;

        // Verificar validFrom (ainda não ativo)
        const validFrom = parseIsoDate(m.validFrom);
        if (validFrom && isBefore(now, validFrom)) return false;

        // Verificar validUntil (expirado)
        const validUntil = parseIsoDate(m.validUntil);
        if (validUntil && isAfter(now, validUntil)) return false;

        // Verificar valido_ate (campo legado)
        const validoAte = parseIsoDate(m.valido_ate);
        if (validoAte && isAfter(now, validoAte)) return false;

        // Verificar limite de usos
        if (m.maxUses !== undefined && m.maxUses > 0) {
          const uses = m.uses ?? 0;
          if (uses >= m.maxUses) return false;
        }

        return true;
      });
  }

  /**
   * Obtém o mandato ativo mais recente para um agente.
   */
  async getMostRecentActiveByAgentId(agentId: string, now: Date = new Date()): Promise<AutonomyMandate | null> {
    const active = await this.getActiveByAgentId(agentId, now);

    if (active.length === 0) {
      return null;
    }

    // Ordenar por data de concessão (mais recente primeiro)
    active.sort((a, b) =>
      new Date(b.concedido_em).getTime() - new Date(a.concedido_em).getTime()
    );

    return active[0];
  }

  /**
   * Obtém todos os mandatos de um agente.
   */
  async getAllByAgentId(agentId: string): Promise<AutonomyMandate[]> {
    const mandates = await this.store.readAll();

    return mandates
      .map((m: any) => this.deserializeMandate(m))
      .filter((m: AutonomyMandate) => m.agentId === agentId);
  }

  /**
   * Revoga um mandato.
   */
  async revoke(id: string, revogadoPor: string, motivo?: string): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === id);

      if (index === -1) {
        throw new Error(`Mandato ${id} não encontrado`);
      }

      const mandate = this.deserializeMandate(mandates[index]);

      if (mandate.revogado || mandate.status === 'revoked') {
        throw new Error(`Mandato ${id} já foi revogado`);
      }

      // Atualizar mandato com revogação
      mandate.revogado = true;
      mandate.revogado_em = new Date();
      mandate.revogado_por = revogadoPor;
      mandate.motivo_revogacao = motivo;
      mandate.status = 'revoked';

      mandates[index] = this.serializeMandate(mandate);
      await this.store.writeAll(mandates);
    });
  }

  /**
   * Lista todos os mandatos.
   */
  async getAll(includeRevoked: boolean = false): Promise<AutonomyMandate[]> {
    const mandates = await this.store.readAll();

    return mandates
      .map((m: any) => this.deserializeMandate(m))
      .filter((m: AutonomyMandate) => {
        if (includeRevoked) return true;
        const status = getEffectiveStatus(m);
        return status === 'active';
      });
  }

  /**
   * Verifica se existe mandato ativo para agente.
   */
  async hasActiveMandate(agentId: string, now: Date = new Date()): Promise<boolean> {
    const active = await this.getActiveByAgentId(agentId, now);
    return active.length > 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DO INCREMENTO 18
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Marca mandato como expirado.
   * Operação idempotente: se já expirado, não faz nada.
   */
  async markExpired(id: string, reason: MandateExpireReason, now: Date = new Date()): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === id);

      if (index === -1) {
        throw new Error(`Mandato ${id} não encontrado`);
      }

      const mandate = this.deserializeMandate(mandates[index]);

      // Idempotência: se já expirado ou revogado, não faz nada
      if (mandate.status === 'expired' || mandate.status === 'revoked' || mandate.revogado) {
        return;
      }

      // Marcar como expirado
      const expired = markAsExpired(mandate, reason, now);
      mandates[index] = this.serializeMandate(expired);
      await this.store.writeAll(mandates);
    });
  }

  /**
   * Incrementa contador de usos do mandato.
   * Operação atômica com lock para evitar race conditions.
   */
  async incrementUses(id: string, now: Date = new Date()): Promise<AutonomyMandate> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === id);

      if (index === -1) {
        throw new Error(`Mandato ${id} não encontrado`);
      }

      const mandate = this.deserializeMandate(mandates[index]);

      // Consumir uso
      const updated = consumeUse(mandate, now);
      mandates[index] = this.serializeMandate(updated);
      await this.store.writeAll(mandates);

      return updated;
    });
  }

  /**
   * Atualiza mandato (uso interno).
   */
  async update(mandate: AutonomyMandate): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === mandate.id);

      if (index === -1) {
        throw new Error(`Mandato ${mandate.id} não encontrado`);
      }

      mandates[index] = this.serializeMandate(mandate);
      await this.store.writeAll(mandates);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DO INCREMENTO 19 - SUSPENSÃO POR CONSEQUÊNCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Suspende um mandato por consequência.
   * Operação idempotente: se já suspenso, não faz nada.
   */
  async suspend(id: string, reason: string, observacaoId: string, now: Date = new Date()): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === id);

      if (index === -1) {
        throw new Error(`Mandato ${id} não encontrado`);
      }

      const mandate = this.deserializeMandate(mandates[index]);

      // Idempotência: se já suspenso, revogado ou expirado, não faz nada
      if (mandate.status === 'suspended' || mandate.status === 'revoked' ||
          mandate.status === 'expired' || mandate.revogado) {
        return;
      }

      // Marcar como suspenso
      mandate.status = 'suspended';
      mandate.suspendedAt = now.toISOString();
      mandate.suspendReason = reason;
      mandate.triggeredByObservacaoId = observacaoId;

      mandates[index] = this.serializeMandate(mandate);
      await this.store.writeAll(mandates);
    });
  }

  /**
   * Retoma um mandato suspenso.
   * Operação idempotente: se não suspenso, não faz nada.
   */
  async resume(id: string, resumedBy: string, now: Date = new Date()): Promise<void> {
    return this.withLock(async () => {
      const mandates = await this.store.readAll();
      const index = mandates.findIndex((m: AutonomyMandate) => m.id === id);

      if (index === -1) {
        throw new Error(`Mandato ${id} não encontrado`);
      }

      const mandate = this.deserializeMandate(mandates[index]);

      // Idempotência: se não suspenso, não faz nada
      if (mandate.status !== 'suspended') {
        return;
      }

      // Retomar mandato
      mandate.status = 'active';
      // Mantém histórico de suspensão para auditoria

      mandates[index] = this.serializeMandate(mandate);
      await this.store.writeAll(mandates);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS DE SERIALIZAÇÃO
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Serializa mandato para persistência (datas como strings ISO).
   */
  private serializeMandate(mandate: AutonomyMandate): any {
    return {
      ...mandate,
      concedido_em: mandate.concedido_em instanceof Date
        ? mandate.concedido_em.toISOString()
        : mandate.concedido_em,
      valido_ate: mandate.valido_ate instanceof Date
        ? mandate.valido_ate.toISOString()
        : mandate.valido_ate,
      revogado_em: mandate.revogado_em instanceof Date
        ? mandate.revogado_em.toISOString()
        : mandate.revogado_em
      // validFrom, validUntil, lastUsedAt, expiredAt já são strings ISO
    };
  }

  /**
   * Deserializa mandato (strings ISO para Date onde apropriado).
   * Mantém novos campos Inc 18 como strings ISO para consistência.
   */
  private deserializeMandate(raw: any): AutonomyMandate {
    return {
      ...raw,
      concedido_em: new Date(raw.concedido_em),
      valido_ate: raw.valido_ate ? new Date(raw.valido_ate) : undefined,
      revogado_em: raw.revogado_em ? new Date(raw.revogado_em) : undefined,
      // Defaults do Inc 18 para retrocompatibilidade
      uses: raw.uses ?? 0,
      status: raw.status ?? (raw.revogado ? 'revoked' : 'active')
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { AutonomyMandateRepositoryImpl };
