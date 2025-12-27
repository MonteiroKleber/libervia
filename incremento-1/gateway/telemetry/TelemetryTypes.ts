/**
 * INCREMENTO 24 — Telemetria & Métricas: Types
 *
 * Tipos para métricas de observabilidade.
 * Suporta counters, gauges e histograms.
 */

// ════════════════════════════════════════════════════════════════════════════
// METRIC TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tipos de métricas suportadas
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Labels para identificar dimensões da métrica
 */
export interface MetricLabels {
  [key: string]: string | undefined;
}

/**
 * Definição base de uma métrica
 */
export interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labels?: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Counter: valor monotonicamente crescente
 */
export interface CounterValue {
  value: number;
  labels: MetricLabels;
}

// ════════════════════════════════════════════════════════════════════════════
// GAUGE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gauge: valor que pode subir ou descer
 */
export interface GaugeValue {
  value: number;
  labels: MetricLabels;
}

// ════════════════════════════════════════════════════════════════════════════
// HISTOGRAM
// ════════════════════════════════════════════════════════════════════════════

/**
 * Buckets padrão para latência HTTP (em ms)
 */
export const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Histogram: distribuição de valores
 */
export interface HistogramValue {
  buckets: Map<number, number>; // bucket_le -> count
  sum: number;
  count: number;
  labels: MetricLabels;
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP METRICS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Labels para métricas HTTP
 */
export interface HttpMetricLabels extends MetricLabels {
  method: string;
  route: string;
  status_code: string;
  tenant_id?: string;
}

/**
 * Labels para métricas de erro
 */
export interface ErrorMetricLabels extends MetricLabels {
  error_code: string;
  tenant_id?: string;
}

/**
 * Labels para métricas de autenticação
 */
export interface AuthMetricLabels extends MetricLabels {
  reason: string;
  tenant_id?: string;
}

/**
 * Labels para métricas de rate limit
 */
export interface RateLimitMetricLabels extends MetricLabels {
  tenant_id: string;
}

// ════════════════════════════════════════════════════════════════════════════
// SNAPSHOT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Snapshot de métricas para export
 */
export interface MetricSnapshot {
  name: string;
  help: string;
  type: MetricType;
  values: Array<{
    labels: MetricLabels;
    value: number;
    buckets?: Map<number, number>;
    sum?: number;
    count?: number;
  }>;
}

/**
 * Snapshot completo de todas as métricas
 */
export interface TelemetrySnapshot {
  timestamp: string;
  metrics: MetricSnapshot[];
}

/**
 * Snapshot filtrado por tenant
 */
export interface TenantTelemetrySnapshot extends TelemetrySnapshot {
  tenantId: string;
}

// ════════════════════════════════════════════════════════════════════════════
// METRIC NAMES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Nomes das métricas (constantes)
 */
export const METRIC_NAMES = {
  // HTTP
  HTTP_REQUESTS_TOTAL: 'libervia_http_requests_total',
  HTTP_REQUEST_DURATION_MS: 'libervia_http_request_duration_ms',
  HTTP_ERRORS_TOTAL: 'libervia_http_errors_total',

  // Security
  AUTH_FAILURES_TOTAL: 'libervia_auth_failures_total',
  TENANT_CONFLICTS_TOTAL: 'libervia_tenant_conflicts_total',
  RATE_LIMITED_TOTAL: 'libervia_rate_limited_total',

  // Runtime
  ACTIVE_INSTANCES: 'libervia_active_instances',
  TENANTS_TOTAL: 'libervia_tenants_total',

  // Process
  PROCESS_UPTIME_SECONDS: 'libervia_process_uptime_seconds',
  PROCESS_MEMORY_BYTES: 'libervia_process_memory_bytes'
} as const;

/**
 * Definições das métricas
 */
export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  [METRIC_NAMES.HTTP_REQUESTS_TOTAL]: {
    name: METRIC_NAMES.HTTP_REQUESTS_TOTAL,
    help: 'Total number of HTTP requests',
    type: 'counter',
    labels: ['method', 'route', 'status_code', 'tenant_id']
  },
  [METRIC_NAMES.HTTP_REQUEST_DURATION_MS]: {
    name: METRIC_NAMES.HTTP_REQUEST_DURATION_MS,
    help: 'HTTP request duration in milliseconds',
    type: 'histogram',
    labels: ['method', 'route', 'tenant_id']
  },
  [METRIC_NAMES.HTTP_ERRORS_TOTAL]: {
    name: METRIC_NAMES.HTTP_ERRORS_TOTAL,
    help: 'Total number of HTTP errors',
    type: 'counter',
    labels: ['error_code', 'tenant_id']
  },
  [METRIC_NAMES.AUTH_FAILURES_TOTAL]: {
    name: METRIC_NAMES.AUTH_FAILURES_TOTAL,
    help: 'Total number of authentication failures',
    type: 'counter',
    labels: ['reason', 'tenant_id']
  },
  [METRIC_NAMES.TENANT_CONFLICTS_TOTAL]: {
    name: METRIC_NAMES.TENANT_CONFLICTS_TOTAL,
    help: 'Total number of tenant conflict errors',
    type: 'counter',
    labels: ['tenant_id']
  },
  [METRIC_NAMES.RATE_LIMITED_TOTAL]: {
    name: METRIC_NAMES.RATE_LIMITED_TOTAL,
    help: 'Total number of rate limited requests',
    type: 'counter',
    labels: ['tenant_id']
  },
  [METRIC_NAMES.ACTIVE_INSTANCES]: {
    name: METRIC_NAMES.ACTIVE_INSTANCES,
    help: 'Number of active tenant instances',
    type: 'gauge',
    labels: ['tenant_id']
  },
  [METRIC_NAMES.TENANTS_TOTAL]: {
    name: METRIC_NAMES.TENANTS_TOTAL,
    help: 'Total number of registered tenants',
    type: 'gauge',
    labels: ['status']
  },
  [METRIC_NAMES.PROCESS_UPTIME_SECONDS]: {
    name: METRIC_NAMES.PROCESS_UPTIME_SECONDS,
    help: 'Process uptime in seconds',
    type: 'gauge',
    labels: []
  },
  [METRIC_NAMES.PROCESS_MEMORY_BYTES]: {
    name: METRIC_NAMES.PROCESS_MEMORY_BYTES,
    help: 'Process memory usage in bytes',
    type: 'gauge',
    labels: ['type']
  }
};
