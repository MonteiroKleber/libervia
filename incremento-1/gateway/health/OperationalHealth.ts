/**
 * INCREMENTO 25 — Runbook Operacional + SLOs + Alerting
 *
 * Operational Health Assessment Module
 *
 * Avalia metricas internas e retorna status de saude operacional.
 * - OK: Sistema operando normalmente
 * - DEGRADED: Alguma metrica em threshold de warning
 * - CRITICAL: Alguma metrica em threshold critico
 *
 * Somente leitura, sem side-effects.
 */

import { getTelemetryRegistry } from '../telemetry/TelemetryRegistry';
import { METRIC_NAMES } from '../telemetry/TelemetryTypes';

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Status de saude operacional
 */
export type HealthStatus = 'OK' | 'DEGRADED' | 'CRITICAL';

/**
 * Severidade de um check individual
 */
export type CheckSeverity = 'OK' | 'WARN' | 'CRITICAL';

/**
 * Resultado de um check individual
 */
export interface HealthCheck {
  name: string;
  status: CheckSeverity;
  value: number | string;
  threshold?: number | string;
  message: string;
  sloRef?: string;
  alertRef?: string;
}

/**
 * Resposta completa do health check operacional
 */
export interface OperationalHealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
  summary: {
    total: number;
    ok: number;
    warn: number;
    critical: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════
// THRESHOLDS (baseados nos SLOs e alerting rules)
// ════════════════════════════════════════════════════════════════════════════

export const THRESHOLDS = {
  // Memory (bytes)
  MEMORY_HEAP_WARN: 500_000_000,      // 500MB - ALERT-007 warning
  MEMORY_HEAP_CRITICAL: 800_000_000,  // 800MB - ALERT-007 critical

  // Uptime
  UPTIME_WARN_SECONDS: 300,           // 5 minutes - processo reiniciou recentemente

  // Error rate (per window calculation)
  ERROR_RATE_WARN_PERCENT: 0.1,       // 0.1% - ALERT-003 warning
  ERROR_RATE_CRITICAL_PERCENT: 1.0,   // 1% - ALERT-003 critical

  // Auth failures (per second rate)
  AUTH_FAILURE_WARN_RATE: 1,          // 1/s - ALERT-004 warning
  AUTH_FAILURE_CRITICAL_RATE: 10,     // 10/s - ALERT-004 critical

  // Tenant conflicts
  TENANT_CONFLICT_WARN: 1,            // >0 em 1h - ALERT-005 warning
  TENANT_CONFLICT_CRITICAL: 10,       // >10 em 1h - ALERT-005 critical

  // Rate limit abuse
  RATE_LIMIT_ABUSE_WARN_PERCENT: 5,   // 5% - ALERT-006 warning
  RATE_LIMIT_ABUSE_CRITICAL_PERCENT: 20 // 20% - ALERT-006 critical
};

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check de memoria heap
 */
function checkMemoryHeap(): HealthCheck {
  const registry = getTelemetryRegistry();
  const gauge = registry.getGauge(METRIC_NAMES.PROCESS_MEMORY_BYTES);

  if (!gauge) {
    return {
      name: 'memory_heap',
      status: 'OK',
      value: 0,
      message: 'Memory gauge not initialized',
      sloRef: 'SLO-007',
      alertRef: 'ALERT-007'
    };
  }

  const values = gauge.getValues();
  const heapUsed = values.find(v => v.labels.type === 'heap_used');
  const heapBytes = heapUsed?.value || 0;
  const heapMB = Math.round(heapBytes / 1024 / 1024);

  let status: CheckSeverity = 'OK';
  let message = `Heap usage: ${heapMB}MB`;

  if (heapBytes >= THRESHOLDS.MEMORY_HEAP_CRITICAL) {
    status = 'CRITICAL';
    message = `Heap usage critical: ${heapMB}MB >= 800MB`;
  } else if (heapBytes >= THRESHOLDS.MEMORY_HEAP_WARN) {
    status = 'WARN';
    message = `Heap usage elevated: ${heapMB}MB >= 500MB`;
  }

  return {
    name: 'memory_heap',
    status,
    value: heapMB,
    threshold: status === 'CRITICAL' ? 800 : status === 'WARN' ? 500 : undefined,
    message,
    sloRef: 'SLO-007',
    alertRef: 'ALERT-007'
  };
}

/**
 * Check de uptime do processo
 */
function checkProcessUptime(): HealthCheck {
  const registry = getTelemetryRegistry();
  const uptimeSeconds = registry.getUptimeSeconds();
  const uptimeFormatted = formatUptime(uptimeSeconds);

  let status: CheckSeverity = 'OK';
  let message = `Process uptime: ${uptimeFormatted}`;

  if (uptimeSeconds < THRESHOLDS.UPTIME_WARN_SECONDS) {
    status = 'WARN';
    message = `Process restarted recently: ${uptimeFormatted} (< 5 minutes)`;
  }

  return {
    name: 'process_uptime',
    status,
    value: Math.round(uptimeSeconds),
    threshold: status === 'WARN' ? 300 : undefined,
    message,
    sloRef: 'SLO-006',
    alertRef: 'ALERT-008'
  };
}

/**
 * Check de taxa de erros 5xx
 */
function checkErrorRate(): HealthCheck {
  const registry = getTelemetryRegistry();

  // Get total requests
  const requestsCounter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
  const errorsCounter = registry.getCounter(METRIC_NAMES.HTTP_ERRORS_TOTAL);

  const totalRequests = sumCounterValues(requestsCounter?.getValues() || []);
  const errors5xx = sumCounterValues(
    (errorsCounter?.getValues() || []).filter(v => v.labels.error_code === '5xx')
  );

  if (totalRequests === 0) {
    return {
      name: 'error_rate_5xx',
      status: 'OK',
      value: '0%',
      message: 'No requests recorded yet',
      sloRef: 'SLO-003',
      alertRef: 'ALERT-003'
    };
  }

  const errorRate = (errors5xx / totalRequests) * 100;
  const errorRateFormatted = errorRate.toFixed(3) + '%';

  let status: CheckSeverity = 'OK';
  let message = `Error rate 5xx: ${errorRateFormatted}`;

  if (errorRate >= THRESHOLDS.ERROR_RATE_CRITICAL_PERCENT) {
    status = 'CRITICAL';
    message = `Error rate 5xx critical: ${errorRateFormatted} >= 1%`;
  } else if (errorRate >= THRESHOLDS.ERROR_RATE_WARN_PERCENT) {
    status = 'WARN';
    message = `Error rate 5xx elevated: ${errorRateFormatted} >= 0.1%`;
  }

  return {
    name: 'error_rate_5xx',
    status,
    value: errorRateFormatted,
    threshold: status === 'CRITICAL' ? '1%' : status === 'WARN' ? '0.1%' : undefined,
    message,
    sloRef: 'SLO-003',
    alertRef: 'ALERT-003'
  };
}

/**
 * Check de falhas de autenticacao
 */
function checkAuthFailures(): HealthCheck {
  const registry = getTelemetryRegistry();
  const counter = registry.getCounter(METRIC_NAMES.AUTH_FAILURES_TOTAL);
  const totalFailures = sumCounterValues(counter?.getValues() || []);

  // Para calcular rate, precisamos do uptime
  const uptimeSeconds = registry.getUptimeSeconds();
  const failureRate = uptimeSeconds > 0 ? totalFailures / uptimeSeconds : 0;

  let status: CheckSeverity = 'OK';
  let message = `Auth failures: ${totalFailures} total (${failureRate.toFixed(2)}/s avg)`;

  if (failureRate >= THRESHOLDS.AUTH_FAILURE_CRITICAL_RATE) {
    status = 'CRITICAL';
    message = `Auth failure rate critical: ${failureRate.toFixed(2)}/s >= 10/s`;
  } else if (failureRate >= THRESHOLDS.AUTH_FAILURE_WARN_RATE) {
    status = 'WARN';
    message = `Auth failure rate elevated: ${failureRate.toFixed(2)}/s >= 1/s`;
  }

  return {
    name: 'auth_failures',
    status,
    value: totalFailures,
    threshold: status === 'CRITICAL' ? '10/s' : status === 'WARN' ? '1/s' : undefined,
    message,
    sloRef: 'SLO-004',
    alertRef: 'ALERT-004'
  };
}

/**
 * Check de conflitos de tenant
 */
function checkTenantConflicts(): HealthCheck {
  const registry = getTelemetryRegistry();
  const counter = registry.getCounter(METRIC_NAMES.TENANT_CONFLICTS_TOTAL);
  const totalConflicts = sumCounterValues(counter?.getValues() || []);

  let status: CheckSeverity = 'OK';
  let message = `Tenant conflicts: ${totalConflicts} total`;

  if (totalConflicts >= THRESHOLDS.TENANT_CONFLICT_CRITICAL) {
    status = 'CRITICAL';
    message = `Tenant conflicts critical: ${totalConflicts} >= 10`;
  } else if (totalConflicts >= THRESHOLDS.TENANT_CONFLICT_WARN) {
    status = 'WARN';
    message = `Tenant conflicts detected: ${totalConflicts} >= 1`;
  }

  return {
    name: 'tenant_conflicts',
    status,
    value: totalConflicts,
    threshold: status === 'CRITICAL' ? 10 : status === 'WARN' ? 1 : undefined,
    message,
    sloRef: 'SLO-008',
    alertRef: 'ALERT-005'
  };
}

/**
 * Check de rate limiting
 */
function checkRateLimitAbuse(): HealthCheck {
  const registry = getTelemetryRegistry();

  const requestsCounter = registry.getCounter(METRIC_NAMES.HTTP_REQUESTS_TOTAL);
  const rateLimitedCounter = registry.getCounter(METRIC_NAMES.RATE_LIMITED_TOTAL);

  const totalRequests = sumCounterValues(requestsCounter?.getValues() || []);
  const totalRateLimited = sumCounterValues(rateLimitedCounter?.getValues() || []);

  if (totalRequests === 0) {
    return {
      name: 'rate_limit_abuse',
      status: 'OK',
      value: '0%',
      message: 'No requests recorded yet',
      sloRef: 'SLO-005',
      alertRef: 'ALERT-006'
    };
  }

  const rateLimitRate = (totalRateLimited / totalRequests) * 100;
  const rateFormatted = rateLimitRate.toFixed(2) + '%';

  let status: CheckSeverity = 'OK';
  let message = `Rate limited: ${rateFormatted} of requests`;

  if (rateLimitRate >= THRESHOLDS.RATE_LIMIT_ABUSE_CRITICAL_PERCENT) {
    status = 'CRITICAL';
    message = `Rate limit abuse critical: ${rateFormatted} >= 20%`;
  } else if (rateLimitRate >= THRESHOLDS.RATE_LIMIT_ABUSE_WARN_PERCENT) {
    status = 'WARN';
    message = `Rate limit abuse elevated: ${rateFormatted} >= 5%`;
  }

  return {
    name: 'rate_limit_abuse',
    status,
    value: rateFormatted,
    threshold: status === 'CRITICAL' ? '20%' : status === 'WARN' ? '5%' : undefined,
    message,
    sloRef: 'SLO-005',
    alertRef: 'ALERT-006'
  };
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Soma valores de um counter
 */
function sumCounterValues(values: Array<{ value: number }>): number {
  return values.reduce((sum, v) => sum + v.value, 0);
}

/**
 * Formata uptime em string legivel
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Determina status geral baseado nos checks
 */
function determineOverallStatus(checks: HealthCheck[]): HealthStatus {
  const hasCritical = checks.some(c => c.status === 'CRITICAL');
  const hasWarn = checks.some(c => c.status === 'WARN');

  if (hasCritical) return 'CRITICAL';
  if (hasWarn) return 'DEGRADED';
  return 'OK';
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ASSESSMENT FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Realiza avaliacao completa de saude operacional
 *
 * Somente leitura - nao modifica nenhum estado
 */
export function assessOperationalHealth(): OperationalHealthResponse {
  const registry = getTelemetryRegistry();

  // Atualizar metricas de runtime antes de avaliar
  registry.updateRuntimeMetrics();

  // Executar todos os checks
  const checks: HealthCheck[] = [
    checkMemoryHeap(),
    checkProcessUptime(),
    checkErrorRate(),
    checkAuthFailures(),
    checkTenantConflicts(),
    checkRateLimitAbuse()
  ];

  // Calcular summary
  const summary = {
    total: checks.length,
    ok: checks.filter(c => c.status === 'OK').length,
    warn: checks.filter(c => c.status === 'WARN').length,
    critical: checks.filter(c => c.status === 'CRITICAL').length
  };

  // Determinar status geral
  const status = determineOverallStatus(checks);

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(registry.getUptimeSeconds()),
    checks,
    summary
  };
}

/**
 * Retorna apenas o status (para health checks simples)
 */
export function getQuickHealthStatus(): HealthStatus {
  return assessOperationalHealth().status;
}
