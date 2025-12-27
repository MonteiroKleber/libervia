/**
 * INCREMENTO 24 — Telemetria & Métricas: Snapshot
 *
 * Gera snapshots de métricas em formato Prometheus e JSON.
 * Suporta filtragem por tenant para isolamento RBAC.
 */

import {
  MetricSnapshot,
  TelemetrySnapshot,
  TenantTelemetrySnapshot,
  MetricLabels,
  METRIC_DEFINITIONS
} from './TelemetryTypes';
import { getTelemetryRegistry, Histogram } from './TelemetryRegistry';

// ════════════════════════════════════════════════════════════════════════════
// PROMETHEUS FORMAT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Formata labels para Prometheus
 * Ex: {method="GET",route="/health",status_code="200"}
 */
function formatLabels(labels: MetricLabels): string {
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${escapeLabel(String(v))}"`)
    .join(',');

  return entries ? `{${entries}}` : '';
}

/**
 * Escapa caracteres especiais em labels
 */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Gera output Prometheus para um counter
 */
function formatCounter(name: string, help: string, values: Array<{ value: number; labels: MetricLabels }>): string {
  const lines: string[] = [];
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} counter`);

  for (const { value, labels } of values) {
    lines.push(`${name}${formatLabels(labels)} ${value}`);
  }

  return lines.join('\n');
}

/**
 * Gera output Prometheus para um gauge
 */
function formatGauge(name: string, help: string, values: Array<{ value: number; labels: MetricLabels }>): string {
  const lines: string[] = [];
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} gauge`);

  for (const { value, labels } of values) {
    lines.push(`${name}${formatLabels(labels)} ${value}`);
  }

  return lines.join('\n');
}

/**
 * Gera output Prometheus para um histogram
 */
function formatHistogram(
  name: string,
  help: string,
  values: Array<{
    buckets: Map<number, number>;
    sum: number;
    count: number;
    labels: MetricLabels;
  }>,
  bucketBoundaries: number[]
): string {
  const lines: string[] = [];
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);

  for (const { buckets, sum, count, labels } of values) {
    const baseLabels = formatLabels(labels);
    const labelPrefix = baseLabels ? baseLabels.slice(0, -1) + ',' : '{';

    // Buckets
    let cumulative = 0;
    for (const le of bucketBoundaries) {
      cumulative += buckets.get(le) || 0;
      const bucketLabels = `${labelPrefix}le="${le}"}`;
      lines.push(`${name}_bucket${bucketLabels} ${cumulative}`);
    }
    // +Inf bucket
    const infLabels = `${labelPrefix}le="+Inf"}`;
    lines.push(`${name}_bucket${infLabels} ${count}`);

    // Sum and count
    lines.push(`${name}_sum${baseLabels} ${sum}`);
    lines.push(`${name}_count${baseLabels} ${count}`);
  }

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// SNAPSHOT GENERATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gera snapshot global de todas as métricas
 */
export function generateSnapshot(): TelemetrySnapshot {
  const registry = getTelemetryRegistry();
  registry.updateRuntimeMetrics();

  const metrics: MetricSnapshot[] = [];

  // Counters
  for (const [name, counter] of registry.getAllCounters()) {
    const definition = METRIC_DEFINITIONS[name] || counter.definition;
    metrics.push({
      name,
      help: definition.help,
      type: 'counter',
      values: counter.getValues().map(v => ({ labels: v.labels, value: v.value }))
    });
  }

  // Gauges
  for (const [name, gauge] of registry.getAllGauges()) {
    const definition = METRIC_DEFINITIONS[name] || gauge.definition;
    metrics.push({
      name,
      help: definition.help,
      type: 'gauge',
      values: gauge.getValues().map(v => ({ labels: v.labels, value: v.value }))
    });
  }

  // Histograms
  for (const [name, histogram] of registry.getAllHistograms()) {
    const definition = METRIC_DEFINITIONS[name] || histogram.definition;
    metrics.push({
      name,
      help: definition.help,
      type: 'histogram',
      values: histogram.getValues().map(v => ({
        labels: v.labels,
        value: v.count,
        buckets: v.buckets,
        sum: v.sum,
        count: v.count
      }))
    });
  }

  return {
    timestamp: new Date().toISOString(),
    metrics
  };
}

