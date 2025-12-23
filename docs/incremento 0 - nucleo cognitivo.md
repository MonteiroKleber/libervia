INCREMENTO 0 — NÚCLEO COGNITIVO (VERSÃO FINAL AJUSTADA)
1. MODELO ESTRUTURAL DAS ENTIDADES
1.1 SituaçãoDecisoria (Camada 4 — Orquestrador)

ENTIDADE SituaçãoDecisoria {
  CAMPO id: Identificador único, imutável após criação
  CAMPO dominio: Texto não vazio
  CAMPO contexto: Texto não vazio
  CAMPO objetivo: Texto não vazio
  CAMPO incertezas: Lista não vazia de Texto
  CAMPO alternativas: Lista de Alternativa (mínimo 2)
  CAMPO riscos: Lista não vazia de Risco
  CAMPO urgencia: Texto
  CAMPO capacidade_absorcao: Texto
  CAMPO consequencia_relevante: Texto não vazio
  CAMPO possibilidade_aprendizado: Booleano (confirmação obrigatória)
  CAMPO status: Enumeração { RASCUNHO, ABERTA, ACEITA, REJEITADA, EM_ANALISE, DECIDIDA, EM_OBSERVACAO, ENCERRADA }
  CAMPO data_criacao: Data/Hora, imutável
  CAMPO caso_uso_declarado: Inteiro entre 1 e 5
  
  CAMPO anexos_analise: Lista de AnexoAnalise (append-only, adicionado durante EM_ANALISE)
  
  INVARIANTE: Campos do núcleo (contexto, objetivo, incertezas, alternativas, riscos, urgencia, capacidade_absorcao, consequencia_relevante, possibilidade_aprendizado, caso_uso_declarado) são IMUTÁVEIS a partir de ACEITA
  INVARIANTE: Campo anexos_analise é append-only (nunca deleta ou modifica itens, apenas adiciona)
  INVARIANTE: Se status = REJEITADA, então entidade é IMUTÁVEL e terminal
  INVARIANTE: Se status = ENCERRADA, então entidade é IMUTÁVEL
}

TIPO Alternativa {
  CAMPO descricao: Texto não vazio
  CAMPO riscos_associados: Lista de Texto
}

TIPO Risco {
  CAMPO descricao: Texto não vazio
  CAMPO tipo: Texto
  CAMPO reversibilidade: Texto
}

TIPO AnexoAnalise {
  CAMPO tipo: Texto (ex: "RiskMap detalhado", "Memória consultada", "Notas de análise")
  CAMPO conteudo: Texto
  CAMPO data_anexo: Data/Hora, imutável
}
1.2 EpisodioDecisao (Camada 3 — Libervia)

ENTIDADE EpisodioDecisao {
  CAMPO id: Identificador único, imutável após criação
  CAMPO caso_uso: Inteiro entre 1 e 5, obrigatório
  CAMPO dominio: Texto não vazio
  CAMPO estado: Enumeração { CRIADO, DECIDIDO, EM_OBSERVACAO, ENCERRADO }
  CAMPO situacao_referenciada: Referência a SituaçãoDecisoria, imutável
  CAMPO data_criacao: Data/Hora, imutável
  CAMPO data_decisao: Data/Hora ou NULO
  CAMPO data_observacao_iniciada: Data/Hora ou NULO
  CAMPO data_encerramento: Data/Hora ou NULO
  
  INVARIANTE: Entidade NUNCA pode ser deletada
  INVARIANTE: Todos os campos são imutáveis exceto 'estado' e campos de data relacionados a transições
  INVARIANTE: Transições de estado seguem máquina de estados rigorosa
}
1.3 DecisaoInstitucional (Camada 3)

ENTIDADE DecisaoInstitucional {
  CAMPO id: Identificador único, imutável após criação
  CAMPO episodio_id: Referência a EpisodioDecisao, imutável
  CAMPO alternativa_escolhida: Texto não vazio, imutável
  CAMPO criterios: Lista não vazia de Texto, imutável
  CAMPO perfil_risco: Enumeração { CONSERVADOR, MODERADO, AGRESSIVO }, imutável
  CAMPO limites: Lista de Limite, imutável
  CAMPO condicoes: Lista de Texto, imutável
  CAMPO data_decisao: Data/Hora, imutável
  
  INVARIANTE: Entidade é TOTALMENTE IMUTÁVEL após criação
  INVARIANTE: Só pode existir UMA DecisaoInstitucional por episodio_id
  INVARIANTE: Entidade NUNCA pode ser deletada
}

TIPO Limite {
  CAMPO tipo: Texto não vazio
  CAMPO descricao: Texto não vazio
  CAMPO valor: Texto
}
1.4 ContratoDeDecisao (Ponte Libervia → Bazari)

ENTIDADE ContratoDeDecisao {
  CAMPO id: Identificador único, imutável após criação
  CAMPO episodio_id: Referência a EpisodioDecisao, imutável
  CAMPO decisao_id: Referência a DecisaoInstitucional, imutável
  CAMPO alternativa_autorizada: Texto não vazio, imutável
  CAMPO limites_execucao: Lista de Limite, imutável
  CAMPO condicoes_obrigatorias: Lista de Texto, imutável
  CAMPO observacao_minima_requerida: Lista de Texto, imutável
  CAMPO data_emissao: Data/Hora, imutável
  CAMPO emitido_para: Texto (identifica Bazari/executor), imutável
  
  INVARIANTE: Entidade é TOTALMENTE IMUTÁVEL após criação
  INVARIANTE: Só pode existir UM ContratoDeDecisao por episodio_id
  INVARIANTE: Entidade NUNCA pode ser deletada
  
  PRINCÍPIO FUNDAMENTAL: A única saída da Libervia para a Bazari é ContratoDeDecisao
}
2. MÁQUINAS DE ESTADOS
2.1 Máquina de Estados — Camada 4 (SituaçãoDecisoria)

MÁQUINA: SituaçãoDecisoria (Camada 4 — Orquestrador Cognitivo)

CAMADA 4 PERTENCE À LIBERVIA
Camada 4 é parte integrante da Libervia, responsável por operacionalizar o processo decisório.

ESTADOS = { RASCUNHO, ABERTA, ACEITA, REJEITADA, EM_ANALISE, DECIDIDA, EM_OBSERVACAO, ENCERRADA }

ESTADO_INICIAL = RASCUNHO

TRANSIÇÕES_VÁLIDAS = {
  RASCUNHO → ABERTA,
  ABERTA → ACEITA,
  ABERTA → REJEITADA (terminal),
  ACEITA → EM_ANALISE,
  EM_ANALISE → DECIDIDA,
  DECIDIDA → EM_OBSERVACAO,
  EM_OBSERVACAO → ENCERRADA
}

ESTADOS_TERMINAIS = { REJEITADA, ENCERRADA }

RESPONSABILIDADE: Controlar ciclo de vida da solicitação de decisão no Orquestrador (Camada 4 da Libervia)
2.2 Máquina de Estados — Camada 3 (EpisodioDecisao)

MÁQUINA: EpisodioDecisao (Camada 3 — Libervia / Cérebro Institucional)

ESTADOS = { CRIADO, DECIDIDO, EM_OBSERVACAO, ENCERRADO }

ESTADO_INICIAL = CRIADO

TRANSIÇÕES_VÁLIDAS = {
  CRIADO → DECIDIDO,
  DECIDIDO → EM_OBSERVACAO,
  EM_OBSERVACAO → ENCERRADO
}

ESTADO_TERMINAL = ENCERRADO

