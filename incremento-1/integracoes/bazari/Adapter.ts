/**
 * ════════════════════════════════════════════════════════════════════════════
 * INCREMENTO 7: ADAPTER BAZARI <-> LIBERVIA
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Interface controlada para Bazari consumir decisoes do Cerebro Institucional.
 *
 * PRINCIPIOS:
 * - UNICA SAIDA: ContratoDeDecisao
 * - SEM VAZAMENTO: Nenhum acesso direto a repositorios ou estados internos
 * - AUDITAVEL: Toda interacao logada
 * - VALIDACAO OBRIGATORIA: Protocolo sempre antes de decisao
 *
 * PROIBIDO:
 * - Criar decisoes sem protocolo
 * - Modificar/deletar decisoes existentes
 * - Expor EventLog bruto
 * - Bypassar validacoes do Orquestrador
 */

import {
  ContratoDeDecisao,
  DadosProtocoloInput,
  EstadoEpisodio,
  EstadoProtocolo,
  SituacaoDecisoria,
  StatusSituacao,
  Alternativa,
  Risco,
  Limite
} from '../../camada-3/entidades/tipos';
import { OrquestradorCognitivo } from '../../camada-3/orquestrador/OrquestradorCognitivo';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS PUBLICOS DO ADAPTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Input para criar situacao via Adapter.
 * Subconjunto controlado de SituacaoDecisoria.
 */
export interface SituacaoInput {
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
}

/**
 * Metadados de rastreio da interacao.
 */
export interface MetadadosInteracao {
  request_id: string;
  timestamp_solicitacao: Date;
  timestamp_emissao: Date;
  versao_contrato: 'v1';
}

/**
 * Contrato com metadados de rastreio.
 * Esta e a UNICA saida publica do Adapter.
 */
export interface ContratoComMetadados {
  contrato: ContratoDeDecisao;
  metadados: MetadadosInteracao;
}

/**
 * Status publico de episodio.
 * Nao expoe detalhes internos.
 */
export interface StatusEpisodioPublico {
  episodio_id: string;
  estado: 'CRIADO' | 'DECIDIDO' | 'EM_OBSERVACAO' | 'ENCERRADO';
  tem_contrato: boolean;
  data_criacao: Date;
  data_decisao?: Date;
}

/**
 * Erro de autorizacao.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Erro de validacao de protocolo.
 */
export class ProtocoloRejeitadoError extends Error {
  public motivo: string;

