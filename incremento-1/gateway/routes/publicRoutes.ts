/**
 * INCREMENTO 11 — MULTI-TENANT GATEWAY: Public Routes
 *
 * Rotas publicas da API cognitiva.
 * Todas as rotas requerem tenantId e apiToken (se configurado).
 */

import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SituacaoDecisoria, StatusSituacao } from '../../camada-3/entidades/tipos';
import { PerfilRisco, Limite } from '../../camada-3/entidades/tipos';
import { CoreInstance } from '../../tenant/TenantRuntime';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para criar decisao (fluxo completo)
 */
interface DecisaoInput {
  situacao: {
    dominio: string;
    contexto: string;
    objetivo: string;
    incertezas: string[];
    alternativas: Array<{
      descricao: string;
      riscos_associados: string[];
    }>;
    riscos: Array<{
      descricao: string;
      tipo: string;
      reversibilidade: string;
    }>;
    urgencia: string;
    capacidade_absorcao: string;
    consequencia_relevante: string;
    possibilidade_aprendizado: boolean;
    caso_uso_declarado: number;
  };
  protocolo: {
    criterios_minimos: string[];
    riscos_considerados: string[];
    limites_definidos: Limite[];
    perfil_risco: PerfilRisco;
    alternativas_avaliadas: string[];
    alternativa_escolhida: string;
    memoria_consultada_ids?: string[];
  };
}

interface EpisodioIdParams {
  id: string;
}

