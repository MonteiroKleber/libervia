#!/usr/bin/env ts-node

/**
 * ════════════════════════════════════════════════════════════════════════════
 * INCREMENTO 9: METRICAS DE OPERACAO CONTINUA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Script para coletar, consolidar e alertar sobre metricas operacionais
 * do Cerebro Institucional.
 *
 * Metricas coletadas:
 * - Estado do EventLog (eventos, segmentos, chain)
 * - Ultimo drill (tempo, status, erros)
 * - Ultimo backup (data, tamanho, chain)
 * - Performance (tempo medio de requisicao)
 *
 * Uso:
 *   npm run operacao:metrics [DATA_DIR] [OUTPUT_DIR]
 *   npm run operacao:metrics ./data ./test-artifacts/operacao
 *
 * Saida:
 *   - Console: Resumo com alertas
 *   - JSON: test-artifacts/operacao/<timestamp>/metrics.json
 *   - Log: test-artifacts/operacao/<timestamp>/metrics.log
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_DATA_DIR = './data';
const DEFAULT_OUTPUT_DIR = './test-artifacts/operacao';

// Thresholds de alerta
const THRESHOLDS = {
  // Tempo do drill em segundos
  drill_tempo_warning: 120,
  drill_tempo_critical: 300,

  // Erros de chain
  chain_erros_warning: 1,
  chain_erros_critical: 1,

  // Numero de segmentos
  segmentos_warning: 100,
  segmentos_critical: 500,

  // Numero de eventos
  eventos_warning: 100_000,
  eventos_critical: 500_000,

  // Taxa de sucesso do drill (percentual)
  drill_taxa_warning: 100,
  drill_taxa_critical: 90,

  // Tempo medio de requisicao em ms
  tempo_medio_warning: 500,
  tempo_medio_critical: 2000,

  // Dias desde ultimo backup
  backup_dias_warning: 7,
  backup_dias_critical: 14,

  // Dias desde ultimo drill
  drill_dias_warning: 14,
  drill_dias_critical: 30
};

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

type AlertLevel = 'OK' | 'WARNING' | 'CRITICAL';

interface MetricAlert {
  metric: string;
  level: AlertLevel;
  value: number | string;
  threshold: number | string;
  message: string;
}

interface EventLogMetrics {
  total_eventos: number;
  total_segmentos: number;
  chain_valid: boolean;
  chain_reason?: string;
  ultimo_evento_id?: string;
  ultimo_evento_timestamp?: string;
}

interface DrillMetrics {
  ultimo_drill_timestamp?: string;
  ultimo_drill_duracao_ms?: number;
  ultimo_drill_status?: string;
  ultimo_drill_cenarios_passou?: number;
  ultimo_drill_cenarios_total?: number;
  ultimo_drill_taxa_sucesso?: number;
  dias_desde_ultimo_drill?: number;
}

interface BackupMetrics {
  ultimo_backup_timestamp?: string;
  ultimo_backup_tamanho_bytes?: number;
  ultimo_backup_eventos?: number;
  ultimo_backup_chain_valid?: boolean;
  dias_desde_ultimo_backup?: number;
}

interface OperacaoMetrics {
  timestamp: string;
  data_dir: string;
  eventlog: EventLogMetrics;
  drill: DrillMetrics;
  backup: BackupMetrics;
  alertas: MetricAlert[];
  status_geral: AlertLevel;
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════════

function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diasDesde(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// COLETORES DE METRICAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Coleta metricas do EventLog
 */
async function coletarMetricasEventLog(dataDir: string): Promise<EventLogMetrics> {
  const metrics: EventLogMetrics = {
    total_eventos: 0,
    total_segmentos: 0,
    chain_valid: false
  };

  try {
    const eventLog = await EventLogRepositoryImpl.create(dataDir);

    metrics.total_eventos = await eventLog.count();
    metrics.total_segmentos = await eventLog._countSegments();

    const chainResult = await eventLog.verifyChain();
    metrics.chain_valid = chainResult.valid;
    if (!chainResult.valid) {
      metrics.chain_reason = chainResult.reason;
    }

    const lastEntry = await eventLog.getLastEntry();
    if (lastEntry) {
      metrics.ultimo_evento_id = lastEntry.id;
      metrics.ultimo_evento_timestamp = lastEntry.timestamp.toISOString();
    }
  } catch (error: any) {
    metrics.chain_valid = false;
    metrics.chain_reason = `Erro ao acessar EventLog: ${error.message}`;
  }

  return metrics;
}