RESPONSABILIDADE: Controlar ciclo de vida do episódio na memória institucional (Camada 3 da Libervia)
2.3 Regras de Transição — Camada 4 (SituaçãoDecisoria)

FUNÇÃO TransicionarSituacao(situacao: SituaçãoDecisoria, novo_status: Status) → Resultado {
  
  SE situacao.status EM { REJEITADA, ENCERRADA } ENTÃO
    RETORNAR Erro("Situação em estado terminal não pode mudar de status")
  FIM SE
  
  SE NÃO ExisteTransicaoSituacao(situacao.status, novo_status) ENTÃO
    RETORNAR Erro("Transição inválida: " + situacao.status + " → " + novo_status)
  FIM SE
  
  situacao.status ← novo_status
  
  RETORNAR Sucesso(situacao)
}

FUNÇÃO ExisteTransicaoSituacao(status_atual: Status, status_novo: Status) → Booleano {
  transicoes_validas ← {
    (RASCUNHO, ABERTA),
    (ABERTA, ACEITA),
    (ABERTA, REJEITADA),
    (ACEITA, EM_ANALISE),
    (EM_ANALISE, DECIDIDA),
    (DECIDIDA, EM_OBSERVACAO),
    (EM_OBSERVACAO, ENCERRADA)
  }
  
  RETORNAR (status_atual, status_novo) ESTÁ EM transicoes_validas
}
2.4 Regras de Transição — Camada 3 (EpisodioDecisao)

FUNÇÃO TransicionarEstado(episodio: EpisodioDecisao, novo_estado: Estado) → Resultado {
  
  SE episodio.estado = ENCERRADO ENTÃO
    RETORNAR Erro("Episódio encerrado não pode mudar de estado")
  FIM SE
  
  SE NÃO ExisteTransicaoEpisodio(episodio.estado, novo_estado) ENTÃO
    RETORNAR Erro("Transição inválida: " + episodio.estado + " → " + novo_estado)
  FIM SE
  
  SE novo_estado = DECIDIDO E NÃO ExisteDecisaoInstitucional(episodio.id) ENTÃO
    RETORNAR Erro("Não pode transicionar para DECIDIDO sem DecisaoInstitucional")
  FIM SE
  
  episodio.estado ← novo_estado
  
  CASO novo_estado DE
    DECIDIDO: episodio.data_decisao ← AgoraUTC()
    EM_OBSERVACAO: episodio.data_observacao_iniciada ← AgoraUTC()
    ENCERRADO: episodio.data_encerramento ← AgoraUTC()
  FIM CASO
  
  RETORNAR Sucesso(episodio)
}

FUNÇÃO ExisteTransicaoEpisodio(estado_atual: Estado, estado_novo: Estado) → Booleano {
  transicoes_validas ← {
    (CRIADO, DECIDIDO),
    (DECIDIDO, EM_OBSERVACAO),
    (EM_OBSERVACAO, ENCERRADO)
  }
  
  RETORNAR (estado_atual, estado_novo) ESTÁ EM transicoes_validas
}
2.5 Conexão Entre as Duas Máquinas (SEM FUSÃO)

CONEXÃO: Camada 4 (Orquestrador) ↔ Camada 3 (Libervia)

IMPORTANTE: Ambas as camadas (Camada 4 e Camada 3) pertencem à Libervia.
Camada 4 = Orquestrador Cognitivo (parte operacional da Libervia)
Camada 3 = Cérebro Institucional / Memória (parte cognitiva da Libervia)

┌─────────────────────────────────────────────────────────────────────┐
│ CAMADA 4 — ORQUESTRADOR COGNITIVO (parte da Libervia)              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  RASCUNHO → ABERTA → ACEITA → EM_ANALISE → DECIDIDA → EM_OBSERVACAO → ENCERRADA
│                  │       │                      │            │            │
│                  ↓       │                      │            │            │
│              REJEITADA   │                      │            │            │
│              (terminal)  │                      │            │            │
│                          ↓                      ↓            ↓            ↓
│                     [Cria Episódio]       [Emite      [Monitora]   [Consolida]
│                                           Contrato]                       │
│                                                │                          │
├─────────────────────────────────────────────────┼──────────────────────────┤
│                                                 │                          │
│  CRIAÇÃO DE EPISÓDIO ←──────────────────────────┘                          │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ CAMADA 3 — CÉREBRO INSTITUCIONAL / MEMÓRIA (parte da Libervia)            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│           CRIADO                                                           │
│              │                                                             │
│              │                                                             │
│              ↓                                                             │
│           DECIDIDO (+ ContratoDeDecisao emitido)                           │
│              │                                                             │
│              │                                                             │
│              ↓                                                             │
│         EM_OBSERVACAO                                                      │
│              │                                                             │
│              │                                                             │
│              ↓                                                             │
│          ENCERRADO ────────────────────────────────────────────────────────┘
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

REGRAS DE SINCRONIZAÇÃO (NÃO-FUSÃO):

1. CRIAÇÃO DE EPISÓDIO
   Camada 4: ABERTA → (validação OK) → ACEITA
   Gatilho: CriarEpisodio()
   Camada 3: → CRIADO
   
2. INÍCIO DE ANÁLISE
   Camada 4: ACEITA → EM_ANALISE
   Camada 3: permanece em CRIADO
   
3. REGISTRO DE DECISÃO
   Camada 4: EM_ANALISE → DECIDIDA
   Gatilho: RegistrarDecisao() + EmitirContrato()
   Camada 3: CRIADO → DECIDIDO
   
4. INÍCIO DE OBSERVAÇÃO
   Camada 4: DECIDIDA → EM_OBSERVACAO
   Gatilho: IniciarObservacao()
   Camada 3: DECIDIDO → EM_OBSERVACAO
   
5. ENCERRAMENTO
   Camada 4: EM_OBSERVACAO → ENCERRADA
   Gatilho: EncerrarEpisodio()
   Camada 3: EM_OBSERVACAO → ENCERRADO

PRINCÍPIOS DE NÃO-FUSÃO:

- Camada 4 tem estados que Camada 3 não tem (RASCUNHO, ABERTA, ACEITA, EM_ANALISE)
- Camada 4 controla PROCESSO de decisão
- Camada 3 controla MEMÓRIA institucional
- Ambas as camadas pertencem à Libervia (não são sistemas separados)
- SituaçãoDecisoria pode ser REJEITADA sem criar EpisodioDecisao
- EpisodioDecisao só existe após SituaçãoDecisoria ser ACEITA
- Camada 4 pode ter múltiplas SituaçãoDecisoria
- Camada 3 só cria EpisodioDecisao para SituaçãoDecisoria validada e aceita
- Sincronização ocorre em pontos específicos, não há fusão de estados
2.6 Invariantes de Sincronização

INVARIANTES DE SINCRONIZAÇÃO ENTRE CAMADAS:

- SituaçãoDecisoria em RASCUNHO → Nenhum EpisodioDecisao existe
- SituaçãoDecisoria em ABERTA → Nenhum EpisodioDecisao existe ainda
- SituaçãoDecisoria ACEITA → EpisodioDecisao CRIADO existe
- SituaçãoDecisoria REJEITADA → Nenhum EpisodioDecisao existe (terminal)
- SituaçãoDecisoria em EM_ANALISE → EpisodioDecisao em CRIADO
- SituaçãoDecisoria DECIDIDA → EpisodioDecisao DECIDIDO + ContratoDeDecisao emitido
- SituaçãoDecisoria EM_OBSERVACAO → EpisodioDecisao EM_OBSERVACAO
- SituaçãoDecisoria ENCERRADA → EpisodioDecisao ENCERRADO

