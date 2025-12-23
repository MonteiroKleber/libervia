/**
 * CONTROL-PLANE SERVER
 *
 * Servidor HTTP leve para observabilidade e auditoria interna.
 * Expoe endpoints para monitoramento do EventLog, export de eventos,
 * replay operacional e estatisticas de protocolos.
 *
 * PRINCIPIOS:
 * - Apenas para operadores internos (nao publico)
 * - Nao afeta logica de decisao do Orquestrador
 * - Falhas aqui NAO bloqueiam operacoes normais
 *
 * Uso:
 *   npm run control-plane:start
 *
 * Configuracao (env):
 *   CONTROL_PLANE_PORT=3001
 *   CONTROL_PLANE_HOST=127.0.0.1
 *   CONTROL_PLANE_TOKEN=seu-token-secreto
 */

import * as http from 'http';
import * as url from 'url';

import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import { DecisionProtocolRepository } from '../repositorios/interfaces/DecisionProtocolRepository';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { EstadoProtocolo, PerfilRisco } from '../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.CONTROL_PLANE_PORT || '3001', 10);
const HOST = process.env.CONTROL_PLANE_HOST || '127.0.0.1';
const TOKEN = process.env.CONTROL_PLANE_TOKEN || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || './data';

// ════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════

interface ControlPlaneContext {
  orquestrador: OrquestradorCognitivo;
  protocoloRepo: DecisionProtocolRepositoryImpl;
}

interface ProtocolStats {
  total: number;
  porEstado: Record<string, number>;
  porPerfilRisco: Record<string, number>;
  ultimoProtocolo: {
    id: string;
    estado: string;
    validado_em: string;
  } | null;
}

// ════════════════════════════════════════════════════════════════════════
// AUTENTICACAO
// ════════════════════════════════════════════════════════════════════════

function authenticate(req: http.IncomingMessage): boolean {
  // Em desenvolvimento sem token configurado, permitir acesso
  if (!IS_PRODUCTION && !TOKEN) {
    return true;
  }

  // Requer token em producao ou se configurado
  if (!TOKEN) {
    return false;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return false;
  }

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || token !== TOKEN) {
    return false;
  }

  return true;
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function sendJson(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function parseQueryParams(urlString: string): Record<string, string> {
  const parsed = url.parse(urlString, true);
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.query)) {
    if (typeof value === 'string') {
      params[key] = value;
    }
  }
  return params;
}

// ════════════════════════════════════════════════════════════════════════
// HANDLERS
// ════════════════════════════════════════════════════════════════════════

async function handleHealthEventlog(
  ctx: ControlPlaneContext,
  res: http.ServerResponse
): Promise<void> {
  const status = ctx.orquestrador.GetEventLogStatus();
  sendJson(res, 200, status);
}

async function handleAuditExport(
  ctx: ControlPlaneContext,
  res: http.ServerResponse,
  params: Record<string, string>
): Promise<void> {
  const options: any = {};

  if (params.fromTs) {
    options.fromTs = new Date(params.fromTs);
  }
  if (params.toTs) {
    options.toTs = new Date(params.toTs);
  }
  if (params.fromSegment) {
    options.fromSegment = parseInt(params.fromSegment, 10);
  }
  if (params.toSegment) {
    options.toSegment = parseInt(params.toSegment, 10);
  }

  try {
    const result = await ctx.orquestrador.ExportEventLogForAudit(options);
    sendJson(res, 200, result);
  } catch (error: any) {
    sendError(res, 500, error.message);
  }
}

async function handleAuditReplay(
  ctx: ControlPlaneContext,
  res: http.ServerResponse,
  params: Record<string, string>
): Promise<void> {
  const options: any = {};

  if (params.evento) {
    options.evento = params.evento;
  }
  if (params.entidade) {
    options.entidade = params.entidade;
  }
  if (params.entidadeId) {
    options.entidadeId = params.entidadeId;
  }
  if (params.fromTs) {
    options.fromTs = new Date(params.fromTs);
  }
  if (params.toTs) {
    options.toTs = new Date(params.toTs);
  }

  try {
    const result = await ctx.orquestrador.ReplayEventLog(options);
    sendJson(res, 200, result);
  } catch (error: any) {
    sendError(res, 500, error.message);
  }
}

async function handleDashboardProtocols(
  ctx: ControlPlaneContext,
  res: http.ServerResponse
): Promise<void> {
  try {
    const stats = await getProtocolStats(ctx.protocoloRepo);
    sendJson(res, 200, stats);
  } catch (error: any) {
    sendError(res, 500, error.message);
  }
}

async function handleDashboardSummary(
  ctx: ControlPlaneContext,
  res: http.ServerResponse
): Promise<void> {
  try {
    const eventLogStatus = ctx.orquestrador.GetEventLogStatus();
    const protocolStats = await getProtocolStats(ctx.protocoloRepo);
    const replay = await ctx.orquestrador.ReplayEventLog();

    const summary = {
      timestamp: new Date().toISOString(),
      eventLog: {
        enabled: eventLogStatus.enabled,
        degraded: eventLogStatus.degraded,
        errorCount: eventLogStatus.errorCount,
        totalEventos: replay.totalEventos
      },
      protocolos: {
        total: protocolStats.total,
        validados: protocolStats.porEstado['VALIDADO'] || 0,
        rejeitados: protocolStats.porEstado['REJEITADO'] || 0
      },
      eventosDistribuicao: replay.porEvento,
      atoresDistribuicao: replay.porAtor,
      range: replay.range
    };

    sendJson(res, 200, summary);
  } catch (error: any) {
    sendError(res, 500, error.message);
  }
}