/**
 * Coleta metricas do ultimo drill
 */
async function coletarMetricasDrill(outputDir: string): Promise<DrillMetrics> {
  const metrics: DrillMetrics = {};

  try {
    // Procurar diretorio de go-live
    const goLiveDir = path.join(outputDir, '..', 'go-live');

    if (await fileExists(goLiveDir)) {
      const dirs = await fs.readdir(goLiveDir);
      const sortedDirs = dirs.sort().reverse(); // Mais recente primeiro

      for (const dir of sortedDirs) {
        const resultPath = path.join(goLiveDir, dir, 'drill-result.json');

        if (await fileExists(resultPath)) {
          const result = await readJsonSafe<any>(resultPath);

          if (result) {
            metrics.ultimo_drill_timestamp = result.timestamp;
            metrics.ultimo_drill_duracao_ms = result.duracao_total_ms;
            metrics.ultimo_drill_status = result.sumario?.falhou === 0 ? 'PASSOU' : 'FALHOU';
            const cenariosPassed = result.sumario?.passou || 0;
            const cenariosTotal = result.sumario?.total_cenarios || 0;
            metrics.ultimo_drill_cenarios_passou = cenariosPassed;
            metrics.ultimo_drill_cenarios_total = cenariosTotal;

            if (cenariosTotal > 0) {
              metrics.ultimo_drill_taxa_sucesso = (cenariosPassed / cenariosTotal) * 100;
            }

            metrics.dias_desde_ultimo_drill = diasDesde(result.timestamp);
            break;
          }
        }
      }
    }
  } catch {
    // Sem dados de drill
  }

  return metrics;
}

/**
 * Coleta metricas do ultimo backup
 */
async function coletarMetricasBackup(outputDir: string): Promise<BackupMetrics> {
  const metrics: BackupMetrics = {};

  try {
    // Procurar em backup-out ou diretorio de backups
    const possibleDirs = [
      path.join(outputDir, '..', '..', 'backup-out'),
      path.join(outputDir, '..', 'backups'),
      './backup-out'
    ];

    for (const backupDir of possibleDirs) {
      if (await fileExists(backupDir)) {
        const files = await fs.readdir(backupDir);
        const manifests = files
          .filter(f => f.endsWith('.manifest.json'))
          .sort()
          .reverse();

        for (const manifestFile of manifests) {
          const manifestPath = path.join(backupDir, manifestFile);
          const manifest = await readJsonSafe<any>(manifestPath);

          if (manifest) {
            metrics.ultimo_backup_timestamp = manifest.created_at;
            metrics.ultimo_backup_eventos = manifest.eventlog_summary?.total_events;
            metrics.ultimo_backup_chain_valid = manifest.chain_valid_at_backup;

            // Calcular tamanho total dos arquivos
            let totalSize = 0;
            for (const file of manifest.files || []) {
              totalSize += file.size || 0;
            }
            metrics.ultimo_backup_tamanho_bytes = totalSize;

            metrics.dias_desde_ultimo_backup = diasDesde(manifest.created_at);
            break;
          }
        }

        if (metrics.ultimo_backup_timestamp) break;
      }
    }
  } catch {
    // Sem dados de backup
  }

  return metrics;
}

// ════════════════════════════════════════════════════════════════════════════
// SISTEMA DE ALERTAS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Avalia metricas e gera alertas
 */