/**
 * Gera snapshot filtrado por tenant
 */
export function generateTenantSnapshot(tenantId: string): TenantTelemetrySnapshot {
  const registry = getTelemetryRegistry();
  registry.updateRuntimeMetrics();

  const metrics: MetricSnapshot[] = [];

  // Counters (filtrados por tenant)
  for (const [name, counter] of registry.getAllCounters()) {
    const definition = METRIC_DEFINITIONS[name] || counter.definition;
    const values = counter.getValuesForTenant(tenantId);
    if (values.length > 0) {
      metrics.push({
        name,
        help: definition.help,
        type: 'counter',
        values: values.map(v => ({ labels: v.labels, value: v.value }))
      });
    }
  }

  // Gauges (filtrados por tenant)
  for (const [name, gauge] of registry.getAllGauges()) {
    const definition = METRIC_DEFINITIONS[name] || gauge.definition;
    const values = gauge.getValuesForTenant(tenantId);
    if (values.length > 0) {
      metrics.push({
        name,
        help: definition.help,
        type: 'gauge',
        values: values.map(v => ({ labels: v.labels, value: v.value }))
      });
    }
  }

  // Histograms (filtrados por tenant)
  for (const [name, histogram] of registry.getAllHistograms()) {
    const definition = METRIC_DEFINITIONS[name] || histogram.definition;
    const values = histogram.getValuesForTenant(tenantId);
    if (values.length > 0) {
      metrics.push({
        name,
        help: definition.help,
        type: 'histogram',
        values: values.map(v => ({
          labels: v.labels,
          value: v.count,
          buckets: v.buckets,
          sum: v.sum,
          count: v.count
        }))
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    tenantId,
    metrics
  };
}

/**
 * Gera output no formato Prometheus text
 */
export function generatePrometheusOutput(): string {
  const registry = getTelemetryRegistry();
  registry.updateRuntimeMetrics();

  const sections: string[] = [];

  // Counters
  for (const [name, counter] of registry.getAllCounters()) {
    const definition = METRIC_DEFINITIONS[name] || counter.definition;
    const values = counter.getValues();
    if (values.length > 0) {
      sections.push(formatCounter(name, definition.help, values));
    }
  }

  // Gauges
  for (const [name, gauge] of registry.getAllGauges()) {
    const definition = METRIC_DEFINITIONS[name] || gauge.definition;
    const values = gauge.getValues();
    if (values.length > 0) {
      sections.push(formatGauge(name, definition.help, values));
    }
  }

  // Histograms
  for (const [name, histogram] of registry.getAllHistograms()) {
    const definition = METRIC_DEFINITIONS[name] || histogram.definition;
    const values = histogram.getValues();
    if (values.length > 0) {
      sections.push(formatHistogram(
        name,
        definition.help,
        values,
        (histogram as Histogram).getBucketBoundaries()
      ));
    }
  }

  return sections.join('\n\n') + '\n';
}

/**
 * Gera output Prometheus filtrado por tenant
 */
export function generateTenantPrometheusOutput(tenantId: string): string {
  const registry = getTelemetryRegistry();
  registry.updateRuntimeMetrics();

  const sections: string[] = [];

  // Counters (filtrados por tenant)
  for (const [name, counter] of registry.getAllCounters()) {
    const definition = METRIC_DEFINITIONS[name] || counter.definition;
    const values = counter.getValuesForTenant(tenantId);
    if (values.length > 0) {
      sections.push(formatCounter(name, definition.help, values));
    }
  }

  // Gauges (filtrados por tenant)
  for (const [name, gauge] of registry.getAllGauges()) {
    const definition = METRIC_DEFINITIONS[name] || gauge.definition;
    const values = gauge.getValuesForTenant(tenantId);
    if (values.length > 0) {
      sections.push(formatGauge(name, definition.help, values));
    }
  }

  // Histograms (filtrados por tenant)
  for (const [name, histogram] of registry.getAllHistograms()) {
    const definition = METRIC_DEFINITIONS[name] || histogram.definition;
    const values = histogram.getValuesForTenant(tenantId);
    if (values.length > 0) {
      sections.push(formatHistogram(
        name,
        definition.help,
        values,
        (histogram as Histogram).getBucketBoundaries()
      ));
    }
  }

  return sections.join('\n\n') + '\n';
}