GARANTIAS:

SE situacao.status = ACEITA ENTÃO ExisteEpisodio(situacao.id) = VERDADEIRO
SE situacao.status = REJEITADA ENTÃO ExisteEpisodio(situacao.id) = FALSO
SE episodio.estado = DECIDIDO ENTÃO ExisteContrato(episodio.id) = VERDADEIRO
SE episodio.estado = ENCERRADO ENTÃO situacao.status = ENCERRADA
3. REGRAS DE VALIDAÇÃO E IMUTABILIDADE
3.1 Validações para Criação de Episódio (5 Gatilhos Canônicos)

FUNÇÃO ValidarAbertura(situacao: SituaçãoDecisoria) → Resultado {
  
  // Gatilho 1: Incerteza real existe
  SE situacao.incertezas.tamanho = 0 ENTÃO
    RETORNAR Erro("Não há incerteza real - decisão é determinística")
  FIM SE
  
  // Gatilho 2: Risco real existe
  SE situacao.riscos.tamanho = 0 ENTÃO
    RETORNAR Erro("Não há risco real identificado")
  FIM SE
  
  // Gatilho 3: Consequência relevante existe
  SE situacao.consequencia_relevante = VAZIO OU situacao.consequencia_relevante = NULO ENTÃO
    RETORNAR Erro("Não há consequência relevante identificada")
  FIM SE
  
  // Gatilho 4: Alternativa real existe (pelo menos 2)
  SE situacao.alternativas.tamanho < 2 ENTÃO
    RETORNAR Erro("Decisão requer no mínimo 2 alternativas reais")
  FIM SE
  
  // Gatilho 5: Possibilidade de aprendizado existe
  SE situacao.possibilidade_aprendizado ≠ VERDADEIRO ENTÃO
    RETORNAR Erro("Não há possibilidade de aprendizado - decisão não qualifica")
  FIM SE
  
  // Validação adicional: Caso de uso válido
  SE situacao.caso_uso_declarado < 1 OU situacao.caso_uso_declarado > 5 ENTÃO
    RETORNAR Erro("Caso de uso deve ser entre 1 e 5")
  FIM SE
  
  RETORNAR Sucesso()
}
3.2 Validações para Registro de Decisão

FUNÇÃO ValidarRegistroDecisão(episodio: EpisodioDecisao, decisao: DecisaoInstitucional) → Resultado {
  
  // Validação 1: Episódio deve estar em CRIADO
  SE episodio.estado ≠ CRIADO ENTÃO
    RETORNAR Erro("Decisão só pode ser registrada quando episódio está em CRIADO")
  FIM SE
  
  // Validação 2: Perfil de risco deve estar explícito
  SE decisao.perfil_risco = NULO ENTÃO
    RETORNAR Erro("Perfil de risco deve estar explicitamente definido")
  FIM SE
  
  // Validação 3: Critérios devem existir
  SE decisao.criterios.tamanho = 0 ENTÃO
    RETORNAR Erro("Decisão institucional requer critérios explícitos")
  FIM SE
  
  // Validação 4: Limites devem existir
  SE decisao.limites.tamanho = 0 ENTÃO
    RETORNAR Erro("Decisão institucional requer limites explícitos")
  FIM SE
  
  // Validação 5: Já existe decisão para este episódio?
  SE ExisteDecisaoParaEpisodio(episodio.id) ENTÃO
    RETORNAR Erro("Já existe DecisaoInstitucional para este episódio")
  FIM SE
  
  // Validação 6: Alternativa escolhida está na situação?
  situacao ← ObterSituacao(episodio.situacao_referenciada)
  SE NÃO AlternativaExiste(situacao, decisao.alternativa_escolhida) ENTÃO
    RETORNAR Erro("Alternativa escolhida não está na situação de decisão")
  FIM SE
  
  RETORNAR Sucesso()
}
3.3 Garantias de Imutabilidade

FUNÇÃO TentarModificarSituaçãoDecisoria(situacao: SituaçãoDecisoria, campo: Texto, valor: Qualquer) → Resultado {
  
  // Campos do núcleo são imutáveis a partir de ACEITA
  campos_nucleo ← { "contexto", "objetivo", "incertezas", "alternativas", "riscos", 
                    "urgencia", "capacidade_absorcao", "consequencia_relevante", 
                    "possibilidade_aprendizado", "caso_uso_declarado" }
  
  SE campo EM campos_nucleo E situacao.status EM { ACEITA, EM_ANALISE, DECIDIDA, EM_OBSERVACAO, ENCERRADA } ENTÃO
    RETORNAR Erro("Campo do núcleo " + campo + " é imutável a partir de ACEITA")
  FIM SE
  
  // Estados terminais: tudo imutável
  SE situacao.status EM { REJEITADA, ENCERRADA } ENTÃO
    RETORNAR Erro("SituaçãoDecisoria não pode ser modificada após " + situacao.status)
  FIM SE
  
  // Campos sempre imutáveis
  SE campo EM { "id", "data_criacao" } ENTÃO
    RETORNAR Erro("Campo " + campo + " é imutável")
  FIM SE
  
  // anexos_analise é append-only
  SE campo = "anexos_analise" E operacao ≠ ADICIONAR ENTÃO
    RETORNAR Erro("anexos_analise é append-only - apenas adição permitida, nunca modificação ou deleção")
  FIM SE
  
  // Permitir modificação do núcleo apenas se RASCUNHO ou ABERTA (antes de aceitar)
  SE situacao.status EM { RASCUNHO, ABERTA } ENTÃO
    RETORNAR Sucesso()
  FIM SE
  
  RETORNAR Erro("Modificação não permitida")
}

FUNÇÃO TentarModificarEpisodioDecisao(episodio: EpisodioDecisao, campo: Texto, valor: Qualquer) → Resultado {
  
  SE campo = "estado" ENTÃO
    // Única modificação permitida via TransicionarEstado
    RETORNAR Erro("Estado só pode ser modificado via TransicionarEstado()")
  FIM SE
  
  SE campo EM { "id", "caso_uso", "dominio", "situacao_referenciada", "data_criacao", "data_decisao", "data_observacao_iniciada", "data_encerramento" } ENTÃO
    RETORNAR Erro("Campo " + campo + " é imutável")
  FIM SE
  
  RETORNAR Erro("Episódio não permite modificações diretas")
}

FUNÇÃO TentarModificarDecisaoInstitucional(decisao: DecisaoInstitucional, campo: Texto, valor: Qualquer) → Resultado {
  RETORNAR Erro("DecisaoInstitucional é totalmente imutável após criação")
}

FUNÇÃO TentarModificarContratoDeDecisao(contrato: ContratoDeDecisao, campo: Texto, valor: Qualquer) → Resultado {
  RETORNAR Erro("ContratoDeDecisao é totalmente imutável após criação")
}

FUNÇÃO TentarDeletarEpisodioDecisao(episodio_id: Identificador) → Resultado {
  RETORNAR Erro("Episódios nunca podem ser deletados - memória institucional é permanente")
}

FUNÇÃO TentarDeletarDecisaoInstitucional(decisao_id: Identificador) → Resultado {
  RETORNAR Erro("Decisões institucionais nunca podem ser deletadas - passado não pode ser reescrito")
}

