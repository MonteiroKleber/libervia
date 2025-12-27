/**
 * INCREMENTO 24 — Telemetria & Métricas: Registry
 *
 * Registry in-memory para métricas.
 * Singleton por processo, suporta filtragem por tenantId.
 */

import {
  MetricLabels,
  HistogramValue,
  DEFAULT_LATENCY_BUCKETS,
  METRIC_NAMES,
  METRIC_DEFINITIONS,
  MetricDefinition
} from './TelemetryTypes';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Chave única para identificar uma série de métricas
 */
function labelsToKey(labels: MetricLabels): string {
  const sorted = Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}="${v}"`).join(',');
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTER
// ════════════════════════════════════════════════════════════════════════════

class Counter {
  private values: Map<string, { value: number; labels: MetricLabels }> = new Map();

  constructor(public readonly definition: MetricDefinition) {}

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels: { ...labels } });
    }
  }

  getValues(): Array<{ value: number; labels: MetricLabels }> {
    return Array.from(this.values.values());
  }

  getValuesForTenant(tenantId: string): Array<{ value: number; labels: MetricLabels }> {
    return this.getValues().filter(v => v.labels.tenant_id === tenantId);
  }

  reset(): void {
    this.values.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GAUGE
// ════════════════════════════════════════════════════════════════════════════

class Gauge {
  private values: Map<string, { value: number; labels: MetricLabels }> = new Map();

  constructor(public readonly definition: MetricDefinition) {}

  set(labels: MetricLabels, value: number): void {
    const key = labelsToKey(labels);
    this.values.set(key, { value, labels: { ...labels } });
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels: { ...labels } });
    }
  }

  dec(labels: MetricLabels = {}, value: number = 1): void {
    this.inc(labels, -value);
  }

  getValues(): Array<{ value: number; labels: MetricLabels }> {
    return Array.from(this.values.values());
  }

  getValuesForTenant(tenantId: string): Array<{ value: number; labels: MetricLabels }> {
    return this.getValues().filter(v => v.labels.tenant_id === tenantId);
  }

  reset(): void {
    this.values.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HISTOGRAM
// ════════════════════════════════════════════════════════════════════════════

class Histogram {
  private values: Map<string, HistogramValue> = new Map();
  private bucketBoundaries: number[];

  constructor(
    public readonly definition: MetricDefinition,
    buckets: number[] = DEFAULT_LATENCY_BUCKETS
  ) {
    this.bucketBoundaries = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: MetricLabels, value: number): void {
    const key = labelsToKey(labels);
    let histogram = this.values.get(key);

    if (!histogram) {
      histogram = {
        buckets: new Map(this.bucketBoundaries.map(b => [b, 0])),
        sum: 0,
        count: 0,
        labels: { ...labels }
      };
      this.values.set(key, histogram);
    }

    histogram.sum += value;
    histogram.count += 1;

    for (const bucket of this.bucketBoundaries) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  getValues(): Array<HistogramValue> {
    return Array.from(this.values.values());
  }

  getValuesForTenant(tenantId: string): Array<HistogramValue> {
    return this.getValues().filter(v => v.labels.tenant_id === tenantId);
  }

  getBucketBoundaries(): number[] {
    return this.bucketBoundaries;
  }

  reset(): void {
    this.values.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registry singleton para todas as métricas
 */
class TelemetryRegistry {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private startTime: number = Date.now();

  constructor() {
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Counters
    this.counters.set(
      METRIC_NAMES.HTTP_REQUESTS_TOTAL,
      new Counter(METRIC_DEFINITIONS[METRIC_NAMES.HTTP_REQUESTS_TOTAL])
    );
    this.counters.set(
      METRIC_NAMES.HTTP_ERRORS_TOTAL,
      new Counter(METRIC_DEFINITIONS[METRIC_NAMES.HTTP_ERRORS_TOTAL])
    );
    this.counters.set(
      METRIC_NAMES.AUTH_FAILURES_TOTAL,
      new Counter(METRIC_DEFINITIONS[METRIC_NAMES.AUTH_FAILURES_TOTAL])
    );
    this.counters.set(
      METRIC_NAMES.TENANT_CONFLICTS_TOTAL,
      new Counter(METRIC_DEFINITIONS[METRIC_NAMES.TENANT_CONFLICTS_TOTAL])
    );
    this.counters.set(
      METRIC_NAMES.RATE_LIMITED_TOTAL,
      new Counter(METRIC_DEFINITIONS[METRIC_NAMES.RATE_LIMITED_TOTAL])
    );

    // Gauges
    this.gauges.set(
      METRIC_NAMES.ACTIVE_INSTANCES,
      new Gauge(METRIC_DEFINITIONS[METRIC_NAMES.ACTIVE_INSTANCES])
    );
    this.gauges.set(
      METRIC_NAMES.TENANTS_TOTAL,
      new Gauge(METRIC_DEFINITIONS[METRIC_NAMES.TENANTS_TOTAL])
    );
    this.gauges.set(
      METRIC_NAMES.PROCESS_UPTIME_SECONDS,
      new Gauge(METRIC_DEFINITIONS[METRIC_NAMES.PROCESS_UPTIME_SECONDS])
    );
    this.gauges.set(
      METRIC_NAMES.PROCESS_MEMORY_BYTES,
      new Gauge(METRIC_DEFINITIONS[METRIC_NAMES.PROCESS_MEMORY_BYTES])
    );

    // Histograms
    this.histograms.set(
      METRIC_NAMES.HTTP_REQUEST_DURATION_MS,
      new Histogram(METRIC_DEFINITIONS[METRIC_NAMES.HTTP_REQUEST_DURATION_MS])
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COUNTER METHODS
  // ──────────────────────────────────────────────────────────────────────────

  incCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.inc(labels, value);
    }
  }

  getCounter(name: string): Counter | undefined {
    return this.counters.get(name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GAUGE METHODS
  // ──────────────────────────────────────────────────────────────────────────

  setGauge(name: string, labels: MetricLabels, value: number): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.set(labels, value);
    }
  }

  incGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.inc(labels, value);
    }
  }

  decGauge(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.dec(labels, value);
    }
  }

  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HISTOGRAM METHODS
  // ──────────────────────────────────────────────────────────────────────────

  observeHistogram(name: string, labels: MetricLabels, value: number): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.observe(labels, value);
    }
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONVENIENCE METHODS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Incrementa contador de requisições HTTP
   */
  incHttpRequests(labels: {
    method: string;
    route: string;
    status_code: string;
    tenant_id?: string;
  }): void {
    this.incCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL, labels);
  }

  /**
   * Registra duração de requisição HTTP
   */
  observeHttpDuration(labels: {
    method: string;
    route: string;
    tenant_id?: string;
  }, durationMs: number): void {
    this.observeHistogram(METRIC_NAMES.HTTP_REQUEST_DURATION_MS, labels, durationMs);
  }

  /**
   * Incrementa contador de erros HTTP
   */
  incHttpError(labels: {
    error_code: string;
    tenant_id?: string;
  }): void {
    this.incCounter(METRIC_NAMES.HTTP_ERRORS_TOTAL, labels);
  }

  /**
   * Incrementa contador de falhas de autenticação
   */
  incAuthFailure(labels: {
    reason: string;
    tenant_id?: string;
  }): void {
    this.incCounter(METRIC_NAMES.AUTH_FAILURES_TOTAL, labels);
  }

  /**
   * Incrementa contador de conflitos de tenant
   */
  incTenantConflict(tenantId: string): void {
    this.incCounter(METRIC_NAMES.TENANT_CONFLICTS_TOTAL, { tenant_id: tenantId });
  }

  /**
   * Incrementa contador de rate limit
   */
  incRateLimited(tenantId: string): void {
    this.incCounter(METRIC_NAMES.RATE_LIMITED_TOTAL, { tenant_id: tenantId });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RUNTIME METRICS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Atualiza métricas de runtime (chamado periodicamente ou sob demanda)
   */
  updateRuntimeMetrics(): void {
    // Uptime
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    this.setGauge(METRIC_NAMES.PROCESS_UPTIME_SECONDS, {}, uptimeSeconds);

    // Memory
    const mem = process.memoryUsage();
    this.setGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES, { type: 'heap_used' }, mem.heapUsed);
    this.setGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES, { type: 'heap_total' }, mem.heapTotal);
    this.setGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES, { type: 'rss' }, mem.rss);
    this.setGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES, { type: 'external' }, mem.external);
  }

  /**
   * Atualiza métricas de tenants
   */
  updateTenantMetrics(counts: { active: number; suspended: number; deleted: number }): void {
    this.setGauge(METRIC_NAMES.TENANTS_TOTAL, { status: 'active' }, counts.active);
    this.setGauge(METRIC_NAMES.TENANTS_TOTAL, { status: 'suspended' }, counts.suspended);
    this.setGauge(METRIC_NAMES.TENANTS_TOTAL, { status: 'deleted' }, counts.deleted);
  }

  /**
   * Atualiza métricas de instâncias ativas
   */
  updateActiveInstances(tenantId: string, count: number): void {
    this.setGauge(METRIC_NAMES.ACTIVE_INSTANCES, { tenant_id: tenantId }, count);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Retorna todos os counters
   */
  getAllCounters(): Map<string, Counter> {
    return this.counters;
  }

  /**
   * Retorna todos os gauges
   */
  getAllGauges(): Map<string, Gauge> {
    return this.gauges;
  }

  /**
   * Retorna todos os histograms
   */
  getAllHistograms(): Map<string, Histogram> {
    return this.histograms;
  }

  /**
   * Retorna o uptime em segundos
   */
  getUptimeSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Reset de todas as métricas (útil para testes)
   */
  reset(): void {
    this.counters.forEach(c => c.reset());
    this.gauges.forEach(g => g.reset());
    this.histograms.forEach(h => h.reset());
    this.startTime = Date.now();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

let instance: TelemetryRegistry | null = null;

/**
 * Retorna a instância singleton do registry
 */
export function getTelemetryRegistry(): TelemetryRegistry {
  if (!instance) {
    instance = new TelemetryRegistry();
  }
  return instance;
}

/**
 * Reset do singleton (para testes)
 */
export function resetTelemetryRegistry(): void {
  if (instance) {
    instance.reset();
  }
}

export { TelemetryRegistry, Counter, Gauge, Histogram };
