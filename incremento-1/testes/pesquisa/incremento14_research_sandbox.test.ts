/**
 * INCREMENTO 14 — CAMADA DE PESQUISA: Testes
 *
 * Testes para garantir que a pesquisa:
 * 1. Não escreve no event-log
 * 2. Não escreve nos repos do core
 * 3. Baseline gera report válido
 * 4. Variações funcionam
 * 5. modoMemoria=OFF não chama memória
 * 6. modoMemoria=READONLY consulta memória apenas leitura
 * 7. Métodos de escrita falham com RESEARCH_WRITE_FORBIDDEN
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ResearchRunner,
  ResearchSandbox,
  ResearchStore,
  ResearchInput,
  ResearchVariation,
  RESEARCH_WRITE_FORBIDDEN,
  ResearchWriteForbiddenError,
  ReadOnlySituacaoRepository,
  ReadOnlyEpisodioRepository,
  ReadOnlyDecisaoRepository,
  ReadOnlyContratoRepository,
  ReadOnlyProtocolRepository,
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  DecisionProtocol,
  StatusSituacao,
  EstadoEpisodio,
  EstadoProtocolo,
  PerfilRisco,
  ClosedLayerRuleId
} from '../../camada-3';
import { SituacaoRepositoryImpl } from '../../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { EventLogRepositoryImpl } from '../../camada-3/event-log/EventLogRepositoryImpl';
import { MemoryQueryService } from '../../camada-3/servicos/MemoryQueryService';

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

async function createTestDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'libervia-research-test-'));
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function criarSituacaoValida(): SituacaoDecisoria {
  return {
    id: `sit-research-${Date.now()}`,
    dominio: 'financeiro',
    contexto: 'Contexto de teste para pesquisa',
    objetivo: 'Objetivo de teste',
    incertezas: ['Incerteza 1', 'Incerteza 2'],
    alternativas: [
      { descricao: 'Alternativa A', riscos_associados: ['Risco A'] },
      { descricao: 'Alternativa B', riscos_associados: ['Risco B'] }
    ],
    riscos: [
      { descricao: 'Risco 1', tipo: 'operacional', reversibilidade: 'reversível' }
    ],
    urgencia: 'média',
    capacidade_absorcao: 'alta',
    consequencia_relevante: 'Impacto financeiro significativo',
    possibilidade_aprendizado: true,
    status: StatusSituacao.EM_ANALISE,
    data_criacao: new Date(),
    caso_uso_declarado: 1,
    anexos_analise: []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: GUARDRAILS ANTI-ESCRITA
// ════════════════════════════════════════════════════════════════════════════

describe('Guardrails Anti-Escrita', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanup(testDir);
  });

  it('ReadOnlySituacaoRepository.create deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await SituacaoRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlySituacaoRepository(innerRepo);

    const situacao = criarSituacaoValida();

    await expect(readOnlyRepo.create(situacao)).rejects.toThrow(ResearchWriteForbiddenError);
    await expect(readOnlyRepo.create(situacao)).rejects.toThrow(/escrita proibida/);
  });

  it('ReadOnlySituacaoRepository.updateStatus deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await SituacaoRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlySituacaoRepository(innerRepo);

    await expect(
      readOnlyRepo.updateStatus('id', StatusSituacao.DECIDIDA)
    ).rejects.toThrow(ResearchWriteForbiddenError);
  });

  it('ReadOnlyEpisodioRepository.create deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await EpisodioRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlyEpisodioRepository(innerRepo);

    const episodio: EpisodioDecisao = {
      id: 'ep-test',
      caso_uso: 1,
      dominio: 'teste',
      estado: EstadoEpisodio.CRIADO,
      situacao_referenciada: 'sit-test',
      data_criacao: new Date(),
      data_decisao: null,
      data_observacao_iniciada: null,
      data_encerramento: null
    };

    await expect(readOnlyRepo.create(episodio)).rejects.toThrow(ResearchWriteForbiddenError);
  });

  it('ReadOnlyDecisaoRepository.create deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await DecisaoRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlyDecisaoRepository(innerRepo);

    const decisao: DecisaoInstitucional = {
      id: 'dec-test',
      episodio_id: 'ep-test',
      alternativa_escolhida: 'Alt A',
      criterios: ['C1'],
      perfil_risco: PerfilRisco.MODERADO,
      limites: [],
      condicoes: [],
      data_decisao: new Date()
    };

    await expect(readOnlyRepo.create(decisao)).rejects.toThrow(ResearchWriteForbiddenError);
  });

  it('ReadOnlyContratoRepository.create deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await ContratoRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlyContratoRepository(innerRepo);

    const contrato: ContratoDeDecisao = {
      id: 'contr-test',
      episodio_id: 'ep-test',
      decisao_id: 'dec-test',
      alternativa_autorizada: 'Alt A',
      limites_execucao: [],
      condicoes_obrigatorias: [],
      observacao_minima_requerida: [],
      data_emissao: new Date(),
      emitido_para: 'teste'
    };

    await expect(readOnlyRepo.create(contrato)).rejects.toThrow(ResearchWriteForbiddenError);
  });

  it('ReadOnlyProtocolRepository.create deve lançar RESEARCH_WRITE_FORBIDDEN', async () => {
    const innerRepo = await DecisionProtocolRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlyProtocolRepository(innerRepo);

    const protocolo: DecisionProtocol = {
      id: 'proto-test',
      episodio_id: 'ep-test',
      criterios_minimos: ['C1'],
      riscos_considerados: ['R1'],
      limites_definidos: [],
      perfil_risco: PerfilRisco.MODERADO,
      alternativas_avaliadas: ['A', 'B'],
      alternativa_escolhida: 'A',
      memoria_consultada_ids: [],
      anexos_utilizados_ids: [],
      estado: EstadoProtocolo.VALIDADO,
      validado_em: new Date(),
      validado_por: 'Libervia'
    };

    await expect(readOnlyRepo.create(protocolo)).rejects.toThrow(ResearchWriteForbiddenError);
  });

  it('ReadOnly repos permitem operações de leitura', async () => {
    const innerRepo = await SituacaoRepositoryImpl.create(testDir);
    const readOnlyRepo = new ReadOnlySituacaoRepository(innerRepo);

    // Leitura deve funcionar (retorna null pois não existe)
    const result = await readOnlyRepo.getById('nao-existe');
    expect(result).toBeNull();

    // init() deve funcionar (não modifica dados)
    await expect(readOnlyRepo.init()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SANDBOX
// ════════════════════════════════════════════════════════════════════════════

describe('ResearchSandbox', () => {
  it('analyzeBaseline retorna resumo válido', () => {
    const sandbox = new ResearchSandbox({ modoMemoria: 'OFF' });
    const situacao = criarSituacaoValida();

    const summary = sandbox.analyzeBaseline(situacao);

    expect(summary.situacaoId).toBe(situacao.id);
    expect(summary.dominio).toBe('financeiro');
    expect(summary.numAlternativas).toBe(2);
    expect(summary.numRiscos).toBe(1);
    expect(summary.numIncertezas).toBe(2);
    expect(summary.temConsequencia).toBe(true);
    expect(summary.closedLayerBlocks).toEqual([]);
  });

  it('analyzeBaseline detecta bloqueios da Camada Fechada', () => {
    const sandbox = new ResearchSandbox({ modoMemoria: 'OFF' });
    const situacao = criarSituacaoValida();
    situacao.riscos = [];
    situacao.incertezas = [];

    const summary = sandbox.analyzeBaseline(situacao);

    expect(summary.closedLayerBlocks.length).toBeGreaterThan(0);
    expect(summary.closedLayerBlocks[0].rule).toBe(ClosedLayerRuleId.SEM_RISCO);
  });

  it('analyzeVariation retorna resultado válido', () => {
    const sandbox = new ResearchSandbox({ modoMemoria: 'OFF' });
    const situacao = criarSituacaoValida();
    const variation: ResearchVariation = {
      id: 'var-1',
      descricao: 'Teste com perfil agressivo',
      perfilRisco: PerfilRisco.AGRESSIVO
    };

    const result = sandbox.analyzeVariation(situacao, variation);

    expect(result.variationId).toBe('var-1');
    expect(result.descricao).toBe('Teste com perfil agressivo');
    expect(result.riskPosture).toBe(PerfilRisco.AGRESSIVO);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.analysis).toContain('var-1');
  });

  it('analyzeVariation detecta bloqueios quando variação invalida', () => {
    const sandbox = new ResearchSandbox({ modoMemoria: 'OFF' });
    const situacao = criarSituacaoValida();
    const variation: ResearchVariation = {
      id: 'var-invalid',
      alternativas: [] // Menos de 2 alternativas
    };

    const result = sandbox.analyzeVariation(situacao, variation);

    expect(result.closedLayerBlocks.length).toBeGreaterThan(0);
    expect(result.closedLayerBlocks[0].rule).toBe(ClosedLayerRuleId.SEM_ALTERNATIVAS);
  });

  it('consultarMemoria retorna null quando modoMemoria=OFF', async () => {
    const sandbox = new ResearchSandbox({ modoMemoria: 'OFF' });
    const situacao = criarSituacaoValida();

    const signals = await sandbox.consultarMemoria(situacao);

    expect(signals).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: RUNNER
// ════════════════════════════════════════════════════════════════════════════

describe('ResearchRunner', () => {
  it('run gera report válido para baseline sem variações', async () => {
    const runner = new ResearchRunner();
    const input: ResearchInput = {
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    };

    const report = await runner.run(input);

    expect(report.reportId).toMatch(/^research-/);
    expect(report.startedAt).toBeInstanceOf(Date);
    expect(report.finishedAt).toBeInstanceOf(Date);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.baselineSummary).toBeDefined();
    expect(report.baselineSummary.situacaoId).toBe(input.situacao.id);
    expect(report.variations).toEqual([]);
    expect(report.truncated).toBe(false);
    expect(report.limitsApplied.maxVariacoes).toBe(10);
    expect(report.limitsApplied.maxTempoMs).toBe(30000);
  });

  it('run processa variações corretamente', async () => {
    const runner = new ResearchRunner();
    const input: ResearchInput = {
      situacao: criarSituacaoValida(),
      variacoes: [
        { id: 'v1', perfilRisco: PerfilRisco.CONSERVADOR },
        { id: 'v2', perfilRisco: PerfilRisco.AGRESSIVO }
      ],
      modoMemoria: 'OFF'
    };

    const report = await runner.run(input);

    expect(report.variations.length).toBe(2);
    expect(report.variations[0].variationId).toBe('v1');
    expect(report.variations[0].riskPosture).toBe(PerfilRisco.CONSERVADOR);
    expect(report.variations[1].variationId).toBe('v2');
    expect(report.variations[1].riskPosture).toBe(PerfilRisco.AGRESSIVO);
  });

  it('run respeita limite de variações', async () => {
    const runner = new ResearchRunner();
    const variacoes: ResearchVariation[] = Array.from({ length: 15 }, (_, i) => ({
      id: `v${i}`,
      descricao: `Variação ${i}`
    }));

    const input: ResearchInput = {
      situacao: criarSituacaoValida(),
      variacoes,
      modoMemoria: 'OFF',
      limitesPesquisa: { maxVariacoes: 5 }
    };

    const report = await runner.run(input);

    expect(report.variations.length).toBe(5);
    expect(report.truncated).toBe(true);
    expect(report.truncationReason).toContain('Limite de variações');
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('run não consulta memória quando modoMemoria=OFF', async () => {
    const runner = new ResearchRunner();
    const input: ResearchInput = {
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    };

    const report = await runner.run(input);

    expect(report.memorySignals).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: STORE
// ════════════════════════════════════════════════════════════════════════════

describe('ResearchStore', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanup(testDir);
  });

  it('usa diretório /research/ separado', async () => {
    const store = new ResearchStore(testDir, 'tenant-1');
    await store.init();

    const researchDir = store.getResearchDir();

    expect(researchDir).toContain('research');
    expect(researchDir).toContain('tenant-1');
  });

  it('salva e carrega report corretamente', async () => {
    const store = new ResearchStore(testDir);
    await store.init();

    const runner = new ResearchRunner();
    const input: ResearchInput = {
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    };
    const report = await runner.run(input);

    const filepath = await store.save(report);
    expect(filepath).toContain(report.reportId);

    const loaded = await store.load(report.reportId);
    expect(loaded).not.toBeNull();
    expect(loaded!.reportId).toBe(report.reportId);
    expect(loaded!.baselineSummary.situacaoId).toBe(report.baselineSummary.situacaoId);
  });

  it('listReportIds retorna IDs salvos', async () => {
    const store = new ResearchStore(testDir);
    await store.init();

    const runner = new ResearchRunner();
    const situacao = criarSituacaoValida();

    const report1 = await runner.run({ situacao, modoMemoria: 'OFF' });
    const report2 = await runner.run({ situacao, modoMemoria: 'OFF' });

    await store.save(report1);
    await store.save(report2);

    const ids = await store.listReportIds();

    expect(ids.length).toBe(2);
    expect(ids).toContain(report1.reportId);
    expect(ids).toContain(report2.reportId);
  });

  it('delete remove report', async () => {
    const store = new ResearchStore(testDir);
    await store.init();

    const runner = new ResearchRunner();
    const report = await runner.run({
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    });

    await store.save(report);
    expect(await store.load(report.reportId)).not.toBeNull();

    const deleted = await store.delete(report.reportId);
    expect(deleted).toBe(true);

    expect(await store.load(report.reportId)).toBeNull();
  });

  it('clear remove todos os reports', async () => {
    const store = new ResearchStore(testDir);
    await store.init();

    const runner = new ResearchRunner();
    const situacao = criarSituacaoValida();

    await store.save(await runner.run({ situacao, modoMemoria: 'OFF' }));
    await store.save(await runner.run({ situacao, modoMemoria: 'OFF' }));
    await store.save(await runner.run({ situacao, modoMemoria: 'OFF' }));

    const deleted = await store.clear();
    expect(deleted).toBe(3);

    const ids = await store.listReportIds();
    expect(ids.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: NÃO ESCREVE NO CORE
// ════════════════════════════════════════════════════════════════════════════

describe('Isolamento do Core', () => {
  let testDir: string;
  let coreDataDir: string;
  let researchDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    coreDataDir = path.join(testDir, 'core-data');
    researchDir = path.join(testDir, 'research');
    await fs.mkdir(coreDataDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanup(testDir);
  });

  it('pesquisa não cria arquivos no diretório do Core', async () => {
    // Setup: criar repos do Core e registrar uma situação
    const situacaoRepo = await SituacaoRepositoryImpl.create(coreDataDir);
    const episodioRepo = await EpisodioRepositoryImpl.create(coreDataDir);
    const eventLogRepo = await EventLogRepositoryImpl.create(coreDataDir);

    const situacao = criarSituacaoValida();
    await situacaoRepo.create(situacao);

    // Capturar estado inicial
    const filesAntes = await fs.readdir(coreDataDir);
    const eventLogDirAntes = path.join(coreDataDir, 'event-log');
    let eventLogFilesAntes: string[] = [];
    try {
      eventLogFilesAntes = await fs.readdir(eventLogDirAntes);
    } catch {
      // Pode não existir ainda
    }

    // Executar pesquisa
    const runner = new ResearchRunner();
    const input: ResearchInput = {
      situacao,
      variacoes: [
        { id: 'v1', perfilRisco: PerfilRisco.CONSERVADOR },
        { id: 'v2', perfilRisco: PerfilRisco.AGRESSIVO }
      ],
      modoMemoria: 'OFF'
    };

    const report = await runner.run(input);

    // Verificar que report foi gerado
    expect(report.variations.length).toBe(2);

    // Verificar que nenhum arquivo novo foi criado no Core
    const filesDepois = await fs.readdir(coreDataDir);
    expect(filesDepois).toEqual(filesAntes);

    // Verificar que event-log não mudou
    let eventLogFilesDepois: string[] = [];
    try {
      eventLogFilesDepois = await fs.readdir(eventLogDirAntes);
    } catch {
      // OK se não existe
    }
    expect(eventLogFilesDepois).toEqual(eventLogFilesAntes);
  });

  it('ResearchStore escreve apenas no diretório research', async () => {
    const store = new ResearchStore(testDir, 'tenant-test');
    await store.init();

    const runner = new ResearchRunner();
    const report = await runner.run({
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    });

    await store.save(report);

    // Verificar que arquivo foi criado no research dir
    const researchPath = store.getResearchDir();
    const researchFiles = await fs.readdir(researchPath);
    expect(researchFiles.length).toBe(1);
    expect(researchFiles[0]).toBe(`${report.reportId}.json`);

    // Verificar que core-data continua vazio
    const coreFiles = await fs.readdir(coreDataDir);
    expect(coreFiles.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: MODOS DE MEMÓRIA
// ════════════════════════════════════════════════════════════════════════════

describe('Modos de Memória', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanup(testDir);
  });

  it('modoMemoria=READONLY consulta memória quando disponível', async () => {
    // Setup: criar repos e memory service
    const episodioRepo = await EpisodioRepositoryImpl.create(testDir);
    const decisaoRepo = await DecisaoRepositoryImpl.create(testDir);
    const contratoRepo = await ContratoRepositoryImpl.create(testDir);

    // Criar um episódio para ser encontrado
    const episodio: EpisodioDecisao = {
      id: 'ep-memoria-1',
      caso_uso: 1,
      dominio: 'financeiro',
      estado: EstadoEpisodio.ENCERRADO,
      situacao_referenciada: 'sit-1',
      data_criacao: new Date(),
      data_decisao: new Date(),
      data_observacao_iniciada: null,
      data_encerramento: new Date()
    };
    await episodioRepo.create(episodio);

    const memoryService = new MemoryQueryService(
      episodioRepo,
      decisaoRepo,
      contratoRepo
    );

    const runner = new ResearchRunner(memoryService);
    const situacao = criarSituacaoValida();

    const report = await runner.run({
      situacao,
      modoMemoria: 'READONLY'
    });

    expect(report.memorySignals).toBeDefined();
    expect(report.memorySignals!.modo).toBe('READONLY');
    expect(report.memorySignals!.totalConsultado).toBeGreaterThanOrEqual(0);
  });

  it('modoMemoria=OFF não preenche memorySignals', async () => {
    const runner = new ResearchRunner();

    const report = await runner.run({
      situacao: criarSituacaoValida(),
      modoMemoria: 'OFF'
    });

    expect(report.memorySignals).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ERRO DE ESCRITA
// ════════════════════════════════════════════════════════════════════════════

describe('ResearchWriteForbiddenError', () => {
  it('tem código RESEARCH_WRITE_FORBIDDEN', () => {
    const error = new ResearchWriteForbiddenError('teste');

    expect(error.code).toBe(RESEARCH_WRITE_FORBIDDEN);
    expect(error.name).toBe('ResearchWriteForbiddenError');
    expect(error.message).toContain('teste');
    expect(error.message).toContain('proibida');
  });
});
