/**
 * CAMADA 6 — MULTI-TENANT: Interface de Integracao Generica
 *
 * Define interface plugavel para integracoes externas.
 *
 * PRINCIPIOS:
 * - Sem referencia a implementacoes especificas
 * - Qualquer instituicao pode implementar seu proprio adapter
 * - Adapter e OPCIONAL - Core funciona sem ele
 */

import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';

// ════════════════════════════════════════════════════════════════════════════
// INTERFACE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Interface generica para adaptadores de integracao
 *
 * Um adapter permite que sistemas externos interajam com o Core Libervia.
 * Exemplos de uso:
 * - Integrar com sistemas de workflow
 * - Expor APIs REST/GraphQL
 * - Conectar com message brokers
 * - Sincronizar com sistemas legados
 */
export interface IntegrationAdapter {
  /**
   * Nome identificador do adapter (para logs e metricas)
   */
  readonly name: string;

  /**
   * Inicializa o adapter para um tenant
   *
   * @param tenantId - ID do tenant
   * @param dataDir - Diretorio de dados do tenant
   * @param orquestrador - Instancia do Core para este tenant
   */
  init?(
    tenantId: string,
    dataDir: string,
    orquestrador: OrquestradorCognitivo
  ): Promise<void>;

  /**
   * Encerra o adapter para um tenant
   * Deve liberar recursos, fechar conexoes, etc.
   *
   * @param tenantId - ID do tenant
   */
  shutdown?(tenantId: string): Promise<void>;

  /**
   * Health check do adapter
   *
   * @param tenantId - ID do tenant
   * @returns true se adapter esta saudavel
   */
  isHealthy?(tenantId: string): Promise<boolean>;
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Factory para criar adaptadores
 *
 * Permite injetar criacao de adapters sem acoplar a implementacoes especificas.
 *
 * @param tenantId - ID do tenant
 * @param dataDir - Diretorio de dados do tenant
 * @param orquestrador - Instancia do Core
 * @returns Adapter inicializado ou null se tenant nao usa adapter
 */
export type IntegrationFactory = (
  tenantId: string,
  dataDir: string,
  orquestrador: OrquestradorCognitivo
) => Promise<IntegrationAdapter | null>;

// ════════════════════════════════════════════════════════════════════════════
// NULL ADAPTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Adapter nulo - usado quando tenant nao tem integracao
 * Implementa Null Object Pattern
 */
export class NullIntegrationAdapter implements IntegrationAdapter {
  readonly name = 'null';

  async init(): Promise<void> {
    // No-op
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

/**
 * Instancia singleton do adapter nulo
 */
export const NULL_ADAPTER = new NullIntegrationAdapter();

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Factory que sempre retorna null (sem adapter)
 */
export const noAdapterFactory: IntegrationFactory = async () => null;

/**
 * Cria uma factory que retorna o mesmo adapter para todos os tenants
 */
export function singleAdapterFactory(
  adapter: IntegrationAdapter
): IntegrationFactory {
  return async (tenantId, dataDir, orquestrador) => {
    if (adapter.init) {
      await adapter.init(tenantId, dataDir, orquestrador);
    }
    return adapter;
  };
}

/**
 * Cria uma factory baseada em mapa de tenantId -> adapter
 */
export function mapAdapterFactory(
  adapterMap: Map<string, IntegrationAdapter>,
  defaultAdapter?: IntegrationAdapter
): IntegrationFactory {
  return async (tenantId, dataDir, orquestrador) => {
    const adapter = adapterMap.get(tenantId) ?? defaultAdapter ?? null;

    if (adapter?.init) {
      await adapter.init(tenantId, dataDir, orquestrador);
    }

    return adapter;
  };
}
