/**
 * INCREMENTO 13 — CAMADA FECHADA: Testes
 *
 * Testes para as 5 regras de bloqueio da Camada Fechada.
 * Cada regra é testada isoladamente e no contexto do OrquestradorCognitivo.
 */

import {
  validateClosedLayer,
  ClosedLayerRuleId,
  SituacaoDecisoria,
  DecisionProtocol,
  StatusSituacao,
  EstadoProtocolo,
  PerfilRisco,
  Limite
} from '../../camada-3';
import {
  checkSemRisco,
  checkSemAlternativas,
  checkSemLimites,
  checkConservadorSemCriterios,
  checkSemConsequencia
} from '../../camada-3/camada-fechada/ClosedLayerRules';

// ════════════════════════════════════════════════════════════════════════════
// FIXTURES DE TESTE
// ════════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(): SituacaoDecisoria {
  return {
    id: 'sit-test-001',
    dominio: 'financeiro',
    contexto: 'Contexto de teste',
    objetivo: 'Objetivo de teste',
    incertezas: ['Incerteza 1'],
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

function criarProtocoloValido(): DecisionProtocol {
  return {
    id: 'prot-test-001',
    episodio_id: 'ep-test-001',
    criterios_minimos: ['Critério 1', 'Critério 2'],
    riscos_considerados: ['Risco 1'],
    limites_definidos: [
      { tipo: 'financeiro', descricao: 'Limite de valor', valor: '10000' }
    ],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
    alternativa_escolhida: 'Alternativa A',
    memoria_consultada_ids: [],
    anexos_utilizados_ids: [],
    estado: EstadoProtocolo.VALIDADO,
    validado_em: new Date(),
    validado_por: 'Libervia'
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 1 — BLOQUEAR_SEM_RISCO
// ════════════════════════════════════════════════════════════════════════════

describe('Regra 1: BLOQUEAR_SEM_RISCO', () => {
  it('deve BLOQUEAR quando não há riscos NEM incertezas', () => {
    const situacao = criarSituacaoValida();
    situacao.riscos = [];
    situacao.incertezas = [];

    const result = checkSemRisco(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_RISCO);
    expect(result.reason).toContain('sem risco nem incerteza');
  });

  it('deve PASSAR quando há pelo menos um risco', () => {
    const situacao = criarSituacaoValida();
    situacao.riscos = [{ descricao: 'Risco', tipo: 'operacional', reversibilidade: 'reversível' }];
    situacao.incertezas = [];

    const result = checkSemRisco(situacao);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve PASSAR quando há pelo menos uma incerteza', () => {
    const situacao = criarSituacaoValida();
    situacao.riscos = [];
    situacao.incertezas = ['Incerteza'];

    const result = checkSemRisco(situacao);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve PASSAR quando há riscos E incertezas', () => {
    const situacao = criarSituacaoValida();

    const result = checkSemRisco(situacao);

    expect(result.blocked).toBe(false);
  });

  it('deve usar default vazio para arrays undefined (defensivo)', () => {
    const situacao = criarSituacaoValida();
    // @ts-expect-error - testando comportamento defensivo
    situacao.riscos = undefined;
    // @ts-expect-error - testando comportamento defensivo
    situacao.incertezas = undefined;

    const result = checkSemRisco(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_RISCO);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 2 — BLOQUEAR_SEM_ALTERNATIVAS
// ════════════════════════════════════════════════════════════════════════════

describe('Regra 2: BLOQUEAR_SEM_ALTERNATIVAS', () => {
  it('deve BLOQUEAR quando não há alternativas', () => {
    const situacao = criarSituacaoValida();
    situacao.alternativas = [];

    const result = checkSemAlternativas(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_ALTERNATIVAS);
    expect(result.reason).toContain('ao menos 2 alternativas');
  });

  it('deve BLOQUEAR quando há apenas 1 alternativa', () => {
    const situacao = criarSituacaoValida();
    situacao.alternativas = [
      { descricao: 'Única alternativa', riscos_associados: [] }
    ];

    const result = checkSemAlternativas(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_ALTERNATIVAS);
  });

  it('deve PASSAR quando há exatamente 2 alternativas', () => {
    const situacao = criarSituacaoValida();

    const result = checkSemAlternativas(situacao);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve PASSAR quando há mais de 2 alternativas', () => {
    const situacao = criarSituacaoValida();
    situacao.alternativas.push({ descricao: 'Terceira', riscos_associados: [] });

    const result = checkSemAlternativas(situacao);

    expect(result.blocked).toBe(false);
  });

  it('deve usar default vazio para array undefined (defensivo)', () => {
    const situacao = criarSituacaoValida();
    // @ts-expect-error - testando comportamento defensivo
    situacao.alternativas = undefined;

    const result = checkSemAlternativas(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_ALTERNATIVAS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 3 — BLOQUEAR_SEM_LIMITES
// ════════════════════════════════════════════════════════════════════════════

describe('Regra 3: BLOQUEAR_SEM_LIMITES', () => {
  it('deve BLOQUEAR quando não há limites definidos no protocolo', () => {
    const protocolo = criarProtocoloValido();
    protocolo.limites_definidos = [];

    const result = checkSemLimites(protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_LIMITES);
    expect(result.reason).toContain('sem limites definidos');
  });

  it('deve PASSAR quando há pelo menos um limite definido', () => {
    const protocolo = criarProtocoloValido();

    const result = checkSemLimites(protocolo);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve usar default vazio para array undefined (defensivo)', () => {
    const protocolo = criarProtocoloValido();
    // @ts-expect-error - testando comportamento defensivo
    protocolo.limites_definidos = undefined;

    const result = checkSemLimites(protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_LIMITES);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 4 — BLOQUEAR_CONSERVADOR_SEM_CRITERIOS
// ════════════════════════════════════════════════════════════════════════════

describe('Regra 4: BLOQUEAR_CONSERVADOR_SEM_CRITERIOS', () => {
  it('deve BLOQUEAR quando perfil é CONSERVADOR e não há critérios', () => {
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    protocolo.criterios_minimos = [];

    const result = checkConservadorSemCriterios(protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.CONSERVADOR_SEM_CRITERIOS);
    expect(result.reason).toContain('CONSERVADOR exige critérios');
  });

  it('deve PASSAR quando perfil é CONSERVADOR com critérios', () => {
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    protocolo.criterios_minimos = ['Critério importante'];

    const result = checkConservadorSemCriterios(protocolo);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve PASSAR quando perfil é MODERADO sem critérios', () => {
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.MODERADO;
    protocolo.criterios_minimos = [];

    const result = checkConservadorSemCriterios(protocolo);

    expect(result.blocked).toBe(false);
  });

  it('deve PASSAR quando perfil é AGRESSIVO sem critérios', () => {
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.AGRESSIVO;
    protocolo.criterios_minimos = [];

    const result = checkConservadorSemCriterios(protocolo);

    expect(result.blocked).toBe(false);
  });

  it('deve usar default vazio para array undefined (defensivo)', () => {
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    // @ts-expect-error - testando comportamento defensivo
    protocolo.criterios_minimos = undefined;

    const result = checkConservadorSemCriterios(protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.CONSERVADOR_SEM_CRITERIOS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: REGRA 5 — BLOQUEAR_SEM_CONSEQUENCIA
// ════════════════════════════════════════════════════════════════════════════

describe('Regra 5: BLOQUEAR_SEM_CONSEQUENCIA', () => {
  it('deve BLOQUEAR quando consequência é string vazia', () => {
    const situacao = criarSituacaoValida();
    situacao.consequencia_relevante = '';

    const result = checkSemConsequencia(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_CONSEQUENCIA);
    expect(result.reason).toContain('sem consequência relevante');
  });

  it('deve BLOQUEAR quando consequência é apenas whitespace', () => {
    const situacao = criarSituacaoValida();
    situacao.consequencia_relevante = '   \t\n  ';

    const result = checkSemConsequencia(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_CONSEQUENCIA);
  });

  it('deve PASSAR quando consequência tem conteúdo', () => {
    const situacao = criarSituacaoValida();

    const result = checkSemConsequencia(situacao);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
  });

  it('deve usar default vazio para string undefined (defensivo)', () => {
    const situacao = criarSituacaoValida();
    // @ts-expect-error - testando comportamento defensivo
    situacao.consequencia_relevante = undefined;

    const result = checkSemConsequencia(situacao);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_CONSEQUENCIA);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: VALIDADOR COMPLETO (validateClosedLayer)
// ════════════════════════════════════════════════════════════════════════════

describe('validateClosedLayer (validador completo)', () => {
  it('deve PASSAR quando todos os requisitos são atendidos', () => {
    const situacao = criarSituacaoValida();
    const protocolo = criarProtocoloValido();

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(false);
    expect(result.rule).toBe('');
    expect(result.reason).toBe('');
  });

  it('deve retornar PRIMEIRO bloqueio encontrado (ordem determinística)', () => {
    const situacao = criarSituacaoValida();
    situacao.riscos = [];
    situacao.incertezas = [];
    situacao.alternativas = [];
    situacao.consequencia_relevante = '';

    const protocolo = criarProtocoloValido();
    protocolo.limites_definidos = [];
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    protocolo.criterios_minimos = [];

    const result = validateClosedLayer(situacao, protocolo);

    // Primeira regra na sequência é SEM_RISCO
    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_RISCO);
  });

  it('deve verificar regra 2 se regra 1 passa', () => {
    const situacao = criarSituacaoValida();
    situacao.alternativas = []; // Falha na regra 2

    const protocolo = criarProtocoloValido();

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_ALTERNATIVAS);
  });

  it('deve verificar regra 3 se regras 1-2 passam', () => {
    const situacao = criarSituacaoValida();
    const protocolo = criarProtocoloValido();
    protocolo.limites_definidos = []; // Falha na regra 3

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_LIMITES);
  });

  it('deve verificar regra 4 se regras 1-3 passam', () => {
    const situacao = criarSituacaoValida();
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    protocolo.criterios_minimos = []; // Falha na regra 4

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.CONSERVADOR_SEM_CRITERIOS);
  });

  it('deve verificar regra 5 se regras 1-4 passam', () => {
    const situacao = criarSituacaoValida();
    situacao.consequencia_relevante = ''; // Falha na regra 5

    const protocolo = criarProtocoloValido();

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(true);
    expect(result.rule).toBe(ClosedLayerRuleId.SEM_CONSEQUENCIA);
  });

  it('deve ser função pura (não modifica inputs)', () => {
    const situacao = criarSituacaoValida();
    const protocolo = criarProtocoloValido();

    const situacaoOriginal = JSON.stringify(situacao);
    const protocoloOriginal = JSON.stringify(protocolo);

    validateClosedLayer(situacao, protocolo);

    expect(JSON.stringify(situacao)).toBe(situacaoOriginal);
    expect(JSON.stringify(protocolo)).toBe(protocoloOriginal);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CENÁRIOS DE BORDA
// ════════════════════════════════════════════════════════════════════════════

describe('Cenários de borda', () => {
  it('deve tratar situação com todos os campos mínimos preenchidos', () => {
    const situacao: SituacaoDecisoria = {
      id: 'min-sit',
      dominio: 'd',
      contexto: 'c',
      objetivo: 'o',
      incertezas: ['i'],
      alternativas: [
        { descricao: 'A', riscos_associados: [] },
        { descricao: 'B', riscos_associados: [] }
      ],
      riscos: [],
      urgencia: 'baixa',
      capacidade_absorcao: 'baixa',
      consequencia_relevante: 'c',
      possibilidade_aprendizado: false,
      status: StatusSituacao.EM_ANALISE,
      data_criacao: new Date(),
      caso_uso_declarado: 1,
      anexos_analise: []
    };

    const protocolo = criarProtocoloValido();

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(false);
  });

  it('deve tratar protocolo CONSERVADOR com critérios mínimos', () => {
    const situacao = criarSituacaoValida();
    const protocolo = criarProtocoloValido();
    protocolo.perfil_risco = PerfilRisco.CONSERVADOR;
    protocolo.criterios_minimos = ['Critério conservador'];

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(false);
  });

  it('deve aceitar consequência com apenas um caractere', () => {
    const situacao = criarSituacaoValida();
    situacao.consequencia_relevante = 'X';

    const protocolo = criarProtocoloValido();

    const result = validateClosedLayer(situacao, protocolo);

    expect(result.blocked).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CONSTANTES DE REGRAS
// ════════════════════════════════════════════════════════════════════════════

describe('ClosedLayerRuleId (constantes)', () => {
  it('deve ter identificadores únicos e imutáveis', () => {
    expect(ClosedLayerRuleId.SEM_RISCO).toBe('BLOQUEAR_SEM_RISCO');
    expect(ClosedLayerRuleId.SEM_ALTERNATIVAS).toBe('BLOQUEAR_SEM_ALTERNATIVAS');
    expect(ClosedLayerRuleId.SEM_LIMITES).toBe('BLOQUEAR_SEM_LIMITES');
    expect(ClosedLayerRuleId.CONSERVADOR_SEM_CRITERIOS).toBe('BLOQUEAR_CONSERVADOR_SEM_CRITERIOS');
    expect(ClosedLayerRuleId.SEM_CONSEQUENCIA).toBe('BLOQUEAR_SEM_CONSEQUENCIA');
  });

  it('deve ter exatamente 5 regras', () => {
    const keys = Object.keys(ClosedLayerRuleId);
    expect(keys.length).toBe(5);
  });
});