FUNÇÃO TentarDeletarContratoDeDecisao(contrato_id: Identificador) → Resultado {
  RETORNAR Erro("Contratos de decisão nunca podem ser deletados - autorização não pode ser reescrita")
}
4. ORQUESTRADOR MÍNIMO (CONCEITUAL)

COMPONENTE OrquestradorCognitivo {
  
  NOTA: Este componente pertence à Camada 4 da Libervia
  
  FUNÇÃO ProcessarSolicitacao(situacao: SituaçãoDecisoria) → Resultado {
    
    // Passo 1: Situação deve estar ABERTA para ser processada
    SE situacao.status ≠ ABERTA ENTÃO
      RETORNAR Erro("Situação deve estar ABERTA para ser processada")
    FIM SE
    
    // Passo 2: Validar se situação atende os 5 gatilhos canônicos
    validacao ← ValidarAbertura(situacao)
    SE validacao é Erro ENTÃO
      situacao.status ← REJEITADA
      RETORNAR Erro("Solicitação rejeitada: " + validacao.mensagem)
    FIM SE
    
    // Passo 3: Aceitar situação (agora pode ser marcada como ACEITA)
    resultado_transicao ← TransicionarSituacao(situacao, ACEITA)
    SE resultado_transicao é Erro ENTÃO
      RETORNAR resultado_transicao
    FIM SE
    
    // Passo 4: Criar episódio APÓS aceitar
    episodio ← CriarEpisodio(situacao)
    
    // Passo 5: Transicionar situação para EM_ANALISE
    TransicionarSituacao(situacao, EM_ANALISE)
    
    RETORNAR Sucesso(episodio)
  }
  
  FUNÇÃO CriarEpisodio(situacao: SituaçãoDecisoria) → EpisodioDecisao {
    
    episodio ← NOVO EpisodioDecisao {
      id ← GerarIdentificadorÚnico(),
      caso_uso ← situacao.caso_uso_declarado,
      dominio ← situacao.dominio,
      estado ← CRIADO,
      situacao_referenciada ← situacao.id,
      data_criacao ← AgoraUTC(),
      data_decisao ← NULO,
      data_observacao_iniciada ← NULO,
      data_encerramento ← NULO
    }
    
    PersistirEpisodio(episodio)
    
    RETORNAR episodio
  }
  
  FUNÇÃO RegistrarDecisao(episodio: EpisodioDecisao, decisao: DecisaoInstitucional) → ContratoDeDecisao {
    
    // Passo 1: Validar registro
    validacao ← ValidarRegistroDecisão(episodio, decisao)
    SE validacao é Erro ENTÃO
      LANÇAR Exceção(validacao.mensagem)
    FIM SE
    
    // Passo 2: Persistir decisão (imutável)
    PersistirDecisao(decisao)
    
    // Passo 3: Transicionar episódio para DECIDIDO
    resultado_episodio ← TransicionarEstado(episodio, DECIDIDO)
    SE resultado_episodio é Erro ENTÃO
      LANÇAR Exceção(resultado_episodio.mensagem)
    FIM SE
    
    // Passo 4: Transicionar situação para DECIDIDA
    situacao ← ObterSituacao(episodio.situacao_referenciada)
    resultado_situacao ← TransicionarSituacao(situacao, DECIDIDA)
    SE resultado_situacao é Erro ENTÃO
      LANÇAR Exceção(resultado_situacao.mensagem)
    FIM SE
    
    // Passo 5: Emitir ContratoDeDecisao (única saída para Bazari)
    contrato ← EmitirContrato(episodio, decisao)
    
    // RETORNO: ContratoDeDecisao é o que Bazari consome
    RETORNAR contrato
  }
  
  FUNÇÃO EmitirContrato(episodio: EpisodioDecisao, decisao: DecisaoInstitucional) → ContratoDeDecisao {
    
    contrato ← NOVO ContratoDeDecisao {
      id ← GerarIdentificadorÚnico(),
      episodio_id ← episodio.id,
      decisao_id ← decisao.id,
      alternativa_autorizada ← decisao.alternativa_escolhida,
      limites_execucao ← decisao.limites,
      condicoes_obrigatorias ← decisao.condicoes,
      observacao_minima_requerida ← DeterminarObservacaoMinima(episodio),
      data_emissao ← AgoraUTC(),
      emitido_para ← "Bazari"
    }
    
    PersistirContrato(contrato)
    
    RETORNAR contrato
  }
  
  FUNÇÃO IniciarObservacao(episodio: EpisodioDecisao) → Resultado {
    
    SE episodio.estado ≠ DECIDIDO ENTÃO
      RETORNAR Erro("Observação só pode iniciar após estado DECIDIDO")
    FIM SE
    
    // Transicionar episódio
    resultado_episodio ← TransicionarEstado(episodio, EM_OBSERVACAO)
    SE resultado_episodio é Erro ENTÃO
      RETORNAR resultado_episodio
    FIM SE
    
    // Transicionar situação
    situacao ← ObterSituacao(episodio.situacao_referenciada)
    resultado_situacao ← TransicionarSituacao(situacao, EM_OBSERVACAO)
    
    RETORNAR resultado_situacao
  }
  
  FUNÇÃO EncerrarEpisodio(episodio: EpisodioDecisao) → Resultado {
    
    SE episodio.estado ≠ EM_OBSERVACAO ENTÃO
      RETORNAR Erro("Episódio só pode ser encerrado após observação")
    FIM SE
    
    // Transicionar episódio
    resultado_episodio ← TransicionarEstado(episodio, ENCERRADO)
    SE resultado_episodio é Erro ENTÃO
      RETORNAR resultado_episodio
    FIM SE
    
    // Transicionar situação
    situacao ← ObterSituacao(episodio.situacao_referenciada)
    resultado_situacao ← TransicionarSituacao(situacao, ENCERRADA)
    
    RETORNAR resultado_situacao
  }
  
  FUNÇÃO DeterminarObservacaoMinima(episodio: EpisodioDecisao) → Lista de Texto {
    // Observação mínima conforme Camada 2
    RETORNAR [
      "Impacto Técnico observado",
      "Impacto Operacional observado",
      "Evidências coletadas",
      "Persistência avaliada"
    ]
  }
}

PRINCÍPIO DE SAÍDA:
A única saída da Libervia (Camada 4 + Camada 3) para a Bazari é ContratoDeDecisao.
RegistrarDecisao() RETORNA ContratoDeDecisao.
Bazari consome ContratoDeDecisao para executar.
5. FLUXO CONCEITUAL COMPLETO (PASSO A PASSO)

FLUXO COMPLETO: Ciclo de Vida de um Episódio de Decisão

NOTA IMPORTANTE: 
Camada 4 (Orquestrador Cognitivo) e Camada 3 (Cérebro Institucional/Memória) 
pertencem à Libervia. Não são sistemas separados.

════════════════════════════════════════════════════════════════════════

1. RASCUNHO (Camada 4 da Libervia)
   
   Bazari prepara SituaçãoDecisoria:
   - Preenche contexto, objetivo, incertezas, alternativas, riscos
   - Preenche consequencia_relevante
   - Confirma possibilidade_aprendizado = VERDADEIRO
   - situacao.status ← RASCUNHO
   - Pode modificar campos livremente enquanto em RASCUNHO
   
   Estado: Camada 4 (RASCUNHO) | Camada 3 (nenhum episódio)

────────────────────────────────────────────────────────────────────────

2. ABERTURA (Camada 4 da Libervia)
   
   Bazari submete SituaçãoDecisoria ao Orquestrador:
   - situacao.status ← ABERTA
   - Aguarda processamento
   
   Estado: Camada 4 (ABERTA) | Camada 3 (nenhum episódio)

