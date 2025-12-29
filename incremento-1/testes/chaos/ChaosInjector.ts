/**
 * INCREMENTO 27 — CHAOS ENGINEERING: Injetor de Falhas Controladas
 *
 * ESTE MÓDULO É EXCLUSIVO PARA TESTES.
 * NUNCA deve ser importado pelo código de produção.
 *
 * Responsabilidades:
 * - Simular falhas de filesystem (write/read/rename)
 * - Corromper arquivos parcialmente
 * - Simular perda de snapshot
 * - Falhar durante persist()
 * - Falhar durante restore
 * - Interromper abruptamente (throw antes do commit)
 *
 * PRINCÍPIOS:
 * - Falhas são explícitas e controláveis
 * - Cada injeção é rastreável
 * - Nenhum efeito colateral no core
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS DE FALHA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tipos de falha que podem ser injetadas.
 */
type ChaosFailureType =
  | 'FILESYSTEM_WRITE'
  | 'FILESYSTEM_READ'
  | 'FILESYSTEM_RENAME'
  | 'CORRUPTION_PARTIAL'
  | 'CORRUPTION_TOTAL'
  | 'SNAPSHOT_LOSS'
  | 'PERSIST_INTERRUPT'
  | 'RESTORE_INTERRUPT'
  | 'NETWORK_TIMEOUT'
  | 'RANDOM_EXCEPTION';

/**
 * Configuração de uma falha injetada.
 */
interface ChaosFailureConfig {
  /** Tipo da falha */
  type: ChaosFailureType;

  /** Probabilidade de ocorrer (0-1) */
  probability?: number;

  /** Número de vezes que deve falhar antes de funcionar */
  failCount?: number;

  /** Atraso em ms antes de falhar */
  delayMs?: number;

  /** Mensagem de erro customizada */
  errorMessage?: string;

  /** Callback executado antes da falha */
  beforeFail?: () => void | Promise<void>;
}

/**
 * Registro de falha ocorrida.
 */
interface ChaosFailureRecord {
  type: ChaosFailureType;
  timestamp: Date;
  context: string;
  error?: Error;
}

// ════════════════════════════════════════════════════════════════════════════
// CHAOS INJECTOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Injetor de falhas controladas para testes de Chaos Engineering.
 *
 * USO:
 * ```typescript
 * const chaos = new ChaosInjector();
 * chaos.enable('FILESYSTEM_WRITE', { failCount: 2 });
 *
 * // Nas próximas 2 chamadas a writeFile, lançará erro
 * await chaos.maybeFailWrite('test.json');
 * ```
 */
class ChaosInjector {
  private enabled: Map<ChaosFailureType, ChaosFailureConfig> = new Map();
  private failureCounters: Map<ChaosFailureType, number> = new Map();
  private history: ChaosFailureRecord[] = [];
  private active: boolean = false;

  /**
   * Ativa o injetor de chaos.
   * Sem chamar activate(), nenhuma falha é injetada.
   */
  activate(): void {
    this.active = true;
  }

  /**
   * Desativa o injetor completamente.
   */
  deactivate(): void {
    this.active = false;
  }

  /**
   * Verifica se o injetor está ativo.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Habilita uma falha específica.
   */
  enable(type: ChaosFailureType, config: Partial<ChaosFailureConfig> = {}): void {
    this.enabled.set(type, {
      type,
      probability: config.probability ?? 1,
      failCount: config.failCount ?? Infinity,
      delayMs: config.delayMs ?? 0,
      errorMessage: config.errorMessage,
      beforeFail: config.beforeFail
    });
    this.failureCounters.set(type, 0);
  }

  /**
   * Desabilita uma falha específica.
   */
  disable(type: ChaosFailureType): void {
    this.enabled.delete(type);
    this.failureCounters.delete(type);
  }

  /**
   * Desabilita todas as falhas.
   */
  disableAll(): void {
    this.enabled.clear();
    this.failureCounters.clear();
  }

  /**
   * Reseta o estado do injetor.
   */
  reset(): void {
    this.disableAll();
    this.history = [];
    this.active = false;
  }

  /**
   * Retorna histórico de falhas injetadas.
   */
  getHistory(): ChaosFailureRecord[] {
    return [...this.history];
  }