function avaliarAlertas(metrics: OperacaoMetrics): MetricAlert[] {
  const alertas: MetricAlert[] = [];

  // Chain validation
  if (!metrics.eventlog.chain_valid) {
    alertas.push({
      metric: 'chain_valid',
      level: 'CRITICAL',
      value: 'false',
      threshold: 'true',
      message: `Chain invalida: ${metrics.eventlog.chain_reason || 'razao desconhecida'}`
    });
  }

  // Numero de segmentos
  if (metrics.eventlog.total_segmentos >= THRESHOLDS.segmentos_critical) {
    alertas.push({
      metric: 'total_segmentos',
      level: 'CRITICAL',
      value: metrics.eventlog.total_segmentos,
      threshold: THRESHOLDS.segmentos_critical,
      message: `Numero de segmentos (${metrics.eventlog.total_segmentos}) excede limite critico`
    });
  } else if (metrics.eventlog.total_segmentos >= THRESHOLDS.segmentos_warning) {
    alertas.push({
      metric: 'total_segmentos',
      level: 'WARNING',
      value: metrics.eventlog.total_segmentos,
      threshold: THRESHOLDS.segmentos_warning,
      message: `Numero de segmentos (${metrics.eventlog.total_segmentos}) acima do esperado`
    });
  }

  // Numero de eventos
  if (metrics.eventlog.total_eventos >= THRESHOLDS.eventos_critical) {
    alertas.push({
      metric: 'total_eventos',
      level: 'CRITICAL',
      value: metrics.eventlog.total_eventos,
      threshold: THRESHOLDS.eventos_critical,
      message: `Numero de eventos (${metrics.eventlog.total_eventos}) excede limite critico`
    });
  } else if (metrics.eventlog.total_eventos >= THRESHOLDS.eventos_warning) {
    alertas.push({
      metric: 'total_eventos',
      level: 'WARNING',
      value: metrics.eventlog.total_eventos,
      threshold: THRESHOLDS.eventos_warning,
      message: `Numero de eventos (${metrics.eventlog.total_eventos}) acima do esperado`
    });
  }

  // Dias desde ultimo drill
  if (metrics.drill.dias_desde_ultimo_drill !== undefined) {
    if (metrics.drill.dias_desde_ultimo_drill >= THRESHOLDS.drill_dias_critical) {
      alertas.push({
        metric: 'dias_desde_ultimo_drill',
        level: 'CRITICAL',
        value: metrics.drill.dias_desde_ultimo_drill,
        threshold: THRESHOLDS.drill_dias_critical,
        message: `Ultimo drill foi ha ${metrics.drill.dias_desde_ultimo_drill} dias`
      });
    } else if (metrics.drill.dias_desde_ultimo_drill >= THRESHOLDS.drill_dias_warning) {
      alertas.push({
        metric: 'dias_desde_ultimo_drill',
        level: 'WARNING',
        value: metrics.drill.dias_desde_ultimo_drill,
        threshold: THRESHOLDS.drill_dias_warning,
        message: `Ultimo drill foi ha ${metrics.drill.dias_desde_ultimo_drill} dias`
      });
    }
  }

  // Taxa de sucesso do drill
  if (metrics.drill.ultimo_drill_taxa_sucesso !== undefined) {
    if (metrics.drill.ultimo_drill_taxa_sucesso < THRESHOLDS.drill_taxa_critical) {
      alertas.push({
        metric: 'drill_taxa_sucesso',
        level: 'CRITICAL',
        value: metrics.drill.ultimo_drill_taxa_sucesso,
        threshold: THRESHOLDS.drill_taxa_critical,
        message: `Taxa de sucesso do drill (${metrics.drill.ultimo_drill_taxa_sucesso}%) abaixo do limite`
      });
    } else if (metrics.drill.ultimo_drill_taxa_sucesso < THRESHOLDS.drill_taxa_warning) {
      alertas.push({
        metric: 'drill_taxa_sucesso',
        level: 'WARNING',
        value: metrics.drill.ultimo_drill_taxa_sucesso,
        threshold: THRESHOLDS.drill_taxa_warning,
        message: `Taxa de sucesso do drill (${metrics.drill.ultimo_drill_taxa_sucesso}%) abaixo do esperado`
      });
    }
  }

  // Tempo do drill
  if (metrics.drill.ultimo_drill_duracao_ms !== undefined) {
    const drillSeconds = metrics.drill.ultimo_drill_duracao_ms / 1000;
    if (drillSeconds >= THRESHOLDS.drill_tempo_critical) {
      alertas.push({
        metric: 'drill_duracao',
        level: 'CRITICAL',
        value: drillSeconds,
        threshold: THRESHOLDS.drill_tempo_critical,
        message: `Tempo do drill (${drillSeconds.toFixed(1)}s) excede limite critico`
      });
    } else if (drillSeconds >= THRESHOLDS.drill_tempo_warning) {
      alertas.push({
        metric: 'drill_duracao',
        level: 'WARNING',
        value: drillSeconds,
        threshold: THRESHOLDS.drill_tempo_warning,
        message: `Tempo do drill (${drillSeconds.toFixed(1)}s) acima do esperado`
      });
    }
  }

  // Dias desde ultimo backup
  if (metrics.backup.dias_desde_ultimo_backup !== undefined) {
    if (metrics.backup.dias_desde_ultimo_backup >= THRESHOLDS.backup_dias_critical) {
      alertas.push({
        metric: 'dias_desde_ultimo_backup',
        level: 'CRITICAL',
        value: metrics.backup.dias_desde_ultimo_backup,
        threshold: THRESHOLDS.backup_dias_critical,
        message: `Ultimo backup foi ha ${metrics.backup.dias_desde_ultimo_backup} dias`
      });
    } else if (metrics.backup.dias_desde_ultimo_backup >= THRESHOLDS.backup_dias_warning) {
      alertas.push({
        metric: 'dias_desde_ultimo_backup',
        level: 'WARNING',
        value: metrics.backup.dias_desde_ultimo_backup,
        threshold: THRESHOLDS.backup_dias_warning,
        message: `Ultimo backup foi ha ${metrics.backup.dias_desde_ultimo_backup} dias`
      });
    }
  }

  // Backup chain invalid
  if (metrics.backup.ultimo_backup_chain_valid === false) {
    alertas.push({
      metric: 'backup_chain_valid',
      level: 'CRITICAL',
      value: 'false',
      threshold: 'true',
      message: 'Ultimo backup possui chain invalida'
    });
  }

  return alertas;
}