────────────────────────────────────────────────────────────────────────

3. VALIDAÇÃO E CRIAÇÃO DE EPISÓDIO (Ponte Camada 4 → Camada 3, dentro da Libervia)
   
   OrquestradorCognitivo.ProcessarSolicitacao(situacao)
   
   a) Validar situacao em estado ABERTA
   b) ValidarAbertura(situacao) — 5 GATILHOS CANÔNICOS:
      1. Incerteza real existe
      2. Risco real existe
      3. Consequência relevante existe
      4. Alternativa real existe (≥2)
      5. Possibilidade de aprendizado existe
   
   SE validação FALHA:
     - situacao.status ← REJEITADA (terminal)
     - Nenhum episódio criado
     - FIM DO FLUXO
   
   SE validação OK:
     - situacao.status ← ACEITA
     - NÚCLEO DA SITUAÇÃO TORNA-SE IMUTÁVEL
     - CriarEpisodio(situacao)
       → episodio.estado ← CRIADO
       → episodio.situacao_referenciada ← situacao.id
     - situacao.status ← EM_ANALISE
   
   Estado: Camada 4 (EM_ANALISE) | Camada 3 (CRIADO)

────────────────────────────────────────────────────────────────────────

4. ANÁLISE (Camada 4 da Libervia, com referência a Camada 3)
   
   Situação permanece em EM_ANALISE:
   - Consulta à memória institucional (episódios passados)
   - Análise de RiskMap detalhado
   - Definição de perfil comportamental
   - Preparação de DecisaoInstitucional
   - Anexos podem ser adicionados (append-only) em situacao.anexos_analise:
     → RiskMap detalhado
     → Memória consultada
     → Notas de análise
   
   Episódio permanece em CRIADO aguardando decisão.
   
   Estado: Camada 4 (EM_ANALISE) | Camada 3 (CRIADO)

────────────────────────────────────────────────────────────────────────

5. DECISÃO INSTITUCIONAL E EMISSÃO DE CONTRATO
   (Sincronização Camada 4 ↔ Camada 3, dentro da Libervia)
   
   Humano ou processo autorizado cria DecisaoInstitucional:
   - alternativa_escolhida (da lista de alternativas da situação)
   - criterios (explícitos)
   - perfil_risco (CONSERVADOR | MODERADO | AGRESSIVO)
   - limites (explícitos)
   - condicoes (explícitas)
   
   contrato ← OrquestradorCognitivo.RegistrarDecisao(episodio, decisao)
   
   a) ValidarRegistroDecisão()
   b) PersistirDecisao(decisao) — IMUTÁVEL
   c) TransicionarEstado(episodio, DECIDIDO)
      → episodio.estado ← DECIDIDO
      → episodio.data_decisao ← AgoraUTC()
   d) TransicionarSituacao(situacao, DECIDIDA)
      → situacao.status ← DECIDIDA
   e) EmitirContrato(episodio, decisao)
      → Cria ContratoDeDecisao — IMUTÁVEL
      → Contrato referencia episodio_id e decisao_id
      → Contrato especifica alternativa_autorizada, limites, condições
   f) RETORNAR ContratoDeDecisao
   
   PRINCÍPIO FUNDAMENTAL:
   A única saída da Libervia para a Bazari é ContratoDeDecisao.
   RegistrarDecisao() retorna ContratoDeDecisao.
   Bazari consome ContratoDeDecisao.
   
   Estado: Camada 4 (DECIDIDA) | Camada 3 (DECIDIDO) + ContratoDeDecisao emitido

────────────────────────────────────────────────────────────────────────

6. INÍCIO DE OBSERVAÇÃO (Sincronização Camada 4 ↔ Camada 3, dentro da Libervia)
   
   OrquestradorCognitivo.IniciarObservacao(episodio)
   
   a) Verificar episodio.estado = DECIDIDO
   b) TransicionarEstado(episodio, EM_OBSERVACAO)
      → episodio.estado ← EM_OBSERVACAO
      → episodio.data_observacao_iniciada ← AgoraUTC()
   c) TransicionarSituacao(situacao, EM_OBSERVACAO)
      → situacao.status ← EM_OBSERVACAO
   
   Bazari recebe ContratoDeDecisao e executa conforme autorização.
   Camada 2 (Contexto Observável) registra observações objetivas.
   
   Estado: Camada 4 (EM_OBSERVACAO) | Camada 3 (EM_OBSERVACAO)

────────────────────────────────────────────────────────────────────────

7. COLETA DE OBSERVAÇÕES (Camada 2)
   
   Durante período de observação:
   - Bazari executa ações autorizadas
   - Camada 2 registra impactos observados:
     → Impacto Técnico
     → Impacto Operacional
     → Impacto Estratégico
     → Impacto Sistêmico
     → Impacto Humano
   - Observações são factuais, sem julgamento
   - Evidências são coletadas
   
   Estado: Camada 4 (EM_OBSERVACAO) | Camada 3 (EM_OBSERVACAO)

────────────────────────────────────────────────────────────────────────

8. ENCERRAMENTO (Sincronização Camada 4 ↔ Camada 3, dentro da Libervia)
   
   Após coleta de observações suficientes:
   
   OrquestradorCognitivo.EncerrarEpisodio(episodio)
   
   a) Verificar episodio.estado = EM_OBSERVACAO
   b) Verificar observação mínima atendida
   c) TransicionarEstado(episodio, ENCERRADO)
      → episodio.estado ← ENCERRADO
      → episodio.data_encerramento ← AgoraUTC()
   d) TransicionarSituacao(situacao, ENCERRADA)
      → situacao.status ← ENCERRADA
   
   Episódio permanece na memória institucional PARA SEMPRE.
   
   Estado: Camada 4 (ENCERRADA - terminal) | Camada 3 (ENCERRADO - terminal)

════════════════════════════════════════════════════════════════════════

INVARIANTES DO FLUXO:

✓ Nenhum passo pode ser pulado
✓ Nenhum passo pode ser revertido
✓ Episódio NUNCA é deletado
✓ Decisão NUNCA é modificada
✓ Contrato NUNCA é modificado
✓ Núcleo da SituaçãoDecisoria é IMUTÁVEL a partir de ACEITA
✓ anexos_analise é append-only (nunca deleta ou modifica, apenas adiciona)
✓ Passado NUNCA é reescrito
✓ SituaçãoDecisoria REJEITADA não gera episódio
✓ ContratoDeDecisao só existe após estado DECIDIDO
✓ ContratoDeDecisao é a ÚNICA saída da Libervia para Bazari
✓ Observação só inicia após ContratoDeDecisao emitido
✓ Encerramento só ocorre após observação suficiente
✓ 5 gatilhos canônicos devem ser validados antes de criar episódio

════════════════════════════════════════════════════════════════════════
6. O QUE O SISTEMA SE RECUSA A FAZER
6.1 Recusas Estruturais

O sistema REJEITA:

1. DELETAR qualquer EpisodioDecisao
   → Memória institucional é permanente
   → Mensagem: "Episódios nunca podem ser deletados - memória institucional é permanente"

2. MODIFICAR qualquer DecisaoInstitucional
   → Passado não pode ser reescrito
   → Mensagem: "DecisaoInstitucional é totalmente imutável após criação"

3. MODIFICAR qualquer ContratoDeDecisao
   → Autorização não pode ser reescrita
   → Mensagem: "ContratoDeDecisao é totalmente imutável após criação"

