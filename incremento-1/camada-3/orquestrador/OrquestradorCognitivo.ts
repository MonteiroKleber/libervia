import { SituacaoRepository } from '../repositorios/interfaces/SituacaoRepository';
import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import { DecisionProtocolRepository } from '../repositorios/interfaces/DecisionProtocolRepository';
import { ObservacaoRepository } from '../repositorios/interfaces/ObservacaoRepository';
import {
  EventLogRepository,
  ExportRangeOptions,
  ExportRangeResult,
  ReplayOptions,
  ReplayResult
} from '../event-log/EventLogRepository';
import { ActorId, TipoEvento, TipoEntidade, ChainVerificationResult } from '../event-log/EventLogEntry';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import {
  ObservacaoDeConsequencia,
  RegistroConsequenciaInput
} from '../entidades/ObservacaoDeConsequencia';
import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  DecisionProtocol,
  DadosProtocoloInput,
  StatusSituacao,
  EstadoEpisodio,
  EstadoProtocolo,
  MemoryQuery,
  MemoryQueryResult,
  AnexoAnalise
} from '../entidades/tipos';
import { validateClosedLayer, ClosedLayerResult } from '../camada-fechada';
import { runMultiAgent, MultiAgentContext } from '../multiagente/MultiAgentRunner';
import { MultiAgentRunInput, MultiAgentRunResult } from '../multiagente/MultiAgentTypes';
import {
  AutonomyMode,
  AutonomyMandate,
  AutonomyCheckInput,
  AutonomyCheckResult,
  MandateExpireReason,
  evaluate as evaluateAutonomy,
  AutonomyCheckResultExtended,
  shouldMarkExpired
} from '../autonomy';
import { AutonomyMandateRepository } from '../autonomy/AutonomyMandateRepository';
import { HumanOverrideRequiredError } from '../autonomy/AutonomyErrors';
import {
  ConsequenceAutonomyTriggers,
  ConsequenceAction,
  ConsequenceAutonomyResult,
  evaluateConsequenceImpact,
  AutonomyConsequenceService,
  AutonomyConsequenceContext
} from '../autonomy/consequence';

// ════════════════════════════════════════════════════════════════════════
// INCREMENTO 4.1: TIPOS PARA HEALTH DO EVENTLOG
// ════════════════════════════════════════════════════════════════════════

interface EventLogErrorEntry {
  ts: number;
  evento: string;
  msg: string;
}

interface EventLogStatus {
  enabled: boolean;
  degraded: boolean;
  errorCount: number;
  lastErrorAt?: Date;
  lastErrorMsg?: string;
  lastErrors: EventLogErrorEntry[];
}

const MAX_ERROR_BUFFER = 20;

/**
 * Orquestrador Cognitivo (Camada 4 da Libervia)
 *
 * PRINCÍPIOS:
 * - NÃO recomenda decisões
 * - NÃO otimiza resultados
 * - NÃO executa ações (isso é responsabilidade do sistema externo/integração)
 * - ÚNICA saída para sistemas externos: ContratoDeDecisao
 *
 * INCREMENTO 3: Novo fluxo formal
 * Situação → Episódio → Protocolo → Decisão → Contrato
 */
class OrquestradorCognitivo {
  private eventLog?: EventLogRepository;
  private eventLogStatus: EventLogStatus;
  private autonomyMandateRepo?: AutonomyMandateRepository; // INCREMENTO 17

  constructor(
    private situacaoRepo: SituacaoRepository,
    private episodioRepo: EpisodioRepository,
    private decisaoRepo: DecisaoRepository,
    private contratoRepo: ContratoRepository,
    private memoryService: MemoryQueryService,
    private protocoloRepo?: DecisionProtocolRepository, // Opcional para retrocompatibilidade
    eventLog?: EventLogRepository, // INCREMENTO 4: Opcional - o log observa, não governa
    private observacaoRepo?: ObservacaoRepository, // INCREMENTO 15: Opcional para consequências
    autonomyMandateRepo?: AutonomyMandateRepository // INCREMENTO 17: Opcional para autonomia
  ) {
    this.eventLog = eventLog;
    this.autonomyMandateRepo = autonomyMandateRepo;
    // INCREMENTO 4.1: Inicializar estado de saúde do EventLog
    this.eventLogStatus = {
      enabled: !!eventLog,
      degraded: false,
      errorCount: 0,
      lastErrors: []
    };
  }

  /**
   * INCREMENTO 4.1: Inicialização assíncrona (opcional)
   * Verifica integridade da cadeia de eventos ao iniciar.
   * Chamador deve chamar init() logo após new OrquestradorCognitivo().
   * Falha na verificação NÃO bloqueia - apenas marca degraded=true.
   */
  async init(): Promise<void> {
    if (!this.eventLog) return;

    try {
      const result = await this.eventLog.verifyChain();
      if (!result.valid) {
        this.eventLogStatus.degraded = true;
        this.eventLogStatus.errorCount++;
        this.eventLogStatus.lastErrorAt = new Date();
        this.eventLogStatus.lastErrorMsg = `Chain corruption at index ${result.firstInvalidIndex}: ${result.reason}`;
        this.addError('INIT_VERIFY', this.eventLogStatus.lastErrorMsg);
        console.error('[EventLog] Cadeia corrompida detectada na inicialização:', result.reason);
      }
    } catch (error) {
      this.eventLogStatus.degraded = true;
      this.eventLogStatus.errorCount++;
      this.eventLogStatus.lastErrorAt = new Date();
      this.eventLogStatus.lastErrorMsg = error instanceof Error ? error.message : String(error);
      this.addError('INIT_VERIFY', this.eventLogStatus.lastErrorMsg);
      console.error('[EventLog] Erro ao verificar cadeia na inicialização:', error);
    }
  }

  /**
   * INCREMENTO 4.1: Adiciona erro ao ring buffer (max 20)
   */
  private addError(evento: string, msg: string): void {
    this.eventLogStatus.lastErrors.push({
      ts: Date.now(),
      evento,
      msg
    });
    // Ring buffer: manter apenas os últimos MAX_ERROR_BUFFER erros
    if (this.eventLogStatus.lastErrors.length > MAX_ERROR_BUFFER) {
      this.eventLogStatus.lastErrors.shift();
    }
  }

  /**
   * INCREMENTO 4.1: Retorna status atual do EventLog
   */
  GetEventLogStatus(): EventLogStatus {
    return { ...this.eventLogStatus, lastErrors: [...this.eventLogStatus.lastErrors] };
  }

