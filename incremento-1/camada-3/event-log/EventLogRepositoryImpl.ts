import * as fs from 'fs/promises';
import * as path from 'path';
import { computeEventHash, computePayloadHash } from '../utilitarios/HashUtil';
import {
  EventLogRepository,
  ExportRangeOptions,
  ExportRangeResult,
  ExportManifest,
  ReplayOptions,
  ReplayResult,
  ReplayInconsistency
} from './EventLogRepository';
import { ActorId, EventLogEntry, ChainVerificationResult } from './EventLogEntry';

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.2: CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════

interface EventLogConfig {
  /** Número máximo de eventos por segmento antes de rotação */
  segmentSize: number;
  /** Atualizar snapshot a cada N eventos */
  snapshotEvery: number;
  /** Número de segmentos a manter (retenção) */
  retentionSegments: number;
}

const DEFAULT_CONFIG: EventLogConfig = {
  segmentSize: 10_000,
  snapshotEvery: 1000,
  retentionSegments: 30
};

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.3: LIMITES DE AUDITORIA
// ════════════════════════════════════════════════════════════════════════

const MAX_EVENTS_EXPORT = 10_000;
const MAX_EVENTS_REPLAY = 50_000;

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.2: SNAPSHOT (CHECKPOINT)
// ════════════════════════════════════════════════════════════════════════

interface EventLogSnapshot {
  version: 1;
  last_segment: number;
  last_index_in_segment: number;
  last_event_id: string;
  last_current_hash: string;
  last_timestamp: string; // ISO
  total_events: number;
}

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.2: DEBUG STATS (PARA TESTES)
// ════════════════════════════════════════════════════════════════════════

interface VerifyDebugStats {
  startedFromSnapshot: boolean;
  snapshotEventIndex: number;
  verifiedEvents: number;
  totalEvents: number;
  segmentsVerified: number;
}

// ════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE SERIALIZAÇÃO E RE-HIDRATAÇÃO
// ════════════════════════════════════════════════════════════════════════

function serializeEntry(e: EventLogEntry): any {
  return {
    ...e,
    timestamp: e.timestamp.toISOString()
  };
}

function reviveEntry(raw: any): EventLogEntry {
  return {
    ...raw,
    timestamp: new Date(raw.timestamp)
  };
}

// ════════════════════════════════════════════════════════════════════════
// GERAÇÃO DE ID
// ════════════════════════════════════════════════════════════════════════

function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `evt-${timestamp}-${random}`;
}

// ════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS DE SEGMENTO
// ════════════════════════════════════════════════════════════════════════

function segmentFileName(segmentNumber: number): string {
  return `segment-${String(segmentNumber).padStart(6, '0')}.json`;
}

function parseSegmentNumber(fileName: string): number | null {
  const match = fileName.match(/^segment-(\d{6})\.json$/);
  return match ? parseInt(match[1], 10) : null;
}

// ════════════════════════════════════════════════════════════════════════
// ESCRITA ATÔMICA
// ════════════════════════════════════════════════════════════════════════