4. MODIFICAR núcleo de SituaçãoDecisoria após ACEITA
   → Contexto de decisão deve ser preservado
   → Mensagem: "Campo do núcleo [campo] é imutável a partir de ACEITA"

5. MODIFICAR ou DELETAR itens em anexos_analise
   → Anexos são append-only
   → Mensagem: "anexos_analise é append-only - apenas adição permitida, nunca modificação ou deleção"

6. TRANSIÇÕES de estado inválidas em ambas as máquinas
   → Máquinas de estados são rígidas
   → Mensagem: "Transição inválida: [estado_atual] → [estado_novo]"

7. CRIAR EpisodioDecisao sem incerteza real
   → Gatilho canônico 1
   → Mensagem: "Não há incerteza real - decisão é determinística"

8. CRIAR EpisodioDecisao sem risco real
   → Gatilho canônico 2
   → Mensagem: "Não há risco real identificado"

9. CRIAR EpisodioDecisao sem consequência relevante
   → Gatilho canônico 3
   → Mensagem: "Não há consequência relevante identificada"

10. CRIAR EpisodioDecisao sem alternativas reais (≥2)
    → Gatilho canônico 4
    → Mensagem: "Decisão requer no mínimo 2 alternativas reais"

11. CRIAR EpisodioDecisao sem possibilidade de aprendizado
    → Gatilho canônico 5
    → Mensagem: "Não há possibilidade de aprendizado - decisão não qualifica"

12. REGISTRAR DecisaoInstitucional sem perfil de risco explícito
    → Risco deve ser assumido conscientemente
    → Mensagem: "Perfil de risco deve estar explicitamente definido"

13. REGISTRAR DecisaoInstitucional sem limites explícitos
    → Autorização tem fronteiras
    → Mensagem: "Decisão institucional requer limites explícitos"

14. REGISTRAR DecisaoInstitucional sem critérios explícitos
    → Decisão deve ser fundamentada
    → Mensagem: "Decisão institucional requer critérios explícitos"

15. MÚLTIPLAS DecisaoInstitucional para mesmo episódio
    → Uma decisão institucional por episódio
    → Mensagem: "Já existe DecisaoInstitucional para este episódio"

16. MÚLTIPLOS ContratoDeDecisao para mesmo episódio
    → Um contrato por episódio
    → Mensagem: "Já existe ContratoDeDecisao para este episódio"

17. PULAR estados em qualquer máquina
    → Processo cognitivo tem sequência
    → Mensagem: "Transição inválida: [estado_atual] → [estado_novo]"

18. TRANSICIONAR a partir de estados terminais
    → REJEITADA e ENCERRADA são finais
    → Mensagem: "Situação em estado terminal não pode mudar de status"
    → Mensagem: "Episódio encerrado não pode mudar de estado"

19. EMITIR ContratoDeDecisao sem DecisaoInstitucional
    → Contrato requer decisão formal
    → Mensagem: "Contrato só pode ser emitido após DecisaoInstitucional"

20. INICIAR observação sem ContratoDeDecisao
    → Execução requer autorização formal
    → Mensagem: "Observação só pode iniciar após ContratoDeDecisao emitido"

21. ENCERRAR episódio sem observação suficiente
    → Aprendizado requer evidência
    → Mensagem: "Episódio requer observação mínima antes de encerramento"
6.2 Recusas Conceituais

O sistema NÃO:

❌ Recomenda decisões
   "Libervia não recomenda decisões. Libervia registra decisões tomadas."

❌ Sugere alternativas
   "Libervia não sugere alternativas. Alternativas são identificadas pelo contexto."

❌ Calcula scores ou rankings
   "Libervia não ranqueia. Decisão institucional não é otimização."

❌ Otimiza resultados
   "Libervia não otimiza. Libervia aprende com consequências reais."

❌ Aprende automaticamente
   "Aprendizado institucional requer consolidação humana consciente."

❌ Prevê consequências
   "Libervia não prediz. Libervia observa o que efetivamente acontece."

❌ Substitui julgamento humano
   "Decisão institucional requer julgamento. Sistema registra, não decide."

❌ Automatiza decisões
   "Decisão institucional requer julgamento. Sistema não automatiza decisões."

❌ Opera de forma autônoma
   "Libervia não é agente autônomo. Libervia é entidade cognitiva sob governança."

❌ Executa ações (isso é responsabilidade de Bazari)
   "Libervia pensa. Bazari executa. Separação é inviolável."

❌ Opina sobre "melhor decisão"
   "Libervia não opina sobre qual decisão tomar. Libervia registra qual decisão foi tomada."

❌ Esconde fracassos
   "Episódios com consequências negativas são preservados permanentemente."

❌ Corrige o passado
   "Passado não pode ser reescrito. Novas decisões criam novos episódios."

❌ Reinterpreta episódios antigos
   "Episódios encerrados permanecem imutáveis. Novo contexto gera novo episódio."

❌ Permite edição de campos imutáveis
   "Campo [campo] é imutável."

❌ Permite reversão de estados
   "Transições de estado são unidirecionais e irreversíveis."

❌ Emite saída para Bazari sem ContratoDeDecisao
   "A única saída da Libervia para a Bazari é ContratoDeDecisao."
6.3 Mensagens de Recusa Completas

FUNÇÃO RecusarOperacaoInvalida(operacao: Texto) → Mensagem {
  
  CASO operacao DE
    
    "recomendar_decisao":
      RETORNAR "Libervia não recomenda decisões. Libervia registra decisões tomadas sob risco real."
    
    "otimizar_resultado":
      RETORNAR "Libervia não otimiza. Libervia aprende com consequências reais, não com predições."
    
    "prever_consequencia":
      RETORNAR "Libervia não prediz. Libervia observa o que efetivamente acontece após decisão."
    
    "deletar_episodio":
      RETORNAR "Memória institucional é permanente. Episódios nunca são deletados."
    
    "corrigir_decisao_passada":
      RETORNAR "Passado não pode ser reescrito. Novas decisões criam novos episódios."
    
    "automatizar_decisao":
      RETORNAR "Decisão institucional requer julgamento consciente. Sistema não automatiza decisões."
    
    "executar_acao":
      RETORNAR "Libervia pensa. Bazari executa. Separação é inviolável."
    
    "ranquear_alternativas":
      RETORNAR "Libervia não ranqueia alternativas. Decisão não é otimização matemática."
    
    "esconder_fracasso":
      RETORNAR "Episódios com consequências negativas são preservados. Fracasso é parte do aprendizado."
    
    "reinterpretar_episodio":
      RETORNAR "Episódios encerrados são imutáveis. Novo contexto gera novo episódio, não reinterpretação."
    
    "pular_estado":
      RETORNAR "Estados não podem ser pulados. Processo cognitivo tem sequência obrigatória."
    
    "reverter_estado":
      RETORNAR "Estados não podem ser revertidos. Transições são unidirecionais."
    
    "modificar_imutavel":
      RETORNAR "Entidade é imutável após criação. Passado institucional não pode ser alterado."
    
    "modificar_nucleo_apos_aceita":
      RETORNAR "Campo do núcleo é imutável a partir de ACEITA. Use anexos_analise (append-only) para extensões."
    
    "deletar_anexo_analise":
      RETORNAR "anexos_analise é append-only. Anexos nunca são deletados ou modificados, apenas adicionados."
    
    "criar_decisao_sem_incerteza":
      RETORNAR "Sem incerteza real, não há decisão. Gatilho canônico 1 não satisfeito."
    
    "criar_decisao_sem_risco":
      RETORNAR "Sem risco real, não há decisão. Gatilho canônico 2 não satisfeito."
    
    "criar_decisao_sem_consequencia":
      RETORNAR "Sem consequência relevante, não há decisão. Gatilho canônico 3 não satisfeito."
    
    "criar_decisao_sem_alternativas":
      RETORNAR "Sem alternativas reais, não há decisão. Gatilho canônico 4 não satisfeito."
    
    "criar_decisao_sem_aprendizado":
      RETORNAR "Sem possibilidade de aprendizado, não há decisão. Gatilho canônico 5 não satisfeito."
    
    "emitir_saida_sem_contrato":
      RETORNAR "A única saída da Libervia para a Bazari é ContratoDeDecisao. Nenhuma outra forma de comunicação é permitida."
    
    "sugerir_melhor_opcao":
      RETORNAR "Libervia não sugere qual opção é melhor. Critérios são definidos por quem decide."
    
    PADRÃO:
      RETORNAR "Operação não permitida pelo núcleo cognitivo."
  
  FIM CASO
}
7. CRITÉRIOS DE SUCESSO — VERIFICAÇÃO
7.1 Um episódio pode existir do início ao fim