  constructor(motivo: string) {
    super(`Protocolo rejeitado: ${motivo}`);
    this.name = 'ProtocoloRejeitadoError';
    this.motivo = motivo;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ADAPTER PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

/**
 * BazariAdapter - Interface controlada para integracao Bazari <-> Libervia.
 *
 * Este adapter encapsula o OrquestradorCognitivo e garante que:
 * 1. Apenas ContratoDeDecisao e retornado (UNICA SAIDA)
 * 2. Nenhum dado interno vaza para Bazari
 * 3. Todas as interacoes sao logadas
 * 4. Protocolo de decisao e sempre validado
 */
export class BazariAdapter {
  private orquestrador: OrquestradorCognitivo;
  private token?: string;
  private requestCounter: number = 0;

  constructor(orquestrador: OrquestradorCognitivo, token?: string) {
    this.orquestrador = orquestrador;
    this.token = token || process.env.LIBERVIA_INTEGRATION_TOKEN;
  }

  /**
   * Gera ID unico para request.
   */
  private gerarRequestId(): string {
    this.requestCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.requestCounter.toString(36).padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 6);
    return `req-${timestamp}-${counter}-${random}`;
  }

  /**
   * Gera UUID simples.
   */
  private gerarId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Valida token de autenticacao.
   * @throws UnauthorizedError se token invalido
   */
  private validarToken(tokenFornecido?: string): void {
    // Se nao ha token configurado, permite (modo dev)
    if (!this.token) {
      return;
    }

    // Token configurado - deve ser fornecido e correto
    if (!tokenFornecido) {
      throw new UnauthorizedError('Token de integracao nao fornecido');
    }

    if (tokenFornecido !== this.token) {
      throw new UnauthorizedError('Token de integracao invalido');
    }
  }

  /**
   * Converte SituacaoInput para SituacaoDecisoria interna.
   */
  private criarSituacaoInterna(input: SituacaoInput): SituacaoDecisoria {
    return {
      id: this.gerarId(),
      dominio: input.dominio,
      contexto: input.contexto,
      objetivo: input.objetivo,
      incertezas: input.incertezas,
      alternativas: input.alternativas.map(a => ({
        descricao: a.descricao,
        riscos_associados: a.riscos_associados
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

  // ══════════════════════════════════════════════════════════════════════════
  // METODOS PUBLICOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Solicita decisao completa para uma situacao.
   *
   * Executa fluxo completo:
   * 1. Validar token
   * 2. Criar situacao
   * 3. Processar solicitacao (cria episodio)
   * 4. Construir e validar protocolo
   * 5. Registrar decisao
   * 6. Retornar APENAS ContratoDeDecisao
   *
   * @param situacaoData Dados da situacao
   * @param protocoloData Dados do protocolo de decisao
   * @param tokenFornecido Token de autenticacao (opcional se nao configurado)
   * @returns ContratoComMetadados (UNICA SAIDA)
   * @throws UnauthorizedError se token invalido
   * @throws ProtocoloRejeitadoError se protocolo rejeitado
   * @throws Error para outros erros
   */
  async solicitarDecisao(
    situacaoData: SituacaoInput,
    protocoloData: DadosProtocoloInput,
    tokenFornecido?: string
  ): Promise<ContratoComMetadados> {
    const request_id = this.gerarRequestId();
    const timestamp_solicitacao = new Date();

    // 1. Validar token
    this.validarToken(tokenFornecido);

    // 2. Criar situacao interna
    const situacao = this.criarSituacaoInterna(situacaoData);

    // 3. Processar solicitacao (cria episodio)
    const episodio = await this.orquestrador.ProcessarSolicitacao(situacao, { actor: 'Bazari' });

    // 4. Construir e validar protocolo
    const protocolo = await this.orquestrador.ConstruirProtocoloDeDecisao(
      episodio.id,
      protocoloData
    );

    // 5. Verificar se protocolo foi validado
    if (protocolo.estado !== EstadoProtocolo.VALIDADO) {
      throw new ProtocoloRejeitadoError(
        protocolo.motivo_rejeicao || 'Protocolo nao atende criterios minimos'
      );
    }

    // 6. Registrar decisao (retorna contrato)
    // O RegistrarDecisao busca o protocolo internamente pelo episodio_id
    // Precisamos passar os dados da decisao baseados no protocolo validado
    const contrato = await this.orquestrador.RegistrarDecisao(
      episodio.id,
      {
        alternativa_escolhida: protocolo.alternativa_escolhida,
        criterios: protocolo.criterios_minimos,
        perfil_risco: protocolo.perfil_risco,
        limites: protocolo.limites_definidos,
        condicoes: [] // Condicoes sao definidas pelo Orquestrador no contrato
      },
      { emitidoPara: 'Bazari' }
    );

    // 7. Retornar APENAS contrato com metadados
    return {
      contrato,
      metadados: {
        request_id,
        timestamp_solicitacao,
        timestamp_emissao: new Date(),
        versao_contrato: 'v1'
      }
    };
  }

  /**
   * Extrai status a partir de um contrato ja emitido.
   * Este metodo e sincrono pois nao precisa consultar estado interno.
   *
   * @param contrato Contrato previamente emitido por solicitarDecisao
   * @param tokenFornecido Token de autenticacao
   * @returns StatusEpisodioPublico
   */
  consultarStatusDoContrato(
    contrato: ContratoDeDecisao,
    tokenFornecido?: string
  ): StatusEpisodioPublico {
    // Validar token
    this.validarToken(tokenFornecido);

    // Retornar status baseado no contrato (sempre DECIDIDO se tem contrato)
    return {
      episodio_id: contrato.episodio_id,
      estado: 'DECIDIDO',
      tem_contrato: true,
      data_criacao: contrato.data_emissao,
      data_decisao: contrato.data_emissao
    };
  }

  /**
   * Retorna contagem de requisicoes processadas.
   * Util para metricas de carga.
   */
  getRequestCount(): number {
    return this.requestCounter;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cria instancia do BazariAdapter com orquestrador fornecido.
 */
export function createBazariAdapter(
  orquestrador: OrquestradorCognitivo,
  token?: string
): BazariAdapter {
  return new BazariAdapter(orquestrador, token);
}

export default BazariAdapter;
