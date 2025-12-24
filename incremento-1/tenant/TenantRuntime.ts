/**
 * CAMADA 6 — MULTI-TENANT: Runtime de Tenants
 *
 * Gerencia instancias ativas do Core por tenant.
 *
 * RESPONSABILIDADES:
 * - Criar instancias do Core sob demanda (lazy loading)
 * - Cachear instancias ativas
 * - Gerenciar lifecycle (init, shutdown)
 * - Integrar com adapters opcionais
 */

import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { EventLogRepository } from '../camada-3/event-log/EventLogRepository';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';

import { TenantRegistry } from './TenantRegistry';
import { IntegrationAdapter, IntegrationFactory, noAdapterFactory } from './IntegrationAdapter';
import { resolveTenantDataDir } from './TenantSecurity';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Instancia do Core para um tenant
 */
export interface CoreInstance {
  /**
   * ID do tenant
   */
  tenantId: string;

  /**
   * Diretorio de dados do tenant
   */
  dataDir: string;

  /**
   * Orquestrador Cognitivo (Core)
   */
  orquestrador: OrquestradorCognitivo;

  /**
   * EventLog do tenant
   */
  eventLog: EventLogRepository;

  /**
   * Adapter de integracao (opcional)
   */
  integration: IntegrationAdapter | null;

  /**
   * Timestamp de criacao da instancia
   */
  startedAt: string;

  /**
   * Timestamp da ultima atividade
   */
  lastActivity: string;
}

/**
 * Metricas de uma instancia
 */
export interface RuntimeMetrics {
  tenantId: string;
  startedAt: string;
  lastActivity: string;
  uptime: number;  // ms
  eventLogStatus: {
    enabled: boolean;
    degraded: boolean;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTACAO
// ════════════════════════════════════════════════════════════════════════════

export class TenantRuntime {
  private registry: TenantRegistry;
  private baseDir: string;
  private integrationFactory: IntegrationFactory;
  private instances: Map<string, CoreInstance> = new Map();

  constructor(
    registry: TenantRegistry,
    integrationFactory: IntegrationFactory = noAdapterFactory
  ) {
    this.registry = registry;
    this.baseDir = registry.getBaseDir();
    this.integrationFactory = integrationFactory;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FACTORY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria um novo TenantRuntime
   */
  static create(
    registry: TenantRegistry,
    integrationFactory?: IntegrationFactory
  ): TenantRuntime {
    return new TenantRuntime(registry, integrationFactory);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE INSTANCE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Obtem ou cria instancia do Core para um tenant
   *
   * @throws Error se tenant nao existir ou nao estiver ativo
   */
  async getOrCreate(tenantId: string): Promise<CoreInstance> {
    // Verificar cache
    const existing = this.instances.get(tenantId);
    if (existing) {
      // Atualizar lastActivity
      existing.lastActivity = new Date().toISOString();
      return existing;
    }

    // Verificar se tenant existe e esta ativo
    const tenantConfig = this.registry.get(tenantId);
    if (!tenantConfig) {
      throw new Error(`Tenant nao encontrado: ${tenantId}`);
    }

    if (tenantConfig.status !== 'active') {
      throw new Error(
        `Tenant nao esta ativo: ${tenantId} (status: ${tenantConfig.status})`
      );
    }

    // Resolver dataDir de forma segura
    const dataDir = await resolveTenantDataDir(this.baseDir, tenantId);

    // Criar instancia do Core
    const instance = await this.createCoreInstance(tenantId, dataDir);

    // Cachear
    this.instances.set(tenantId, instance);

    return instance;
  }

  /**
   * Obtem instancia existente (sem criar)
   */
  get(tenantId: string): CoreInstance | null {
    return this.instances.get(tenantId) || null;
  }

  /**
   * Verifica se tenant tem instancia ativa
   */
  isActive(tenantId: string): boolean {
    return this.instances.has(tenantId);
  }

  /**
   * Lista tenants com instancias ativas
   */
  listActive(): string[] {
    return Array.from(this.instances.keys());
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRIACAO DE INSTANCIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cria uma nova instancia do Core
   */
  private async createCoreInstance(
    tenantId: string,
    dataDir: string
  ): Promise<CoreInstance> {
    const now = new Date().toISOString();

    // 1. Criar repositorios
    const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
    const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
    const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
    const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
    const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
    const eventLog = await EventLogRepositoryImpl.create(dataDir);

    // 2. Criar servico de memoria
    const memoryService = new MemoryQueryService(
      episodioRepo,
      decisaoRepo,
      contratoRepo
    );

    // 3. Criar orquestrador
    const orquestrador = new OrquestradorCognitivo(
      situacaoRepo,
      episodioRepo,
      decisaoRepo,
      contratoRepo,
      memoryService,
      protocoloRepo,
      eventLog
    );

    // 4. Inicializar orquestrador
    await orquestrador.init();

    // 5. Criar adapter de integracao (opcional)
    const integration = await this.integrationFactory(
      tenantId,
      dataDir,
      orquestrador
    );

    return {
      tenantId,
      dataDir,
      orquestrador,
      eventLog,
      integration,
      startedAt: now,
      lastActivity: now
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHUTDOWN
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Encerra instancia de um tenant
   */
  async shutdown(tenantId: string): Promise<void> {
    const instance = this.instances.get(tenantId);
    if (!instance) {
      return;  // Nada a fazer
    }

    // Encerrar adapter
    if (instance.integration?.shutdown) {
      await instance.integration.shutdown(tenantId);
    }

    // Remover do cache
    this.instances.delete(tenantId);
  }

  /**
   * Encerra todas as instancias
   */
  async shutdownAll(): Promise<void> {
    const shutdownPromises = Array.from(this.instances.keys()).map(
      tenantId => this.shutdown(tenantId)
    );

    await Promise.all(shutdownPromises);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // METRICAS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Obtem metricas de uma instancia
   */
  getMetrics(tenantId: string): RuntimeMetrics | null {
    const instance = this.instances.get(tenantId);
    if (!instance) {
      return null;
    }

    const now = Date.now();
    const startedAt = new Date(instance.startedAt).getTime();

    // Obter status do eventLog
    const eventLogStatus = instance.orquestrador.GetEventLogStatus();

    return {
      tenantId,
      startedAt: instance.startedAt,
      lastActivity: instance.lastActivity,
      uptime: now - startedAt,
      eventLogStatus
    };
  }

  /**
   * Obtem metricas de todas as instancias ativas
   */
  getAllMetrics(): RuntimeMetrics[] {
    return Array.from(this.instances.keys())
      .map(tenantId => this.getMetrics(tenantId))
      .filter((m): m is RuntimeMetrics => m !== null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica saude de uma instancia
   */
  async isHealthy(tenantId: string): Promise<boolean> {
    const instance = this.instances.get(tenantId);
    if (!instance) {
      return false;
    }

    // Verificar eventLog
    const eventLogStatus = instance.orquestrador.GetEventLogStatus();
    if (!eventLogStatus.enabled || eventLogStatus.degraded) {
      return false;
    }

    // Verificar adapter
    if (instance.integration?.isHealthy) {
      const adapterHealthy = await instance.integration.isHealthy(tenantId);
      if (!adapterHealthy) {
        return false;
      }
    }

    return true;
  }

  /**
   * Obtem contagem de instancias
   */
  getInstanceCount(): number {
    return this.instances.size;
  }
}