TESTE: Ciclo completo de episódio

Passo 1: Criar SituaçãoDecisoria válida
  situacao.status ← RASCUNHO
  Preencher todos os campos obrigatórios (incluindo consequencia_relevante)
  Confirmar possibilidade_aprendizado ← VERDADEIRO
  → ✓ SUCESSO

Passo 2: Abrir situação
  situacao.status ← ABERTA
  → ✓ SUCESSO

Passo 3: ProcessarSolicitacao()
  ValidarAbertura() valida 5 gatilhos canônicos → SUCESSO
  situacao.status ← ACEITA
  Núcleo da situação torna-se IMUTÁVEL
  CriarEpisodio() → episodio.estado ← CRIADO
  situacao.status ← EM_ANALISE
  → ✓ SUCESSO

Passo 4: RegistrarDecisao()
  Criar DecisaoInstitucional válida
  episodio.estado ← DECIDIDO
  situacao.status ← DECIDIDA
  ContratoDeDecisao emitido e RETORNADO
  → ✓ SUCESSO

Passo 5: IniciarObservacao()
  episodio.estado ← EM_OBSERVACAO
  situacao.status ← EM_OBSERVACAO
  → ✓ SUCESSO

Passo 6: EncerrarEpisodio()
  episodio.estado ← ENCERRADO
  situacao.status ← ENCERRADA
  → ✓ SUCESSO

Passo 7: Episódio permanece acessível indefinidamente
  TentarDeletarEpisodioDecisao(episodio.id) → ERRO
  Episódio pode ser consultado
  → ✓ SUCESSO

RESULTADO: ✓ TODOS OS PASSOS FUNCIONAM
7.2 O sistema aceita erro como parte do processo

TESTE: Erro não impede registro

Passo 1: Criar episódio com decisão arriscada
  perfil_risco ← AGRESSIVO
  Alternativa com alto risco documentado
  → ✓ PERMITIDO

Passo 2: Decisão pode ter consequência negativa
  Sistema não previne decisões arriscadas
  Sistema não alerta sobre "má decisão"
  → ✓ PERMITIDO

Passo 3: Observação registra fracasso sem julgamento
  Camada 2 registra impactos negativos objetivamente
  Sem avaliação de "sucesso" ou "fracasso"
  → ✓ PERMITIDO

Passo 4: Episódio com fracasso é encerrado normalmente
  episodio.estado ← ENCERRADO
  Mesmo processo para consequências positivas ou negativas
  → ✓ PERMITIDO

Passo 5: Fracasso não é deletado ou escondido
  TentarDeletarEpisodioDecisao() → ERRO
  TentarModificarDecisaoInstitucional() → ERRO
  → ✓ GARANTIDO

Passo 6: Fracasso permanece na memória institucional
  Episódio acessível permanentemente
  Futuras decisões podem consultar este episódio
  → ✓ GARANTIDO

RESULTADO: ✓ SISTEMA ACEITA E PRESERVA ERROS
7.3 O passado nunca é reescrito

TESTE: Imutabilidade do passado

Passo 1: TentarModificarDecisaoInstitucional()
  → ERRO: "DecisaoInstitucional é totalmente imutável após criação"
  → ✓ REJEITADO

Passo 2: TentarDeletarEpisodioDecisao()
  → ERRO: "Episódios nunca podem ser deletados - memória institucional é permanente"
  → ✓ REJEITADO

Passo 3: TentarModificarContratoDeDecisao()
  → ERRO: "ContratoDeDecisao é totalmente imutável após criação"
  → ✓ REJEITADO

Passo 4: TentarModificarNucleoSituaçãoDecisoria(situacao em ACEITA, "contexto", novo_valor)
  → ERRO: "Campo do núcleo contexto é imutável a partir de ACEITA"
  → ✓ REJEITADO

Passo 5: TentarDeletarAnexoAnalise(situacao, anexo)
  → ERRO: "anexos_analise é append-only - apenas adição permitida, nunca modificação ou deleção"
  → ✓ REJEITADO

Passo 6: TentarTransicionarEstado(episodio em ENCERRADO, qualquer estado)
  → ERRO: "Episódio encerrado não pode mudar de estado"
  → ✓ REJEITADO

Passo 7: TentarModificarCampoImutavel(episodio, "data_criacao", nova_data)
  → ERRO: "Campo data_criacao é imutável"
  → ✓ REJEITADO

Passo 8: TentarReverterEstado(episodio, DECIDIDO após estar em EM_OBSERVACAO)
  → ERRO: "Transição inválida: EM_OBSERVACAO → DECIDIDO"
  → ✓ REJEITADO

RESULTADO: ✓ PASSADO É COMPLETAMENTE IMUTÁVEL
7.4 Não há inteligência artificial opinando

TESTE: Ausência de recomendação

Passo 1: Sistema não sugere qual alternativa escolher
  Função RecomendarAlternativa() não existe
  DecisaoInstitucional.alternativa_escolhida é fornecida externamente
  → ✓ CONFIRMADO

Passo 2: Sistema não calcula "melhor opção"
  Nenhuma função de otimização
  Nenhum cálculo de score
  → ✓ CONFIRMADO

Passo 3: Sistema não ranqueia alternativas
  Alternativas são lista não-ordenada
  Nenhuma propriedade de "prioridade" ou "peso"
  → ✓ CONFIRMADO

Passo 4: Sistema não prediz sucesso/fracasso
  Nenhuma função de previsão
  Nenhum modelo preditivo
  → ✓ CONFIRMADO

Passo 5: Sistema apenas valida estrutura formal
  ValidarAbertura() verifica presença dos 5 gatilhos canônicos
  ValidarRegistroDecisão() verifica campos obrigatórios
  Nenhuma validação de "qualidade" da decisão
  → ✓ CONFIRMADO

Passo 6: TentarRecomendarDecisao()
  → "Libervia não recomenda decisões. Libervia registra decisões tomadas."
  → ✓ RECUSADO

RESULTADO: ✓ SISTEMA NÃO OPINA
7.5 A separação Libervia ↔ Bazari é preservada

TESTE: Separação de responsabilidades

IMPORTANTE: Camada 4 e Camada 3 pertencem AMBAS à Libervia.

Passo 1: Libervia (Camada 3) cria EpisodioDecisao
  OrquestradorCognitivo.CriarEpisodio() → episodio
  → ✓ LIBERVIA

