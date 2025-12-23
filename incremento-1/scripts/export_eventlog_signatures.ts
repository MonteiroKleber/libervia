#!/usr/bin/env ts-node
/**
 * EXPORT EVENTLOG SIGNATURES
 *
 * Script para gerar manifest com assinaturas/hashes do EventLog.
 * Usado para convergência canônica e verificação de integridade.
 *
 * Uso: ts-node scripts/export_eventlog_signatures.ts [DATA_DIR]
 *
 * Output: test-artifacts/eventlog-manifest-YYYYMMDD.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Imports do projeto
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';
import { computeEventHash, computePayloadHash } from '../utilitarios/HashUtil';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════

const DATA_DIR = process.argv[2] || './test-data-signatures';
const OUTPUT_DIR = './test-artifacts';

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

interface SegmentInfo {
  segment: number;
  eventCount: number;
  firstEventId: string;
  lastEventId: string;
  firstHash: string;
  lastHash: string;
}

interface EventLogManifest {
  generated_at: string;
  data_dir: string;
  total_events: number;
  segments: SegmentInfo[];
  snapshot: {
    exists: boolean;
    last_segment: number | null;
    last_event_id: string | null;
    last_current_hash: string | null;
    total_events: number | null;
  };
  chain_verification: {
    valid: boolean;
    total_verified: number;
    first_invalid_index: number | null;
    reason: string | null;
  };
  genesis_event: {
    id: string | null;
    current_hash: string | null;
    timestamp: string | null;
  };
  last_event: {
    id: string | null;
    current_hash: string | null;
    timestamp: string | null;
  };
}

// ════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ════════════════════════════════════════════════════════════════════════

function log(msg: string): void {
  console.log(msg);
}

async function cleanDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignorar se não existir
  }
  await fs.mkdir(dir, { recursive: true });
}

function formatDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  log('══════════════════════════════════════════════════════════════════════');
  log('EXPORT EVENTLOG SIGNATURES');
  log('══════════════════════════════════════════════════════════════════════');
  log(`Data: ${new Date().toISOString()}`);
  log(`DATA_DIR: ${DATA_DIR}`);
  log('');

  // 1. Limpar e criar diretório de dados
  log('1. Preparando diretório de dados...');
  await cleanDir(DATA_DIR);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // 2. Criar EventLog
  log('2. Criando EventLog...');
  const eventLog = await EventLogRepositoryImpl.create(DATA_DIR, {
    segmentSize: 5,     // Pequeno para demonstrar rotação
    snapshotEvery: 3,   // Snapshot a cada 3 eventos
    retentionSegments: 10
  });

  // 3. Inserir eventos mínimos representativos
  log('3. Inserindo eventos representativos...');

  // Simular fluxo: Situação → Episódio → Protocolo → Decisão → Contrato
  const sitId = 'sit-signature-001';
  const epId = 'ep-signature-001';
  const protId = 'prot-signature-001';
  const decId = 'dec-signature-001';
  const contId = 'cont-signature-001';

  await eventLog.append('Libervia', TipoEvento.SITUACAO_CRIADA, TipoEntidade.SITUACAO, sitId, {
    dominio: 'Financeiro',
    caso_uso: 1
  });
  log('   - SITUACAO_CRIADA');

  await eventLog.append('Libervia', TipoEvento.SITUACAO_STATUS_ALTERADO, TipoEntidade.SITUACAO, sitId, {
    de: 'RASCUNHO',
    para: 'ABERTA'
  });
  log('   - SITUACAO_STATUS_ALTERADO (RASCUNHO → ABERTA)');

  await eventLog.append('Libervia', TipoEvento.SITUACAO_STATUS_ALTERADO, TipoEntidade.SITUACAO, sitId, {
    de: 'ABERTA',
    para: 'ACEITA'
  });
  log('   - SITUACAO_STATUS_ALTERADO (ABERTA → ACEITA)');

  await eventLog.append('Libervia', TipoEvento.EPISODIO_CRIADO, TipoEntidade.EPISODIO, epId, {
    situacao_id: sitId,
    caso_uso: 1
  });
  log('   - EPISODIO_CRIADO');

  await eventLog.append('Libervia', TipoEvento.SITUACAO_STATUS_ALTERADO, TipoEntidade.SITUACAO, sitId, {
    de: 'ACEITA',
    para: 'EM_ANALISE'
  });
  log('   - SITUACAO_STATUS_ALTERADO (ACEITA → EM_ANALISE)');

  await eventLog.append('Bazari', TipoEvento.MEMORIA_CONSULTADA, TipoEntidade.SITUACAO, sitId, {
    query: { caso_uso: 1, limit: 10 },
    resultados: 0
  });
  log('   - MEMORIA_CONSULTADA (Bazari)');

  await eventLog.append('Libervia', TipoEvento.PROTOCOLO_VALIDADO, TipoEntidade.PROTOCOLO, protId, {
    episodio_id: epId,
    estado: 'VALIDADO'
  });
  log('   - PROTOCOLO_VALIDADO');

  await eventLog.append('Libervia', TipoEvento.DECISAO_REGISTRADA, TipoEntidade.DECISAO, decId, {
    episodio_id: epId,
    alternativa: 'Alternativa A',
    perfil_risco: 'MODERADO'
  });
  log('   - DECISAO_REGISTRADA');

  await eventLog.append('Libervia', TipoEvento.CONTRATO_EMITIDO, TipoEntidade.CONTRATO, contId, {
    episodio_id: epId,
    decisao_id: decId,
    emitido_para: 'Bazari'
  });
  log('   - CONTRATO_EMITIDO');

  await eventLog.append('Libervia', TipoEvento.SITUACAO_STATUS_ALTERADO, TipoEntidade.SITUACAO, sitId, {
    de: 'EM_ANALISE',
    para: 'DECIDIDA'
  });
  log('   - SITUACAO_STATUS_ALTERADO (EM_ANALISE → DECIDIDA)');

  // 4. Verificar cadeia
  log('');
  log('4. Verificando cadeia de hashes...');
  const verifyResult = await eventLog.verifyChain();
  log(`   - valid: ${verifyResult.valid}`);
  log(`   - totalVerified: ${verifyResult.totalVerified}`);

  // 5. Obter informações
  log('');
  log('5. Coletando informações para manifest...');

  const allEvents = await eventLog.getAll();
  const count = await eventLog.count();
  const lastEntry = await eventLog.getLastEntry();
  const genesisEntry = allEvents.length > 0 ? allEvents[0] : null;

  // Listar segmentos
  const segmentDir = path.join(DATA_DIR, 'event-log');
  let segmentFiles: string[] = [];
  try {
    const files = await fs.readdir(segmentDir);
    segmentFiles = files.filter(f => f.startsWith('segment-') && f.endsWith('.json')).sort();
  } catch {
    // Ignorar
  }

  const segments: SegmentInfo[] = [];
  for (const segFile of segmentFiles) {
    const segPath = path.join(segmentDir, segFile);
    const content = await fs.readFile(segPath, 'utf-8');
    const events = JSON.parse(content);
    if (events.length > 0) {
      const segNum = parseInt(segFile.match(/segment-(\d+)\.json/)?.[1] || '0');
      segments.push({
        segment: segNum,
        eventCount: events.length,
        firstEventId: events[0].id,
        lastEventId: events[events.length - 1].id,
        firstHash: events[0].current_hash,
        lastHash: events[events.length - 1].current_hash
      });
    }
  }

  // Ler snapshot se existir
  const snapshotPath = path.join(DATA_DIR, 'event-log-snapshot.json');
  let snapshotData: any = null;
  try {
    const snapContent = await fs.readFile(snapshotPath, 'utf-8');
    snapshotData = JSON.parse(snapContent);
  } catch {
    // Ignorar
  }

  // 6. Construir manifest
  log('');
  log('6. Construindo manifest...');

  const manifest: EventLogManifest = {
    generated_at: new Date().toISOString(),
    data_dir: DATA_DIR,
    total_events: count,
    segments,
    snapshot: {
      exists: snapshotData !== null,
      last_segment: snapshotData?.last_segment ?? null,
      last_event_id: snapshotData?.last_event_id ?? null,
      last_current_hash: snapshotData?.last_current_hash ?? null,
      total_events: snapshotData?.total_events ?? null
    },
    chain_verification: {
      valid: verifyResult.valid,
      total_verified: verifyResult.totalVerified,
      first_invalid_index: verifyResult.firstInvalidIndex ?? null,
      reason: verifyResult.reason ?? null
    },
    genesis_event: {
      id: genesisEntry?.id ?? null,
      current_hash: genesisEntry?.current_hash ?? null,
      timestamp: genesisEntry?.timestamp.toISOString() ?? null
    },
    last_event: {
      id: lastEntry?.id ?? null,
      current_hash: lastEntry?.current_hash ?? null,
      timestamp: lastEntry?.timestamp.toISOString() ?? null
    }
  };

  // 7. Salvar manifest
  const outputPath = path.join(OUTPUT_DIR, `eventlog-manifest-${formatDate()}.json`);
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2));
  log(`   - Manifest salvo em: ${outputPath}`);

  // 8. Mostrar resumo
  log('');
  log('══════════════════════════════════════════════════════════════════════');
  log('RESUMO');
  log('══════════════════════════════════════════════════════════════════════');
  log(`Total de eventos: ${manifest.total_events}`);
  log(`Segmentos criados: ${manifest.segments.length}`);
  log(`Snapshot existe: ${manifest.snapshot.exists}`);
  log(`Cadeia válida: ${manifest.chain_verification.valid}`);
  log(`Genesis hash: ${manifest.genesis_event.current_hash?.substring(0, 16)}...`);
  log(`Last hash: ${manifest.last_event.current_hash?.substring(0, 16)}...`);
  log('');
  log('Segmentos:');
  for (const seg of manifest.segments) {
    log(`  - segment-${String(seg.segment).padStart(6, '0')}: ${seg.eventCount} eventos`);
  }
  log('');
  log('Manifest completo salvo em:');
  log(`  ${outputPath}`);
  log('══════════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('ERRO:', err);
  process.exit(1);
});
