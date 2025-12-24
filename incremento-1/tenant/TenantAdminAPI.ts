/**
 * CAMADA 6 — MULTI-TENANT: API Administrativa
 *
 * Expoe operacoes administrativas por tenant.
 *
 * RESPONSABILIDADES:
 * - CRUD de tenants
 * - Auditoria por tenant (export, verify, replay)
 * - Metricas por tenant
 *
 * NOTA: Nao implementa servidor HTTP real.
 * E uma classe de servico para uso por controllers.
 */

import { TenantRegistry } from './TenantRegistry';
import { TenantRuntime, RuntimeMetrics } from './TenantRuntime';
import { TenantConfig, TenantRegistrationInput } from './TenantConfig';
import {
  ChainVerificationResult,
  EventLogEntry
} from '../camada-3/event-log/EventLogEntry';
import {
  ExportRangeOptions,
  ExportRangeResult,
  ReplayOptions,
  ReplayResult
} from '../camada-3/event-log/EventLogRepository';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resultado de operacao administrativa
 */
export interface AdminResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Metricas globais
 */
export interface GlobalMetrics {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  activeInstances: number;
  instanceMetrics: RuntimeMetrics[];
}

/**
 * Status de saude
 */
export interface HealthStatus {
  healthy: boolean;
  registry: boolean;
  runtime: boolean;
  details: {
    totalInstances: number;
    healthyInstances: number;
    unhealthyTenants: string[];
  };
}

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTACAO
// ════════════════════════════════════════════════════════════════════════════

export class TenantAdminAPI {
  private registry: TenantRegistry;
  private runtime: TenantRuntime;

  constructor(registry: TenantRegistry, runtime: TenantRuntime) {
    this.registry = registry;
    this.runtime = runtime;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FACTORY
  // ══════════════════════════════════════════════════════════════════════════

  static create(registry: TenantRegistry, runtime: TenantRuntime): TenantAdminAPI {
    return new TenantAdminAPI(registry, runtime);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TENANT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista todos os tenants
   */
  async listTenants(includeDeleted?: boolean): Promise<AdminResult<TenantConfig[]>> {
    try {
      const tenants = this.registry.list(includeDeleted);
      return { success: true, data: tenants };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Obtem detalhes de um tenant
   */
  async getTenant(tenantId: string): Promise<AdminResult<TenantConfig>> {
    try {
      const tenant = this.registry.get(tenantId);
      if (!tenant) {
        return { success: false, error: `Tenant nao encontrado: ${tenantId}` };
      }
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Registra um novo tenant
   */
  async registerTenant(
    input: TenantRegistrationInput
  ): Promise<AdminResult<TenantConfig>> {
    try {
      const tenant = await this.registry.register(input);
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Atualiza configuracao de um tenant
   */
  async updateTenant(
    tenantId: string,
    partial: Partial<Pick<TenantConfig, 'name' | 'quotas' | 'features' | 'metadata'>>
  ): Promise<AdminResult<TenantConfig>> {
    try {
      const tenant = await this.registry.update(tenantId, partial);
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Suspende um tenant
   */
  async suspendTenant(tenantId: string): Promise<AdminResult<TenantConfig>> {
    try {
      // Primeiro, shutdown da instancia se estiver rodando
      await this.runtime.shutdown(tenantId);

      // Depois, suspender no registry
      const tenant = await this.registry.suspend(tenantId);
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Reativa um tenant suspenso
   */
  async resumeTenant(tenantId: string): Promise<AdminResult<TenantConfig>> {
    try {
      const tenant = await this.registry.resume(tenantId);
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Remove um tenant (soft delete)
   */
  async removeTenant(tenantId: string): Promise<AdminResult<TenantConfig>> {
    try {
      // Primeiro, shutdown da instancia se estiver rodando
      await this.runtime.shutdown(tenantId);

      // Depois, remover no registry
      const tenant = await this.registry.remove(tenantId);
      return { success: true, data: tenant };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AUDITORIA POR TENANT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica integridade da cadeia de eventos
   */
  async verifyChain(tenantId: string): Promise<AdminResult<ChainVerificationResult>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const result = await instance.eventLog.verifyChain();
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Verifica integridade a partir do snapshot (fast path)
   */
  async verifyFromSnapshot(
    tenantId: string
  ): Promise<AdminResult<ChainVerificationResult>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const result = await instance.eventLog.verifyFromSnapshot();
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Exporta eventos por range
   */
  async exportEventLog(
    tenantId: string,
    options?: ExportRangeOptions
  ): Promise<AdminResult<ExportRangeResult>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const result = await instance.eventLog.exportRange(options);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Replay do EventLog (gera resumo operacional)
   */
  async replayEventLog(
    tenantId: string,
    options?: ReplayOptions
  ): Promise<AdminResult<ReplayResult>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const result = await instance.eventLog.replay(options);
      return { success: true, data: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Lista todos os eventos de um tenant
   */
  async listEvents(tenantId: string): Promise<AdminResult<EventLogEntry[]>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const entries = await instance.eventLog.getAll();
      return { success: true, data: entries };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Conta eventos de um tenant
   */
  async countEvents(tenantId: string): Promise<AdminResult<number>> {
    try {
      const instance = await this.runtime.getOrCreate(tenantId);
      const count = await instance.eventLog.count();
      return { success: true, data: count };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // METRICAS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Obtem metricas de um tenant
   */
  async getTenantMetrics(tenantId: string): Promise<AdminResult<RuntimeMetrics>> {
    try {
      // Garantir que instancia existe
      await this.runtime.getOrCreate(tenantId);

      const metrics = this.runtime.getMetrics(tenantId);
      if (!metrics) {
        return { success: false, error: `Metricas nao disponiveis: ${tenantId}` };
      }

      return { success: true, data: metrics };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Obtem metricas globais
   */
  async getGlobalMetrics(): Promise<AdminResult<GlobalMetrics>> {
    try {
      const allTenants = this.registry.list(true);
      const activeTenants = allTenants.filter(t => t.status === 'active').length;
      const suspendedTenants = allTenants.filter(t => t.status === 'suspended').length;
      const instanceMetrics = this.runtime.getAllMetrics();

      return {
        success: true,
        data: {
          totalTenants: allTenants.length,
          activeTenants,
          suspendedTenants,
          activeInstances: instanceMetrics.length,
          instanceMetrics
        }
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica saude do sistema
   */
  async healthCheck(): Promise<AdminResult<HealthStatus>> {
    try {
      const activeInstances = this.runtime.listActive();
      const healthChecks = await Promise.all(
        activeInstances.map(async tenantId => ({
          tenantId,
          healthy: await this.runtime.isHealthy(tenantId)
        }))
      );

      const unhealthyTenants = healthChecks
        .filter(h => !h.healthy)
        .map(h => h.tenantId);

      const status: HealthStatus = {
        healthy: unhealthyTenants.length === 0,
        registry: true,
        runtime: true,
        details: {
          totalInstances: activeInstances.length,
          healthyInstances: activeInstances.length - unhealthyTenants.length,
          unhealthyTenants
        }
      };

      return { success: true, data: status };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INSTANCE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Força shutdown de uma instancia
   */
  async shutdownInstance(tenantId: string): Promise<AdminResult<void>> {
    try {
      await this.runtime.shutdown(tenantId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Shutdown de todas as instancias
   */
  async shutdownAll(): Promise<AdminResult<void>> {
    try {
      await this.runtime.shutdownAll();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido'
      };
    }
  }

  /**
   * Lista instancias ativas
   */
  listActiveInstances(): string[] {
    return this.runtime.listActive();
  }
}