/**
 * Determina status geral baseado nos alertas
 */
function determinarStatusGeral(alertas: MetricAlert[]): AlertLevel {
  if (alertas.some(a => a.level === 'CRITICAL')) {
    return 'CRITICAL';
  }
  if (alertas.some(a => a.level === 'WARNING')) {
    return 'WARNING';
  }
  return 'OK';
}

// ════════════════════════════════════════════════════════════════════════════
// SAIDA E NOTIFICACAO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Imprime resumo no console
 */
function imprimirResumo(metrics: OperacaoMetrics): void {
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('METRICAS DE OPERACAO CONTINUA');
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log(`Data: ${metrics.timestamp}`);
  console.log(`Data Dir: ${metrics.data_dir}`);
  console.log('');

  // EventLog
  console.log('EventLog:');
  console.log(`  Eventos: ${metrics.eventlog.total_eventos.toLocaleString()}`);
  console.log(`  Segmentos: ${metrics.eventlog.total_segmentos}`);
  console.log(`  Chain Valida: ${metrics.eventlog.chain_valid ? 'SIM' : 'NAO'}`);
  if (metrics.eventlog.ultimo_evento_timestamp) {
    console.log(`  Ultimo Evento: ${metrics.eventlog.ultimo_evento_timestamp}`);
  }
  console.log('');

  // Drill
  console.log('Ultimo Drill:');
  if (metrics.drill.ultimo_drill_timestamp) {
    console.log(`  Data: ${metrics.drill.ultimo_drill_timestamp}`);
    console.log(`  Status: ${metrics.drill.ultimo_drill_status}`);
    console.log(`  Duracao: ${((metrics.drill.ultimo_drill_duracao_ms || 0) / 1000).toFixed(1)}s`);
    console.log(`  Taxa Sucesso: ${metrics.drill.ultimo_drill_taxa_sucesso?.toFixed(1)}%`);
    console.log(`  Dias Atras: ${metrics.drill.dias_desde_ultimo_drill}`);
  } else {
    console.log('  Nenhum drill encontrado');
  }
  console.log('');

  // Backup
  console.log('Ultimo Backup:');
  if (metrics.backup.ultimo_backup_timestamp) {
    console.log(`  Data: ${metrics.backup.ultimo_backup_timestamp}`);
    console.log(`  Tamanho: ${formatBytes(metrics.backup.ultimo_backup_tamanho_bytes || 0)}`);
    console.log(`  Eventos: ${metrics.backup.ultimo_backup_eventos?.toLocaleString()}`);
    console.log(`  Chain Valida: ${metrics.backup.ultimo_backup_chain_valid ? 'SIM' : 'NAO'}`);
    console.log(`  Dias Atras: ${metrics.backup.dias_desde_ultimo_backup}`);
  } else {
    console.log('  Nenhum backup encontrado');
  }
  console.log('');

  // Alertas
  if (metrics.alertas.length > 0) {
    console.log('ALERTAS:');
    for (const alerta of metrics.alertas) {
      const icon = alerta.level === 'CRITICAL' ? '[CRITICAL]' : '[WARNING]';
      console.log(`  ${icon} ${alerta.message}`);
    }
    console.log('');
  }

  // Status geral
  console.log('════════════════════════════════════════════════════════════════════════════');
  const statusIcon = metrics.status_geral === 'OK' ? 'OK' :
    metrics.status_geral === 'WARNING' ? 'WARNING' : 'CRITICAL';
  console.log(`STATUS GERAL: ${statusIcon}`);
  console.log('════════════════════════════════════════════════════════════════════════════');
}

