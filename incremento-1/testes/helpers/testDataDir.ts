/**
 * Helper para criacao de diretorios de teste isolados.
 *
 * Cada teste recebe seu proprio diretorio unico, evitando
 * race conditions entre testes paralelos.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

export interface TestDataDir {
  /**
   * Caminho absoluto do diretorio de teste
   */
  dir: string;

  /**
   * Funcao de cleanup - remove o diretorio recursivamente
   * Implementa retry com backoff para lidar com handles abertos
   */
  cleanup: () => Promise<void>;
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════════

const CLEANUP_RETRIES = 3;
const CLEANUP_DELAYS = [20, 50, 100]; // ms

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria um diretorio de teste unico e isolado.
 *
 * Usa fs.mkdtemp para garantir unicidade mesmo em execucao paralela.
 *
 * @param prefix - Prefixo opcional para identificacao (ex: 'inc7', 'gateway')
 * @returns Objeto com path do diretorio e funcao de cleanup
 *
 * @example
 * ```typescript
 * let testDir: TestDataDir;
 *
 * beforeEach(async () => {
 *   testDir = await createTestDataDir('meu-teste');
 * });
 *
 * afterEach(async () => {
 *   await testDir.cleanup();
 * });
 *
 * test('exemplo', async () => {
 *   // usar testDir.dir como dataDir
 *   const repo = await MyRepo.create(testDir.dir);
 * });
 * ```
 */
export async function createTestDataDir(prefix: string = 'test'): Promise<TestDataDir> {
  // Criar no diretorio temporario do sistema
  const tmpBase = os.tmpdir();
  const dirPrefix = path.join(tmpBase, `libervia-${prefix}-`);

  // mkdtemp garante unicidade atomica
  const dir = await fs.mkdtemp(dirPrefix);

  return {
    dir,
    cleanup: createCleanupFn(dir)
  };
}

/**
 * Cria funcao de cleanup com retry e backoff.
 */
function createCleanupFn(dir: string): () => Promise<void> {
  return async () => {
    for (let attempt = 0; attempt < CLEANUP_RETRIES; attempt++) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        return; // Sucesso
      } catch (err: any) {
        // ENOENT significa que ja foi removido - sucesso
        if (err.code === 'ENOENT') {
          return;
        }

        // Se ainda temos retries, esperar e tentar novamente
        if (attempt < CLEANUP_RETRIES - 1) {
          await sleep(CLEANUP_DELAYS[attempt]);
        } else {
          // Ultima tentativa falhou - logar mas nao falhar o teste
          console.warn(`[testDataDir] Cleanup failed after ${CLEANUP_RETRIES} attempts: ${dir}`);
        }
      }
    }
  };
}

/**
 * Helper para sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER PARA SUITES COM MULTIPLOS TESTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria um gerenciador de diretorios para suites com multiplos testes.
 *
 * Util quando voce precisa de subdiretorios para cada teste dentro
 * de uma suite, mas quer um cleanup unico no final.
 *
 * @example
 * ```typescript
 * describe('minha suite', () => {
 *   const dirManager = createTestDirManager('minha-suite');
 *
 *   afterAll(async () => {
 *     await dirManager.cleanupAll();
 *   });
 *
 *   test('teste 1', async () => {
 *     const { dir } = await dirManager.create('teste-1');
 *     // usar dir...
 *   });
 * });
 * ```
 */
export function createTestDirManager(suitePrefix: string): TestDirManager {
  return new TestDirManager(suitePrefix);
}

export class TestDirManager {
  private dirs: TestDataDir[] = [];
  private suitePrefix: string;

  constructor(suitePrefix: string) {
    this.suitePrefix = suitePrefix;
  }

  /**
   * Cria um novo diretorio de teste e registra para cleanup posterior.
   */
  async create(testName: string = ''): Promise<TestDataDir> {
    const prefix = testName
      ? `${this.suitePrefix}-${testName}`
      : this.suitePrefix;

    const testDir = await createTestDataDir(prefix);
    this.dirs.push(testDir);
    return testDir;
  }

  /**
   * Limpa todos os diretorios criados por este manager.
   */
  async cleanupAll(): Promise<void> {
    const cleanups = this.dirs.map(d => d.cleanup());
    await Promise.all(cleanups);
    this.dirs = [];
  }
}
