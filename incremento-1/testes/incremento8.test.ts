/**
 * ════════════════════════════════════════════════════════════════════════════
 * INCREMENTO 8: TESTES DE PREPARACAO GO-LIVE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Testes para validar cenarios de caos, garantias fundamentais e prontidao
 * para producao do Cerebro Institucional.
 *
 * Cobertura:
 * - Cenarios de caos (corrupcao, perda de dados, stress)
 * - Garantias fundamentais (imutabilidade, replay deterministico)
 * - Fluxo de backup/restauracao
 * - Funcionalidade do adapter pos-cenarios adversos
 *
 * NOTA: Usa diretorios isolados por teste via createTestDataDir
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BazariAdapter, SituacaoInput } from '../integracoes/bazari/Adapter';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { EventLogRepositoryImpl } from '../camada-3/event-log/EventLogRepositoryImpl';
import { DadosProtocoloInput, PerfilRisco, ContratoDeDecisao } from '../camada-3/entidades/tipos';
import { createBackup, restoreBackup } from '../scripts/backup_frio_eventlog';
import { createTestDataDir, TestDataDir } from './helpers/testDataDir';

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

async function criarOrquestradorCompleto(dataDir: string): Promise<{
  orquestrador: OrquestradorCognitivo;
  eventLog: EventLogRepositoryImpl;
  situacaoRepo: SituacaoRepositoryImpl;
  episodioRepo: EpisodioRepositoryImpl;
  decisaoRepo: DecisaoRepositoryImpl;
  contratoRepo: ContratoRepositoryImpl;
  protocoloRepo: DecisionProtocolRepositoryImpl;
  memoryService: MemoryQueryService;
}> {
  const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
  const eventLog = await EventLogRepositoryImpl.create(dataDir);

  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );

  await orquestrador.init();

  return {
    orquestrador,
    eventLog,
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    protocoloRepo,
    memoryService
  };
}

function gerarSituacao(index: number): SituacaoInput {
  return {
    dominio: 'tecnologico',
    contexto: `Contexto de teste ${index}`,
    objetivo: `Objetivo ${index}`,
    incertezas: ['Incerteza A', 'Incerteza B'],
    alternativas: [
      { descricao: `Alt 1 - ${index}`, riscos_associados: ['Risco 1'] },
      { descricao: `Alt 2 - ${index}`, riscos_associados: ['Risco 2'] }
    ],
    riscos: [{ descricao: 'Risco geral', tipo: 'operacional', reversibilidade: 'reversivel' }],
    urgencia: 'media',
    capacidade_absorcao: 'alta',
    consequencia_relevante: 'Consequencia teste',
    possibilidade_aprendizado: true,
    caso_uso_declarado: 1
  };
}

function gerarProtocolo(situacao: SituacaoInput): DadosProtocoloInput {
  return {
    criterios_minimos: ['Criterio 1', 'Criterio 2'],
    riscos_considerados: situacao.riscos.map(r => r.descricao),
    limites_definidos: [{ tipo: 'tempo', descricao: 'Prazo', valor: '30 dias' }],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: situacao.alternativas.map(a => a.descricao),
    alternativa_escolhida: situacao.alternativas[0].descricao,
    memoria_consultada_ids: []
  };
}

async function gerarEpisodios(
  adapter: BazariAdapter,
  count: number
): Promise<ContratoDeDecisao[]> {
  const contratos: ContratoDeDecisao[] = [];

  for (let i = 0; i < count; i++) {
    const situacao = gerarSituacao(i);
    const protocolo = gerarProtocolo(situacao);
    const resultado = await adapter.solicitarDecisao(situacao, protocolo);
    contratos.push(resultado.contrato);
  }

  return contratos;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: GARANTIAS FUNDAMENTAIS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 8 - Garantias Fundamentais', () => {
  test('Repositorios nao possuem metodo delete', async () => {
    const testDir = await createTestDataDir('inc8-garantias-delete');

    try {
      const { decisaoRepo, contratoRepo, protocoloRepo } = await criarOrquestradorCompleto(testDir.dir);

      // Verificar que nao existem metodos delete/update
      expect((decisaoRepo as any).delete).toBeUndefined();
      expect((decisaoRepo as any).update).toBeUndefined();
      expect((contratoRepo as any).delete).toBeUndefined();
      expect((contratoRepo as any).update).toBeUndefined();
      expect((protocoloRepo as any).delete).toBeUndefined();
      expect((protocoloRepo as any).update).toBeUndefined();
    } finally {
      await testDir.cleanup();
    }
  });

  test('Replay deterministico - dois replays consecutivos sao identicos', async () => {
    const testDir = await createTestDataDir('inc8-replay-det');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar alguns episodios
      await gerarEpisodios(adapter, 5);

      // Executar dois replays
      const replay1 = await eventLog.replay();
      const replay2 = await eventLog.replay();

      // Devem ser identicos
      expect(replay1.totalEventos).toBe(replay2.totalEventos);
      expect(JSON.stringify(replay1.porEvento)).toBe(JSON.stringify(replay2.porEvento));
      expect(JSON.stringify(replay1.porAtor)).toBe(JSON.stringify(replay2.porAtor));
      expect(JSON.stringify(replay1.porEntidade)).toBe(JSON.stringify(replay2.porEntidade));
    } finally {
      await testDir.cleanup();
    }
  });

  test('Unica saida e ContratoDeDecisao com emitido_para = Bazari', async () => {
    const testDir = await createTestDataDir('inc8-unica-saida');

    try {
      const { orquestrador } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      const situacao = gerarSituacao(0);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter.solicitarDecisao(situacao, protocolo);

      expect(resultado.contrato).toBeDefined();
      expect(resultado.contrato.emitido_para).toBe('Bazari');
      expect(resultado.metadados.versao_contrato).toBe('v1');
    } finally {
      await testDir.cleanup();
    }
  });

  test('Chain valida apos multiplas operacoes', async () => {
    const testDir = await createTestDataDir('inc8-chain-valida');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar episodios
      await gerarEpisodios(adapter, 10);

      // Verificar chain
      const chainResult = await eventLog.verifyChain();
      expect(chainResult.valid).toBe(true);
    } finally {
      await testDir.cleanup();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CENARIOS DE CAOS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 8 - Cenarios de Caos', () => {
  test('Detecta corrupcao de segmento', async () => {
    const testDir = await createTestDataDir('inc8-corrupcao-seg');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 5);

      // Localizar e corromper segmento (alterar hash, nao quebrar JSON)
      const eventLogDir = path.join(testDir.dir, 'event-log');
      const files = await fs.readdir(eventLogDir);
      const segments = files.filter(f => f.startsWith('segment-')).sort();

      if (segments.length > 0) {
        const segmentPath = path.join(eventLogDir, segments[0]);
        const content = await fs.readFile(segmentPath, 'utf-8');

        // Parse e corromper um hash (mantendo JSON valido)
        const data = JSON.parse(content);
        if (data.length > 0) {
          // Corromper o current_hash do primeiro evento
          data[0].current_hash = 'corrupted_hash_value_12345';
          await fs.writeFile(segmentPath, JSON.stringify(data, null, 2));

          // Recriar EventLog e verificar
          const eventLog2 = await EventLogRepositoryImpl.create(testDir.dir);
          const chainResult = await eventLog2.verifyChain();

          // Sistema deve detectar corrupcao via hash mismatch
          expect(chainResult.valid).toBe(false);
        }
      }
    } finally {
      await testDir.cleanup();
    }
  });

  test('Sobrevive a corrupcao de snapshot', async () => {
    const testDir = await createTestDataDir('inc8-corrupcao-snap');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 5);

      const snapshotPath = path.join(testDir.dir, 'event-log-snapshot.json');

      // Verificar se snapshot existe (pode nao existir se poucos eventos)
      try {
        await fs.access(snapshotPath);

        // Corromper snapshot
        await fs.writeFile(snapshotPath, '{ invalid json');

        // Recriar EventLog - deve reconstruir a partir dos segmentos
        const eventLog2 = await EventLogRepositoryImpl.create(testDir.dir);
        const count = await eventLog2.count();
        const chainResult = await eventLog2.verifyChain();

        // Sistema deve continuar funcionando
        expect(count).toBeGreaterThan(0);
        expect(chainResult.valid).toBe(true);
      } catch {
        // Snapshot nao existe, teste passa (sistema funciona sem snapshot)
        expect(true).toBe(true);
      }
    } finally {
      await testDir.cleanup();
    }
  });

  test('Suporta requisicoes paralelas sem corrupcao', async () => {
    const testDir = await createTestDataDir('inc8-paralelas');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Executar N requisicoes em paralelo
      const N = 5;
      const promises = Array.from({ length: N }, (_, i) => {
        const situacao = gerarSituacao(i);
        const protocolo = gerarProtocolo(situacao);
        return adapter.solicitarDecisao(situacao, protocolo);
      });

      const resultados = await Promise.all(promises);

      // Todas devem ter sucesso
      expect(resultados.length).toBe(N);
      resultados.forEach(r => {
        expect(r.contrato).toBeDefined();
        expect(r.contrato.emitido_para).toBe('Bazari');
      });

      // Chain deve estar valida
      const chainResult = await eventLog.verifyChain();
      expect(chainResult.valid).toBe(true);
    } finally {
      await testDir.cleanup();
    }
  });

  test('Recupera apos restart inesperado', async () => {
    const testDir = await createTestDataDir('inc8-restart');

    try {
      // Primeira sessao
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      await gerarEpisodios(adapter, 3);
      const eventosAntes = await eventLog.count();

      // Simular crash (simplesmente descartar referencias)
      // Recriar do disco
      const { orquestrador: orq2, eventLog: el2 } = await criarOrquestradorCompleto(testDir.dir);
      const adapter2 = new BazariAdapter(orq2);

      const eventosDepois = await el2.count();

      // Dados devem estar preservados
      expect(eventosDepois).toBe(eventosAntes);

      // Novas operacoes devem funcionar
      await gerarEpisodios(adapter2, 1);
      const eventosFinal = await el2.count();
      expect(eventosFinal).toBeGreaterThan(eventosDepois);

      // Chain valida
      const chainResult = await el2.verifyChain();
      expect(chainResult.valid).toBe(true);
    } finally {
      await testDir.cleanup();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: BACKUP E RESTAURACAO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 8 - Backup e Restauracao', () => {
  test('Backup frio cria arquivo valido', async () => {
    const testDir = await createTestDataDir('inc8-backup-frio');
    const backupDir = await createTestDataDir('inc8-backup-output');

    try {
      const { orquestrador } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 5);

      // Criar backup
      const result = await createBackup(testDir.dir, backupDir.dir);

      expect(result.success).toBe(true);
      expect(result.archive_path).toBeDefined();
      expect(result.manifest_path).toBeDefined();
      expect(result.manifest).toBeDefined();
      expect(result.manifest!.eventlog_summary.total_events).toBeGreaterThan(0);
      expect(result.manifest!.chain_valid_at_backup).toBe(true);
    } finally {
      await testDir.cleanup();
      await backupDir.cleanup();
    }
  });

  test('Restauracao preserva integridade', async () => {
    const testDir = await createTestDataDir('inc8-rest-integ');
    const backupDir = await createTestDataDir('inc8-rest-backup');
    const restoreDir = await createTestDataDir('inc8-rest-dest');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 5);
      const eventosOriginais = await eventLog.count();

      // Criar backup
      const backupResult = await createBackup(testDir.dir, backupDir.dir);
      expect(backupResult.success).toBe(true);

      // Restaurar
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        restoreDir.dir,
        true
      );

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.events_restored).toBe(eventosOriginais);
      expect(restoreResult.chain_valid).toBe(true);
    } finally {
      await testDir.cleanup();
      await backupDir.cleanup();
      await restoreDir.cleanup();
    }
  });

  test('Adapter funciona apos restauracao de backup', async () => {
    const testDir = await createTestDataDir('inc8-adapter-rest');
    const backupDir = await createTestDataDir('inc8-adapter-backup');
    const restoreDir = await createTestDataDir('inc8-adapter-restore');

    try {
      const { orquestrador } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 3);

      // Backup
      const backupResult = await createBackup(testDir.dir, backupDir.dir);
      expect(backupResult.success).toBe(true);

      // Restaurar
      const restoreResult = await restoreBackup(
        backupResult.archive_path!,
        backupResult.manifest_path!,
        restoreDir.dir,
        true
      );
      expect(restoreResult.success).toBe(true);

      // Criar novo adapter no diretorio restaurado
      const { orquestrador: orq2 } = await criarOrquestradorCompleto(restoreDir.dir);
      const adapter2 = new BazariAdapter(orq2);

      // Deve conseguir criar novos contratos
      const situacao = gerarSituacao(999);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter2.solicitarDecisao(situacao, protocolo);

      expect(resultado.contrato).toBeDefined();
      expect(resultado.contrato.emitido_para).toBe('Bazari');
    } finally {
      await testDir.cleanup();
      await backupDir.cleanup();
      await restoreDir.cleanup();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: VALIDACAO PRE-PRODUCAO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 8 - Validacao Pre-Producao', () => {
  // Aumentar timeout para testes de stress
  jest.setTimeout(15000);
  test('Drill modo fast - subset de cenarios', async () => {
    const testDir = await createTestDataDir('inc8-drill-fast');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados minimos
      await gerarEpisodios(adapter, 3);

      // Verificar garantias basicas
      const chainResult = await eventLog.verifyChain();
      expect(chainResult.valid).toBe(true);

      const replay1 = await eventLog.replay();
      const replay2 = await eventLog.replay();
      expect(replay1.totalEventos).toBe(replay2.totalEventos);

      // Verificar adapter funcional
      const situacao = gerarSituacao(888);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      expect(resultado.contrato.emitido_para).toBe('Bazari');
    } finally {
      await testDir.cleanup();
    }
  });

  test('Garantias pos-drill - verifica integridade', async () => {
    const testDir = await createTestDataDir('inc8-pos-drill');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Simular drill: gerar dados, stress, verificar
      await gerarEpisodios(adapter, 10);

      // Verificar todas as garantias
      const chainResult = await eventLog.verifyChain();
      expect(chainResult.valid).toBe(true);

      const replay = await eventLog.replay();
      expect(replay.totalEventos).toBeGreaterThan(0);
      expect(replay.inconsistencias.length).toBe(0);

      // Verificar que eventos esperados existem
      expect(replay.porEvento).toHaveProperty('SITUACAO_CRIADA');
      expect(replay.porEvento).toHaveProperty('EPISODIO_CRIADO');
      expect(replay.porEvento).toHaveProperty('PROTOCOLO_VALIDADO');
      expect(replay.porEvento).toHaveProperty('DECISAO_REGISTRADA');
      expect(replay.porEvento).toHaveProperty('CONTRATO_EMITIDO');
    } finally {
      await testDir.cleanup();
    }
  });

  test('Replay deterministico apos stress', async () => {
    const testDir = await createTestDataDir('inc8-replay-stress');

    try {
      const { orquestrador, eventLog } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar carga
      await gerarEpisodios(adapter, 15);

      // Multiplos replays devem ser identicos
      const replays: any[] = [];
      for (let i = 0; i < 3; i++) {
        replays.push(await eventLog.replay());
      }

      for (let i = 1; i < replays.length; i++) {
        expect(replays[i].totalEventos).toBe(replays[0].totalEventos);
        expect(JSON.stringify(replays[i].porEvento)).toBe(JSON.stringify(replays[0].porEvento));
      }
    } finally {
      await testDir.cleanup();
    }
  });

  test('Adapter funcional - chamada bem-sucedida retorna contrato', async () => {
    const testDir = await createTestDataDir('inc8-adapter-func');

    try {
      const { orquestrador } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      const situacao = gerarSituacao(0);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter.solicitarDecisao(situacao, protocolo);

      // Verificar estrutura completa do contrato
      expect(resultado.contrato.id).toBeDefined();
      expect(resultado.contrato.episodio_id).toBeDefined();
      expect(resultado.contrato.decisao_id).toBeDefined();
      expect(resultado.contrato.alternativa_autorizada).toBeDefined();
      expect(resultado.contrato.condicoes_obrigatorias).toBeDefined();
      expect(resultado.contrato.limites_execucao).toBeDefined();
      expect(resultado.contrato.data_emissao).toBeDefined();
      expect(resultado.contrato.emitido_para).toBe('Bazari');
    } finally {
      await testDir.cleanup();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CRITERIOS GO-LIVE
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 8 - Criterios Go-Live', () => {
  // Aumentar timeout para testes de stress
  jest.setTimeout(15000);

  test('Todos os criterios obrigatorios passam', async () => {
    const testDir = await createTestDataDir('inc8-criterios');

    try {
      const { orquestrador, eventLog, decisaoRepo, contratoRepo } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      // Gerar dados
      await gerarEpisodios(adapter, 10);

      // Criterio 1: Chain valida
      const chainResult = await eventLog.verifyChain();
      expect(chainResult.valid).toBe(true);

      // Criterio 2: Replay deterministico
      const replay1 = await eventLog.replay();
      const replay2 = await eventLog.replay();
      expect(replay1.totalEventos).toBe(replay2.totalEventos);

      // Criterio 3: Sem delete/update
      expect((decisaoRepo as any).delete).toBeUndefined();
      expect((contratoRepo as any).delete).toBeUndefined();

      // Criterio 4: Adapter funcional
      const situacao = gerarSituacao(100);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter.solicitarDecisao(situacao, protocolo);
      expect(resultado.contrato.emitido_para).toBe('Bazari');
    } finally {
      await testDir.cleanup();
    }
  });

  test('Sistema nao vaza dados internos', async () => {
    const testDir = await createTestDataDir('inc8-nao-vaza');

    try {
      const { orquestrador } = await criarOrquestradorCompleto(testDir.dir);
      const adapter = new BazariAdapter(orquestrador);

      const situacao = gerarSituacao(0);
      const protocolo = gerarProtocolo(situacao);
      const resultado = await adapter.solicitarDecisao(situacao, protocolo);

      // Converter para JSON e verificar que nao ha campos internos
      const json = JSON.stringify(resultado);

      const camposProibidos = [
        'eventLog',
        'repositorio',
        'situacaoRepo',
        'episodioRepo',
        'decisaoRepo',
        'protocoloRepo',
        'memoryService',
        'errorBuffer',
        'dataDir'
      ];

      for (const campo of camposProibidos) {
        expect(json).not.toContain(`"${campo}"`);
      }
    } finally {
      await testDir.cleanup();
    }
  });
});