  /**
   * INCREMENTO 4.1: Força verificação da cadeia e atualiza status
   */
  async VerifyEventLogNow(): Promise<ChainVerificationResult> {
    if (!this.eventLog) {
      return { valid: true, totalVerified: 0 };
    }

    try {
      const result = await this.eventLog.verifyChain();
      if (!result.valid) {
        this.eventLogStatus.degraded = true;
        this.eventLogStatus.errorCount++;
        this.eventLogStatus.lastErrorAt = new Date();
        this.eventLogStatus.lastErrorMsg = `Chain corruption at index ${result.firstInvalidIndex}: ${result.reason}`;
        this.addError('VERIFY_NOW', this.eventLogStatus.lastErrorMsg);
      }
      return result;
    } catch (error) {
      this.eventLogStatus.degraded = true;
      this.eventLogStatus.errorCount++;
      this.eventLogStatus.lastErrorAt = new Date();
      this.eventLogStatus.lastErrorMsg = error instanceof Error ? error.message : String(error);
      this.addError('VERIFY_NOW', this.eventLogStatus.lastErrorMsg);
      return {
        valid: false,
        totalVerified: 0,
        reason: this.eventLogStatus.lastErrorMsg
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // INCREMENTO 4.3: AUDITORIA OPERACIONAL
  // ══════════════════════════════════════════════════════════════════════

  /**
   * INCREMENTO 4.3: Exporta eventos para auditoria externa.
   * Delega para eventLog.exportRange().
   * Se não houver eventLog, retorna export vazio com manifest.
   * NUNCA bloqueia - apenas retorna dados.
   */
  async ExportEventLogForAudit(options?: ExportRangeOptions): Promise<ExportRangeResult> {
    if (!this.eventLog) {
      return {
        entries: [],
        manifest: {
          fromTs: null,
          toTs: null,
          fromSegment: null,
          toSegment: null,
          count: 0,
          firstId: null,
          lastId: null,
          chainValidWithinExport: true
        }
      };
    }

    try {
      return await this.eventLog.exportRange(options);
    } catch (error) {
      // Export falhou, mas não bloqueia
      this.eventLogStatus.errorCount++;
      this.eventLogStatus.lastErrorAt = new Date();
      this.eventLogStatus.lastErrorMsg = error instanceof Error ? error.message : String(error);
      this.addError('EXPORT_AUDIT', this.eventLogStatus.lastErrorMsg);

      // Retornar export vazio em caso de erro
      return {
        entries: [],
        manifest: {
          fromTs: null,
          toTs: null,
          fromSegment: null,
          toSegment: null,
          count: 0,
          firstId: null,
          lastId: null,
          chainValidWithinExport: false
        }
      };
    }
  }

  /**
   * INCREMENTO 4.3: Gera resumo operacional (replay) do EventLog.
   * Delega para eventLog.replay().
   * Se não houver eventLog, retorna resumo vazio.
   * NUNCA bloqueia - apenas retorna dados.
   */
  async ReplayEventLog(options?: ReplayOptions): Promise<ReplayResult> {
    if (!this.eventLog) {
      return {
        totalEventos: 0,
        porEvento: {},
        porEntidade: {},
        porAtor: {},
        range: { firstTs: null, lastTs: null },
        inconsistencias: [],
        truncated: false
      };
    }

    try {
      return await this.eventLog.replay(options);
    } catch (error) {
      // Replay falhou, mas não bloqueia
      this.eventLogStatus.errorCount++;
      this.eventLogStatus.lastErrorAt = new Date();
      this.eventLogStatus.lastErrorMsg = error instanceof Error ? error.message : String(error);
      this.addError('REPLAY', this.eventLogStatus.lastErrorMsg);

      // Retornar resumo vazio em caso de erro
      return {
        totalEventos: 0,
        porEvento: {},
        porEntidade: {},
        porAtor: {},
        range: { firstTs: null, lastTs: null },
        inconsistencias: [],
        truncated: false
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCREMENTO 4: LOGGING DE EVENTOS (OPCIONAL)
  // O log observa, não governa - falhas de log não bloqueiam operações
  // ════════════════════════════════════════════════════════════════════════

  private async logEvent(
    evento: string,
    entidade: string,
    entidadeId: string,
    payload: unknown,
    actor: ActorId = 'Libervia'
  ): Promise<void> {
    if (!this.eventLog) return;

    try {
      await this.eventLog.append(actor, evento, entidade, entidadeId, payload);
    } catch (error) {
      // INCREMENTO 4.1: Tracking de erros com ring buffer
      this.eventLogStatus.degraded = true;
      this.eventLogStatus.errorCount++;
      this.eventLogStatus.lastErrorAt = new Date();
      this.eventLogStatus.lastErrorMsg = error instanceof Error ? error.message : String(error);
      this.addError(evento, this.eventLogStatus.lastErrorMsg);
      // Log falhou, mas não bloqueia a operação
      console.error('[EventLog] Falha ao registrar evento:', evento, error);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // FUNÇÕES DO INCREMENTO 0 (corrigidas)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Processa uma solicitação de decisão
   *
   * Fluxo:
   * 1. Se situação não existe, cria
   * 2. Se situação está em RASCUNHO, transiciona para ABERTA
   * 3. Valida que está em ABERTA
   * 4. Transiciona para ACEITA e cria episódio
   * 5. Transiciona para EM_ANALISE
   */
  async ProcessarSolicitacao(
    situacao: SituacaoDecisoria,
    options?: { actor?: string }
  ): Promise<EpisodioDecisao> {
    const actor = options?.actor ?? 'external';

    // Verificar se situação existe
    let sit = await this.situacaoRepo.getById(situacao.id);

    if (!sit) {
      // Situação nova - criar
      await this.situacaoRepo.create(situacao);
      sit = await this.situacaoRepo.getById(situacao.id);

      // INCREMENTO 4: Log de criação de situação
      await this.logEvent(
        TipoEvento.SITUACAO_CRIADA,
        TipoEntidade.SITUACAO,
        situacao.id,
        situacao,
        actor // Sistema externo solicita a criação
      );
    }

    if (!sit) {
      throw new Error('Falha ao criar/recuperar situação');
    }

    // Se está em RASCUNHO, transicionar para ABERTA
    if (sit.status === StatusSituacao.RASCUNHO) {
      const statusAnterior = sit.status;
      await this.situacaoRepo.updateStatus(sit.id, StatusSituacao.ABERTA);
      sit = await this.situacaoRepo.getById(sit.id);

      // INCREMENTO 4: Log de mudança de status
      await this.logEvent(
        TipoEvento.SITUACAO_STATUS_ALTERADO,
        TipoEntidade.SITUACAO,
        sit!.id,
        { status_anterior: statusAnterior, status_novo: StatusSituacao.ABERTA }
      );
    }

    // Validar que está em ABERTA
    if (sit!.status !== StatusSituacao.ABERTA) {
      throw new Error(
        `Situação deve estar ABERTA para ser processada. ` +
        `Status atual: ${sit!.status}`
      );
    }

    // Transicionar para ACEITA
    await this.situacaoRepo.updateStatus(sit!.id, StatusSituacao.ACEITA);

    // INCREMENTO 4: Log de transição para ACEITA
    await this.logEvent(
      TipoEvento.SITUACAO_STATUS_ALTERADO,
      TipoEntidade.SITUACAO,
      sit!.id,
      { status_anterior: StatusSituacao.ABERTA, status_novo: StatusSituacao.ACEITA }
    );

    // Criar episódio
    const episodio = await this.CriarEpisodio(sit!);

    // Transicionar para EM_ANALISE
    await this.situacaoRepo.updateStatus(sit!.id, StatusSituacao.EM_ANALISE);

    // INCREMENTO 4: Log de transição para EM_ANALISE
    await this.logEvent(
      TipoEvento.SITUACAO_STATUS_ALTERADO,
      TipoEntidade.SITUACAO,
      sit!.id,
      { status_anterior: StatusSituacao.ACEITA, status_novo: StatusSituacao.EM_ANALISE }
    );

    return episodio;
  }

  private async CriarEpisodio(situacao: SituacaoDecisoria): Promise<EpisodioDecisao> {
    const episodio: EpisodioDecisao = {
      id: this.gerarId(),
      caso_uso: situacao.caso_uso_declarado,
      dominio: situacao.dominio,
      estado: EstadoEpisodio.CRIADO,
      situacao_referenciada: situacao.id,
      data_criacao: new Date(),
      data_decisao: null,
      data_observacao_iniciada: null,
      data_encerramento: null
    };

    await this.episodioRepo.create(episodio);

    // INCREMENTO 4: Log de criação de episódio
    await this.logEvent(
      TipoEvento.EPISODIO_CRIADO,
      TipoEntidade.EPISODIO,
      episodio.id,
      episodio
    );

    return episodio;
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCREMENTO 3: PROTOCOLO FORMAL DE DECISÃO
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Constrói e valida o Protocolo Formal de Decisão
   *
   * VALIDAÇÕES OBRIGATÓRIAS:
   * - Episódio existe
   * - Episódio está em estado CRIADO
   * - Situação associada está em EM_ANALISE
   * - Memória só pode ser usada se registrada como anexo
   * - Todos os campos obrigatórios preenchidos
   * - Alternativa escolhida ∈ alternativas avaliadas
   *
   * @returns DecisionProtocol com estado VALIDADO ou REJEITADO
   */
  async ConstruirProtocoloDeDecisao(
    episodio_id: string,
    dados: DadosProtocoloInput
  ): Promise<DecisionProtocol> {
    if (!this.protocoloRepo) {
      throw new Error(
        'DecisionProtocolRepository não configurado. ' +
        'Passe protocoloRepo no constructor para usar Incremento 3.'
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 1: Episódio existe
    // ══════════════════════════════════════════════════════════════════════
    const episodio = await this.episodioRepo.getById(episodio_id);
    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 2: Episódio está em estado CRIADO
    // ══════════════════════════════════════════════════════════════════════
    if (episodio.estado !== EstadoEpisodio.CRIADO) {
      throw new Error(
        `Protocolo só pode ser construído quando episódio está em CRIADO. ` +
        `Estado atual: ${episodio.estado}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 3: Situação associada está em EM_ANALISE
    // ══════════════════════════════════════════════════════════════════════
    const situacao = await this.situacaoRepo.getById(episodio.situacao_referenciada);
    if (!situacao) {
      throw new Error(
        `SituaçãoDecisoria ${episodio.situacao_referenciada} não encontrada`
      );
    }

    if (situacao.status !== StatusSituacao.EM_ANALISE) {
      throw new Error(
        `Protocolo só pode ser construído quando situação está em EM_ANALISE. ` +
        `Status atual: ${situacao.status}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 4: Verificar se já existe protocolo para este episódio
    // ══════════════════════════════════════════════════════════════════════
    const protocoloExistente = await this.protocoloRepo.getByEpisodioId(episodio_id);
    if (protocoloExistente) {
      throw new Error(
        `Já existe DecisionProtocol para este episódio. ` +
        `Estado: ${protocoloExistente.estado}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 5: Campos obrigatórios preenchidos
    // ══════════════════════════════════════════════════════════════════════
    const errosValidacao: string[] = [];

    if (!dados.criterios_minimos || dados.criterios_minimos.length === 0) {
      errosValidacao.push('criterios_minimos é obrigatório e não pode ser vazio');
    }

    if (!dados.riscos_considerados || dados.riscos_considerados.length === 0) {
      errosValidacao.push('riscos_considerados é obrigatório e não pode ser vazio');
    }

    if (!dados.limites_definidos || dados.limites_definidos.length === 0) {
      errosValidacao.push('limites_definidos é obrigatório e não pode ser vazio');
    }

    if (!dados.perfil_risco) {
      errosValidacao.push('perfil_risco é obrigatório');
    }

    if (!dados.alternativas_avaliadas || dados.alternativas_avaliadas.length < 2) {
      errosValidacao.push('alternativas_avaliadas requer no mínimo 2 alternativas');
    }

    if (!dados.alternativa_escolhida) {
      errosValidacao.push('alternativa_escolhida é obrigatório');
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 6: Alternativa escolhida ∈ alternativas avaliadas
    // ══════════════════════════════════════════════════════════════════════
    if (dados.alternativa_escolhida &&
        dados.alternativas_avaliadas &&
        !dados.alternativas_avaliadas.includes(dados.alternativa_escolhida)) {
      errosValidacao.push('alternativa_escolhida deve estar entre as alternativas_avaliadas');
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 7: Memória consultada deve estar registrada como anexo
    // ══════════════════════════════════════════════════════════════════════
    const memoriaConsultadaIds = dados.memoria_consultada_ids ?? [];

    if (memoriaConsultadaIds.length > 0) {
      // Extrair IDs de episódios dos anexos de memória consultada
      const idsNosAnexos = this.extrairIdsDeMemoriaConsultada(situacao.anexos_analise);

      for (const memoriaId of memoriaConsultadaIds) {
        if (!idsNosAnexos.has(memoriaId)) {
          errosValidacao.push(
            `Memória ${memoriaId} usada no protocolo não foi registrada como anexo. ` +
            `Use ConsultarMemoriaDuranteAnalise primeiro.`
          );
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // DETERMINAR ESTADO DO PROTOCOLO
    // ══════════════════════════════════════════════════════════════════════

    const now = new Date();
    let estado: EstadoProtocolo;
    let motivo_rejeicao: string | undefined;

    if (errosValidacao.length > 0) {
      estado = EstadoProtocolo.REJEITADO;
      motivo_rejeicao = errosValidacao.join('; ');
    } else {
      estado = EstadoProtocolo.VALIDADO;
    }

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRUIR E PERSISTIR PROTOCOLO
    // ══════════════════════════════════════════════════════════════════════

    // Extrair IDs de anexos utilizados (todos os anexos da situação)
    const anexos_utilizados_ids = situacao.anexos_analise.map((_, index) =>
      `anexo-${situacao.id}-${index}`
    );

    const protocolo: DecisionProtocol = {
      id: this.gerarId(),
      episodio_id,
      criterios_minimos: dados.criterios_minimos ?? [],
      riscos_considerados: dados.riscos_considerados ?? [],
      limites_definidos: dados.limites_definidos ?? [],
      perfil_risco: dados.perfil_risco,
      alternativas_avaliadas: dados.alternativas_avaliadas ?? [],
      alternativa_escolhida: dados.alternativa_escolhida ?? '',
      memoria_consultada_ids: memoriaConsultadaIds,
      anexos_utilizados_ids,
      estado,
      validado_em: now,
      validado_por: 'Libervia',
      motivo_rejeicao
    };

    await this.protocoloRepo.create(protocolo);

    // INCREMENTO 4: Log de protocolo (VALIDADO ou REJEITADO)
    const eventoProtocolo = protocolo.estado === EstadoProtocolo.VALIDADO
      ? TipoEvento.PROTOCOLO_VALIDADO
      : TipoEvento.PROTOCOLO_REJEITADO;

    await this.logEvent(
      eventoProtocolo,
      TipoEntidade.PROTOCOLO,
      protocolo.id,
      protocolo
    );

    return protocolo;
  }

  /**
   * Extrai IDs de episódios dos anexos de "Memória consultada"
   */
  private extrairIdsDeMemoriaConsultada(anexos: AnexoAnalise[]): Set<string> {
    const ids = new Set<string>();

    for (const anexo of anexos) {
      if (anexo.tipo === 'Memória consultada') {
        // Padrão: "- episodio-id (caso_uso: X, estado: Y)"
        const regex = /^- ([^\s]+) \(caso_uso:/gm;
        let match;
        while ((match = regex.exec(anexo.conteudo)) !== null) {
          ids.add(match[1]);
        }
      }
    }

    return ids;
  }

  /**
   * Registra uma decisão institucional
   *
   * INCREMENTO 3: Agora REQUER protocolo VALIDADO
   *
   * RETORNA ContratoDeDecisao (única saída para o sistema chamador)
   */
  async RegistrarDecisao(
    episodio_id: string,
    decisaoInput: Omit<DecisaoInstitucional, 'id' | 'episodio_id' | 'data_decisao'>,
    options?: { emitidoPara?: string }
  ): Promise<ContratoDeDecisao> {
    const episodio = await this.episodioRepo.getById(episodio_id);

    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }

    if (episodio.estado !== EstadoEpisodio.CRIADO) {
      throw new Error('Decisão só pode ser registrada quando episódio está em CRIADO');
    }

    // ══════════════════════════════════════════════════════════════════════
    // INCREMENTO 3: VALIDAR PROTOCOLO (OBRIGATÓRIO - SEM BYPASS)
    // ══════════════════════════════════════════════════════════════════════

    if (!this.protocoloRepo) {
      throw new Error(
        'Incremento 3 ativo: protocoloRepo é obrigatório. ' +
        'Configure DecisionProtocolRepository no constructor do OrquestradorCognitivo.'
      );
    }

    const protocolo = await this.protocoloRepo.getByEpisodioId(episodio_id);

    if (!protocolo) {
      throw new Error(
        'Decisão não pode ser registrada sem DecisionProtocol. ' +
        'Use ConstruirProtocoloDeDecisao primeiro.'
      );
    }

    if (protocolo.estado !== EstadoProtocolo.VALIDADO) {
      throw new Error(
        `Decisão só pode ser registrada com protocolo VALIDADO. ` +
        `Estado atual: ${protocolo.estado}. ` +
        `Motivo: ${protocolo.motivo_rejeicao ?? 'N/A'}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // INCREMENTO 13: CAMADA FECHADA - Validação de bloqueio
    // ══════════════════════════════════════════════════════════════════════

    const situacao = await this.situacaoRepo.getById(episodio.situacao_referenciada);
    if (!situacao) {
      throw new Error(
        `SituacaoDecisoria ${episodio.situacao_referenciada} não encontrada`
      );
    }

    const closedLayerResult = validateClosedLayer(situacao, protocolo);
    if (closedLayerResult.blocked) {
      throw new Error(
        `Decisão bloqueada pela Camada Fechada. ` +
        `Regra: ${closedLayerResult.rule}. ` +
        `Motivo: ${closedLayerResult.reason}`
      );
    }

    // Validar consistência entre protocolo e decisão
    if (protocolo.alternativa_escolhida !== decisaoInput.alternativa_escolhida) {
      throw new Error(
        `alternativa_escolhida na decisão (${decisaoInput.alternativa_escolhida}) ` +
        `difere do protocolo (${protocolo.alternativa_escolhida})`
      );
    }

    if (protocolo.perfil_risco !== decisaoInput.perfil_risco) {
      throw new Error(
        `perfil_risco na decisão (${decisaoInput.perfil_risco}) ` +
        `difere do protocolo (${protocolo.perfil_risco})`
      );
    }

    // Criar decisão com dados fornecidos pelo Orquestrador
    const decisao: DecisaoInstitucional = {
      ...decisaoInput,
      id: this.gerarId(),
      episodio_id: episodio_id,
      data_decisao: new Date() // Orquestrador é fonte da data
    };

    await this.decisaoRepo.create(decisao);

    // INCREMENTO 4: Log de decisão registrada
    await this.logEvent(
      TipoEvento.DECISAO_REGISTRADA,
      TipoEntidade.DECISAO,
      decisao.id,
      decisao
    );

    // Transicionar episódio para DECIDIDO
    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.DECIDIDO);

    // INCREMENTO 4: Log de mudança de estado do episódio
    await this.logEvent(
      TipoEvento.EPISODIO_ESTADO_ALTERADO,
      TipoEntidade.EPISODIO,
      episodio_id,
      { estado_anterior: EstadoEpisodio.CRIADO, estado_novo: EstadoEpisodio.DECIDIDO }
    );

    // Transicionar situação para DECIDIDA
    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.DECIDIDA
    );

    // INCREMENTO 4: Log de mudança de status da situação
    await this.logEvent(
      TipoEvento.SITUACAO_STATUS_ALTERADO,
      TipoEntidade.SITUACAO,
      episodio.situacao_referenciada,
      { status_anterior: StatusSituacao.EM_ANALISE, status_novo: StatusSituacao.DECIDIDA }
    );

    // Emitir contrato (única saída para o sistema externo)
    const emitidoPara = options?.emitidoPara ?? 'external';
    const contrato = await this.EmitirContrato(episodio_id, decisao, emitidoPara);

    return contrato;
  }

  private async EmitirContrato(
    episodio_id: string,
    decisao: DecisaoInstitucional,
    emitidoPara: string = 'external'
  ): Promise<ContratoDeDecisao> {
    const contrato: ContratoDeDecisao = {
      id: this.gerarId(),
      episodio_id,
      decisao_id: decisao.id,
      alternativa_autorizada: decisao.alternativa_escolhida,
      limites_execucao: decisao.limites,
      condicoes_obrigatorias: decisao.condicoes,
      observacao_minima_requerida: [
        'Impacto Técnico observado',
        'Impacto Operacional observado',
        'Evidências coletadas',
        'Persistência avaliada'
      ],
      data_emissao: new Date(), // Orquestrador é fonte da data
      emitido_para: emitidoPara
    };

    await this.contratoRepo.create(contrato);

    // INCREMENTO 4: Log de contrato emitido
    await this.logEvent(
      TipoEvento.CONTRATO_EMITIDO,
      TipoEntidade.CONTRATO,
      contrato.id,
      contrato
    );

    return contrato;
  }

  async IniciarObservacao(episodio_id: string): Promise<void> {
    const episodio = await this.episodioRepo.getById(episodio_id);

    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }

    if (episodio.estado !== EstadoEpisodio.DECIDIDO) {
      throw new Error('Observação só pode iniciar após estado DECIDIDO');
    }

    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.EM_OBSERVACAO);

    // INCREMENTO 4: Log de mudança de estado do episódio
    await this.logEvent(
      TipoEvento.EPISODIO_ESTADO_ALTERADO,
      TipoEntidade.EPISODIO,
      episodio_id,
      { estado_anterior: EstadoEpisodio.DECIDIDO, estado_novo: EstadoEpisodio.EM_OBSERVACAO }
    );

    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.EM_OBSERVACAO
    );

    // INCREMENTO 4: Log de mudança de status da situação
    await this.logEvent(
      TipoEvento.SITUACAO_STATUS_ALTERADO,
      TipoEntidade.SITUACAO,
      episodio.situacao_referenciada,
      { status_anterior: StatusSituacao.DECIDIDA, status_novo: StatusSituacao.EM_OBSERVACAO }
    );
  }

  async EncerrarEpisodio(episodio_id: string): Promise<void> {
    const episodio = await this.episodioRepo.getById(episodio_id);

    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodio_id} não encontrado`);
    }

    if (episodio.estado !== EstadoEpisodio.EM_OBSERVACAO) {
      throw new Error('Episódio só pode ser encerrado após observação');
    }

    await this.episodioRepo.updateEstado(episodio_id, EstadoEpisodio.ENCERRADO);

    // INCREMENTO 4: Log de mudança de estado do episódio
    await this.logEvent(
      TipoEvento.EPISODIO_ESTADO_ALTERADO,
      TipoEntidade.EPISODIO,
      episodio_id,
      { estado_anterior: EstadoEpisodio.EM_OBSERVACAO, estado_novo: EstadoEpisodio.ENCERRADO }
    );

    await this.situacaoRepo.updateStatus(
      episodio.situacao_referenciada,
      StatusSituacao.ENCERRADA
    );

    // INCREMENTO 4: Log de mudança de status da situação
    await this.logEvent(
      TipoEvento.SITUACAO_STATUS_ALTERADO,
      TipoEntidade.SITUACAO,
      episodio.situacao_referenciada,
      { status_anterior: StatusSituacao.EM_OBSERVACAO, status_novo: StatusSituacao.ENCERRADA }
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // FUNÇÕES DO INCREMENTO 1
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Consulta memória institucional durante análise
   * APENAS em EM_ANALISE
   * Registra consulta como AnexoAnalise (append-only)
   * NÃO recomenda, NÃO ranqueia, apenas consulta e registra
   */
  async ConsultarMemoriaDuranteAnalise(
    situacao_id: string,
    query: MemoryQuery
  ): Promise<MemoryQueryResult> {
    // Verificar que situação existe
    const situacao = await this.situacaoRepo.getById(situacao_id);

    if (!situacao) {
      throw new Error(`SituaçãoDecisoria com id ${situacao_id} não encontrada`);
    }

    // APENAS em EM_ANALISE
    if (situacao.status !== StatusSituacao.EM_ANALISE) {
      throw new Error(
        `Consulta de memória só é permitida em EM_ANALISE. ` +
        `Status atual: ${situacao.status}`
      );
    }

    // Executar consulta (sem ranking, sem recomendação)
    // INCREMENTO 2: Internamente usa índices para eficiência
    const resultado = await this.memoryService.find(query);

    // Registrar consulta como anexo (append-only)
    await this.RegistrarMemoriaConsultada(situacao_id, query, resultado);

    // INCREMENTO 4: Log de consulta de memória
    await this.logEvent(
      TipoEvento.MEMORIA_CONSULTADA,
      TipoEntidade.CONSULTA,
      situacao_id,
      { query, total_encontrado: resultado.total_encontrado }
    );

    return resultado;
  }

  /**
   * Registra memória consultada como AnexoAnalise (append-only)
   * PRIVADO - chamado internamente por ConsultarMemoriaDuranteAnalise
   */
  private async RegistrarMemoriaConsultada(
    situacao_id: string,
    query: MemoryQuery,
    resultado: MemoryQueryResult
  ): Promise<void> {
    const conteudo = this.serializarConsultaMemoria(query, resultado);

    const anexo: AnexoAnalise = {
      tipo: 'Memória consultada',
      conteudo,
      data_anexo: new Date()
    };

    await this.situacaoRepo.appendAnexoAnalise(situacao_id, anexo);
  }

  private serializarConsultaMemoria(
    query: MemoryQuery,
    resultado: MemoryQueryResult
  ): string {
    const linhas: string[] = ['### CONSULTA À MEMÓRIA INSTITUCIONAL'];

    linhas.push('\n**Query aplicada:**');
    if (query.caso_uso !== undefined) linhas.push(`- caso_uso: ${query.caso_uso}`);
    if (query.dominio) linhas.push(`- dominio: ${query.dominio}`);
    if (query.perfil_risco) linhas.push(`- perfil_risco: ${query.perfil_risco}`);
    if (query.estado) linhas.push(`- estado: ${query.estado}`);
    if (query.data_inicio) linhas.push(`- data_inicio: ${query.data_inicio.toISOString()}`);
    if (query.data_fim) linhas.push(`- data_fim: ${query.data_fim.toISOString()}`);
    linhas.push(`- limit: ${query.limit ?? 20}`);
    if (query.cursor) linhas.push(`- cursor: ${query.cursor}`);

    linhas.push(`\n**Total encontrado:** ${resultado.total_encontrado}`);

    linhas.push('\n**Episódios retornados (IDs apenas):**');
    if (resultado.hits.length === 0) {
      linhas.push('- Nenhum episódio encontrado');
    } else {
      resultado.hits.forEach(hit => {
        linhas.push(`- ${hit.episodio_id} (caso_uso: ${hit.caso_uso}, estado: ${hit.estado})`);
      });
    }

    if (resultado.next_cursor) {
      linhas.push(`\n**Próximo cursor:** ${resultado.next_cursor}`);
    }

    // IMPORTANTE: Não adicionar interpretação, resumo ou recomendação
    // Apenas dados factuais da consulta

    return linhas.join('\n');
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCREMENTO 15: REGISTRO DE CONSEQUÊNCIAS
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Registra uma consequência (observada + percebida) para um contrato existente.
   *
   * INVARIANTES:
   * - Contrato DEVE existir (pós-execução)
   * - Append-only: nunca editar, nunca deletar
   * - Imutável após criação
   * - Anti-fraude: valida observacao_minima_requerida do contrato
   *
   * @param contratoId ID do contrato ao qual a consequência se refere
   * @param input Dados da consequência (observada + percebida)
   * @param options Opções adicionais (actor para auditoria)
   * @returns ObservacaoDeConsequencia criada
   */
  async RegistrarConsequencia(
    contratoId: string,
    input: RegistroConsequenciaInput,
    options?: { actor?: ActorId }
  ): Promise<ObservacaoDeConsequencia> {
    const actor = options?.actor ?? 'external';

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 1: ObservacaoRepository deve estar configurado
    // ══════════════════════════════════════════════════════════════════════
    if (!this.observacaoRepo) {
      throw new Error(
        'ObservacaoRepository não configurado. ' +
        'Passe observacaoRepo no constructor para usar Incremento 15.'
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 2: Contrato DEVE existir
    // ══════════════════════════════════════════════════════════════════════
    const contrato = await this.contratoRepo.getById(contratoId);
    if (!contrato) {
      throw new Error(
        `ContratoDeDecisao com id ${contratoId} não encontrado. ` +
        `Consequências só podem ser registradas para contratos existentes.`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 3: Episódio DEVE estar em estado apropriado
    // ══════════════════════════════════════════════════════════════════════
    const episodio = await this.episodioRepo.getById(contrato.episodio_id);
    if (!episodio) {
      throw new Error(
        `EpisodioDecisao ${contrato.episodio_id} não encontrado. ` +
        `Inconsistência de dados.`
      );
    }

    // Consequências são pós-execução: episódio deve estar DECIDIDO, EM_OBSERVACAO ou ENCERRADO
    const estadosValidos = [
      EstadoEpisodio.DECIDIDO,
      EstadoEpisodio.EM_OBSERVACAO,
      EstadoEpisodio.ENCERRADO
    ];

    if (!estadosValidos.includes(episodio.estado)) {
      throw new Error(
        `Consequência só pode ser registrada para episódio em estado ` +
        `DECIDIDO, EM_OBSERVACAO ou ENCERRADO. Estado atual: ${episodio.estado}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 4: Campos obrigatórios
    // ══════════════════════════════════════════════════════════════════════
    if (!input.observada) {
      throw new Error('observada é obrigatório');
    }
    if (!input.observada.descricao) {
      throw new Error('observada.descricao é obrigatório');
    }
    if (!input.percebida) {
      throw new Error('percebida é obrigatório');
    }
    if (!input.percebida.descricao) {
      throw new Error('percebida.descricao é obrigatório');
    }
    if (!input.percebida.sinal) {
      throw new Error('percebida.sinal é obrigatório');
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 5: Anti-fraude - observacao_minima_requerida
    // ══════════════════════════════════════════════════════════════════════
    if (!input.evidencias_minimas || input.evidencias_minimas.length === 0) {
      throw new Error('evidencias_minimas é obrigatório e deve ter ao menos 1 item');
    }

    // Tratar contratos antigos: undefined ou [] = sem exigência adicional
    const observacaoMinimaRequerida = contrato.observacao_minima_requerida ?? [];

    // Verificar se todas as evidências mínimas requeridas estão presentes
    const faltantes = observacaoMinimaRequerida.filter(
      requerida => !input.evidencias_minimas.includes(requerida)
    );

    if (faltantes.length > 0) {
      throw new Error(
        `Evidências mínimas faltantes (anti-fraude): ${faltantes.join(', ')}. ` +
        `O contrato exige: ${observacaoMinimaRequerida.join(', ')}`
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDAÇÃO 6: Se é follow-up, observação anterior deve existir
    // ══════════════════════════════════════════════════════════════════════
    if (input.observacao_anterior_id) {
      const observacaoAnterior = await this.observacaoRepo.getById(
        input.observacao_anterior_id
      );
      if (!observacaoAnterior) {
        throw new Error(
          `Observação anterior ${input.observacao_anterior_id} não encontrada. ` +
          `Follow-up deve referenciar observação existente.`
        );
      }
      if (observacaoAnterior.contrato_id !== contratoId) {
        throw new Error(
          `Observação anterior pertence a contrato diferente. ` +
          `Follow-up deve referenciar observação do mesmo contrato.`
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // CRIAR OBSERVAÇÃO
    // ══════════════════════════════════════════════════════════════════════
    const now = new Date();

    const observacao: ObservacaoDeConsequencia = {
      id: this.gerarId(),
      contrato_id: contratoId,
      episodio_id: contrato.episodio_id,
      observada: {
        descricao: input.observada.descricao,
        indicadores: input.observada.indicadores,
        anexos: input.observada.anexos?.map(a => ({
          ...a,
          data_anexo: a.data_anexo ?? now
        })),
        limites_respeitados: input.observada.limites_respeitados,
        condicoes_cumpridas: input.observada.condicoes_cumpridas
      },
      percebida: {
        descricao: input.percebida.descricao,
        sinal: input.percebida.sinal,
        risco_percebido: input.percebida.risco_percebido,
        licoes: input.percebida.licoes,
        contexto_adicional: input.percebida.contexto_adicional
      },
      evidencias_minimas: input.evidencias_minimas,
      registrado_por: actor,
      data_registro: now,
      observacao_anterior_id: input.observacao_anterior_id,
      notas: input.notas
    };

    // Persistir
    await this.observacaoRepo.create(observacao);

    // INCREMENTO 4: Log de consequência registrada
    await this.logEvent(
      TipoEvento.CONSEQUENCIA_REGISTRADA,
      TipoEntidade.OBSERVACAO,
      observacao.id,
      observacao,
      actor
    );

    // ══════════════════════════════════════════════════════════════════════
    // INCREMENTO 19: AVALIAR E APLICAR POLICY DE CONSEQUÊNCIA
    // Se autonomyTriggers fornecidos E autonomyMandateRepo disponível
    // ══════════════════════════════════════════════════════════════════════
    if (input.autonomyTriggers && this.autonomyMandateRepo && input.agentId) {
      const consequenceResult = await this.AvaliarEAplicarConsequencia(
        observacao,
        input.autonomyTriggers,
        input.agentId
      );

      // Retornar observação com resultado da avaliação de consequência
      return {
        ...observacao,
        _consequenceResult: consequenceResult
      } as ObservacaoDeConsequencia & { _consequenceResult?: ConsequenceAutonomyResult };
    }

    return observacao;
  }

  /**
   * Busca consequências registradas para um contrato.
   * Retorna lista ordenada por data_registro (mais antiga primeiro).
   */
  async GetConsequenciasByContrato(contratoId: string): Promise<ObservacaoDeConsequencia[]> {
    if (!this.observacaoRepo) {
      throw new Error(
        'ObservacaoRepository não configurado. ' +
        'Passe observacaoRepo no constructor para usar Incremento 15.'
      );
    }

    // Validar que contrato existe
    const contrato = await this.contratoRepo.getById(contratoId);
    if (!contrato) {
      throw new Error(`ContratoDeDecisao com id ${contratoId} não encontrado`);
    }

    return this.observacaoRepo.getByContratoId(contratoId);
  }

  /**
   * Busca consequências registradas para um episódio.
   * Retorna lista ordenada por data_registro (mais antiga primeiro).
   */
  async GetConsequenciasByEpisodio(episodioId: string): Promise<ObservacaoDeConsequencia[]> {
    if (!this.observacaoRepo) {
      throw new Error(
        'ObservacaoRepository não configurado. ' +
        'Passe observacaoRepo no constructor para usar Incremento 15.'
      );
    }

    // Validar que episódio existe
    const episodio = await this.episodioRepo.getById(episodioId);
    if (!episodio) {
      throw new Error(`EpisodioDecisao com id ${episodioId} não encontrado`);
    }

    return this.observacaoRepo.getByEpisodioId(episodioId);
  }

  /**
   * Conta quantas consequências foram registradas para um contrato.
   */
  async CountConsequenciasByContrato(contratoId: string): Promise<number> {
    if (!this.observacaoRepo) {
      return 0;
    }

    return this.observacaoRepo.countByContratoId(contratoId);
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCREMENTO 16: MULTIAGENTE
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Processa uma solicitação de decisão usando múltiplos agentes.
   *
   * Multiagente = múltiplos agentes decisores processam a mesma situação
   * sob perfis/mandatos distintos, produzindo propostas candidatas
   * e uma agregação institucional final.
   *
   * PRINCÍPIOS:
   * - NÃO é LLM, nem otimizador, nem previsão
   * - É divergência deliberada de perfis com rastreabilidade
   * - Closed Layer continua soberana (valida antes de cada proposta)
   * - Um episódio por situação (não fragmentar vivência)
   *
   * @param situacao - Situação decisória a processar
   * @param input - Configuração do multiagente (agentes, política, dados base)
   * @param options - Opções adicionais (actor, emitidoPara)
   * @returns Resultado completo da execução multiagente
   */
  async ProcessarSolicitacaoMultiAgente(
    situacao: SituacaoDecisoria,
    input: MultiAgentRunInput,
    options?: { actor?: ActorId; emitidoPara?: string }
  ): Promise<MultiAgentRunResult> {
    // Validar que protocoloRepo está configurado
    if (!this.protocoloRepo) {
      throw new Error(
        'DecisionProtocolRepository não configurado. ' +
        'Passe protocoloRepo no constructor para usar Incremento 16 (Multiagente).'
      );
    }

    // Criar contexto para o runner
    const context: MultiAgentContext = {
      situacaoRepo: this.situacaoRepo,
      episodioRepo: this.episodioRepo,
      decisaoRepo: this.decisaoRepo,
      contratoRepo: this.contratoRepo,
      protocoloRepo: this.protocoloRepo,
      eventLog: this.eventLog,
      gerarId: () => this.gerarId()
    };

    // Delegar para o runner
    return runMultiAgent(situacao, input, context, options);
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCREMENTO 17: AUTONOMIA GRADUADA
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Concede um mandato de autonomia para um agente.
   *
   * PRINCÍPIOS:
   * - Mandatos são explícitos (nunca inferidos)
   * - Mandatos são revogáveis
   * - Mandatos são auditáveis (registrados no EventLog)
   *
   * @param mandate - Mandato a conceder
   * @returns Mandato criado
   */
  async ConcederMandato(mandate: AutonomyMandate): Promise<AutonomyMandate> {
    if (!this.autonomyMandateRepo) {
      throw new Error(
        'AutonomyMandateRepository não configurado. ' +
        'Passe autonomyMandateRepo no constructor para usar Incremento 17.'
      );
    }

    // Validar campos obrigatórios
    if (!mandate.id) {
      throw new Error('mandate.id é obrigatório');
    }
    if (!mandate.agentId) {
      throw new Error('mandate.agentId é obrigatório');
    }
    if (!mandate.modo) {
      throw new Error('mandate.modo é obrigatório');
    }
    if (!mandate.politicas_permitidas || mandate.politicas_permitidas.length === 0) {
      throw new Error('mandate.politicas_permitidas é obrigatório e não pode ser vazio');
    }
    if (!mandate.perfil_risco_maximo) {
      throw new Error('mandate.perfil_risco_maximo é obrigatório');
    }
    if (!mandate.concedido_por) {
      throw new Error('mandate.concedido_por é obrigatório');
    }

    // Garantir campos padrão
    const mandateToCreate: AutonomyMandate = {
      ...mandate,
      concedido_em: mandate.concedido_em ?? new Date(),
      limites: mandate.limites ?? [],
      requer_humano_se: mandate.requer_humano_se ?? [],
      revogado: false
    };

    // Persistir
    await this.autonomyMandateRepo.create(mandateToCreate);

    // Log de concessão
    await this.logEvent(
      TipoEvento.AUTONOMY_GRANTED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandate.id,
      mandateToCreate,
      mandate.concedido_por
    );

    return mandateToCreate;
  }

  /**
   * Revoga um mandato de autonomia.
   *
   * @param mandateId - ID do mandato a revogar
   * @param revogadoPor - Ator que revoga
   * @param motivo - Motivo da revogação
   */
  async RevogarMandato(
    mandateId: string,
    revogadoPor: ActorId,
    motivo?: string
  ): Promise<void> {
    if (!this.autonomyMandateRepo) {
      throw new Error(
        'AutonomyMandateRepository não configurado. ' +
        'Passe autonomyMandateRepo no constructor para usar Incremento 17.'
      );
    }

    // Verificar se mandato existe
    const mandate = await this.autonomyMandateRepo.getById(mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${mandateId} não encontrado`);
    }

    if (mandate.revogado) {
      throw new Error(`Mandato ${mandateId} já foi revogado`);
    }

    // Revogar
    await this.autonomyMandateRepo.revoke(mandateId, revogadoPor, motivo);

    // Log de revogação
    await this.logEvent(
      TipoEvento.AUTONOMY_REVOKED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandateId,
      { agentId: mandate.agentId, motivo },
      revogadoPor
    );
  }

  /**
   * Obtém o mandato ativo de um agente.
   *
   * @param agentId - ID do agente
   * @returns Mandato ativo ou null
   */
  async GetMandatoAtivo(agentId: string): Promise<AutonomyMandate | null> {
    if (!this.autonomyMandateRepo) {
      return null;
    }

    return this.autonomyMandateRepo.getMostRecentActiveByAgentId(agentId);
  }

  /**
   * Avalia se um agente tem autonomia para uma decisão.
   *
   * REGRAS CANÔNICAS:
   * 1. ENSINO nunca decide
   * 2. Mandato é obrigatório fora do ensino
   * 3. Política precisa estar autorizada
   * 4. Perfil de risco não pode exceder
   * 5. Camada Fechada sempre vence
   *
   * INCREMENTO 18 adiciona:
   * - Verificação de validFrom (mandato ainda não ativo)
   * - Verificação de validUntil (mandato expirado por tempo)
   * - Verificação de maxUses (mandato esgotado por usos)
   * - Parâmetro now para testes determinísticos
   *
   * @param input - Dados para avaliação
   * @param now - Data atual (opcional, para testes determinísticos)
   * @returns Resultado da avaliação (estendido com info de expiração)
   */
  async AvaliarAutonomia(
    input: AutonomyCheckInput,
    now?: Date
  ): Promise<AutonomyCheckResultExtended> {
    const currentTime = now ?? new Date();

    // Se não tiver repositório de autonomia, modo é ENSINO
    if (!this.autonomyMandateRepo) {
      const result = evaluateAutonomy({
        ...input,
        mandate: undefined,
        now: currentTime
      });

      // Log de verificação
      if (result.permitido) {
        await this.logEvent(
          TipoEvento.AUTONOMY_CHECK_PASSED,
          TipoEntidade.AUTONOMY_MANDATE,
          input.agentId,
          { ...input, result }
        );
      } else {
        await this.logEvent(
          TipoEvento.AUTONOMY_CHECK_FAILED,
          TipoEntidade.AUTONOMY_MANDATE,
          input.agentId,
          { ...input, result }
        );
      }

      return result;
    }

    // Obter mandato se não fornecido
    let mandate = input.mandate;
    if (!mandate) {
      mandate = await this.autonomyMandateRepo.getMostRecentActiveByAgentId(input.agentId, currentTime) ?? undefined;
    }

    // Avaliar com data atual
    const result = evaluateAutonomy({
      ...input,
      mandate,
      now: currentTime
    });

    // INCREMENTO 18: Se resultado indica que mandato precisa ser expirado
    if (result.shouldExpire && result.mandato_id && result.expireReason) {
      await this.MarcarMandatoExpirado(result.mandato_id, result.expireReason, currentTime);
    }

    // Log de verificação
    if (result.permitido) {
      await this.logEvent(
        TipoEvento.AUTONOMY_CHECK_PASSED,
        TipoEntidade.AUTONOMY_MANDATE,
        input.agentId,
        { ...input, result }
      );
    } else {
      await this.logEvent(
        TipoEvento.AUTONOMY_CHECK_FAILED,
        TipoEntidade.AUTONOMY_MANDATE,
        input.agentId,
        { ...input, result }
      );
    }

    return result;
  }

  /**
   * Verifica autonomia e lança exceção se não permitido.
   *
   * Uso típico: antes de emitir contrato final.
   *
   * @param input - Dados para avaliação
   * @throws HumanOverrideRequiredError se autonomia não permitida
   */
  async VerificarAutonomiaOuBloquear(input: AutonomyCheckInput): Promise<void> {
    const result = await this.AvaliarAutonomia(input);

    if (!result.permitido) {
      // Log de bloqueio
      await this.logEvent(
        TipoEvento.AUTONOMY_BLOCKED,
        TipoEntidade.AUTONOMY_MANDATE,
        input.agentId,
        { ...input, result }
      );

      throw new HumanOverrideRequiredError(
        result.motivo ?? 'Autonomia não permitida',
        result.modo,
        input.agentId,
        result.mandato_id
      );
    }
  }

  /**
   * Obtém histórico de mandatos de um agente (incluindo revogados).
   *
   * @param agentId - ID do agente
   * @returns Lista de mandatos
   */
  async GetHistoricoMandatos(agentId: string): Promise<AutonomyMandate[]> {
    if (!this.autonomyMandateRepo) {
      return [];
    }

    return this.autonomyMandateRepo.getAllByAgentId(agentId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INCREMENTO 19: POLICY DE CONSEQUÊNCIA PARA AUTONOMIA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Avalia e aplica a policy de consequência para autonomia.
   *
   * PRINCÍPIOS:
   * - Determinístico: mesmas entradas = mesmos resultados
   * - Sem IA: regras puras, sem heurística
   * - Idempotente: ações já aplicadas não são reaplicadas
   *
   * @param observacao - Observação de consequência registrada
   * @param triggers - Gatilhos de autonomia
   * @param agentId - ID do agente
   * @returns Resultado da avaliação
   */
  private async AvaliarEAplicarConsequencia(
    observacao: ObservacaoDeConsequencia,
    triggers: ConsequenceAutonomyTriggers,
    agentId: string
  ): Promise<ConsequenceAutonomyResult> {
    if (!this.autonomyMandateRepo) {
      return {
        action: ConsequenceAction.NO_ACTION,
        reason: 'AutonomyMandateRepository não configurado',
        ruleId: 'RULE_19_0_NO_TRIGGER' as any,
        effects: {}
      };
    }

    // Obter mandato atual do agente
    const mandate = await this.autonomyMandateRepo.getMostRecentActiveByAgentId(agentId);

    // Avaliar impacto (função pura, sem I/O)
    const result = evaluateConsequenceImpact({
      observacao,
      triggers,
      mandate: mandate ?? undefined,
      currentMode: mandate?.modo
    });

    // Se ação já foi aplicada ou não há ação, retornar
    if (result.alreadyApplied || result.action === ConsequenceAction.NO_ACTION) {
      return result;
    }

    // Criar contexto para aplicar efeitos
    const context: AutonomyConsequenceContext = {
      mandateRepo: this.autonomyMandateRepo,
      eventLog: this.eventLog
    };

    const service = new AutonomyConsequenceService(context);

    // Aplicar efeitos conforme ação
    switch (result.action) {
      case ConsequenceAction.SUSPEND_MANDATE:
        if (mandate) {
          await service.suspendMandate(
            mandate.id,
            result.effects.suspendReason ?? 'Suspensão por consequência',
            observacao.id
          );
        }
        break;

      case ConsequenceAction.REVOKE_MANDATE:
        if (mandate) {
          await service.revokeByConsequence(
            mandate.id,
            result.reason,
            observacao.id
          );
        }
        break;

      case ConsequenceAction.DEGRADE_MODE:
        // Degradação de modo é registrada no EventLog
        // O novo modo é aplicado no próximo AvaliarAutonomia
        if (mandate && result.effects.newAutonomyMode) {
          await service.degradeMode(
            mandate.id,
            mandate.modo,
            result.effects.newAutonomyMode,
            observacao.id
          );
        }
        break;

      case ConsequenceAction.FLAG_HUMAN_REVIEW:
        await service.flagHumanReview(
          agentId,
          result.reason,
          observacao.id,
          mandate?.id
        );
        break;
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INCREMENTO 18: MÉTODOS DE MANDATOS TEMPORAIS E LIMITE DE USOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Marca um mandato como expirado.
   * Registra evento AUTONOMY_EXPIRED no EventLog.
   * Operação idempotente: se já expirado, não faz nada.
   *
   * @param mandateId - ID do mandato
   * @param reason - Motivo da expiração ('TIME' ou 'USES')
   * @param now - Data da expiração
   */
  async MarcarMandatoExpirado(
    mandateId: string,
    reason: MandateExpireReason,
    now: Date = new Date()
  ): Promise<void> {
    if (!this.autonomyMandateRepo) {
      throw new Error(
        'AutonomyMandateRepository não configurado. ' +
        'Passe autonomyMandateRepo no constructor para usar Incremento 18.'
      );
    }

    // Verificar se mandato existe
    const mandate = await this.autonomyMandateRepo.getById(mandateId);
    if (!mandate) {
      throw new Error(`Mandato ${mandateId} não encontrado`);
    }

    // Idempotência: se já expirado, não faz nada
    if (mandate.status === 'expired') {
      return;
    }

    // Marcar como expirado
    await this.autonomyMandateRepo.markExpired(mandateId, reason, now);

    // Log de expiração
    await this.logEvent(
      TipoEvento.AUTONOMY_EXPIRED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandateId,
      {
        mandateId,
        agentId: mandate.agentId,
        expiredAt: now.toISOString(),
        reason
      }
    );
  }

  /**
   * Registra uso de mandato.
   * Incrementa contador de usos e registra evento.
   * Deve ser chamado APÓS avaliação passar e ANTES de emitir contrato.
   *
   * @param mandateId - ID do mandato
   * @param now - Data do uso
   * @returns Mandato atualizado
   */
  async RegistrarUsoMandato(
    mandateId: string,
    now: Date = new Date()
  ): Promise<AutonomyMandate> {
    if (!this.autonomyMandateRepo) {
      throw new Error(
        'AutonomyMandateRepository não configurado. ' +
        'Passe autonomyMandateRepo no constructor para usar Incremento 18.'
      );
    }

    // Incrementar uso
    const updated = await this.autonomyMandateRepo.incrementUses(mandateId, now);

    // Log de uso
    await this.logEvent(
      TipoEvento.AUTONOMY_USE_CONSUMED,
      TipoEntidade.AUTONOMY_MANDATE,
      mandateId,
      {
        mandateId,
        agentId: updated.agentId,
        uses: updated.uses,
        maxUses: updated.maxUses,
        lastUsedAt: updated.lastUsedAt
      }
    );

    // Se atingiu limite de usos, logar expiração
    if (updated.status === 'expired' && updated.expireReason === 'USES') {
      await this.logEvent(
        TipoEvento.AUTONOMY_EXPIRED,
        TipoEntidade.AUTONOMY_MANDATE,
        mandateId,
        {
          mandateId,
          agentId: updated.agentId,
          expiredAt: updated.expiredAt,
          reason: 'USES'
        }
      );
    }

    return updated;
  }

  // ════════════════════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ════════════════════════════════════════════════════════════════════════

  private gerarId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

export { OrquestradorCognitivo };