/**
 * Prepara payload para hook de email (futuro)
 */
function prepararPayloadEmail(metrics: OperacaoMetrics): object {
  return {
    subject: `[${metrics.status_geral}] Metricas Operacao Continua - ${metrics.timestamp}`,
    body: {
      timestamp: metrics.timestamp,
      status: metrics.status_geral,
      alertas: metrics.alertas.map(a => ({
        nivel: a.level,
        metrica: a.metric,
        mensagem: a.message
      })),
      resumo: {
        eventos: metrics.eventlog.total_eventos,
        segmentos: metrics.eventlog.total_segmentos,
        chain_valid: metrics.eventlog.chain_valid,
        ultimo_drill: metrics.drill.ultimo_drill_timestamp,
        ultimo_backup: metrics.backup.ultimo_backup_timestamp
      }
    }
  };
}

/**
 * Salva metricas e logs
 */
async function salvarResultados(
  metrics: OperacaoMetrics,
  outputDir: string,
  timestamp: string
): Promise<string> {
  const runDir = path.join(outputDir, timestamp);
  await fs.mkdir(runDir, { recursive: true });

  // Salvar metricas JSON
  const metricsPath = path.join(runDir, 'metrics.json');
  await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2));

  // Salvar log texto
  const logLines: string[] = [
    `Metricas de Operacao Continua`,
    `Data: ${metrics.timestamp}`,
    `Status: ${metrics.status_geral}`,
    ``,
    `EventLog:`,
    `  Eventos: ${metrics.eventlog.total_eventos}`,
    `  Segmentos: ${metrics.eventlog.total_segmentos}`,
    `  Chain Valida: ${metrics.eventlog.chain_valid}`,
    ``
  ];

  if (metrics.alertas.length > 0) {
    logLines.push('Alertas:');
    for (const a of metrics.alertas) {
      logLines.push(`  [${a.level}] ${a.message}`);
    }
  }

  const logPath = path.join(runDir, 'metrics.log');
  await fs.writeFile(logPath, logLines.join('\n'));

  // Salvar payload de email (para futuro hook)
  const emailPayload = prepararPayloadEmail(metrics);
  const emailPath = path.join(runDir, 'email-payload.json');
  await fs.writeFile(emailPath, JSON.stringify(emailPayload, null, 2));

  return runDir;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const DATA_DIR = args[0] || DEFAULT_DATA_DIR;
  const OUTPUT_DIR = args[1] || DEFAULT_OUTPUT_DIR;

  const timestamp = formatTimestamp();

  // Coletar metricas
  const eventlogMetrics = await coletarMetricasEventLog(DATA_DIR);
  const drillMetrics = await coletarMetricasDrill(OUTPUT_DIR);
  const backupMetrics = await coletarMetricasBackup(OUTPUT_DIR);

  // Montar objeto de metricas
  const metrics: OperacaoMetrics = {
    timestamp: new Date().toISOString(),
    data_dir: DATA_DIR,
    eventlog: eventlogMetrics,
    drill: drillMetrics,
    backup: backupMetrics,
    alertas: [],
    status_geral: 'OK'
  };

  // Avaliar alertas
  metrics.alertas = avaliarAlertas(metrics);
  metrics.status_geral = determinarStatusGeral(metrics.alertas);

  // Imprimir resumo
  imprimirResumo(metrics);

  // Salvar resultados
  const runDir = await salvarResultados(metrics, OUTPUT_DIR, timestamp);
  console.log(`\nResultados salvos em: ${runDir}`);

  // Exit code baseado no status
  if (metrics.status_geral === 'CRITICAL') {
    process.exitCode = 2;
  } else if (metrics.status_geral === 'WARNING') {
    process.exitCode = 1;
  }
}

// Executar
main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});

// Exports para uso programatico e testes
export {
  OperacaoMetrics,
  MetricAlert,
  AlertLevel,
  THRESHOLDS,
  coletarMetricasEventLog,
  coletarMetricasDrill,
  coletarMetricasBackup,
  avaliarAlertas,
  determinarStatusGeral,
  prepararPayloadEmail
};