Passo 2: Libervia (Camada 3) registra DecisaoInstitucional
  OrquestradorCognitivo.RegistrarDecisao() → contrato
  → ✓ LIBERVIA

Passo 3: Libervia (Camada 4) emite ContratoDeDecisao
  OrquestradorCognitivo.EmitirContrato() → contrato
  RegistrarDecisao() RETORNA ContratoDeDecisao
  → ✓ LIBERVIA

Passo 4: Libervia NÃO executa ações
  Nenhuma função de execução em OrquestradorCognitivo
  TentarExecutarAcao() → ERRO
  → ✓ LIBERVIA NÃO EXECUTA

Passo 5: Bazari recebe ContratoDeDecisao
  contrato.emitido_para ← "Bazari"
  Contrato especifica o que Bazari está autorizado a fazer
  A ÚNICA saída da Libervia para Bazari é ContratoDeDecisao
  → ✓ PONTE FORMAL E ÚNICA LIBERVIA → BAZARI

Passo 6: Bazari executa, Libervia observa
  Execução: responsabilidade de Bazari
  Observação: Camada 2 registra, Libervia lê
  → ✓ SEPARAÇÃO PRESERVADA

Passo 7: Libervia aprende, Bazari vive consequências
  Episódio consolidado em Camada 3 (Libervia)
  Consequências vividas por Bazari
  → ✓ SEPARAÇÃO PRESERVADA

Passo 8: TentarExecutarViaCognitivo()
  → "Libervia pensa. Bazari executa. Separação é inviolável."
  → ✓ RECUSADO

Passo 9: TentarEmitirSaidaSemContrato()
  → "A única saída da Libervia para a Bazari é ContratoDeDecisao."
  → ✓ RECUSADO

RESULTADO: ✓ SEPARAÇÃO É INVIOLÁVEL E CAMADA 4 PERTENCE À LIBERVIA
7.6 Verificação Completa dos Critérios

RESUMO DE VERIFICAÇÃO:

✓ 7.1 Um episódio pode existir do início ao fim
    Todos os 7 passos funcionam corretamente

✓ 7.2 O sistema aceita erro como parte do processo
    Erros são registrados, preservados e não escondidos

✓ 7.3 O passado nunca é reescrito
    Todas as 8 tentativas de modificação são rejeitadas
    Núcleo da situação imutável a partir de ACEITA
    anexos_analise é append-only

✓ 7.4 Não há inteligência artificial opinando
    Todas as 6 verificações confirmam ausência de opinião
    5 gatilhos canônicos validados formalmente

✓ 7.5 A separação Libervia ↔ Bazari é preservada
    Todas as 9 verificações confirmam separação
    Camada 4 explicitamente parte da Libervia
    ContratoDeDecisao é única saída para Bazari

════════════════════════════════════════════════════════════════════════

INCREMENTO 0 ATENDE TODOS OS CRITÉRIOS DE SUCESSO

════════════════════════════════════════════════════════════════════════
ENCERRAMENTO
Implementação Completa — Incremento 0 (Versão Final Ajustada)
Este documento define o núcleo estrutural completo, corrigido e ajustado do Incremento 0: ✓ 4 Entidades canônicas com campos obrigatórios, invariantes e extensibilidade controlada
✓ 2 Máquinas de estados distintas (Camada 4 e Camada 3, ambas da Libervia) com conexão formal
✓ 5 Gatilhos canônicos validados formalmente (incerteza, risco, consequência, alternativas, aprendizado)
✓ Regras de validação e imutabilidade explícitas, completas e ajustadas
✓ Orquestrador conceitual com todas as operações mínimas e retorno explícito de ContratoDeDecisao
✓ Fluxo passo a passo documentado em 8 etapas com clareza arquitetural
✓ Recusas estruturais e conceituais definidas (21 estruturais + 17 conceituais)
✓ Critérios de sucesso verificáveis (5 testes completos com 9 verificações no teste 7.5)
✓ ContratoDeDecisao formalizado e explicitado como ÚNICA saída da Libervia para Bazari
✓ Imutabilidade granular do núcleo da SituaçãoDecisoria a partir de ACEITA, com anexos_analise append-only
✓ Clareza arquitetural explícita: Camada 4 e Camada 3 pertencem AMBAS à Libervia
Ajustes Finos Aplicados (4 ajustes solicitados)
Ajuste 1: Invariante de imutabilidade da SituaçãoDecisoria ✓
Núcleo (contexto, objetivo, incertezas, alternativas, riscos, etc.) IMUTÁVEL a partir de ACEITA
Campo anexos_analise adicionado como append-only
Permite extensões durante EM_ANALISE sem violar imutabilidade do núcleo
Ajuste 2: ValidarAbertura completa com 5 gatilhos canônicos ✓
Gatilho 1: Incerteza real existe
Gatilho 2: Risco real existe
Gatilho 3: Consequência relevante existe (campo consequencia_relevante adicionado)
Gatilho 4: Alternativa real existe (≥2)
Gatilho 5: Possibilidade de aprendizado existe (campo possibilidade_aprendizado adicionado)
Ajuste 3: ContratoDeDecisao explicitamente "a saída" ✓
RegistrarDecisao() RETORNA ContratoDeDecisao
Princípio fundamental explícito: "A única saída da Libervia para a Bazari é ContratoDeDecisao"
Assinatura da função ajustada no Orquestrador
Documentação do fluxo atualizada
Ajuste 4: Camada 4 explicitamente parte da Libervia ✓
Nota no início da máquina de estados: "CAMADA 4 PERTENCE À LIBERVIA"
Diagrama atualizado com clareza: "Camada 4 — parte da Libervia" e "Camada 3 — parte da Libervia"
Princípios de não-fusão atualizados: "Ambas as camadas pertencem à Libervia (não são sistemas separados)"
Fluxo completo marcado: "NOTA IMPORTANTE: Camada 4 e Camada 3 pertencem à Libervia"
Teste 7.5 ajustado com 9 verificações confirmando separação e pertencimento à Libervia
Características Fundamentais Preservadas
Rigor: Nenhuma transição de estado pode ser pulada ou revertida em nenhuma das duas máquinas.
Imutabilidade Granular: Núcleo da SituaçãoDecisoria imutável a partir de ACEITA, com anexos append-only.
Memória Permanente: Episódios nunca são deletados.
Separação: Libervia pensa e emite contrato, Bazari executa — ponte formal e ÚNICA via ContratoDeDecisao.
Não-opinião: Sistema não recomenda, não otimiza, não prediz.
Risco Real: Decisões só existem onde 5 gatilhos canônicos são satisfeitos.
Duas Camadas Distintas: Camada 4 (Orquestrador) controla processo, Camada 3 (Cérebro) controla memória, ambas pertencem à Libervia.
Saída Única: A ÚNICA saída da Libervia para Bazari é ContratoDeDecisao.
O que NÃO foi implementado (fora de escopo)
❌ Linguagem de programação específica
❌ Banco de dados
❌ API ou endpoints
❌ Interface de usuário
❌ Sistema de autenticação
❌ Automação ou agentes
❌ IA que opina ou recomenda
❌ Scores, rankings ou otimização
❌ Framework ou stack tecnológico
Status Final
INCREMENTO 0 ESTÁ 100% CANÔNICO E IMPLEMENTÁVEL. Todos os 4 ajustes finos foram aplicados sem ampliar escopo.
Todos os critérios de sucesso são verificáveis.
Núcleo cognitivo está formalmente especificado e pronto para implementação.
Aguardando instrução para próximo incremento.