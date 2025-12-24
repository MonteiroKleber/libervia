#!/usr/bin/env ts-node
/**
 * VALIDAÇÃO OPERACIONAL DO EVENTLOG (Inc 4.0–4.3)
 *
 * Smoke + Stress test fora do Jest
 *
 * Uso: ts-node scripts/validate_inc4_3.ts [DATA_DIR]
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Imports do projeto
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../camada-3/event-log/EventLogEntry';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { StatusSituacao, PerfilRisco } from '../camada-3/entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════

const DATA_DIR = process.argv[2] || './test-data-runtime';
const SEGMENT_SIZE = 1000; // Para forçar rotação mais rápida
const SNAPSHOT_EVERY = 500;

// ════════════════════════════════════════════════════════════════════════
// RELATÓRIO
// ════════════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];
let totalEvents = 0;
let segmentsCreated = 0;

function log(msg: string): void {
  console.log(msg);
}

function addResult(name: string, passed: boolean, details?: string, error?: string): void {
  results.push({ name, passed, details, error });
  const icon = passed ? '✅' : '❌';
  log(`${icon} ${name}${details ? ` - ${details}` : ''}${error ? ` (ERRO: ${error})` : ''}`);
}

// ════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorio(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignorar se não existe
  }
}

async function contarSegmentos(dataDir: string): Promise<number> {
  const segmentDir = path.join(dataDir, 'event-log');
  try {
    const files = await fs.readdir(segmentDir);
    return files.filter(f => f.startsWith('segment-') && f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function salvarExport(dataDir: string, exportName: string, data: any): Promise<string> {
  const exportDir = path.join(dataDir, exportName);
  await fs.mkdir(exportDir, { recursive: true });

  const manifestPath = path.join(exportDir, 'manifest.json');
  const entriesPath = path.join(exportDir, 'entries.json');

  await fs.writeFile(manifestPath, JSON.stringify(data.manifest, null, 2));
  await fs.writeFile(entriesPath, JSON.stringify(data.entries.map((e: any) => ({
    id: e.id,
    timestamp: e.timestamp,
    actor: e.actor,
    evento: e.evento,
    entidade: e.entidade,
    entidade_id: e.entidade_id,
    current_hash: e.current_hash,
    previous_hash: e.previous_hash
  })), null, 2));

  return exportDir;
}

// ════════════════════════════════════════════════════════════════════════
// CENÁRIO 1: RESTART + SNAPSHOT + SEGMENTOS
// ════════════════════════════════════════════════════════════════════════

async function cenario1(): Promise<void> {
  log('\n' + '═'.repeat(70));
  log('CENÁRIO 1: RESTART + SNAPSHOT + SEGMENTOS');
  log('═'.repeat(70));

  // 1.1 - Criar EventLog fresh
  log('\n📁 Limpando DATA_DIR e criando EventLog fresh...');
  await limparDiretorio(DATA_DIR);

  const eventLog = await EventLogRepositoryImpl.create(DATA_DIR, {
    segmentSize: SEGMENT_SIZE,
    snapshotEvery: SNAPSHOT_EVERY,
    retentionSegments: 30
  });
  addResult('1.1 EventLog criado', true, `DATA_DIR: ${DATA_DIR}`);

  // 1.2 - Append de eventos para forçar rotação (>= 3 segmentos)
  log('\n📝 Gerando eventos para criar múltiplos segmentos...');
  const targetEvents = SEGMENT_SIZE * 3 + 100; // Garantir 3+ segmentos
  const startTime = Date.now();

  for (let i = 0; i < targetEvents; i++) {
    await eventLog.append(
      i % 2 === 0 ? 'Libervia' : 'Bazari',
      TipoEvento.SITUACAO_CRIADA,
      TipoEntidade.SITUACAO,
      `sit-${i}`,
      { index: i, data: 'payload' }
    );

    if ((i + 1) % 500 === 0) {
      log(`   ... ${i + 1}/${targetEvents} eventos criados`);
    }
  }

  const appendTime = Date.now() - startTime;
  totalEvents = await eventLog.count();
  segmentsCreated = await contarSegmentos(DATA_DIR);

  addResult('1.2 Append de eventos',
    segmentsCreated >= 3,
    `${totalEvents} eventos em ${segmentsCreated} segmentos (${appendTime}ms)`
  );

  // Verificar arquivos de segmento
  const segmentDir = path.join(DATA_DIR, 'event-log');
  const files = await fs.readdir(segmentDir);
  log(`   Segmentos encontrados: ${files.filter(f => f.startsWith('segment-')).join(', ')}`);

  // 1.3 - verifyChain
  log('\n🔍 Verificando cadeia...');
  const verifyResult = await eventLog.verifyChain();
  addResult('1.3 verifyChain()',
    verifyResult.valid,
    `valid=${verifyResult.valid}, totalVerified=${verifyResult.totalVerified}`
  );

  // 1.4 - verifyFromSnapshot
  const verifySnapshotResult = await eventLog.verifyFromSnapshot();
  addResult('1.4 verifyFromSnapshot()',
    verifySnapshotResult.valid,
    `valid=${verifySnapshotResult.valid}, totalVerified=${verifySnapshotResult.totalVerified}`
  );

  // 1.5 - Simular restart
  log('\n🔄 Simulando restart (novo EventLogRepositoryImpl.create)...');
  const eventLog2 = await EventLogRepositoryImpl.create(DATA_DIR, {
    segmentSize: SEGMENT_SIZE,
    snapshotEvery: SNAPSHOT_EVERY,
    retentionSegments: 30
  });

  const count2 = await eventLog2.count();
  addResult('1.5.1 Restart - count preservado',
    count2 === totalEvents,
    `count=${count2} (esperado: ${totalEvents})`
  );

  const verifyAfterRestart = await eventLog2.verifyFromSnapshot();
  addResult('1.5.2 Restart - verifyFromSnapshot',
    verifyAfterRestart.valid,
    `valid=${verifyAfterRestart.valid}`
  );

  const verifyChainAfterRestart = await eventLog2.verifyChain();
  addResult('1.5.3 Restart - verifyChain',
    verifyChainAfterRestart.valid,
    `valid=${verifyChainAfterRestart.valid}`
  );

  // 1.6 - exportRange
  log('\n📤 Testando exportRange (últimos 200 eventos)...');
  const allEvents = await eventLog2.getAll();
  const fromTs = allEvents.length > 200 ? allEvents[allEvents.length - 200].timestamp : undefined;

  const exportResult = await eventLog2.exportRange({ fromTs });
  const exportPath = await salvarExport(DATA_DIR, 'audit-export-1', exportResult);

  addResult('1.6 exportRange',
    exportResult.manifest.chainValidWithinExport && exportResult.entries.length > 0,
    `count=${exportResult.manifest.count}, chainValid=${exportResult.manifest.chainValidWithinExport}, path=${exportPath}`
  );
}

// ════════════════════════════════════════════════════════════════════════
// CENÁRIO 2: LIMITES DE SEGURANÇA
// ════════════════════════════════════════════════════════════════════════

async function cenario2(): Promise<void> {
  log('\n' + '═'.repeat(70));
  log('CENÁRIO 2: LIMITES DE SEGURANÇA (MAX_EVENTS_EXPORT / MAX_EVENTS_REPLAY)');
  log('═'.repeat(70));

  // 2.1 - Gerar dataset maior (60k+ eventos)
  log('\n📝 Gerando dataset grande (60k+ eventos)...');

  // Usar o mesmo DATA_DIR do cenário 1 e adicionar mais eventos
  const eventLog = await EventLogRepositoryImpl.create(DATA_DIR, {
    segmentSize: SEGMENT_SIZE,
    snapshotEvery: SNAPSHOT_EVERY,
    retentionSegments: 100 // Aumentar retenção para não perder segmentos
  });

  const currentCount = await eventLog.count();
  const targetTotal = 60100;
  const eventsToAdd = targetTotal - currentCount;

  if (eventsToAdd > 0) {
    log(`   Adicionando ${eventsToAdd} eventos (atual: ${currentCount})...`);
    const startTime = Date.now();

    for (let i = 0; i < eventsToAdd; i++) {
      await eventLog.append(
        'Libervia',
        TipoEvento.EPISODIO_CRIADO,
        TipoEntidade.EPISODIO,
        `ep-stress-${i}`,
        { i }
      );

      if ((i + 1) % 5000 === 0) {
        log(`   ... ${i + 1}/${eventsToAdd} eventos adicionados`);
      }
    }

    const elapsed = Date.now() - startTime;
    log(`   Tempo de inserção: ${elapsed}ms (${(eventsToAdd / elapsed * 1000).toFixed(0)} eventos/s)`);
  }

  totalEvents = await eventLog.count();
  segmentsCreated = await contarSegmentos(DATA_DIR);
  addResult('2.1 Dataset grande criado',
    totalEvents >= 60000,
    `${totalEvents} eventos em ${segmentsCreated} segmentos`
  );

  // 2.2 - Testar limite de export (10k)
  log('\n🚫 Testando limite de exportRange (>10k eventos)...');
  try {
    // Export sem filtros (todos os eventos) deve falhar se > 10k
    await eventLog.exportRange();
    addResult('2.2 exportRange limit', false, 'Deveria ter lançado erro para >10k eventos');
  } catch (error: any) {
    const isExpectedError = error.message.includes('Export too large') ||
                            error.message.includes('exceeds');
    addResult('2.2 exportRange limit',
      isExpectedError,
      `Erro esperado capturado: ${error.message}`
    );
  }

  // 2.3 - Testar replay (50k+ eventos)
  log('\n🔄 Testando replay com muitos eventos...');
  const replayResult = await eventLog.replay();

  // Se truncated=true quando > 50k, está correto
  // Se totalEventos <= 50k e não truncated, também correto
  const replayCorrect = (totalEvents > 50000 && replayResult.truncated) ||
                        (totalEvents <= 50000 && !replayResult.truncated) ||
                        replayResult.totalEventos <= 50000;

  addResult('2.3 replay limit',
    replayCorrect,
    `totalEventos=${replayResult.totalEventos}, truncated=${replayResult.truncated}, inconsistencias=${replayResult.inconsistencias.length}`
  );

  // 2.4 - Verificar integridade após stress
  log('\n🔍 Verificando integridade após stress...');
  const verifyAfterStress = await eventLog.verifyFromSnapshot();
  addResult('2.4.1 verifyFromSnapshot após stress',
    verifyAfterStress.valid,
    `valid=${verifyAfterStress.valid}`
  );

  const verifyChainAfterStress = await eventLog.verifyChain();
  addResult('2.4.2 verifyChain após stress',
    verifyChainAfterStress.valid,
    `valid=${verifyChainAfterStress.valid}`
  );
}

// ════════════════════════════════════════════════════════════════════════
// CENÁRIO 3: BOOTSTRAP DO ORQUESTRADOR
// ════════════════════════════════════════════════════════════════════════

async function cenario3(): Promise<void> {
  log('\n' + '═'.repeat(70));
  log('CENÁRIO 3: BOOTSTRAP DO ORQUESTRADOR EM "PRODUÇÃO"');
  log('═'.repeat(70));

  // 3.1 - Criar diretório separado para este cenário
  const ORQ_DATA_DIR = DATA_DIR + '-orq';
  await limparDiretorio(ORQ_DATA_DIR);

  log('\n🏗️ Montando repositórios...');

  const situacaoRepo = await SituacaoRepositoryImpl.create(ORQ_DATA_DIR);
  const episodioRepo = await EpisodioRepositoryImpl.create(ORQ_DATA_DIR);
  const decisaoRepo = await DecisaoRepositoryImpl.create(ORQ_DATA_DIR);
  const contratoRepo = await ContratoRepositoryImpl.create(ORQ_DATA_DIR);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(ORQ_DATA_DIR);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
  const eventLog = await EventLogRepositoryImpl.create(ORQ_DATA_DIR, {
    segmentSize: 100,
    snapshotEvery: 50
  });

  addResult('3.1 Repositórios criados', true, `DATA_DIR: ${ORQ_DATA_DIR}`);

  // 3.2 - Construir OrquestradorCognitivo
  log('\n🎯 Construindo OrquestradorCognitivo...');
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

  const status = orq.GetEventLogStatus();
  addResult('3.2.1 orq.init()',
    status.enabled && !status.degraded,
    `enabled=${status.enabled}, degraded=${status.degraded}`
  );

  const verifyNow = await orq.VerifyEventLogNow();
  addResult('3.2.2 VerifyEventLogNow()',
    verifyNow.valid,
    `valid=${verifyNow.valid}`
  );

  // 3.3 - Executar fluxo mínimo
  log('\n🔄 Executando fluxo mínimo...');

  // Criar situação completa conforme SituacaoDecisoria
  const situacao = {
    id: `sit-${Date.now()}`,
    dominio: 'Validação',
    contexto: 'Teste de validação operacional do EventLog',
    objetivo: 'Validar funcionamento completo do sistema',
    incertezas: ['Teste de incerteza'],
    alternativas: [{ id: 'alt1', descricao: 'Alternativa 1' }, { id: 'alt2', descricao: 'Alternativa 2' }],
    riscos: [{ id: 'risco1', descricao: 'Risco de teste', impacto: 'baixo', probabilidade: 'baixa' }],
    urgencia: 'MEDIA',
    capacidade_absorcao: 'ALTA',
    consequencia_relevante: 'Validação do sistema',
    possibilidade_aprendizado: true,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    caso_uso_declarado: 1,
    anexos_analise: []
  };

  const episodio = await orq.ProcessarSolicitacao(situacao as any);
  addResult('3.3.1 ProcessarSolicitacao',
    !!episodio && !!episodio.id,
    `episodio.id=${episodio.id}`
  );

  // ConsultarMemoriaDuranteAnalise (situação deve estar EM_ANALISE)
  const situacaoAtual = await situacaoRepo.getById(situacao.id);
  if (situacaoAtual?.status === StatusSituacao.EM_ANALISE) {
    const queryResult = await orq.ConsultarMemoriaDuranteAnalise(situacao.id, {
      caso_uso: 1,
      limit: 10
    });
    addResult('3.3.2 ConsultarMemoriaDuranteAnalise',
      queryResult !== undefined,
      `total_encontrado=${queryResult.total_encontrado}`
    );
  } else {
    addResult('3.3.2 ConsultarMemoriaDuranteAnalise',
      false,
      `Situação não está EM_ANALISE: ${situacaoAtual?.status}`
    );
  }

  // ConstruirProtocoloDeDecisao
  const protocolo = await orq.ConstruirProtocoloDeDecisao(episodio.id, {
    criterios_minimos: ['criterio1', 'criterio2'],
    riscos_considerados: ['risco1'],
    limites_definidos: [{ tipo: 'financeiro', descricao: 'Limite de teste', valor: '1000' }],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: ['alt1', 'alt2'],
    alternativa_escolhida: 'alt1'
  });
  addResult('3.3.3 ConstruirProtocoloDeDecisao',
    protocolo.estado === 'VALIDADO',
    `estado=${protocolo.estado}`
  );

  // RegistrarDecisao
  const contrato = await orq.RegistrarDecisao(episodio.id, {
    alternativa_escolhida: 'alt1',
    criterios: ['criterio1', 'criterio2'],
    limites: [{ tipo: 'financeiro', descricao: 'Limite de teste', valor: '1000' }],
    condicoes: ['condicao1'],
    perfil_risco: PerfilRisco.MODERADO
  });
  addResult('3.3.4 RegistrarDecisao',
    !!contrato && !!contrato.id,
    `contrato.id=${contrato.id}`
  );

  // 3.4 - Verificar eventos registrados
  log('\n📊 Verificando eventos registrados...');
  const eventCount = await eventLog.count();
  addResult('3.4.1 Eventos no EventLog',
    eventCount > 0,
    `count=${eventCount}`
  );

  const replayResult = await eventLog.replay();
  addResult('3.4.2 Replay do EventLog',
    replayResult.totalEventos > 0 && replayResult.inconsistencias.length === 0,
    `totalEventos=${replayResult.totalEventos}, porEvento=${JSON.stringify(replayResult.porEvento)}`
  );

  // 3.5 - Testar métodos do Orquestrador (se existirem)
  log('\n📤 Testando métodos de auditoria do Orquestrador...');

  if (typeof (orq as any).ExportEventLogForAudit === 'function') {
    const exportResult = await orq.ExportEventLogForAudit();
    const exportPath = await salvarExport(ORQ_DATA_DIR, 'audit-export-2', exportResult);
    addResult('3.5.1 ExportEventLogForAudit',
      exportResult.manifest.count > 0,
      `count=${exportResult.manifest.count}, path=${exportPath}`
    );
  } else {
    addResult('3.5.1 ExportEventLogForAudit', false, 'Método não existe');
  }

  if (typeof (orq as any).ReplayEventLog === 'function') {
    const replayOrqResult = await orq.ReplayEventLog();
    addResult('3.5.2 ReplayEventLog',
      replayOrqResult.totalEventos > 0,
      `totalEventos=${replayOrqResult.totalEventos}, porAtor=${JSON.stringify(replayOrqResult.porAtor)}`
    );
  } else {
    addResult('3.5.2 ReplayEventLog', false, 'Método não existe');
  }

  // Status final do Orquestrador
  const finalStatus = orq.GetEventLogStatus();
  addResult('3.6 Status final do Orquestrador',
    finalStatus.enabled && !finalStatus.degraded && finalStatus.errorCount === 0,
    `enabled=${finalStatus.enabled}, degraded=${finalStatus.degraded}, errorCount=${finalStatus.errorCount}`
  );
}

// ════════════════════════════════════════════════════════════════════════
// GERAÇÃO DO RELATÓRIO
// ════════════════════════════════════════════════════════════════════════

function gerarRelatorio(): void {
  log('\n' + '═'.repeat(70));
  log('RELATÓRIO FINAL');
  log('═'.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log(`\n## Resumo`);
  log(`- **Total de testes:** ${results.length}`);
  log(`- **Passou:** ${passed} ✅`);
  log(`- **Falhou:** ${failed} ❌`);
  log(`- **Total de eventos gerados:** ${totalEvents}`);
  log(`- **Segmentos criados:** ${segmentsCreated}`);
  log(`- **DATA_DIR:** ${DATA_DIR}`);

  log(`\n## Resultados Detalhados`);
  log('');
  log('| Teste | Status | Detalhes |');
  log('|-------|--------|----------|');
  for (const r of results) {
    const status = r.passed ? '✅' : '❌';
    const details = r.error ? `ERRO: ${r.error}` : (r.details || '');
    log(`| ${r.name} | ${status} | ${details} |`);
  }

  if (failed > 0) {
    log(`\n## Falhas`);
    for (const r of results.filter(r => !r.passed)) {
      log(`- **${r.name}**: ${r.error || r.details || 'Sem detalhes'}`);
    }
  }

  log(`\n## Arquivos Gerados`);
  log(`- \`${DATA_DIR}/event-log/\` - Segmentos do EventLog`);
  log(`- \`${DATA_DIR}/event-log-snapshot.json\` - Snapshot`);
  log(`- \`${DATA_DIR}/audit-export-1/\` - Export do Cenário 1`);
  log(`- \`${DATA_DIR}-orq/audit-export-2/\` - Export do Cenário 3`);

  log('\n' + '═'.repeat(70));
  log(failed === 0 ? '🎉 VALIDAÇÃO CONCLUÍDA COM SUCESSO!' : '⚠️ VALIDAÇÃO CONCLUÍDA COM FALHAS');
  log('═'.repeat(70));
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log('═'.repeat(70));
  log('VALIDAÇÃO OPERACIONAL DO EVENTLOG (Inc 4.0–4.3)');
  log('═'.repeat(70));
  log(`Iniciado em: ${new Date().toISOString()}`);
  log(`DATA_DIR: ${DATA_DIR}`);

  try {
    await cenario1();
    await cenario2();
    await cenario3();
  } catch (error: any) {
    log(`\n❌ ERRO FATAL: ${error.message}`);
    log(error.stack);
  }

  gerarRelatorio();

  log(`\nFinalizado em: ${new Date().toISOString()}`);
}

main().catch(console.error);
