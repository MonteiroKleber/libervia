import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Store genérico para persistência em arquivo JSON
 * - Escrita atômica (via .tmp + rename)
 * - Controle de concorrência via fila interna
 * - Leitura segura com fallback para .tmp (recuperação de crash)
 */
class JsonFileStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private filePath: string) {}

  /**
   * Lê todos os itens do arquivo
   * Retorna array vazio se arquivo não existe
   * Tenta recuperar de .tmp se arquivo principal não existe mas .tmp existe
   */
  async readAll(): Promise<any[]> {
    const tmpPath = this.filePath + '.tmp';

    try {
      // Tentar ler arquivo principal
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Arquivo principal não existe, verificar se há .tmp de crash anterior
        try {
          const tmpExists = await fs.access(tmpPath).then(() => true).catch(() => false);
          if (tmpExists) {
            // Recuperar de .tmp (crash durante rename anterior)
            await fs.rename(tmpPath, this.filePath);
            const raw = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(raw);
          }
        } catch {
          // Ignorar erro de recuperação, retornar vazio
        }
        return [];
      }
      throw error;
    }
  }

  /**
   * Escreve todos os itens no arquivo
   * - Escrita atômica: escreve em .tmp e depois renomeia
   * - Fila interna para evitar race conditions
   * - Propaga erros corretamente sem envenenar a fila
   */
  async writeAll(items: any[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    const tmpPath = this.filePath + '.tmp';

    // Encadear escrita, capturando erro anterior para não envenenar fila
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(items, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
    });

    return this.writeChain;
  }
}

export { JsonFileStore };
