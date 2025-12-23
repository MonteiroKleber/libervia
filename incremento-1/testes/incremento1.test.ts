import * as fs from 'fs/promises';
import * as path from 'path';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  StatusSituacao,
  EstadoEpisodio,
  PerfilRisco,
  MemoryQuery,
  AnexoAnalise
} from '../entidades/tipos';

const TEST_DATA_DIR = './test-data-' + Date.now();

// ════════════════════════════════════════════════════════════════════════
// SETUP E TEARDOWN
// ════════════════════════════════════════════════════════════════════════

async function limparDiretorioTeste(): Promise<void> {
  try {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Ignorar se não existe
  }
}

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function criarSituacaoValida(id: string = 'situacao-1'): SituacaoDecisoria {
  return {
    id,
    dominio: 'Teste',
    contexto: 'Contexto de teste',
    objetivo: 'Objetivo de teste',
    incertezas: ['Incerteza 1'],
    alternativas: [
      { descricao: 'Alt 1', riscos_associados: ['Risco 1'] },
      { descricao: 'Alt 2', riscos_associados: ['Risco 2'] }
    ],
    riscos: [{ descricao: 'Risco 1', tipo: 'Técnico', reversibilidade: 'Alta' }],
    urgencia: 'Média',
    capacidade_absorcao: 'Alta',
    consequencia_relevante: 'Consequência relevante',
    possibilidade_aprendizado: true,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    caso_uso_declarado: 1,
    anexos_analise: []
  };
}

function criarEpisodioValido(
  id: string = 'episodio-1',
  situacao_id: string = 'situacao-1'
): EpisodioDecisao {
  return {
    id,
    caso_uso: 1,
    dominio: 'Teste',
    estado: EstadoEpisodio.CRIADO,
    situacao_referenciada: situacao_id,
    data_criacao: new Date(),
    data_decisao: null,
    data_observacao_iniciada: null,
    data_encerramento: null
  };
}

function criarDecisaoValida(
  id: string = 'decisao-1',
  episodio_id: string = 'episodio-1'
): DecisaoInstitucional {
  return {
    id,
    episodio_id,
    alternativa_escolhida: 'Alt 1',
    criterios: ['Critério 1'],
    perfil_risco: PerfilRisco.MODERADO,
    limites: [{ tipo: 'Financeiro', descricao: 'Máximo R$ 1000', valor: '1000' }],
    condicoes: ['Condição 1'],
    data_decisao: new Date()
  };
}

function criarContratoValido(
  id: string = 'contrato-1',
  episodio_id: string = 'episodio-1',
  decisao_id: string = 'decisao-1'
): ContratoDeDecisao {
  return {
    id,
    episodio_id,
    decisao_id,
    alternativa_autorizada: 'Alt 1',
    limites_execucao: [{ tipo: 'Financeiro', descricao: 'Máximo R$ 1000', valor: '1000' }],
    condicoes_obrigatorias: ['Condição 1'],
    observacao_minima_requerida: ['Impacto Técnico observado'],
    data_emissao: new Date(),
    emitido_para: 'Bazari'
  };
}

