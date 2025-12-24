import * as fs from 'fs/promises';
import { SituacaoRepositoryImpl } from '../camada-3/repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import { OrquestradorCognitivo } from '../camada-3/orquestrador/OrquestradorCognitivo';
import {
  SituacaoDecisoria,
  DecisionProtocol,
  DadosProtocoloInput,
  StatusSituacao,
  EstadoEpisodio,
  EstadoProtocolo,
  PerfilRisco,
  Limite
} from '../camada-3/entidades/tipos';

const TEST_DATA_DIR = './test-data-inc3-' + Date.now();

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

function criarDadosProtocoloValidos(): DadosProtocoloInput {
  return {
    criterios_minimos: ['Critério 1', 'Critério 2'],
    riscos_considerados: ['Risco técnico', 'Risco operacional'],
    limites_definidos: [
      { tipo: 'Financeiro', descricao: 'Máximo R$ 1000', valor: '1000' }
    ],
    perfil_risco: PerfilRisco.MODERADO,
    alternativas_avaliadas: ['Alt 1', 'Alt 2'],
    alternativa_escolhida: 'Alt 1'
  };
}

async function criarOrquestradorCompleto() {
  const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
  const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
  const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
  const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
  const protocoloRepo = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo
  );

  return {
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    protocoloRepo,
    memoryService,
    orquestrador
  };
}

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 3
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 3 - Protocolo Formal de Decisão', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Criar decisão sem protocolo → erro
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Criar decisão sem protocolo → erro', () => {
    test('RegistrarDecisao sem protocolo lança erro', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      // Criar situação e episódio
      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Tentar registrar decisão sem criar protocolo primeiro
      await expect(
        orquestrador.RegistrarDecisao(episodio.id, {
          alternativa_escolhida: 'Alt 1',
          criterios: ['Critério 1'],
          perfil_risco: PerfilRisco.MODERADO,
          limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
          condicoes: ['Condição 1']
        })
      ).rejects.toThrow('Decisão não pode ser registrada sem DecisionProtocol');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Protocolo incompleto → erro (REJEITADO)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Protocolo incompleto → REJEITADO', () => {
    test('Protocolo sem criterios_minimos é REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosIncompletos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        criterios_minimos: [] // Vazio
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosIncompletos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('criterios_minimos');
    });

    test('Protocolo sem riscos_considerados é REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosIncompletos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        riscos_considerados: [] // Vazio
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosIncompletos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('riscos_considerados');
    });

    test('Protocolo sem limites_definidos é REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosIncompletos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        limites_definidos: [] // Vazio
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosIncompletos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('limites_definidos');
    });

    test('Protocolo com menos de 2 alternativas é REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosIncompletos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        alternativas_avaliadas: ['Alt 1'] // Apenas 1
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosIncompletos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('alternativas_avaliadas');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Alternativa inválida → erro
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Alternativa inválida → REJEITADO', () => {
    test('alternativa_escolhida não está em alternativas_avaliadas → REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosInvalidos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        alternativas_avaliadas: ['Alt 1', 'Alt 2'],
        alternativa_escolhida: 'Alt 3' // Não existe nas avaliadas
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosInvalidos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('alternativa_escolhida deve estar entre');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Memória usada sem anexo → erro
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Memória usada sem anexo → REJEITADO', () => {
    test('memoria_consultada_ids sem registro em anexos → REJEITADO', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const dadosComMemoria: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        memoria_consultada_ids: ['episodio-inexistente-123']
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosComMemoria
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);
      expect(protocolo.motivo_rejeicao).toContain('não foi registrada como anexo');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Protocolo válido gera decisão
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Protocolo válido gera decisão', () => {
    test('Fluxo completo: Situação → Episódio → Protocolo → Decisão → Contrato', async () => {
      const { orquestrador, protocoloRepo, decisaoRepo, contratoRepo } =
        await criarOrquestradorCompleto();

      // 1. Criar situação e episódio
      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      expect(episodio.estado).toBe(EstadoEpisodio.CRIADO);

      // 2. Construir protocolo válido
      const dadosProtocolo = criarDadosProtocoloValidos();
      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosProtocolo
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.VALIDADO);
      expect(protocolo.validado_por).toBe('Libervia');
      expect(protocolo.motivo_rejeicao).toBeUndefined();

      // 3. Registrar decisão (agora deve funcionar)
      const contrato = await orquestrador.RegistrarDecisao(episodio.id, {
        alternativa_escolhida: dadosProtocolo.alternativa_escolhida,
        criterios: dadosProtocolo.criterios_minimos,
        perfil_risco: dadosProtocolo.perfil_risco,
        limites: dadosProtocolo.limites_definidos,
        condicoes: ['Condição 1']
      });

      // 4. Verificar resultados
      expect(contrato).toBeDefined();
      expect(contrato.alternativa_autorizada).toBe('Alt 1');
      expect(contrato.emitido_para).toBe('external');

      // Verificar que protocolo foi persistido
      const protocoloPersistido = await protocoloRepo.getByEpisodioId(episodio.id);
      expect(protocoloPersistido).not.toBeNull();
      expect(protocoloPersistido!.estado).toBe(EstadoProtocolo.VALIDADO);

      // Verificar que decisão foi criada
      const decisao = await decisaoRepo.getByEpisodioId(episodio.id);
      expect(decisao).not.toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Protocolo rejeitado não gera decisão
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Protocolo rejeitado não gera decisão', () => {
    test('RegistrarDecisao com protocolo REJEITADO lança erro', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Criar protocolo inválido (será REJEITADO)
      const dadosInvalidos: DadosProtocoloInput = {
        ...criarDadosProtocoloValidos(),
        criterios_minimos: [] // Vazio → REJEITADO
      };

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        dadosInvalidos
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.REJEITADO);

      // Tentar registrar decisão com protocolo rejeitado
      await expect(
        orquestrador.RegistrarDecisao(episodio.id, {
          alternativa_escolhida: 'Alt 1',
          criterios: ['Critério 1'],
          perfil_risco: PerfilRisco.MODERADO,
          limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
          condicoes: ['Condição 1']
        })
      ).rejects.toThrow('Decisão só pode ser registrada com protocolo VALIDADO');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Update/delete inexistentes
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Update/delete inexistentes', () => {
    test('DecisionProtocolRepository não possui método update', async () => {
      const { protocoloRepo } = await criarOrquestradorCompleto();

      expect((protocoloRepo as any).update).toBeUndefined();
      expect((protocoloRepo as any).updateEstado).toBeUndefined();
    });

    test('DecisionProtocolRepository não possui método delete', async () => {
      const { protocoloRepo } = await criarOrquestradorCompleto();

      expect((protocoloRepo as any).delete).toBeUndefined();
      expect((protocoloRepo as any).remove).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Estados terminais respeitados
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Estados terminais respeitados', () => {
    test('Não é possível criar segundo protocolo para mesmo episódio', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Criar primeiro protocolo (VALIDADO)
      await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );

      // Tentar criar segundo protocolo
      await expect(
        orquestrador.ConstruirProtocoloDeDecisao(
          episodio.id,
          criarDadosProtocoloValidos()
        )
      ).rejects.toThrow('Já existe DecisionProtocol para este episódio');
    });

    test('Protocolo só pode ser criado quando episódio está em CRIADO', async () => {
      const { orquestrador, episodioRepo } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Criar protocolo válido
      await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );

      // Registrar decisão (transiciona episódio para DECIDIDO)
      await orquestrador.RegistrarDecisao(episodio.id, {
        alternativa_escolhida: 'Alt 1',
        criterios: ['Critério 1'],
        perfil_risco: PerfilRisco.MODERADO,
        limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
        condicoes: ['Condição 1']
      });

      // Criar nova situação e episódio para testar
      const situacao2 = criarSituacaoValida('situacao-2');
      const episodio2 = await orquestrador.ProcessarSolicitacao(situacao2);

      // Forçar estado DECIDIDO sem protocolo (simulando edge case)
      await episodioRepo.updateEstado(episodio2.id, EstadoEpisodio.DECIDIDO);

      // Tentar criar protocolo para episódio já DECIDIDO
      await expect(
        orquestrador.ConstruirProtocoloDeDecisao(
          episodio2.id,
          criarDadosProtocoloValidos()
        )
      ).rejects.toThrow('Protocolo só pode ser construído quando episódio está em CRIADO');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: Consistência entre protocolo e decisão
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: Consistência entre protocolo e decisão', () => {
    test('Decisão com alternativa diferente do protocolo lança erro', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Criar protocolo com Alt 1
      await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
        ...criarDadosProtocoloValidos(),
        alternativa_escolhida: 'Alt 1'
      });

      // Tentar registrar decisão com Alt 2
      await expect(
        orquestrador.RegistrarDecisao(episodio.id, {
          alternativa_escolhida: 'Alt 2', // Diferente do protocolo
          criterios: ['Critério 1'],
          perfil_risco: PerfilRisco.MODERADO,
          limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
          condicoes: ['Condição 1']
        })
      ).rejects.toThrow('alternativa_escolhida na decisão (Alt 2) difere do protocolo (Alt 1)');
    });

    test('Decisão com perfil_risco diferente do protocolo lança erro', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      // Criar protocolo com MODERADO
      await orquestrador.ConstruirProtocoloDeDecisao(episodio.id, {
        ...criarDadosProtocoloValidos(),
        perfil_risco: PerfilRisco.MODERADO
      });

      // Tentar registrar decisão com AGRESSIVO
      await expect(
        orquestrador.RegistrarDecisao(episodio.id, {
          alternativa_escolhida: 'Alt 1',
          criterios: ['Critério 1'],
          perfil_risco: PerfilRisco.AGRESSIVO, // Diferente do protocolo
          limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
          condicoes: ['Condição 1']
        })
      ).rejects.toThrow('perfil_risco na decisão (AGRESSIVO) difere do protocolo (MODERADO)');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: Persistência do protocolo
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 10: Persistência do protocolo', () => {
    test('Protocolo persiste após reinicialização', async () => {
      // Criar orquestrador e protocolo
      const { orquestrador, protocoloRepo } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );

      expect(protocolo.estado).toBe(EstadoProtocolo.VALIDADO);

      // Criar novo repositório (simula restart)
      const protocoloRepo2 = await DecisionProtocolRepositoryImpl.create(TEST_DATA_DIR);

      const protocoloRecuperado = await protocoloRepo2.getByEpisodioId(episodio.id);

      expect(protocoloRecuperado).not.toBeNull();
      expect(protocoloRecuperado!.id).toBe(protocolo.id);
      expect(protocoloRecuperado!.estado).toBe(EstadoProtocolo.VALIDADO);
      expect(protocoloRecuperado!.alternativa_escolhida).toBe('Alt 1');
      expect(protocoloRecuperado!.validado_por).toBe('Libervia');
    });

    test('Datas são preservadas após persistência', async () => {
      const { orquestrador } = await criarOrquestradorCompleto();

      const situacao = criarSituacaoValida();
      const episodio = await orquestrador.ProcessarSolicitacao(situacao);

      const antes = new Date();
      const protocolo = await orquestrador.ConstruirProtocoloDeDecisao(
        episodio.id,
        criarDadosProtocoloValidos()
      );
      const depois = new Date();

      // Verificar que validado_em está entre antes e depois
      expect(protocolo.validado_em.getTime()).toBeGreaterThanOrEqual(antes.getTime());
      expect(protocolo.validado_em.getTime()).toBeLessThanOrEqual(depois.getTime());

      // Verificar que é Date, não string
      expect(protocolo.validado_em instanceof Date).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 11: protocoloRepo é OBRIGATÓRIO (sem modo legado)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 11: protocoloRepo é OBRIGATÓRIO', () => {
    test('RegistrarDecisao sem protocoloRepo configurado lança erro', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      // Orquestrador SEM protocoloRepo
      const orquestradorSemProtocolo = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService
        // Sem protocoloRepo
      );

      const situacao = criarSituacaoValida();
      const episodio = await orquestradorSemProtocolo.ProcessarSolicitacao(situacao);

      // DEVE FALHAR: protocoloRepo é obrigatório no Incremento 3
      await expect(
        orquestradorSemProtocolo.RegistrarDecisao(episodio.id, {
          alternativa_escolhida: 'Alt 1',
          criterios: ['Critério 1'],
          perfil_risco: PerfilRisco.MODERADO,
          limites: [{ tipo: 'Financeiro', descricao: 'Max', valor: '1000' }],
          condicoes: ['Condição 1']
        })
      ).rejects.toThrow('protocoloRepo é obrigatório');
    });

    test('ConstruirProtocoloDeDecisao sem protocoloRepo lança erro explicativo', async () => {
      const situacaoRepo = await SituacaoRepositoryImpl.create(TEST_DATA_DIR);
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      const orquestradorSemProtocolo = new OrquestradorCognitivo(
        situacaoRepo,
        episodioRepo,
        decisaoRepo,
        contratoRepo,
        memoryService
      );

      const situacao = criarSituacaoValida();
      const episodio = await orquestradorSemProtocolo.ProcessarSolicitacao(situacao);

      await expect(
        orquestradorSemProtocolo.ConstruirProtocoloDeDecisao(
          episodio.id,
          criarDadosProtocoloValidos()
        )
      ).rejects.toThrow('DecisionProtocolRepository não configurado');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 12: Garantias anteriores preservadas
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 12: Garantias anteriores preservadas', () => {
    test('Decisão ainda é imutável', async () => {
      const { decisaoRepo } = await criarOrquestradorCompleto();

      expect((decisaoRepo as any).update).toBeUndefined();
      expect((decisaoRepo as any).delete).toBeUndefined();
    });

    test('Contrato ainda é imutável', async () => {
      const { contratoRepo } = await criarOrquestradorCompleto();

      expect((contratoRepo as any).update).toBeUndefined();
      expect((contratoRepo as any).delete).toBeUndefined();
    });

    test('Episódio ainda segue máquina de estados', async () => {
      const { episodioRepo } = await criarOrquestradorCompleto();

      // Criar episódio
      await episodioRepo.create({
        id: 'ep-test',
        caso_uso: 1,
        dominio: 'Teste',
        estado: EstadoEpisodio.CRIADO,
        situacao_referenciada: 'sit-test',
        data_criacao: new Date(),
        data_decisao: null,
        data_observacao_iniciada: null,
        data_encerramento: null
      });

      // Transição inválida: CRIADO → ENCERRADO
      await expect(
        episodioRepo.updateEstado('ep-test', EstadoEpisodio.ENCERRADO)
      ).rejects.toThrow('Transição inválida');
    });
  });
});