async function getProtocolStats(repo: DecisionProtocolRepositoryImpl): Promise<ProtocolStats> {
  // Acessar store interno via reflexao (para estatisticas apenas)
  const store = (repo as any).store as Map<string, any>;

  const stats: ProtocolStats = {
    total: store.size,
    porEstado: {},
    porPerfilRisco: {},
    ultimoProtocolo: null
  };

  let ultimoProtocolo: any = null;

  for (const protocolo of store.values()) {
    // Contar por estado
    const estado = protocolo.estado;
    stats.porEstado[estado] = (stats.porEstado[estado] || 0) + 1;

    // Contar por perfil de risco
    const perfil = protocolo.perfil_risco;
    stats.porPerfilRisco[perfil] = (stats.porPerfilRisco[perfil] || 0) + 1;

    // Encontrar mais recente
    if (!ultimoProtocolo || protocolo.validado_em > ultimoProtocolo.validado_em) {
      ultimoProtocolo = protocolo;
    }
  }

  if (ultimoProtocolo) {
    stats.ultimoProtocolo = {
      id: ultimoProtocolo.id,
      estado: ultimoProtocolo.estado,
      validado_em: ultimoProtocolo.validado_em.toISOString()
    };
  }

  return stats;
}

// ════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════

async function handleRequest(
  ctx: ControlPlaneContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsedUrl = url.parse(req.url || '/', true);
  const pathname = parsedUrl.pathname || '/';
  const method = req.method || 'GET';
  const params = parseQueryParams(req.url || '/');

  // CORS headers para desenvolvimento
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Autenticacao
  if (!authenticate(req)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  // Roteamento
  try {
    switch (pathname) {
      case '/health/eventlog':
        await handleHealthEventlog(ctx, res);
        break;

      case '/audit/export':
        await handleAuditExport(ctx, res, params);
        break;

      case '/audit/replay':
        await handleAuditReplay(ctx, res, params);
        break;

      case '/dashboard/protocols':
        await handleDashboardProtocols(ctx, res);
        break;

      case '/dashboard/summary':
        await handleDashboardSummary(ctx, res);
        break;

      case '/':
        sendJson(res, 200, {
          name: 'Libervia Control-Plane',
          version: '6.0',
          endpoints: [
            'GET /health/eventlog',
            'GET /audit/export',
            'GET /audit/replay',
            'GET /dashboard/protocols',
            'GET /dashboard/summary'
          ]
        });
        break;

      default:
        sendError(res, 404, 'Not Found');
    }
  } catch (error: any) {
    console.error('[Control-Plane] Erro:', error);
    sendError(res, 500, error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// INICIALIZACAO
// ════════════════════════════════════════════════════════════════════════

async function createContext(dataDir: string): Promise<ControlPlaneContext> {
  console.log(`[Control-Plane] Inicializando com DATA_DIR=${dataDir}`);

  const situacaoRepo = await SituacaoRepositoryImpl.create(dataDir);
  const episodioRepo = await EpisodioRepositoryImpl.create(dataDir);
  const decisaoRepo = await DecisaoRepositoryImpl.create(dataDir);
  const contratoRepo = await ContratoRepositoryImpl.create(dataDir);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(dataDir);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

  let eventLog: EventLogRepositoryImpl | undefined;
  try {
    eventLog = await EventLogRepositoryImpl.create(dataDir);
    console.log('[Control-Plane] EventLog carregado');
  } catch (error) {
    console.warn('[Control-Plane] EventLog nao disponivel:', error);
  }

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
  console.log('[Control-Plane] Orquestrador inicializado');

  return { orquestrador, protocoloRepo };
}

async function startServer(): Promise<http.Server> {
  const ctx = await createContext(DATA_DIR);

  const server = http.createServer((req, res) => {
    handleRequest(ctx, req, res).catch(error => {
      console.error('[Control-Plane] Erro nao tratado:', error);
      sendError(res, 500, 'Internal Server Error');
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, HOST, () => {
      console.log(`[Control-Plane] Servidor iniciado em http://${HOST}:${PORT}`);
      console.log(`[Control-Plane] Token requerido: ${IS_PRODUCTION || TOKEN ? 'Sim' : 'Nao (dev mode)'}`);
      resolve(server);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
// EXPORTS PARA TESTES
// ════════════════════════════════════════════════════════════════════════

export {
  startServer,
  createContext,
  handleRequest,
  authenticate,
  getProtocolStats,
  ControlPlaneContext,
  ProtocolStats
};

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════

if (require.main === module) {
  startServer().catch(error => {
    console.error('[Control-Plane] Falha ao iniciar:', error);
    process.exit(1);
  });
}