async function atomicWriteJson(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// ════════════════════════════════════════════════════════════════════════
// IMPLEMENTAÇÃO
// ════════════════════════════════════════════════════════════════════════

class EventLogRepositoryImpl implements EventLogRepository {
  private dataDir: string;
  private segmentDir: string;
  private snapshotPath: string;
  private legacyPath: string;
  private legacyBackupPath: string;

  private config: EventLogConfig;
  private initialized: boolean = false;

  // Estado em memória
  private currentSegment: number = 1;
  private currentSegmentEntries: EventLogEntry[] = [];
  private snapshot: EventLogSnapshot | null = null;
  private totalEvents: number = 0;
  private lastHash: string | null = null;
  private eventsSinceSnapshot: number = 0;

  // Cache para consultas (carregado sob demanda)
  // AVISO: Em produção com muitos eventos, isso pode consumir memória
  private allEntriesCache: EventLogEntry[] | null = null;

  constructor(dataDir: string = './data', config: Partial<EventLogConfig> = {}) {
    this.dataDir = dataDir;
    this.segmentDir = path.join(dataDir, 'event-log');
    this.snapshotPath = path.join(dataDir, 'event-log-snapshot.json');
    this.legacyPath = path.join(dataDir, 'event-log.json');
    this.legacyBackupPath = path.join(dataDir, 'event-log.legacy.json');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static async create(
    dataDir: string = './data',
    config: Partial<EventLogConfig> = {}
  ): Promise<EventLogRepositoryImpl> {
    const repo = new EventLogRepositoryImpl(dataDir, config);
    await repo.init();
    return repo;
  }

  async init(): Promise<void> {
    // 1. Verificar e migrar legado se necessário
    await this.migrateLegacyIfNeeded();

    // 2. Carregar snapshot
    this.snapshot = await readJsonSafe<EventLogSnapshot>(this.snapshotPath);

    // 3. Determinar segmento atual e carregar
    await this.loadCurrentState();

    this.initialized = true;
  }

  private async migrateLegacyIfNeeded(): Promise<void> {
    const legacyExists = await fs.access(this.legacyPath).then(() => true).catch(() => false);
    if (!legacyExists) return;

    // ✅ A) "Já migrado" = existe pelo menos o segment-000001.json (não só o diretório)
    const segment1Path = path.join(this.segmentDir, segmentFileName(1));
    const segment1Exists = await fs.access(segment1Path).then(() => true).catch(() => false);

    // Se já existe segment-000001, só garantir snapshot (se faltar) e mover legado pra backup
    if (segment1Exists) {
      // ✅ B) idempotência: não reescreve segment-000001
      const snapshotExists = await fs.access(this.snapshotPath).then(() => true).catch(() => false);

      if (!snapshotExists) {
        const segRaw = await readJsonSafe<any[]>(segment1Path);
        const entries = (segRaw ?? []).map(reviveEntry);

        if (entries.length > 0) {
          // ✅ C) validação mínima antes de confiar no last_current_hash
          const ok = this.verifyEntriesInMemory(entries);
          if (ok) {
            const lastEntry = entries[entries.length - 1];
            const snapshot: EventLogSnapshot = {
              version: 1,
              last_segment: 1,
              last_index_in_segment: entries.length - 1,
              last_event_id: lastEntry.id,
              last_current_hash: lastEntry.current_hash,
              last_timestamp: lastEntry.timestamp.toISOString(),
              total_events: entries.length
            };
            await atomicWriteJson(this.snapshotPath, snapshot);
          }
        }
      }

      await this.safeMoveLegacyToBackup();
      return;
    }

    // Checar diretório (mas não usar isso como "já migrado")
    await fs.mkdir(this.segmentDir, { recursive: true });

    // Carregar legado
    const legacyRaw = await readJsonSafe<any[]>(this.legacyPath);
    if (!legacyRaw || legacyRaw.length === 0) {
      await this.safeMoveLegacyToBackup();
      return;
    }

    const entries = legacyRaw.map(reviveEntry);

    // ✅ C) validação mínima do legado antes de gerar snapshot confiável
    const valid = this.verifyEntriesInMemory(entries);

    // ✅ B) escrever segmento de forma idempotente: só escreve se não existir
    const seg1ExistsNow = await fs.access(segment1Path).then(() => true).catch(() => false);
    if (!seg1ExistsNow) {
      await atomicWriteJson(segment1Path, entries.map(serializeEntry));
    }

    // snapshot só se for válido
    if (valid) {
      const lastEntry = entries[entries.length - 1];
      const snapshot: EventLogSnapshot = {
        version: 1,
        last_segment: 1,
        last_index_in_segment: entries.length - 1,
        last_event_id: lastEntry.id,
        last_current_hash: lastEntry.current_hash,
        last_timestamp: lastEntry.timestamp.toISOString(),
        total_events: entries.length
      };
      await atomicWriteJson(this.snapshotPath, snapshot);
    }

    // ✅ D) mover legado para backup com fallback seguro
    await this.safeMoveLegacyToBackup();
  }

  /**
   * Validação mínima (mesmo algoritmo do verifyChain, mas em memória, só para migração).
   * Retorna true se a cadeia bate (genesis + encadeamento + hash).
   */
  private verifyEntriesInMemory(entries: EventLogEntry[]): boolean {
    if (entries.length === 0) return true;

    const genesis = entries[0];
    if (genesis.previous_hash !== null) return false;

    const expectedGenesisHash = computeEventHash(
      null,
      genesis.timestamp,
      genesis.actor,
      genesis.evento,
      genesis.entidade,
      genesis.entidade_id,
      genesis.payload_hash
    );
    if (genesis.current_hash !== expectedGenesisHash) return false;

    for (let i = 1; i < entries.length; i++) {
      const cur = entries[i];
      const prev = entries[i - 1];

      if (cur.previous_hash !== prev.current_hash) return false;

      const expected = computeEventHash(
        cur.previous_hash,
        cur.timestamp,
        cur.actor,
        cur.evento,
        cur.entidade,
        cur.entidade_id,
        cur.payload_hash
      );
      if (cur.current_hash !== expected) return false;
    }

    return true;
  }

  /**
   * ✅ D) rename com fallback copy+unlink se rename falhar
   */
  private async safeMoveLegacyToBackup(): Promise<void> {
    try {
      await fs.rename(this.legacyPath, this.legacyBackupPath);
    } catch {
      // fallback: copy then unlink
      try {
        const content = await fs.readFile(this.legacyPath);
        await fs.writeFile(this.legacyBackupPath, content);
        await fs.unlink(this.legacyPath);
      } catch {
        // Se falhar aqui, não bloqueia init. Apenas deixa legado no lugar.
      }
    }
  }

  private async loadCurrentState(): Promise<void> {
    // Listar segmentos existentes
    const segmentDirExists = await fs.access(this.segmentDir).then(() => true).catch(() => false);

    if (!segmentDirExists) {
      // Nenhum segmento ainda
      this.currentSegment = 1;
      this.currentSegmentEntries = [];
      this.totalEvents = 0;
      this.lastHash = null;
      this.eventsSinceSnapshot = 0;
      return;
    }

    const files = await fs.readdir(this.segmentDir);
    const segmentNumbers = files
      .map(parseSegmentNumber)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);

    if (segmentNumbers.length === 0) {
      this.currentSegment = 1;
      this.currentSegmentEntries = [];
      this.totalEvents = 0;
      this.lastHash = null;
      this.eventsSinceSnapshot = 0;
      return;
    }

    // Carregar último segmento
    this.currentSegment = segmentNumbers[segmentNumbers.length - 1];
    const lastSegmentPath = path.join(this.segmentDir, segmentFileName(this.currentSegment));
    const lastSegmentRaw = await readJsonSafe<any[]>(lastSegmentPath);
    this.currentSegmentEntries = (lastSegmentRaw || []).map(reviveEntry);

    // Calcular total de eventos
    if (this.snapshot) {
      // Usar snapshot como base + eventos do segmento atual após snapshot
      const eventsInCurrentAfterSnapshot = this.currentSegment === this.snapshot.last_segment
        ? this.currentSegmentEntries.length - (this.snapshot.last_index_in_segment + 1)
        : this.currentSegmentEntries.length;

      // Contar segmentos entre snapshot e atual
      let eventsBetween = 0;
      for (let seg = this.snapshot.last_segment + 1; seg < this.currentSegment; seg++) {
        const segPath = path.join(this.segmentDir, segmentFileName(seg));
        const segData = await readJsonSafe<any[]>(segPath);
        eventsBetween += segData ? segData.length : 0;
      }

      this.totalEvents = this.snapshot.total_events + eventsBetween + eventsInCurrentAfterSnapshot;
      this.eventsSinceSnapshot = eventsBetween + eventsInCurrentAfterSnapshot;
    } else {
      // Sem snapshot, contar todos
      let total = 0;
      for (const segNum of segmentNumbers) {
        const segPath = path.join(this.segmentDir, segmentFileName(segNum));
        const segData = await readJsonSafe<any[]>(segPath);
        total += segData ? segData.length : 0;
      }
      this.totalEvents = total;
      this.eventsSinceSnapshot = total;
    }

    // Obter último hash
    if (this.currentSegmentEntries.length > 0) {
      this.lastHash = this.currentSegmentEntries[this.currentSegmentEntries.length - 1].current_hash;
    } else if (this.snapshot) {
      this.lastHash = this.snapshot.last_current_hash;
    } else {
      this.lastHash = null;
    }
  }

  private checkInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Repositório não inicializado. Use static create() ou chame init() antes de usar.'
      );
    }
  }

  private invalidateCache(): void {
    this.allEntriesCache = null;
  }

  private async persistCurrentSegment(): Promise<void> {
    await fs.mkdir(this.segmentDir, { recursive: true });
    const segmentPath = path.join(this.segmentDir, segmentFileName(this.currentSegment));
    await atomicWriteJson(segmentPath, this.currentSegmentEntries.map(serializeEntry));
  }

  private async updateSnapshot(): Promise<void> {
    if (this.currentSegmentEntries.length === 0) return;

    const lastEntry = this.currentSegmentEntries[this.currentSegmentEntries.length - 1];
    this.snapshot = {
      version: 1,
      last_segment: this.currentSegment,
      last_index_in_segment: this.currentSegmentEntries.length - 1,
      last_event_id: lastEntry.id,
      last_current_hash: lastEntry.current_hash,
      last_timestamp: lastEntry.timestamp.toISOString(),
      total_events: this.totalEvents
    };
    await atomicWriteJson(this.snapshotPath, this.snapshot);
    this.eventsSinceSnapshot = 0;
  }

  private async rotateSegment(): Promise<void> {
    // Fechar segmento atual (já persistido)
    // Atualizar snapshot antes de rotacionar
    await this.updateSnapshot();

    // Criar novo segmento
    this.currentSegment++;
    this.currentSegmentEntries = [];
  }

  async append(
    actor: ActorId,
    evento: string,
    entidade: string,
    entidadeId: string,
    payload: unknown
  ): Promise<EventLogEntry> {
    this.checkInitialized();

    const id = generateEventId();
    const timestamp = new Date();
    const payloadHash = computePayloadHash(payload);

    // Obter hash do evento anterior
    const previousHash = this.lastHash;

    // Calcular hash encadeado
    const currentHash = computeEventHash(
      previousHash,
      timestamp,
      actor,
      evento,
      entidade,
      entidadeId,
      payloadHash
    );

    const entry: EventLogEntry = {
      id,
      timestamp,
      actor,
      evento,
      entidade,
      entidade_id: entidadeId,
      payload_hash: payloadHash,
      previous_hash: previousHash,
      current_hash: currentHash
    };

    // Adicionar ao segmento atual
    this.currentSegmentEntries.push(entry);
    this.totalEvents++;
    this.lastHash = currentHash;
    this.eventsSinceSnapshot++;

    // Persistir segmento
    await this.persistCurrentSegment();

    // Invalidar cache
    this.invalidateCache();

    // Verificar se precisa rotacionar
    if (this.currentSegmentEntries.length >= this.config.segmentSize) {
      await this.rotateSegment();
    } else if (this.eventsSinceSnapshot >= this.config.snapshotEvery) {
      // Atualizar snapshot periodicamente
      await this.updateSnapshot();
    }

    return entry;
  }

  async getAll(): Promise<EventLogEntry[]> {
    this.checkInitialized();

    // AVISO: Carrega todos os segmentos em memória. Em produção com muitos
    // eventos, isso pode consumir memória significativa.
    if (this.allEntriesCache) {
      return this.allEntriesCache.map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
    }

    const entries: EventLogEntry[] = [];

    // Listar segmentos
    const segmentDirExists = await fs.access(this.segmentDir).then(() => true).catch(() => false);
    if (!segmentDirExists) {
      return [];
    }

    const files = await fs.readdir(this.segmentDir);
    const segmentNumbers = files
      .map(parseSegmentNumber)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);

    for (const segNum of segmentNumbers) {
      if (segNum === this.currentSegment) {
        // Usar dados em memória para segmento atual
        entries.push(...this.currentSegmentEntries);
      } else {
        const segPath = path.join(this.segmentDir, segmentFileName(segNum));
        const segData = await readJsonSafe<any[]>(segPath);
        if (segData) {
          entries.push(...segData.map(reviveEntry));
        }
      }
    }

    this.allEntriesCache = entries;
    return entries.map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
  }

  async getById(id: string): Promise<EventLogEntry | null> {
    this.checkInitialized();
    const all = await this.getAll();
    const entry = all.find(e => e.id === id);
    return entry || null;
  }

  async getByEvento(evento: string): Promise<EventLogEntry[]> {
    this.checkInitialized();
    const all = await this.getAll();
    return all.filter(e => e.evento === evento);
  }

  async getByEntidade(entidade: string, entidadeId?: string): Promise<EventLogEntry[]> {
    this.checkInitialized();
    const all = await this.getAll();
    return all.filter(e =>
      e.entidade === entidade &&
      (entidadeId === undefined || e.entidade_id === entidadeId)
    );
  }

  async getLastEntry(): Promise<EventLogEntry | null> {
    this.checkInitialized();
    if (this.currentSegmentEntries.length > 0) {
      const last = this.currentSegmentEntries[this.currentSegmentEntries.length - 1];
      return { ...last, timestamp: new Date(last.timestamp) };
    }
    // Se segmento atual está vazio, buscar do anterior
    if (this.currentSegment > 1) {
      const prevSegPath = path.join(this.segmentDir, segmentFileName(this.currentSegment - 1));
      const prevData = await readJsonSafe<any[]>(prevSegPath);
      if (prevData && prevData.length > 0) {
        const last = reviveEntry(prevData[prevData.length - 1]);
        return { ...last, timestamp: new Date(last.timestamp) };
      }
    }
    return null;
  }

  async count(): Promise<number> {
    this.checkInitialized();
    return this.totalEvents;
  }

  /**
   * Verifica integridade da cadeia.
   * Por padrão, usa fast verify a partir do snapshot.
   * Para verificação completa desde genesis, use verifyChainFull().
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    this.checkInitialized();

    if (this.totalEvents === 0) {
      return { valid: true, totalVerified: 0 };
    }

    // Fast verify: começar do snapshot se disponível
    return this.verifyFromSnapshot();
  }

  /**
   * INCREMENTO 4.2: Verificação completa desde genesis.
   * Ignora snapshot e verifica toda a cadeia.
   */
  async verifyChainFull(): Promise<ChainVerificationResult> {
    this.checkInitialized();

    if (this.totalEvents === 0) {
      return { valid: true, totalVerified: 0 };
    }

    const all = await this.getAll();
    return this.verifyEntries(all, 0, true);
  }

  /**
   * INCREMENTO 4.3: Verificação rápida a partir do snapshot.
   * Se snapshot não existe, fallback para verificação completa.
   * API pública para auditoria operacional.
   */
  async verifyFromSnapshot(): Promise<ChainVerificationResult> {
    this.checkInitialized();

    if (this.totalEvents === 0) {
      return { valid: true, totalVerified: 0 };
    }

    const all = await this.getAll();

    if (!this.snapshot || this.snapshot.total_events === 0) {
      // Sem snapshot, verificar tudo
      return this.verifyEntries(all, 0, true);
    }

    // Encontrar índice do evento do snapshot
    const snapshotIndex = all.findIndex(e => e.id === this.snapshot!.last_event_id);

    if (snapshotIndex === -1) {
      // Snapshot aponta para evento que não existe - verificar tudo
      return this.verifyEntries(all, 0, true);
    }

    // Verificar que o hash do snapshot confere
    if (all[snapshotIndex].current_hash !== this.snapshot.last_current_hash) {
      // Snapshot corrompido - verificar tudo
      return this.verifyEntries(all, 0, true);
    }

    // Fast verify: começar do snapshot + 1
    const startIndex = snapshotIndex + 1;

    if (startIndex >= all.length) {
      // Nada novo após snapshot
      return { valid: true, totalVerified: all.length };
    }

    // Verificar apenas eventos após snapshot
    return this.verifyEntries(all, startIndex, false, all[snapshotIndex].current_hash);
  }

  private verifyEntries(
    entries: EventLogEntry[],
    startIndex: number,
    isGenesisCheck: boolean,
    previousHashAtStart?: string | null
  ): ChainVerificationResult {
    if (entries.length === 0) {
      return { valid: true, totalVerified: 0 };
    }

    let previousHash: string | null = previousHashAtStart ?? null;

    // Se começando do genesis, verificar primeiro evento
    if (isGenesisCheck && startIndex === 0) {
      const genesis = entries[0];

      if (genesis.previous_hash !== null) {
        return {
          valid: false,
          firstInvalidIndex: 0,
          firstInvalidId: genesis.id,
          reason: 'Genesis event must have previous_hash = null',
          totalVerified: 0
        };
      }

      const expectedGenesisHash = computeEventHash(
        null,
        genesis.timestamp,
        genesis.actor,
        genesis.evento,
        genesis.entidade,
        genesis.entidade_id,
        genesis.payload_hash
      );

      if (genesis.current_hash !== expectedGenesisHash) {
        return {
          valid: false,
          firstInvalidIndex: 0,
          firstInvalidId: genesis.id,
          reason: 'Genesis event hash mismatch',
          totalVerified: 0
        };
      }

      previousHash = genesis.current_hash;
      startIndex = 1;
    }

    // Verificar cadeia a partir de startIndex
    for (let i = startIndex; i < entries.length; i++) {
      const current = entries[i];

      // Verificar encadeamento
      if (current.previous_hash !== previousHash) {
        return {
          valid: false,
          firstInvalidIndex: i,
          firstInvalidId: current.id,
          reason: `Chain broken: previous_hash does not match previous event's current_hash`,
          totalVerified: i
        };
      }

      // Verificar hash do evento atual
      const expectedHash = computeEventHash(
        current.previous_hash,
        current.timestamp,
        current.actor,
        current.evento,
        current.entidade,
        current.entidade_id,
        current.payload_hash
      );

      if (current.current_hash !== expectedHash) {
        return {
          valid: false,
          firstInvalidIndex: i,
          firstInvalidId: current.id,
          reason: `Hash mismatch at index ${i}`,
          totalVerified: i
        };
      }

      previousHash = current.current_hash;
    }

    return { valid: true, totalVerified: entries.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  // INCREMENTO 4.2: POLÍTICA DE RETENÇÃO
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Remove segmentos antigos conforme política de retenção.
   * Nunca remove segmentos necessários para verificação a partir do snapshot.
   * Atualiza snapshot antes de remover se necessário.
   */
  async prune(): Promise<{ segmentsRemoved: number; eventsRemoved: number }> {
    this.checkInitialized();

    const segmentDirExists = await fs.access(this.segmentDir).then(() => true).catch(() => false);
    if (!segmentDirExists) {
      return { segmentsRemoved: 0, eventsRemoved: 0 };
    }

    const files = await fs.readdir(this.segmentDir);
    const segmentNumbers = files
      .map(parseSegmentNumber)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);

    if (segmentNumbers.length <= this.config.retentionSegments) {
      return { segmentsRemoved: 0, eventsRemoved: 0 };
    }

    // Calcular quantos segmentos remover
    const segmentsToRemove = segmentNumbers.length - this.config.retentionSegments;
    const segmentsToRemoveList = segmentNumbers.slice(0, segmentsToRemove);

    // Verificar se snapshot está em segmento que será removido
    const minSegmentToKeep = segmentNumbers[segmentsToRemove];

    if (this.snapshot && this.snapshot.last_segment < minSegmentToKeep) {
      // Precisa avançar snapshot para ponto seguro antes de deletar
      await this.advanceSnapshotToSegment(minSegmentToKeep);
    }

    // Remover segmentos antigos
    let eventsRemoved = 0;
    for (const segNum of segmentsToRemoveList) {
      const segPath = path.join(this.segmentDir, segmentFileName(segNum));
      const segData = await readJsonSafe<any[]>(segPath);
      eventsRemoved += segData ? segData.length : 0;
      await fs.unlink(segPath).catch(() => {});
    }

    // Atualizar total de eventos
    this.totalEvents -= eventsRemoved;
    this.invalidateCache();

    return { segmentsRemoved: segmentsToRemoveList.length, eventsRemoved };
  }

  private async advanceSnapshotToSegment(targetSegment: number): Promise<void> {
    // Carregar último evento do segmento anterior ao target
    const segPath = path.join(this.segmentDir, segmentFileName(targetSegment));
    const segData = await readJsonSafe<any[]>(segPath);

    if (!segData || segData.length === 0) {
      throw new Error(`Cannot advance snapshot: segment ${targetSegment} is empty`);
    }

    // Contar total de eventos até o primeiro evento do target segment
    let totalBefore = 0;
    const files = await fs.readdir(this.segmentDir);
    const segmentNumbers = files
      .map(parseSegmentNumber)
      .filter((n): n is number => n !== null && n < targetSegment)
      .sort((a, b) => a - b);

    for (const segNum of segmentNumbers) {
      const sPath = path.join(this.segmentDir, segmentFileName(segNum));
      const sData = await readJsonSafe<any[]>(sPath);
      totalBefore += sData ? sData.length : 0;
    }

    // Usar primeiro evento do target segment como novo checkpoint
    const firstEntry = reviveEntry(segData[0]);

    // Para manter integridade, precisamos do evento anterior
    // Vamos usar o último evento do segmento anterior se existir
    if (segmentNumbers.length > 0) {
      const lastSeg = segmentNumbers[segmentNumbers.length - 1];
      const lastSegPath = path.join(this.segmentDir, segmentFileName(lastSeg));
      const lastSegData = await readJsonSafe<any[]>(lastSegPath);

      if (lastSegData && lastSegData.length > 0) {
        const lastEntry = reviveEntry(lastSegData[lastSegData.length - 1]);
        this.snapshot = {
          version: 1,
          last_segment: lastSeg,
          last_index_in_segment: lastSegData.length - 1,
          last_event_id: lastEntry.id,
          last_current_hash: lastEntry.current_hash,
          last_timestamp: lastEntry.timestamp.toISOString(),
          total_events: totalBefore
        };
        await atomicWriteJson(this.snapshotPath, this.snapshot);
        return;
      }
    }

    // Se não há segmento anterior, criar snapshot no início do target
    // Isso só acontece se vamos remover todos os segmentos anteriores
    // Neste caso, recriamos o snapshot apontando para o novo "genesis"
    this.snapshot = {
      version: 1,
      last_segment: targetSegment,
      last_index_in_segment: 0,
      last_event_id: firstEntry.id,
      last_current_hash: firstEntry.current_hash,
      last_timestamp: firstEntry.timestamp.toISOString(),
      total_events: 1
    };
    await atomicWriteJson(this.snapshotPath, this.snapshot);
  }

  // ══════════════════════════════════════════════════════════════════════
  // INCREMENTO 4.3: AUDITORIA OPERACIONAL
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Exporta eventos por intervalo para auditoria externa.
   * Streaming por segmentos, sem carregar tudo em memória via getAll().
   *
   * @throws Error se export exceder MAX_EVENTS_EXPORT
   */
  async exportRange(options: ExportRangeOptions = {}): Promise<ExportRangeResult> {
    this.checkInitialized();

    const { fromTs, toTs, fromSegment, toSegment } = options;

    // Listar segmentos disponíveis
    const segmentNumbers = await this.listSegmentNumbers();

    if (segmentNumbers.length === 0) {
      return {
        entries: [],
        manifest: this.createEmptyManifest()
      };
    }

    // Determinar range de segmentos
    const minSeg = fromSegment ?? segmentNumbers[0];
    const maxSeg = toSegment ?? segmentNumbers[segmentNumbers.length - 1];

    const entries: EventLogEntry[] = [];
    let isFirstGlobalEvent = true;
    let globalEventIndex = 0;

    // Iterar segmentos em ordem
    for (const segNum of segmentNumbers) {
      if (segNum < minSeg || segNum > maxSeg) {
        // Contar eventos para saber se é genesis
        if (segNum < minSeg) {
          const segData = await this.loadSegment(segNum);
          globalEventIndex += segData.length;
          isFirstGlobalEvent = false;
        }
        continue;
      }

      const segmentEntries = await this.loadSegment(segNum);

      for (const entry of segmentEntries) {
        // Filtrar por timestamp se especificado
        if (fromTs && entry.timestamp < fromTs) {
          globalEventIndex++;
          isFirstGlobalEvent = false;
          continue;
        }
        if (toTs && entry.timestamp > toTs) {
          continue; // Não incrementa porque já passou
        }

        // Verificar limite
        if (entries.length >= MAX_EVENTS_EXPORT) {
          throw new Error(`Export too large: exceeds ${MAX_EVENTS_EXPORT} events`);
        }

        entries.push(entry);
        globalEventIndex++;
        if (entries.length === 1 && globalEventIndex > 1) {
          isFirstGlobalEvent = false;
        }
      }
    }

    // Verificar integridade dentro do export
    const chainValidWithinExport = this.verifyExportChain(entries, isFirstGlobalEvent && entries.length > 0 && globalEventIndex === entries.length);

    // Criar manifest
    const manifest: ExportManifest = {
      fromTs: entries.length > 0 ? entries[0].timestamp.toISOString() : null,
      toTs: entries.length > 0 ? entries[entries.length - 1].timestamp.toISOString() : null,
      fromSegment: fromSegment ?? null,
      toSegment: toSegment ?? null,
      count: entries.length,
      firstId: entries.length > 0 ? entries[0].id : null,
      lastId: entries.length > 0 ? entries[entries.length - 1].id : null,
      chainValidWithinExport
    };

    return { entries, manifest };
  }

  /**
   * Verifica integridade da cadeia dentro de um export.
   * Se startsAtGenesis=true, valida regra do genesis.
   * Caso contrário, só valida encadeamento interno.
   */
  private verifyExportChain(entries: EventLogEntry[], startsAtGenesis: boolean): boolean {
    if (entries.length === 0) return true;

    // Se começa no genesis, verificar regra do genesis
    if (startsAtGenesis) {
      const genesis = entries[0];
      if (genesis.previous_hash !== null) return false;

      const expectedHash = computeEventHash(
        null,
        genesis.timestamp,
        genesis.actor,
        genesis.evento,
        genesis.entidade,
        genesis.entidade_id,
        genesis.payload_hash
      );
      if (genesis.current_hash !== expectedHash) return false;
    }

    // Verificar encadeamento interno
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].previous_hash !== entries[i - 1].current_hash) {
        return false;
      }

      const expected = computeEventHash(
        entries[i].previous_hash,
        entries[i].timestamp,
        entries[i].actor,
        entries[i].evento,
        entries[i].entidade,
        entries[i].entidade_id,
        entries[i].payload_hash
      );
      if (entries[i].current_hash !== expected) return false;
    }

    return true;
  }

  /**
   * Gera resumo operacional determinístico (sem opinião).
   * Streaming por segmentos, trunca se exceder limite.
   */
  async replay(options: ReplayOptions = {}): Promise<ReplayResult> {
    this.checkInitialized();

    const { evento, entidade, entidadeId, fromTs, toTs } = options;

    const result: ReplayResult = {
      totalEventos: 0,
      porEvento: {},
      porEntidade: {},
      porAtor: {},
      range: { firstTs: null, lastTs: null },
      inconsistencias: [],
      truncated: false
    };

    const segmentNumbers = await this.listSegmentNumbers();
    if (segmentNumbers.length === 0) {
      return result;
    }

    let processedCount = 0;
    let previousHash: string | null = null;
    let globalIndex = 0;

    for (const segNum of segmentNumbers) {
      const segmentEntries = await this.loadSegment(segNum);

      for (const entry of segmentEntries) {
        // Verificar limite de replay
        if (processedCount >= MAX_EVENTS_REPLAY) {
          result.truncated = true;
          return result;
        }

        // Verificar inconsistências (sempre, independente de filtros)
        const inconsistency = this.checkEntryConsistency(entry, previousHash, globalIndex);
        if (inconsistency) {
          result.inconsistencias.push(inconsistency);
        }
        previousHash = entry.current_hash;
        globalIndex++;

        // Aplicar filtros
        if (evento && entry.evento !== evento) continue;
        if (entidade && entry.entidade !== entidade) continue;
        if (entidadeId && entry.entidade_id !== entidadeId) continue;
        if (fromTs && entry.timestamp < fromTs) continue;
        if (toTs && entry.timestamp > toTs) continue;

        // Contabilizar
        result.totalEventos++;
        result.porEvento[entry.evento] = (result.porEvento[entry.evento] || 0) + 1;
        result.porEntidade[entry.entidade] = (result.porEntidade[entry.entidade] || 0) + 1;
        result.porAtor[entry.actor] = (result.porAtor[entry.actor] || 0) + 1;

        // Atualizar range
        const tsIso = entry.timestamp.toISOString();
        if (!result.range.firstTs) {
          result.range.firstTs = tsIso;
        }
        result.range.lastTs = tsIso;

        processedCount++;
      }
    }

    return result;
  }

  /**
   * Verifica consistência de um único evento durante replay.
   */
  private checkEntryConsistency(
    entry: EventLogEntry,
    expectedPreviousHash: string | null,
    index: number
  ): ReplayInconsistency | null {
    // Genesis deve ter previous_hash = null
    if (index === 0) {
      if (entry.previous_hash !== null) {
        return { index, id: entry.id, reason: 'Genesis event must have previous_hash = null' };
      }
    } else {
      // Verificar encadeamento
      if (entry.previous_hash !== expectedPreviousHash) {
        return { index, id: entry.id, reason: 'Chain broken: previous_hash mismatch' };
      }
    }

    // Verificar hash do evento
    const expected = computeEventHash(
      entry.previous_hash,
      entry.timestamp,
      entry.actor,
      entry.evento,
      entry.entidade,
      entry.entidade_id,
      entry.payload_hash
    );

    if (entry.current_hash !== expected) {
      return { index, id: entry.id, reason: 'Hash mismatch' };
    }

    return null;
  }

  /**
   * Lista números de segmentos disponíveis, ordenados.
   */
  private async listSegmentNumbers(): Promise<number[]> {
    const segmentDirExists = await fs.access(this.segmentDir).then(() => true).catch(() => false);
    if (!segmentDirExists) return [];

    const files = await fs.readdir(this.segmentDir);
    return files
      .map(parseSegmentNumber)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  }

  /**
   * Carrega um segmento do disco (ou memória se for o atual).
   */
  private async loadSegment(segNum: number): Promise<EventLogEntry[]> {
    if (segNum === this.currentSegment) {
      return this.currentSegmentEntries.map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
    }

    const segPath = path.join(this.segmentDir, segmentFileName(segNum));
    const segData = await readJsonSafe<any[]>(segPath);
    return segData ? segData.map(reviveEntry) : [];
  }

  /**
   * Cria manifest vazio para export sem eventos.
   */
  private createEmptyManifest(): ExportManifest {
    return {
      fromTs: null,
      toTs: null,
      fromSegment: null,
      toSegment: null,
      count: 0,
      firstId: null,
      lastId: null,
      chainValidWithinExport: true
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÉTODOS DE DEBUG (SOMENTE PARA TESTES)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * SOMENTE PARA TESTES: Corrompe um evento para testar verifyChain.
   * @internal
   */
  _corruptEntry(index: number, field: keyof EventLogEntry, value: any): void {
    // Encontrar o evento no segmento atual ou carregar todos
    if (index < this.totalEvents - this.currentSegmentEntries.length) {
      // Evento está em segmento anterior - carregar cache
      this.getAll().then(all => {
        if (index >= 0 && index < all.length) {
          (all[index] as any)[field] = value;
          this.allEntriesCache = all;
        }
      });
    } else {
      // Evento está no segmento atual
      const localIndex = index - (this.totalEvents - this.currentSegmentEntries.length);
      if (localIndex >= 0 && localIndex < this.currentSegmentEntries.length) {
        (this.currentSegmentEntries[localIndex] as any)[field] = value;
        this.invalidateCache();
      }
    }
  }

  /**
   * SOMENTE PARA TESTES: Retorna referência interna (não clonar).
   * @internal
   */
  _getEntriesRef(): EventLogEntry[] {
    return this.currentSegmentEntries;
  }

  /**
   * SOMENTE PARA TESTES: Retorna estatísticas de debug da última verificação.
   * @internal
   */
  async _debugVerifyStats(): Promise<VerifyDebugStats> {
    const all = await this.getAll();

    if (!this.snapshot) {
      return {
        startedFromSnapshot: false,
        snapshotEventIndex: -1,
        verifiedEvents: all.length,
        totalEvents: all.length,
        segmentsVerified: await this._countSegments()
      };
    }

    const snapshotIndex = all.findIndex(e => e.id === this.snapshot!.last_event_id);
    const verifiedEvents = snapshotIndex >= 0 ? all.length - snapshotIndex - 1 : all.length;

    return {
      startedFromSnapshot: snapshotIndex >= 0,
      snapshotEventIndex: snapshotIndex,
      verifiedEvents,
      totalEvents: all.length,
      segmentsVerified: await this._countSegments()
    };
  }

  /**
   * SOMENTE PARA TESTES: Conta segmentos existentes.
   * @internal
   */
  async _countSegments(): Promise<number> {
    const segmentDirExists = await fs.access(this.segmentDir).then(() => true).catch(() => false);
    if (!segmentDirExists) return 0;

    const files = await fs.readdir(this.segmentDir);
    return files.filter(f => parseSegmentNumber(f) !== null).length;
  }

  /**
   * SOMENTE PARA TESTES: Retorna snapshot atual.
   * @internal
   */
  _getSnapshot(): EventLogSnapshot | null {
    return this.snapshot;
  }

  /**
   * SOMENTE PARA TESTES: Retorna configuração.
   * @internal
   */
  _getConfig(): EventLogConfig {
    return { ...this.config };
  }

  /**
   * SOMENTE PARA TESTES: Retorna número do segmento atual.
   * @internal
   */
  _getCurrentSegment(): number {
    return this.currentSegment;
  }

  // UPDATE é PROIBIDO - método não existe
  // DELETE é PROIBIDO - método não existe
}

export { EventLogRepositoryImpl, EventLogConfig, EventLogSnapshot };