interface EventosQuery {
  tipo?: string;
  entidade?: string;
  limit?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gera ID unico para situacao
 */
function generateSituacaoId(): string {
  return `sit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Converte input para SituacaoDecisoria interna
 */
function criarSituacaoInterna(input: DecisaoInput['situacao']): SituacaoDecisoria {
  return {
    id: generateSituacaoId(),
    dominio: input.dominio,
    contexto: input.contexto,
    objetivo: input.objetivo,
    incertezas: input.incertezas,
    alternativas: input.alternativas.map(alt => ({
      descricao: alt.descricao,
      riscos_associados: alt.riscos_associados
    })),
    riscos: input.riscos.map(r => ({
      descricao: r.descricao,
      tipo: r.tipo,
      reversibilidade: r.reversibilidade
    })),
    urgencia: input.urgencia,
    capacidade_absorcao: input.capacidade_absorcao,
    consequencia_relevante: input.consequencia_relevante,
    possibilidade_aprendizado: input.possibilidade_aprendizado,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    caso_uso_declarado: input.caso_uso_declarado,
    anexos_analise: []
  };
}

/**
 * Extrai instancia do Core da request
 */
function getInstance(request: FastifyRequest): CoreInstance {
  const instance = request.tenantInstance;
  if (!instance) {
    throw new Error('Tenant instance not available');
  }
  return instance;
}

// ════════════════════════════════════════════════════════════════════════════
// PLUGIN
// ════════════════════════════════════════════════════════════════════════════

export const publicRoutes: FastifyPluginAsync = async (app) => {
  // ══════════════════════════════════════════════════════════════════════════
  // DECISOES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/decisoes
   * Solicita uma decisao (fluxo completo: situacao -> protocolo -> decisao -> contrato)
   */
  app.post<{ Body: DecisaoInput }>(
    '/decisoes',
    async (request, reply) => {
      const instance = getInstance(request);
      const tenantId = request.tenantId!;
      const { situacao: situacaoInput, protocolo: protocoloInput } = request.body;

      try {
        // 1. Criar situacao interna
        const situacao = criarSituacaoInterna(situacaoInput);

        // 2. Processar solicitacao (cria episodio)
        // Passa tenantId como actor para rastreabilidade
        const episodio = await instance.orquestrador.ProcessarSolicitacao(
          situacao,
          { actor: tenantId }
        );

        // 3. Construir e validar protocolo
        const protocolo = await instance.orquestrador.ConstruirProtocoloDeDecisao(
          episodio.id,
          {
            criterios_minimos: protocoloInput.criterios_minimos,
            riscos_considerados: protocoloInput.riscos_considerados,
            limites_definidos: protocoloInput.limites_definidos,
            perfil_risco: protocoloInput.perfil_risco,
            alternativas_avaliadas: protocoloInput.alternativas_avaliadas,
            alternativa_escolhida: protocoloInput.alternativa_escolhida,
            memoria_consultada_ids: protocoloInput.memoria_consultada_ids
          }
        );

        // 4. Verificar se protocolo foi validado
        if (protocolo.estado !== 'VALIDADO') {
          return reply.code(400).send({
            error: 'Protocol rejected',
            reason: protocolo.motivo_rejeicao || 'Protocol validation failed'
          });
        }

        // 5. Registrar decisao e emitir contrato
        const contrato = await instance.orquestrador.RegistrarDecisao(
          episodio.id,
          {
            alternativa_escolhida: protocoloInput.alternativa_escolhida,
            criterios: protocoloInput.criterios_minimos,
            perfil_risco: protocoloInput.perfil_risco,
            limites: protocoloInput.limites_definidos,
            condicoes: []
          },
          { emitidoPara: tenantId }
        );

        // 6. Retornar contrato
        return reply.code(201).send({
          contrato,
          episodio_id: episodio.id,
          metadados: {
            tenant_id: tenantId,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error: any) {
        request.log.error({ err: error }, 'Decision request failed');
        return reply.code(500).send({
          error: 'Decision processing failed',
          message: error.message
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // EPISODIOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/episodios/:id
   * Consulta status de um episodio via EventLog
   */
  app.get<{ Params: EpisodioIdParams }>(
    '/episodios/:id',
    async (request, reply) => {
      const instance = getInstance(request);
      const { id } = request.params;

      try {
        // Buscar eventos do episodio no EventLog
        const eventos = await instance.eventLog.getByEntidade('EpisodioDecisao', id);

        if (eventos.length === 0) {
          return reply.code(404).send({ error: 'Episode not found' });
        }

        // Ordenar por timestamp e pegar o mais recente
        eventos.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        const ultimoEvento = eventos[0];

        // Buscar contrato associado
        const contratosEventos = await instance.eventLog.getByEntidade('ContratoDeDecisao');
        const contratoEvento = contratosEventos.find(e =>
          e.entidade_id.includes(id) || eventos.some(ep => ep.id === e.id)
        );

        return {
          episodio_id: id,
          ultimo_evento: ultimoEvento.evento,
          timestamp: ultimoEvento.timestamp,
          total_eventos: eventos.length,
          tem_contrato: !!contratoEvento
        };
      } catch (error: any) {
        request.log.error({ err: error }, 'Episode query failed');
        return reply.code(500).send({
          error: 'Query failed',
          message: error.message
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // EVENTOS (via EventLog)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/eventos
   * Lista eventos recentes do tenant
   */
  app.get<{ Querystring: { tipo?: string; entidade?: string; limit?: string } }>(
    '/eventos',
    async (request, reply) => {
      const instance = getInstance(request);
      const { tipo, entidade, limit: limitStr } = request.query;
      const limit = limitStr ? parseInt(limitStr, 10) : 50;

      try {
        let eventos;

        if (tipo) {
          eventos = await instance.eventLog.getByEvento(tipo);
        } else if (entidade) {
          eventos = await instance.eventLog.getByEntidade(entidade);
        } else {
          eventos = await instance.eventLog.getAll();
        }

        // Limitar e ordenar por timestamp desc
        const resultado = eventos
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, limit)
          .map(e => ({
            id: e.id,
            evento: e.evento,
            entidade: e.entidade,
            entidade_id: e.entidade_id,
            timestamp: e.timestamp,
            actor: e.actor
          }));

        return {
          eventos: resultado,
          total: eventos.length,
          limit
        };
      } catch (error: any) {
        request.log.error({ err: error }, 'Events query failed');
        return reply.code(500).send({
          error: 'Query failed',
          message: error.message
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // OBSERVACOES
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/observacoes
   * Inicia observacao de um episodio decidido
   */
  app.post<{ Body: { episodio_id: string } }>(
    '/observacoes',
    async (request, reply) => {
      const instance = getInstance(request);
      const { episodio_id } = request.body;

      try {
        await instance.orquestrador.IniciarObservacao(episodio_id);

        return {
          success: true,
          message: `Observation started for episode ${episodio_id}`
        };
      } catch (error: any) {
        request.log.error({ err: error }, 'Start observation failed');
        return reply.code(400).send({
          error: 'Failed to start observation',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/v1/episodios/:id/encerrar
   * Encerra um episodio em observacao
   */
  app.post<{ Params: EpisodioIdParams }>(
    '/episodios/:id/encerrar',
    async (request, reply) => {
      const instance = getInstance(request);
      const { id } = request.params;

      try {
        await instance.orquestrador.EncerrarEpisodio(id);

        return {
          success: true,
          message: `Episode ${id} closed`
        };
      } catch (error: any) {
        request.log.error({ err: error }, 'Close episode failed');
        return reply.code(400).send({
          error: 'Failed to close episode',
          message: error.message
        });
      }
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // EVENTLOG STATUS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/eventlog/status
   * Status do EventLog do tenant
   */
  app.get(
    '/eventlog/status',
    async (request, _reply) => {
      const instance = getInstance(request);

      const status = instance.orquestrador.GetEventLogStatus();

      return {
        enabled: status.enabled,
        degraded: status.degraded,
        errorCount: status.errorCount,
        lastErrorAt: status.lastErrorAt,
        lastErrorMsg: status.lastErrorMsg
      };
    }
  );
};
