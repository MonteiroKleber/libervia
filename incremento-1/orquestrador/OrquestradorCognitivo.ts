import { SituacaoRepository } from '../repositorios/interfaces/SituacaoRepository';
import { EpisodioRepository } from '../repositorios/interfaces/EpisodioRepository';
import { DecisaoRepository } from '../repositorios/interfaces/DecisaoRepository';
import { ContratoRepository } from '../repositorios/interfaces/ContratoRepository';
import { DecisionProtocolRepository } from '../repositorios/interfaces/DecisionProtocolRepository';
import {
  EventLogRepository,
  ExportRangeOptions,
  ExportRangeResult,
  ReplayOptions,
  ReplayResult
} from '../event-log/EventLogRepository';
import { TipoEvento, TipoEntidade, ChainVerificationResult } from '../event-log/EventLogEntry';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
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
 * - NÃO executa ações (isso é Bazari)
 * - ÚNICA saída para Bazari: ContratoDeDecisao
 *
 * INCREMENTO 3: Novo fluxo formal
 * Situação → Episódio → Protocolo → Decisão → Contrato
 */
class OrquestradorCognitivo {
  private eventLog?: EventLogRepository;
  private eventLogStatus: EventLogStatus;

  constructor(
    private situacaoRepo: SituacaoRepository,
    private episodioRepo: EpisodioRepository,
    private decisaoRepo: DecisaoRepository,
    private contratoRepo: ContratoRepository,
    private memoryService: MemoryQueryService,
    private protocoloRepo?: DecisionProtocolRepository, // Opcional para retrocompatibilidade
    eventLog?: EventLogRepository // INCREMENTO 4: Opcional - o log observa, não governa
  ) {
    this.eventLog = eventLog;
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
    actor: 'Libervia' | 'Bazari' = 'Libervia'
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
  async ProcessarSolicitacao(situacao: SituacaoDecisoria): Promise<EpisodioDecisao> {
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
        'Bazari' // Bazari solicita a criação
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
   * RETORNA ContratoDeDecisao (única saída para Bazari)
   */
  async RegistrarDecisao(
    episodio_id: string,
    decisaoInput: Omit<DecisaoInstitucional, 'id' | 'episodio_id' | 'data_decisao'>
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

    // Emitir contrato (ÚNICA saída para Bazari)
    const contrato = await this.EmitirContrato(episodio_id, decisao);

    return contrato;
  }

  private async EmitirContrato(
    episodio_id: string,
    decisao: DecisaoInstitucional
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
      emitido_para: 'Bazari'
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
  // UTILITÁRIOS
  // ════════════════════════════════════════════════════════════════════════

  private gerarId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

export { OrquestradorCognitivo };
