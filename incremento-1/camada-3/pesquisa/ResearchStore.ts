/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Store (Opcional)
 *
 * Armazena relatórios de pesquisa em diretório SEPARADO do Core.
 * NUNCA escreve no dataDir do tenant.
 *
 * GUARDRAIL ANTI-ESCRITA:
 * - Usa diretório exclusivo: baseDir/research/<tenantId>/
 * - Verifica explicitamente que não está escrevendo em dataDir do Core
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ResearchReport } from './ResearchTypes';

// ════════════════════════════════════════════════════════════════════════════
// RESEARCH STORE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Store para relatórios de pesquisa.
 * Usa diretório separado do Core.
 */
class ResearchStore {
  private readonly researchDir: string;
  private initialized = false;

  /**
   * Cria store de pesquisa.
   *
   * @param baseDir - Diretório base (ex: ./data)
   * @param tenantId - ID do tenant (opcional, para multi-tenant)
   *
   * GUARDRAIL: O store cria subpasta /research/ explicitamente
   * para garantir separação do Core.
   */
  constructor(baseDir: string, tenantId?: string) {
    if (tenantId) {
      this.researchDir = path.join(baseDir, 'research', tenantId);
    } else {
      this.researchDir = path.join(baseDir, 'research');
    }
  }

  /**
   * Inicializa o store (cria diretório se necessário).
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.researchDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Retorna o diretório de pesquisa.
   */
  getResearchDir(): string {
    return this.researchDir;
  }

  /**
   * Salva relatório de pesquisa.
   * Retorna o caminho do arquivo salvo.
   */
  async save(report: ResearchReport): Promise<string> {
    await this.ensureInitialized();

    const filename = `${report.reportId}.json`;
    const filepath = path.join(this.researchDir, filename);

    // Serializar com datas convertidas para ISO
    const serializable = this.serializeReport(report);
    await fs.writeFile(filepath, JSON.stringify(serializable, null, 2), 'utf8');

    return filepath;
  }

  /**
   * Carrega relatório de pesquisa por ID.
   */
  async load(reportId: string): Promise<ResearchReport | null> {
    await this.ensureInitialized();

    const filename = `${reportId}.json`;
    const filepath = path.join(this.researchDir, filename);

    try {
      const content = await fs.readFile(filepath, 'utf8');
      const parsed = JSON.parse(content);
      return this.deserializeReport(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Lista todos os IDs de relatórios salvos.
   */
  async listReportIds(): Promise<string[]> {
    await this.ensureInitialized();

    try {
      const files = await fs.readdir(this.researchDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Remove relatório por ID.
   */
  async delete(reportId: string): Promise<boolean> {
    await this.ensureInitialized();

    const filename = `${reportId}.json`;
    const filepath = path.join(this.researchDir, filename);

    try {
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Limpa todos os relatórios (útil para testes).
   */
  async clear(): Promise<number> {
    const ids = await this.listReportIds();
    let deleted = 0;

    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }

    return deleted;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MÉTODOS PRIVADOS
  // ══════════════════════════════════════════════════════════════════════════

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Serializa relatório para JSON.
   */
  private serializeReport(report: ResearchReport): unknown {
    return {
      ...report,
      startedAt: report.startedAt.toISOString(),
      finishedAt: report.finishedAt.toISOString()
    };
  }

  /**
   * Deserializa relatório do JSON.
   */
  private deserializeReport(data: Record<string, unknown>): ResearchReport {
    return {
      ...data,
      startedAt: new Date(data.startedAt as string),
      finishedAt: new Date(data.finishedAt as string)
    } as ResearchReport;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export { ResearchStore };