  /**
   * Retorna contagem de falhas por tipo.
   */
  getFailureCounts(): Map<ChaosFailureType, number> {
    return new Map(this.failureCounters);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE INJEÇÃO DE FALHA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica e possivelmente injeta falha de escrita.
   */
  async maybeFailWrite(context: string): Promise<void> {
    await this.maybeInjectFailure('FILESYSTEM_WRITE', context);
  }

  /**
   * Verifica e possivelmente injeta falha de leitura.
   */
  async maybeFailRead(context: string): Promise<void> {
    await this.maybeInjectFailure('FILESYSTEM_READ', context);
  }

  /**
   * Verifica e possivelmente injeta falha de rename.
   */
  async maybeFailRename(context: string): Promise<void> {
    await this.maybeInjectFailure('FILESYSTEM_RENAME', context);
  }

  /**
   * Verifica e possivelmente injeta interrupção de persist.
   */
  async maybeFailPersist(context: string): Promise<void> {
    await this.maybeInjectFailure('PERSIST_INTERRUPT', context);
  }

  /**
   * Verifica e possivelmente injeta interrupção de restore.
   */
  async maybeFailRestore(context: string): Promise<void> {
    await this.maybeInjectFailure('RESTORE_INTERRUPT', context);
  }

  /**
   * Verifica e possivelmente injeta exceção aleatória.
   */
  async maybeThrow(context: string): Promise<void> {
    await this.maybeInjectFailure('RANDOM_EXCEPTION', context);
  }

  /**
   * Lógica central de injeção de falha.
   */
  private async maybeInjectFailure(type: ChaosFailureType, context: string): Promise<void> {
    if (!this.active) return;

    const config = this.enabled.get(type);
    if (!config) return;

    const currentCount = this.failureCounters.get(type) ?? 0;

    // Verificar se ainda deve falhar
    if (currentCount >= (config.failCount ?? Infinity)) {
      return;
    }

    // Verificar probabilidade
    if (Math.random() > (config.probability ?? 1)) {
      return;
    }

    // Incrementar contador
    this.failureCounters.set(type, currentCount + 1);

    // Atraso opcional
    if (config.delayMs && config.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, config.delayMs));
    }

    // Callback antes de falhar
    if (config.beforeFail) {
      await config.beforeFail();
    }

    // Criar e registrar erro
    const error = new ChaosError(
      config.errorMessage ?? `Chaos injection: ${type}`,
      type,
      context
    );

    this.history.push({
      type,
      timestamp: new Date(),
      context,
      error
    });

    throw error;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE CORRUPÇÃO DE DADOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Corrompe um arquivo JSON parcialmente.
   * Mantém estrutura mas altera valores críticos.
   */
  async corruptJsonPartially(filePath: string, corruptionType: 'hash' | 'signature' | 'data'): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    switch (corruptionType) {
      case 'hash':
        if (data.contentHash) {
          data.contentHash = 'corrupted_' + data.contentHash.substring(10);
        }
        if (data.current_hash) {
          data.current_hash = 'corrupted_' + data.current_hash.substring(10);
        }
        break;

      case 'signature':
        if (data.signature) {
          data.signature = 'invalid_signature_'.padEnd(64, '0');
        }
        break;

      case 'data':
        if (data.entities && Array.isArray(data.entities)) {
          data.entities[0].dataHash = 'corrupted_data_hash';
        }
        if (data.payload_hash) {
          data.payload_hash = 'corrupted_payload';
        }
        break;
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    this.history.push({
      type: 'CORRUPTION_PARTIAL',
      timestamp: new Date(),
      context: `${filePath}:${corruptionType}`
    });
  }

  /**
   * Corrompe um arquivo completamente (torna ilegível).
   */
  async corruptFileTotally(filePath: string): Promise<void> {
    await fs.writeFile(filePath, 'CORRUPTED_DATA_NOT_JSON_{{{', 'utf-8');

    this.history.push({
      type: 'CORRUPTION_TOTAL',
      timestamp: new Date(),
      context: filePath
    });
  }

