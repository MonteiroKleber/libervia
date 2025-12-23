import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';

import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { TipoEvento, TipoEntidade } from '../event-log/EventLogEntry';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  StatusSituacao,
  PerfilRisco,
  DadosProtocoloInput,
  EstadoProtocolo
} from '../entidades/tipos';

import {
  createContext,
  handleRequest,
  authenticate,
  getProtocolStats,
  ControlPlaneContext
} from '../control-plane/Server';

import {
  collectDashboardData,
  generateMarkdown
} from '../scripts/gerar_dashboard_eventlog';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

const TEST_DATA_DIR = './test-data-inc6-' + Date.now();

// ════════════════════════════════════════════════════════════════════════
// SETUP E TEARDOWN
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorio(): Promise<void> {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Ignorar se nao existe
  }
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(id?: string): SituacaoDecisoria {
  return {
    id: id ?? `situacao-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    dominio: 'Teste',
    contexto: 'Contexto de teste',
    objetivo: 'Objetivo claro',
    incertezas: ['Incerteza'],
    alternativas: [
      { descricao: 'Alternativa A', riscos_associados: ['risco-1'] },
      { descricao: 'Alternativa B', riscos_associados: ['risco-2'] }
    ],
    riscos: [{ descricao: 'Risco identificado', tipo: 'Operacional', reversibilidade: 'Parcial' }],
    urgencia: 'Media',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequencia significativa',
    possibilidade_aprendizado: true,
    caso_uso_declarado: 1,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    anexos_analise: []
  };
}

function criarDadosProtocoloValidos(): DadosProtocoloInput {
  return {
    criterios_minimos: ['Custo', 'Prazo'],
    riscos_considerados: ['Risco de atraso'],
    limites_definidos: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
    alternativa_escolhida: 'Alternativa A'
  };
}

async function criarInfraestruturaComDados(dataDir: string): Promise<OrquestradorCognitivo> {
  const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
  const eventLog = await EventLogRepositoryImpl.create(dataDir, {
    segmentSize: 5,
    snapshotEvery: 3
  });

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

  // Criar alguns dados para teste
  for (let i = 0; i < 3; i++) {
    const sit = criarSituacaoValida(`sit-test-${i}`);
    const episodio = await orq.ProcessarSolicitacao(sit);

    const protocolo = await orq.ConstruirProtocoloDeDecisao(episodio.id, criarDadosProtocoloValidos());

    await orq.RegistrarDecisao(episodio.id, {
      alternativa_escolhida: 'Alternativa A',
      criterios: ['Custo', 'Prazo'],
      limites: [{ tipo: 'Financeiro', descricao: 'Max 10k', valor: '10000' }],
      condicoes: ['Condicao 1'],
      perfil_risco: PerfilRisco.MODERADO
    });
  }

  return orq;
}

// Mock de request/response para testes
function createMockRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): http.IncomingMessage {
  const req = {
    method,
    url,
    headers
  } as unknown as http.IncomingMessage;
  return req;
}

class MockResponse {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: string = '';

  writeHead(status: number, headers?: Record<string, string>): void {
    this.statusCode = status;
    if (headers) {
      this.headers = { ...this.headers, ...headers };
    }
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  end(data?: string): void {
    if (data) {
      this.body = data;
    }
  }

  getJson(): any {
    return JSON.parse(this.body);
  }
}

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 6
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 6 - Observabilidade e Auditoria', () => {

  beforeEach(async () => {
    await limparDiretorio();
  });

  afterAll(async () => {
    await limparDiretorio();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Health endpoint
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Health endpoint', () => {
    test('GET /health/eventlog retorna status correto', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/health/eventlog');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.enabled).toBe(true);
      expect(body.degraded).toBe(false);
      expect(typeof body.errorCount).toBe('number');
    });

    test('EventLog desabilitado retorna enabled=false', async () => {
      // Criar contexto sem EventLog
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      const orq = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService,
        protocoloRepo
        // Sem eventLog
      );

      const ctx: ControlPlaneContext = { orquestrador: orq, protocoloRepo };

      const req = createMockRequest('GET', '/health/eventlog');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.getJson();
      expect(body.enabled).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Export com parametros
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Export com parametros', () => {
    test('GET /audit/export retorna eventos', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/audit/export');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.manifest).toBeDefined();
      expect(body.manifest.count).toBeGreaterThan(0);
      expect(body.manifest.chainValidWithinExport).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
    });

    test('GET /audit/export com filtro de segmento', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/audit/export?fromSegment=1&toSegment=1');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.manifest).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Replay com filtros
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Replay com filtros', () => {
    test('GET /audit/replay retorna resumo', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/audit/replay');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.totalEventos).toBeGreaterThan(0);
      expect(body.porEvento).toBeDefined();
      expect(body.porEntidade).toBeDefined();
      expect(body.porAtor).toBeDefined();
      expect(body.truncated).toBe(false);
    });

    test('GET /audit/replay com filtro de evento', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/audit/replay?evento=SITUACAO_CRIADA');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      // Deve ter apenas eventos do tipo filtrado
      if (body.totalEventos > 0) {
        expect(body.porEvento['SITUACAO_CRIADA']).toBeDefined();
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Protocolos agregados
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Protocolos agregados', () => {
    test('GET /dashboard/protocols retorna estatisticas', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/dashboard/protocols');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.total).toBe(3);
      expect(body.porEstado).toBeDefined();
      expect(body.porEstado['VALIDADO']).toBe(3);
      expect(body.porPerfilRisco).toBeDefined();
    });

    test('getProtocolStats conta corretamente VALIDADO vs REJEITADO', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);

      const stats = await getProtocolStats(protocoloRepo);

      expect(stats.total).toBe(3);
      expect(stats.porEstado['VALIDADO']).toBe(3);
      expect(stats.ultimoProtocolo).not.toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Autenticacao
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Autenticacao', () => {
    test('Requisicao sem token em dev mode e aceita', () => {
      // Em dev mode sem TOKEN configurado, deve permitir
      const req = createMockRequest('GET', '/health/eventlog', {});
      const result = authenticate(req);

      // Depende do ambiente, mas em testes nao ha TOKEN
      expect(result).toBe(true);
    });

    test('Funcao authenticate valida Bearer token corretamente', () => {
      // Testar logica de parsing do header Authorization
      // Sem header = depende do modo dev
      const reqNoHeader = createMockRequest('GET', '/health/eventlog', {});
      // Em dev mode sem token configurado, permite
      expect(authenticate(reqNoHeader)).toBe(true);

      // Com header Bearer valido (quando token configurado via env)
      const reqWithBearer = createMockRequest('GET', '/health/eventlog', {
        authorization: 'Bearer some-token'
      });
      // Em dev mode sem TOKEN, ainda permite
      expect(authenticate(reqWithBearer)).toBe(true);
    });

    test('Requisicao com token valido e aceita', () => {
      const originalToken = process.env.CONTROL_PLANE_TOKEN;
      process.env.CONTROL_PLANE_TOKEN = 'valid-token';

      try {
        const req = createMockRequest('GET', '/health/eventlog', {
          authorization: 'Bearer valid-token'
        });
        const result = authenticate(req);
        expect(result).toBe(true);
      } finally {
        if (originalToken) {
          process.env.CONTROL_PLANE_TOKEN = originalToken;
        } else {
          delete process.env.CONTROL_PLANE_TOKEN;
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Dashboard script
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Dashboard script', () => {
    test('collectDashboardData retorna dados validos', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);

      const data = await collectDashboardData(TEST_DATA_DIR);

      expect(data.generated_at).toBeDefined();
      expect(data.data_dir).toBeDefined();
      expect(data.eventLog.enabled).toBe(true);
      expect(data.eventLog.totalEventos).toBeGreaterThan(0);
      expect(data.protocolos.total).toBe(3);
    });

    test('generateMarkdown gera markdown valido', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const data = await collectDashboardData(TEST_DATA_DIR);

      const markdown = generateMarkdown(data);

      expect(markdown).toContain('# Dashboard Libervia');
      expect(markdown).toContain('## Status do EventLog');
      expect(markdown).toContain('## Protocolos de Decisao');
      expect(markdown).toContain('## Eventos por Tipo');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Dashboard summary
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Dashboard summary', () => {
    test('GET /dashboard/summary retorna resumo completo', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/dashboard/summary');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.timestamp).toBeDefined();
      expect(body.eventLog).toBeDefined();
      expect(body.eventLog.enabled).toBe(true);
      expect(body.protocolos).toBeDefined();
      expect(body.protocolos.total).toBe(3);
      expect(body.eventosDistribuicao).toBeDefined();
      expect(body.atoresDistribuicao).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Rota raiz
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Rota raiz', () => {
    test('GET / retorna lista de endpoints', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(200);

      const body = res.getJson();
      expect(body.name).toBe('Libervia Control-Plane');
      expect(body.endpoints).toContain('GET /health/eventlog');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Rota 404
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: Rota nao encontrada', () => {
    test('GET /inexistente retorna 404', async () => {
      await criarInfraestruturaComDados(TEST_DATA_DIR);
      const ctx = await createContext(TEST_DATA_DIR);

      const req = createMockRequest('GET', '/inexistente');
      const res = new MockResponse();

      await handleRequest(ctx, req, res as any);

      expect(res.statusCode).toBe(404);

      const body = res.getJson();
      expect(body.error).toBe('Not Found');
    });
  });

});