// ════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 1 - Persistência e Consulta da Memória', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Episódio não pode ser deletado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Episódio não pode ser deletado', () => {
    test('EpisodioRepository não possui método delete', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).delete).toBeUndefined();
      expect((repo as any).remove).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Decisão não pode ser alterada
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Decisão não pode ser alterada', () => {
    test('DecisaoRepository não possui método update', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).update).toBeUndefined();
      expect((repo as any).updateDecisao).toBeUndefined();
    });

    test('Tentativa de criar segunda decisão para mesmo episódio falha', async () => {
      const repo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);

      const decisao1 = criarDecisaoValida('decisao-1', 'episodio-1');
      await repo.create(decisao1);

      const decisao2 = criarDecisaoValida('decisao-2', 'episodio-1');

      await expect(repo.create(decisao2)).rejects.toThrow(
        'Já existe DecisaoInstitucional para este episódio'
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Contrato não pode ser alterado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Contrato não pode ser alterado', () => {
    test('ContratoRepository não possui método update', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).update).toBeUndefined();
    });

    test('ContratoRepository não possui método delete', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).delete).toBeUndefined();
    });

    test('Apenas um contrato por episódio', async () => {
      const repo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);

      const contrato1 = criarContratoValido('contrato-1', 'episodio-1');
      await repo.create(contrato1);

      const contrato2 = criarContratoValido('contrato-2', 'episodio-1');

      await expect(repo.create(contrato2)).rejects.toThrow(
        'Já existe ContratoDeDecisao para este episódio'
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Núcleo da situação trava a partir de ACEITA
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Núcleo da situação trava a partir de ACEITA', () => {
    test('SituacaoRepository não possui método update genérico', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).update).toBeUndefined();
      expect((repo as any).updateContexto).toBeUndefined();
      expect((repo as any).updateNucleo).toBeUndefined();
    });

    test('Transições de estado seguem regras rígidas', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);

      const situacao = criarSituacaoValida();
      await repo.create(situacao);

      // Transição válida: RASCUNHO → ABERTA
      await repo.updateStatus(situacao.id, StatusSituacao.ABERTA);

      // Transição inválida: ABERTA → EM_ANALISE (deve ser ACEITA primeiro)
      await expect(
        repo.updateStatus(situacao.id, StatusSituacao.EM_ANALISE)
      ).rejects.toThrow('Transição inválida');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Anexo é append-only
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Anexo é append-only', () => {
    test('Anexo só pode ser adicionado em EM_ANALISE', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);

      const situacao = criarSituacaoValida();
      await repo.create(situacao);

      const anexo: AnexoAnalise = {
        tipo: 'Teste',
        conteudo: 'conteúdo de teste',
        data_anexo: new Date()
      };

      // Tentar adicionar em RASCUNHO - deve falhar
      await expect(
        repo.appendAnexoAnalise(situacao.id, anexo)
      ).rejects.toThrow('Anexos só podem ser adicionados quando status = EM_ANALISE');

      // Transicionar para EM_ANALISE
      await repo.updateStatus(situacao.id, StatusSituacao.ABERTA);
      await repo.updateStatus(situacao.id, StatusSituacao.ACEITA);
      await repo.updateStatus(situacao.id, StatusSituacao.EM_ANALISE);

      // Agora deve funcionar
      await expect(
        repo.appendAnexoAnalise(situacao.id, anexo)
      ).resolves.not.toThrow();

      // Verificar que foi adicionado
      const recuperada = await repo.getById(situacao.id);
      expect(recuperada!.anexos_analise).toHaveLength(1);
      expect(recuperada!.anexos_analise[0].tipo).toBe('Teste');
    });

    test('Anexo não muta objeto input', async () => {
      const repo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);

      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.EM_ANALISE;
      await repo.create(situacao);

      // Usar timestamp fixo para evitar problemas de timezone
      const dataOriginal = new Date('2020-06-15T12:00:00.000Z');
      const timestampOriginal = dataOriginal.getTime();
      const anexo: AnexoAnalise = {
        tipo: 'Teste',
        conteudo: 'conteúdo',
        data_anexo: dataOriginal
      };

      await repo.appendAnexoAnalise(situacao.id, anexo);

      // Verificar que data_anexo do input não foi mutada (comparar timestamp)
      expect(anexo.data_anexo.getTime()).toBe(timestampOriginal);

      // Verificar que anexo persistido tem data atual (mais recente que a original)
      const recuperada = await repo.getById(situacao.id);
      expect(recuperada!.anexos_analise[0].data_anexo.getTime()).toBeGreaterThan(timestampOriginal);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Consulta de memória só ocorre em EM_ANALISE
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Consulta de memória só ocorre em EM_ANALISE', () => {
    test('Consulta fora de EM_ANALISE é rejeitada', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );

      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.ABERTA;
      await situacaoRepo.create(situacao);

      const query: MemoryQuery = { caso_uso: 1 };

      await expect(
        orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, query)
      ).rejects.toThrow('Consulta de memória só é permitida em EM_ANALISE');
    });

    test('Consulta em EM_ANALISE funciona', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );

      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.EM_ANALISE;
      await situacaoRepo.create(situacao);

      const query: MemoryQuery = { caso_uso: 1 };

      const resultado = await orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, query);

      expect(resultado).toBeDefined();
      expect(resultado.hits).toBeDefined();
      expect(Array.isArray(resultado.hits)).toBe(true);
    });

    test('Consulta registra anexo automaticamente', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService
      );

      const situacao = criarSituacaoValida();
      situacao.status = StatusSituacao.EM_ANALISE;
      await situacaoRepo.create(situacao);

      const query: MemoryQuery = { caso_uso: 1 };

      await orquestrador.ConsultarMemoriaDuranteAnalise(situacao.id, query);

      // Verificar que anexo foi adicionado
      const recuperada = await situacaoRepo.getById(situacao.id);
      expect(recuperada!.anexos_analise).toHaveLength(1);
      expect(recuperada!.anexos_analise[0].tipo).toBe('Memória consultada');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: MemoryQueryService não faz ranking
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: MemoryQueryService não faz ranking', () => {
    test('MemoryQueryService não possui métodos de ranking', async () => {
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      expect((memoryService as any).rankResults).toBeUndefined();
      expect((memoryService as any).recommendDecision).toBeUndefined();
      expect((memoryService as any).scoreAlternatives).toBeUndefined();
      expect((memoryService as any).predictOutcome).toBeUndefined();
      expect((memoryService as any).suggestBestOption).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Persistência e recuperação de dados
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Persistência e recuperação de dados', () => {
    test('Dados persistem após reinicialização do repositório', async () => {
      // Criar e popular repositório
      const repo1 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const episodio = criarEpisodioValido();
      await repo1.create(episodio);

      // Criar novo repositório apontando para mesma pasta
      const repo2 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const recuperado = await repo2.getById(episodio.id);

      expect(recuperado).not.toBeNull();
      expect(recuperado!.id).toBe(episodio.id);
      expect(recuperado!.dominio).toBe(episodio.dominio);
      expect(recuperado!.data_criacao instanceof Date).toBe(true);
    });

    test('Datas são preservadas corretamente após persistência', async () => {
      const repo1 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const dataOriginal = new Date('2024-01-15T10:30:00.000Z');
      const episodio = criarEpisodioValido();
      episodio.data_criacao = dataOriginal;
      await repo1.create(episodio);

      const repo2 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const recuperado = await repo2.getById(episodio.id);

      expect(recuperado!.data_criacao.getTime()).toBe(dataOriginal.getTime());
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Fluxo completo do Orquestrador
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: Fluxo completo do Orquestrador', () => {
    test('Fluxo ProcessarSolicitacao → Protocolo → RegistrarDecisao → Contrato', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
      const orquestrador = new OrquestradorCognitivo(
        situacaoRepo, episodioRepo, decisaoRepo, contratoRepo, memoryService, protocoloRepo
      );

      // 1. Processar solicitação
      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      expect(episodio).toBeDefined();
      expect(episodio.estado).toBe(EstadoEpisodio.CRIADO);

      // 2. Criar protocolo formal (INCREMENTO 3: obrigatório)
      await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
        criterios_minimos: ['Critério 1', 'Critério 2'],
        riscos_considerados: ['Risco técnico'],
        limites_definidos: [{ tipo: 'Financeiro', descricao: 'Max 1000', valor: '1000' }],
        perfil_risco: PerfilRisco.MODERADO,
        alternativas_avaliadas: ['Alt 1', 'Alt 2'],
        alternativa_escolhida: 'Alt 1'
      });

      // 3. Registrar decisão (retorna contrato)
      const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
        alternativa_escolhida: 'Alt 1',
        criterios: ['Critério 1'],
        perfil_risco: PerfilRisco.MODERADO,
        limites: [{ tipo: 'Financeiro', descricao: 'Max 1000', valor: '1000' }],
        condicoes: ['Condição 1']
      });

      expect(contrato).toBeDefined();
      expect(contrato.alternativa_autorizada).toBe('Alt 1');
      expect(contrato.emitido_para).toBe('Bazari');

      // Verificar que episódio está DECIDIDO
      const episodioAtualizado = await episodioRepo.getById(episodio.id);
      expect(episodioAtualizado!.estado).toBe(EstadoEpisodio.DECIDIDO);

      // 4. Iniciar observação
      await orquestrador.IniciarObservacao(episodio.id);
      const episodioObs = await episodioRepo.getById(episodio.id);
      expect(episodioObs!.estado).toBe(EstadoEpisodio.EM_OBSERVACAO);

      // 5. Encerrar episódio
      await orquestrador.EncerrarEpisodio(episodio.id);
      const episodioFinal = await episodioRepo.getById(episodio.id);
      expect(episodioFinal!.estado).toBe(EstadoEpisodio.ENCERRADO);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: Batch lookup funciona corretamente
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 10: Batch lookup funciona corretamente', () => {
    test('getByEpisodioIds retorna Map com decisões corretas', async () => {
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);

      const decisao1 = criarDecisaoValida('decisao-1', 'episodio-1');
      const decisao2 = criarDecisaoValida('decisao-2', 'episodio-2');
      decisao2.alternativa_escolhida = 'Alt 2';

      await decisaoRepo.create(decisao1);
      await decisaoRepo.create(decisao2);

      const result = await decisaoRepo.getByEpisodioIds(['episodio-1', 'episodio-2', 'episodio-3']);

      expect(result.size).toBe(2);
      expect(result.get('episodio-1')?.alternativa_escolhida).toBe('Alt 1');
      expect(result.get('episodio-2')?.alternativa_escolhida).toBe('Alt 2');
      expect(result.has('episodio-3')).toBe(false);
    });
  });
});