  /**
   * Simula perda de snapshot.
   */
  async deleteSnapshot(snapshotPath: string): Promise<void> {
    try {
      await fs.unlink(snapshotPath);

      this.history.push({
        type: 'SNAPSHOT_LOSS',
        timestamp: new Date(),
        context: snapshotPath
      });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Trunca um arquivo (simula escrita parcial).
   */
  async truncateFile(filePath: string, keepBytes: number): Promise<void> {
    const content = await fs.readFile(filePath);
    await fs.writeFile(filePath, content.slice(0, keepBytes));

    this.history.push({
      type: 'CORRUPTION_PARTIAL',
      timestamp: new Date(),
      context: `${filePath}:truncated@${keepBytes}`
    });
  }

  /**
   * Cria arquivo .tmp órfão (simula crash durante escrita atômica).
   */
  async createOrphanTmpFile(targetPath: string, content: string): Promise<void> {
    const tmpPath = targetPath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');

    this.history.push({
      type: 'PERSIST_INTERRUPT',
      timestamp: new Date(),
      context: `orphan:${tmpPath}`
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ERRO ESPECÍFICO DE CHAOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Erro específico de injeção de chaos.
 * Permite identificar facilmente falhas injetadas vs. reais.
 */
class ChaosError extends Error {
  constructor(
    message: string,
    public readonly chaosType: ChaosFailureType,
    public readonly chaosContext: string
  ) {
    super(message);
    this.name = 'ChaosError';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WRAPPERS PARA FUNÇÕES DE SISTEMA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria wrapper de fs.writeFile com injeção de chaos.
 */
function createChaosWriteFile(chaos: ChaosInjector) {
  return async (filePath: string, data: string | Buffer, options?: any): Promise<void> => {
    await chaos.maybeFailWrite(filePath);
    await fs.writeFile(filePath, data, options);
  };
}

/**
 * Cria wrapper de fs.readFile com injeção de chaos.
 */
function createChaosReadFile(chaos: ChaosInjector) {
  return async (filePath: string, options?: any): Promise<string | Buffer> => {
    await chaos.maybeFailRead(filePath);
    return fs.readFile(filePath, options);
  };
}

/**
 * Cria wrapper de fs.rename com injeção de chaos.
 */
function createChaosRename(chaos: ChaosInjector) {
  return async (oldPath: string, newPath: string): Promise<void> => {
    await chaos.maybeFailRename(`${oldPath} -> ${newPath}`);
    await fs.rename(oldPath, newPath);
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RACE CONDITION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Executa múltiplas operações concorrentemente.
 * Útil para testar race conditions.
 */
async function runConcurrently<T>(
  operations: (() => Promise<T>)[],
  options?: { maxConcurrency?: number }
): Promise<{ results: T[]; errors: Error[] }> {
  const results: T[] = [];
  const errors: Error[] = [];

  const promises = operations.map(async (op, index) => {
    try {
      const result = await op();
      results[index] = result;
    } catch (error) {
      errors.push(error as Error);
    }
  });

  await Promise.all(promises);

  return { results, errors };
}

/**
 * Cria N operações idênticas para teste de concorrência.
 */
function replicateOperation<T>(operation: () => Promise<T>, count: number): (() => Promise<T>)[] {
  return Array.from({ length: count }, () => operation);
}

// ════════════════════════════════════════════════════════════════════════════
// ASSERTIONS PARA CHAOS TESTING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verifica que uma operação falha com ChaosError.
 */
async function expectChaosFailure(
  operation: () => Promise<unknown>,
  expectedType?: ChaosFailureType
): Promise<ChaosError> {
  try {
    await operation();
    throw new Error('Expected operation to fail with ChaosError');
  } catch (error) {
    if (!(error instanceof ChaosError)) {
      throw new Error(`Expected ChaosError but got: ${(error as Error).message}`);
    }
    if (expectedType && error.chaosType !== expectedType) {
      throw new Error(`Expected chaos type ${expectedType} but got ${error.chaosType}`);
    }
    return error;
  }
}

/**
 * Verifica que nenhum arquivo .tmp órfão existe.
 */
async function assertNoOrphanTmpFiles(directory: string): Promise<void> {
  const files = await fs.readdir(directory).catch(() => []);
  const tmpFiles = files.filter(f => f.endsWith('.tmp'));

  if (tmpFiles.length > 0) {
    throw new Error(`Found orphan .tmp files: ${tmpFiles.join(', ')}`);
  }
}

/**
 * Verifica integridade de arquivo JSON.
 */
async function assertValidJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  ChaosInjector,
  ChaosError,
  ChaosFailureType,
  ChaosFailureConfig,
  ChaosFailureRecord,
  createChaosWriteFile,
  createChaosReadFile,
  createChaosRename,
  runConcurrently,
  replicateOperation,
  expectChaosFailure,
  assertNoOrphanTmpFiles,
  assertValidJson
};
