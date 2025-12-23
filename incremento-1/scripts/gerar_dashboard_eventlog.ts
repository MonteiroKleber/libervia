#!/usr/bin/env ts-node
/**
 * GERAR DASHBOARD EVENTLOG
 *
 * Script para gerar dashboards estaticos de observabilidade.
 * Consulta os repositorios e EventLog diretamente (sem precisar do control-plane rodando).
 *
 * Uso:
 *   npm run dashboards:generate [DATA_DIR] [OUTPUT_DIR]
 *
 * Output:
 *   dashboards/dashboard-YYYYMMDD-HHMMSS.md
 *   dashboards/dashboard-YYYYMMDD-HHMMSS.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

const DATA_DIR = process.argv[2] || './data';
const OUTPUT_DIR = process.argv[3] || './dashboards';

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

interface DashboardData {
  generated_at: string;
  data_dir: string;
  eventLog: {
    enabled: boolean;
    degraded: boolean;
    errorCount: number;
    lastErrorMsg: string | null;
    totalEventos: number;
    primeiroEvento: string | null;
    ultimoEvento: string | null;
  };
  protocolos: {
    total: number;
    porEstado: Record<string, number>;
    porPerfilRisco: Record<string, number>;
  };
  eventos: {
    porTipo: Record<string, number>;
    porEntidade: Record<string, number>;
    porAtor: Record<string, number>;
    range: {
      firstTs: string | null;
      lastTs: string | null;
    };
    inconsistencias: number;
  };
}

// ════════════════════════════════════════════════════════════════════════
// UTILITARIOS
// ════════════════════════════════════════════════════════════════════════

function log(msg: string): void {
  console.log(msg);
}

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

function formatDateBr(isoDate: string | null): string {
  if (!isoDate) return 'N/A';
  const d = new Date(isoDate);
  return d.toLocaleString('pt-BR');
}

// ════════════════════════════════════════════════════════════════════════
// COLETA DE DADOS
// ════════════════════════════════════════════════════════════════════════

async function collectDashboardData(dataDir: string): Promise<DashboardData> {
  log('Coletando dados...');

  // Inicializar repositorios
  const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

  let eventLog: EventLogRepositoryImpl | undefined;
  try {
    eventLog = await EventLogRepositoryImpl.create(dataDir);
  } catch {
    // EventLog nao disponivel
  }

  const orq = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );
  await orq.init();

  // Coletar status do EventLog
  const eventLogStatus = orq.GetEventLogStatus();

  // Coletar replay
  const replay = await orq.ReplayEventLog();

  // Coletar export para primeiro/ultimo evento
  let primeiroEvento: string | null = null;
  let ultimoEvento: string | null = null;
  try {
    const exportResult = await orq.ExportEventLogForAudit();
    primeiroEvento = exportResult.manifest.firstId;
    ultimoEvento = exportResult.manifest.lastId;
  } catch {
    // Ignorar
  }

  // Coletar estatisticas de protocolos
  const protocoloStore = (protocoloRepo as any).store as Map<string, any>;
  const protocolStats = {
    total: protocoloStore.size,
    porEstado: {} as Record<string, number>,
    porPerfilRisco: {} as Record<string, number>
  };

  for (const protocolo of protocoloStore.values()) {
    const estado = protocolo.estado;
    protocolStats.porEstado[estado] = (protocolStats.porEstado[estado] || 0) + 1;

    const perfil = protocolo.perfil_risco;
    protocolStats.porPerfilRisco[perfil] = (protocolStats.porPerfilRisco[perfil] || 0) + 1;
  }

  return {
    generated_at: new Date().toISOString(),
    data_dir: path.resolve(dataDir),
    eventLog: {
      enabled: eventLogStatus.enabled,
      degraded: eventLogStatus.degraded,
      errorCount: eventLogStatus.errorCount,
      lastErrorMsg: eventLogStatus.lastErrorMsg || null,
      totalEventos: replay.totalEventos,
      primeiroEvento,
      ultimoEvento
    },
    protocolos: protocolStats,
    eventos: {
      porTipo: replay.porEvento,
      porEntidade: replay.porEntidade,
      porAtor: replay.porAtor,
      range: replay.range,
      inconsistencias: replay.inconsistencias.length
    }
  };
}

// ════════════════════════════════════════════════════════════════════════
// GERACAO DE MARKDOWN
// ════════════════════════════════════════════════════════════════════════

function generateMarkdown(data: DashboardData): string {
  const lines: string[] = [];

  lines.push(`# Dashboard Libervia - ${formatDateBr(data.generated_at)}`);
  lines.push('');
  lines.push(`**Data de geracao**: ${data.generated_at}`);
  lines.push(`**Diretorio de dados**: ${data.data_dir}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Status do EventLog
  lines.push('## Status do EventLog');
  lines.push('');
  lines.push(`| Metrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Enabled | ${data.eventLog.enabled ? 'Sim' : 'Nao'} |`);
  lines.push(`| Degraded | ${data.eventLog.degraded ? '**SIM**' : 'Nao'} |`);
  lines.push(`| Erros | ${data.eventLog.errorCount} |`);
  lines.push(`| Total de eventos | ${data.eventLog.totalEventos} |`);
  lines.push(`| Primeiro evento | ${data.eventLog.primeiroEvento || 'N/A'} |`);
  lines.push(`| Ultimo evento | ${data.eventLog.ultimoEvento || 'N/A'} |`);

  if (data.eventLog.lastErrorMsg) {
    lines.push('');
    lines.push(`**Ultimo erro**: ${data.eventLog.lastErrorMsg}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Protocolos de Decisao
  lines.push('## Protocolos de Decisao');
  lines.push('');
  lines.push(`**Total**: ${data.protocolos.total}`);
  lines.push('');

  if (Object.keys(data.protocolos.porEstado).length > 0) {
    lines.push('### Por Estado');
    lines.push('');
    lines.push('| Estado | Quantidade |');
    lines.push('|--------|------------|');
    for (const [estado, count] of Object.entries(data.protocolos.porEstado)) {
      lines.push(`| ${estado} | ${count} |`);
    }
    lines.push('');
  }

  if (Object.keys(data.protocolos.porPerfilRisco).length > 0) {
    lines.push('### Por Perfil de Risco');
    lines.push('');
    lines.push('| Perfil | Quantidade |');
    lines.push('|--------|------------|');
    for (const [perfil, count] of Object.entries(data.protocolos.porPerfilRisco)) {
      lines.push(`| ${perfil} | ${count} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Eventos por Tipo
  lines.push('## Eventos por Tipo');
  lines.push('');

  if (Object.keys(data.eventos.porTipo).length > 0) {
    lines.push('| Tipo | Quantidade |');
    lines.push('|------|------------|');
    const sorted = Object.entries(data.eventos.porTipo).sort((a, b) => b[1] - a[1]);
    for (const [tipo, count] of sorted) {
      lines.push(`| ${tipo} | ${count} |`);
    }
  } else {
    lines.push('*Nenhum evento registrado*');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Eventos por Entidade
  lines.push('## Eventos por Entidade');
  lines.push('');

  if (Object.keys(data.eventos.porEntidade).length > 0) {
    lines.push('| Entidade | Quantidade |');
    lines.push('|----------|------------|');
    const sorted = Object.entries(data.eventos.porEntidade).sort((a, b) => b[1] - a[1]);
    for (const [entidade, count] of sorted) {
      lines.push(`| ${entidade} | ${count} |`);
    }
  } else {
    lines.push('*Nenhum evento registrado*');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Eventos por Ator
  lines.push('## Eventos por Ator');
  lines.push('');

  if (Object.keys(data.eventos.porAtor).length > 0) {
    lines.push('| Ator | Quantidade |');
    lines.push('|------|------------|');
    for (const [ator, count] of Object.entries(data.eventos.porAtor)) {
      lines.push(`| ${ator} | ${count} |`);
    }
  } else {
    lines.push('*Nenhum evento registrado*');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Range de Eventos
  lines.push('## Range de Eventos');
  lines.push('');
  lines.push(`| Metrica | Valor |`);
  lines.push(`|---------|-------|`);
  lines.push(`| Primeiro | ${formatDateBr(data.eventos.range.firstTs)} |`);
  lines.push(`| Ultimo | ${formatDateBr(data.eventos.range.lastTs)} |`);
  lines.push(`| Inconsistencias | ${data.eventos.inconsistencias} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*Dashboard gerado automaticamente em ${formatDateBr(data.generated_at)}*`);

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log('════════════════════════════════════════════════════════════════════════');
  log('GERAR DASHBOARD EVENTLOG');
  log('════════════════════════════════════════════════════════════════════════');
  log(`Data: ${new Date().toISOString()}`);
  log(`DATA_DIR: ${DATA_DIR}`);
  log(`OUTPUT_DIR: ${OUTPUT_DIR}`);
  log('');

  // Verificar se data dir existe
  try {
    await fs.access(DATA_DIR);
  } catch {
    log(`ERRO: Diretorio de dados nao encontrado: ${DATA_DIR}`);
    process.exit(1);
  }

  // Criar diretorio de saida
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Coletar dados
  const data = await collectDashboardData(DATA_DIR);
  log(`   - EventLog: ${data.eventLog.totalEventos} eventos`);
  log(`   - Protocolos: ${data.protocolos.total}`);
  log('');

  // Gerar arquivos
  const timestamp = formatTimestamp();
  const mdPath = path.join(OUTPUT_DIR, `dashboard-${timestamp}.md`);
  const jsonPath = path.join(OUTPUT_DIR, `dashboard-${timestamp}.json`);

  log('Gerando arquivos...');

  // Markdown
  const markdown = generateMarkdown(data);
  await fs.writeFile(mdPath, markdown, 'utf-8');
  log(`   - ${mdPath}`);

  // JSON
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
  log(`   - ${jsonPath}`);

  log('');
  log('════════════════════════════════════════════════════════════════════════');
  log('DASHBOARD GERADO COM SUCESSO');
  log('════════════════════════════════════════════════════════════════════════');
}

// Exports para testes
export { collectDashboardData, generateMarkdown, DashboardData };

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    console.error('ERRO:', error);
    process.exit(1);
  });
}
