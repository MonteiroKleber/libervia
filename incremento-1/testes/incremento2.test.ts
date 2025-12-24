import * as fs from 'fs/promises';
import * as path from 'path';
import { EpisodioRepositoryImpl } from '../camada-3/repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../camada-3/repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../camada-3/repositorios/implementacao/ContratoRepositoryImpl';
import { MemoryQueryService } from '../camada-3/servicos/MemoryQueryService';
import {
  EpisodioDecisao,
  DecisaoInstitucional,
  ContratoDeDecisao,
  EstadoEpisodio,
  PerfilRisco,
  MemoryQuery
} from '../camada-3/entidades/tipos';

const TEST_DATA_DIR = './test-data-inc2-' + Date.now();

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

function criarEpisodioValido(
  id: string,
  options: {
    caso_uso?: number;
    dominio?: string;
    estado?: EstadoEpisodio;
    data_criacao?: Date;
  } = {}
): EpisodioDecisao {
  return {
    id,
    caso_uso: options.caso_uso ?? 1,
    dominio: options.dominio ?? 'Teste',
    estado: options.estado ?? EstadoEpisodio.CRIADO,
    situacao_referenciada: `situacao-${id}`,
    data_criacao: options.data_criacao ?? new Date(),
    data_decisao: null,
    data_observacao_iniciada: null,
    data_encerramento: null
  };
}

function criarDecisaoValida(
  id: string,
  episodio_id: string,
  perfil_risco: PerfilRisco = PerfilRisco.MODERADO
): DecisaoInstitucional {
  return {
    id,
    episodio_id,
    alternativa_escolhida: 'Alt 1',
    criterios: ['Critério 1'],
    perfil_risco,
    limites: [{ tipo: 'Financeiro', descricao: 'Max 1000', valor: '1000' }],
    condicoes: ['Condição 1'],
    data_decisao: new Date()
  };
}

function criarContratoValido(
  id: string,
  episodio_id: string,
  decisao_id: string
): ContratoDeDecisao {
  return {
    id,
    episodio_id,
    decisao_id,
    alternativa_autorizada: 'Alt 1',
    limites_execucao: [{ tipo: 'Financeiro', descricao: 'Max 1000', valor: '1000' }],
    condicoes_obrigatorias: ['Condição 1'],
    observacao_minima_requerida: ['Impacto observado'],
    data_emissao: new Date(),
    emitido_para: 'external'
  };
}

// ════════════════════════════════════════════════════════════════════════
// TESTES DO INCREMENTO 2
// ════════════════════════════════════════════════════════════════════════

describe('Incremento 2 - Índices para Consultas Eficientes', () => {

  beforeEach(async () => {
    await limparDiretorioTeste();
  });

  afterAll(async () => {
    await limparDiretorioTeste();
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 1: Índice por caso_uso
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 1: Índice por caso_uso', () => {
    test('Filtro por caso_uso retorna apenas episódios correspondentes', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar episódios com diferentes casos de uso
      await repo.create(criarEpisodioValido('ep-1', { caso_uso: 1 }));
      await repo.create(criarEpisodioValido('ep-2', { caso_uso: 2 }));
      await repo.create(criarEpisodioValido('ep-3', { caso_uso: 1 }));
      await repo.create(criarEpisodioValido('ep-4', { caso_uso: 3 }));

      const result = await repo.find({ caso_uso: 1 });

      expect(result.episodios.length).toBe(2);
      expect(result.episodios.every(e => e.caso_uso === 1)).toBe(true);
    });

    test('Filtro por caso_uso inexistente retorna vazio', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { caso_uso: 1 }));
      await repo.create(criarEpisodioValido('ep-2', { caso_uso: 2 }));

      const result = await repo.find({ caso_uso: 5 });

      expect(result.episodios.length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 2: Índice por estado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 2: Índice por estado', () => {
    test('Filtro por estado retorna apenas episódios correspondentes', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { estado: EstadoEpisodio.CRIADO }));
      await repo.create(criarEpisodioValido('ep-2', { estado: EstadoEpisodio.CRIADO }));
      await repo.create(criarEpisodioValido('ep-3', { estado: EstadoEpisodio.DECIDIDO }));

      const result = await repo.find({ estado: EstadoEpisodio.CRIADO });

      expect(result.episodios.length).toBe(2);
      expect(result.episodios.every(e => e.estado === EstadoEpisodio.CRIADO)).toBe(true);
    });

    test('Índice de estado é atualizado após updateEstado', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { estado: EstadoEpisodio.CRIADO }));

      // Verificar estado inicial
      let result = await repo.find({ estado: EstadoEpisodio.CRIADO });
      expect(result.episodios.length).toBe(1);

      result = await repo.find({ estado: EstadoEpisodio.DECIDIDO });
      expect(result.episodios.length).toBe(0);

      // Atualizar estado
      await repo.updateEstado('ep-1', EstadoEpisodio.DECIDIDO);

      // Verificar índices atualizados
      result = await repo.find({ estado: EstadoEpisodio.CRIADO });
      expect(result.episodios.length).toBe(0);

      result = await repo.find({ estado: EstadoEpisodio.DECIDIDO });
      expect(result.episodios.length).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 3: Índice por domínio (case-insensitive)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 3: Índice por domínio', () => {
    test('Filtro por domínio é case-insensitive', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { dominio: 'Financeiro' }));
      await repo.create(criarEpisodioValido('ep-2', { dominio: 'FINANCEIRO' }));
      await repo.create(criarEpisodioValido('ep-3', { dominio: 'financeiro' }));
      await repo.create(criarEpisodioValido('ep-4', { dominio: 'Operacional' }));

      const result = await repo.find({ dominio: 'financeiro' });

      expect(result.episodios.length).toBe(3);
    });

    test('Filtro por domínio suporta match parcial', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { dominio: 'Gestão Financeira' }));
      await repo.create(criarEpisodioValido('ep-2', { dominio: 'Análise Financeira' }));
      await repo.create(criarEpisodioValido('ep-3', { dominio: 'Operacional' }));

      const result = await repo.find({ dominio: 'financeira' });

      expect(result.episodios.length).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 4: Combinação de filtros (intersecção)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 4: Combinação de filtros', () => {
    test('Múltiplos filtros aplicam intersecção', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', {
        caso_uso: 1,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.CRIADO
      }));
      await repo.create(criarEpisodioValido('ep-2', {
        caso_uso: 1,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.DECIDIDO
      }));
      await repo.create(criarEpisodioValido('ep-3', {
        caso_uso: 2,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.CRIADO
      }));
      await repo.create(criarEpisodioValido('ep-4', {
        caso_uso: 1,
        dominio: 'Operacional',
        estado: EstadoEpisodio.CRIADO
      }));

      // Filtrar por caso_uso=1 E domínio=Financeiro E estado=CRIADO
      const result = await repo.find({
        caso_uso: 1,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.CRIADO
      });

      expect(result.episodios.length).toBe(1);
      expect(result.episodios[0].id).toBe('ep-1');
    });

    test('Intersecção vazia retorna array vazio', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', {
        caso_uso: 1,
        dominio: 'Financeiro'
      }));
      await repo.create(criarEpisodioValido('ep-2', {
        caso_uso: 2,
        dominio: 'Operacional'
      }));

      // Não existe episódio com caso_uso=1 E domínio=Operacional
      const result = await repo.find({
        caso_uso: 1,
        dominio: 'Operacional'
      });

      expect(result.episodios.length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 5: Filtros por data (não indexados)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 5: Filtros por data', () => {
    test('Filtro por data_inicio funciona', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      const data1 = new Date('2024-01-01');
      const data2 = new Date('2024-06-01');
      const data3 = new Date('2024-12-01');

      await repo.create(criarEpisodioValido('ep-1', { data_criacao: data1 }));
      await repo.create(criarEpisodioValido('ep-2', { data_criacao: data2 }));
      await repo.create(criarEpisodioValido('ep-3', { data_criacao: data3 }));

      const result = await repo.find({ data_inicio: new Date('2024-05-01') });

      expect(result.episodios.length).toBe(2);
      expect(result.episodios.map(e => e.id).sort()).toEqual(['ep-2', 'ep-3']);
    });

    test('Filtro por data_fim funciona', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      const data1 = new Date('2024-01-01');
      const data2 = new Date('2024-06-01');
      const data3 = new Date('2024-12-01');

      await repo.create(criarEpisodioValido('ep-1', { data_criacao: data1 }));
      await repo.create(criarEpisodioValido('ep-2', { data_criacao: data2 }));
      await repo.create(criarEpisodioValido('ep-3', { data_criacao: data3 }));

      const result = await repo.find({ data_fim: new Date('2024-07-01') });

      expect(result.episodios.length).toBe(2);
      expect(result.episodios.map(e => e.id).sort()).toEqual(['ep-1', 'ep-2']);
    });

    test('Combinação de data_inicio e data_fim funciona', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      const data1 = new Date('2024-01-01');
      const data2 = new Date('2024-06-01');
      const data3 = new Date('2024-12-01');

      await repo.create(criarEpisodioValido('ep-1', { data_criacao: data1 }));
      await repo.create(criarEpisodioValido('ep-2', { data_criacao: data2 }));
      await repo.create(criarEpisodioValido('ep-3', { data_criacao: data3 }));

      const result = await repo.find({
        data_inicio: new Date('2024-03-01'),
        data_fim: new Date('2024-09-01')
      });

      expect(result.episodios.length).toBe(1);
      expect(result.episodios[0].id).toBe('ep-2');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 6: Paginação com cursor
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 6: Paginação com cursor', () => {
    test('Cursor permite paginação correta', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar 5 episódios com datas diferentes
      const base = Date.now();
      for (let i = 1; i <= 5; i++) {
        await repo.create(criarEpisodioValido(`ep-${i}`, {
          data_criacao: new Date(base + i * 1000) // 1 segundo de diferença
        }));
      }

      // Primeira página (limit=2)
      const page1 = await repo.find({ limit: 2 });
      expect(page1.episodios.length).toBe(2);
      expect(page1.next_cursor).toBeDefined();

      // Segunda página
      const page2 = await repo.find({ limit: 2, cursor: page1.next_cursor });
      expect(page2.episodios.length).toBe(2);
      expect(page2.next_cursor).toBeDefined();

      // Terceira página (última)
      const page3 = await repo.find({ limit: 2, cursor: page2.next_cursor });
      expect(page3.episodios.length).toBe(1);
      expect(page3.next_cursor).toBeUndefined();

      // Verificar que não há duplicatas entre páginas
      const allIds = [
        ...page1.episodios.map(e => e.id),
        ...page2.episodios.map(e => e.id),
        ...page3.episodios.map(e => e.id)
      ];
      const uniqueIds = [...new Set(allIds)];
      expect(uniqueIds.length).toBe(5);
    });

    test('Ordenação é por data decrescente (mais recente primeiro)', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      const base = Date.now();
      await repo.create(criarEpisodioValido('ep-antigo', {
        data_criacao: new Date(base)
      }));
      await repo.create(criarEpisodioValido('ep-recente', {
        data_criacao: new Date(base + 10000)
      }));

      const result = await repo.find({});

      expect(result.episodios[0].id).toBe('ep-recente');
      expect(result.episodios[1].id).toBe('ep-antigo');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 7: Limite máximo respeitado
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 7: Limite máximo respeitado', () => {
    test('Limite padrão é 20', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar 25 episódios
      for (let i = 1; i <= 25; i++) {
        await repo.create(criarEpisodioValido(`ep-${i}`));
      }

      const result = await repo.find({});

      expect(result.episodios.length).toBe(20);
      expect(result.next_cursor).toBeDefined();
    });

    test('Limite máximo é 100', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar 110 episódios
      for (let i = 1; i <= 110; i++) {
        await repo.create(criarEpisodioValido(`ep-${i}`));
      }

      const result = await repo.find({ limit: 500 }); // Pedindo mais que o máximo

      expect(result.episodios.length).toBe(100);
      expect(result.next_cursor).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 8: Índices persistem após reload
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 8: Índices persistem após reload', () => {
    test('Índices são reconstruídos corretamente após init()', async () => {
      // Criar repositório e popular
      const repo1 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo1.create(criarEpisodioValido('ep-1', {
        caso_uso: 1,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.CRIADO
      }));
      await repo1.create(criarEpisodioValido('ep-2', {
        caso_uso: 2,
        dominio: 'Operacional',
        estado: EstadoEpisodio.DECIDIDO
      }));

      // Criar novo repositório (simula restart)
      const repo2 = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Verificar que índices funcionam
      let result = await repo2.find({ caso_uso: 1 });
      expect(result.episodios.length).toBe(1);
      expect(result.episodios[0].id).toBe('ep-1');

      result = await repo2.find({ estado: EstadoEpisodio.DECIDIDO });
      expect(result.episodios.length).toBe(1);
      expect(result.episodios[0].id).toBe('ep-2');

      result = await repo2.find({ dominio: 'financeiro' });
      expect(result.episodios.length).toBe(1);
      expect(result.episodios[0].id).toBe('ep-1');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 9: getByIds funciona corretamente
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 9: getByIds (batch lookup)', () => {
    test('getByIds retorna Map com episódios corretos', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { dominio: 'Dom1' }));
      await repo.create(criarEpisodioValido('ep-2', { dominio: 'Dom2' }));
      await repo.create(criarEpisodioValido('ep-3', { dominio: 'Dom3' }));

      const result = await repo.getByIds(['ep-1', 'ep-3', 'ep-inexistente']);

      expect(result.size).toBe(2);
      expect(result.get('ep-1')?.dominio).toBe('Dom1');
      expect(result.get('ep-3')?.dominio).toBe('Dom3');
      expect(result.has('ep-inexistente')).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 10: MemoryQueryService usa índices via find()
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 10: MemoryQueryService com índices', () => {
    test('Consulta combinada com filtros e perfil_risco', async () => {
      const episodioRepo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);
      const decisaoRepo = await DecisaoRepositoryImpl.create(TEST_DATA_DIR);
      const contratoRepo = await ContratoRepositoryImpl.create(TEST_DATA_DIR);
      const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);

      // Criar episódios
      await episodioRepo.create(criarEpisodioValido('ep-1', { caso_uso: 1, dominio: 'Financeiro' }));
      await episodioRepo.create(criarEpisodioValido('ep-2', { caso_uso: 1, dominio: 'Financeiro' }));
      await episodioRepo.create(criarEpisodioValido('ep-3', { caso_uso: 2, dominio: 'Operacional' }));

      // Criar decisões com diferentes perfis de risco
      await decisaoRepo.create(criarDecisaoValida('dec-1', 'ep-1', PerfilRisco.CONSERVADOR));
      await decisaoRepo.create(criarDecisaoValida('dec-2', 'ep-2', PerfilRisco.AGRESSIVO));

      // Buscar caso_uso=1 com perfil CONSERVADOR
      const result = await memoryService.find({
        caso_uso: 1,
        perfil_risco: PerfilRisco.CONSERVADOR
      });

      expect(result.hits.length).toBe(1);
      expect(result.hits[0].episodio_id).toBe('ep-1');
      expect(result.hits[0].perfil_risco).toBe(PerfilRisco.CONSERVADOR);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 11: Performance - validação determinística de uso de índices
  // (INCREMENTO 2.1: sem asserts de tempo absoluto para estabilidade em CI)
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 11: Performance com muitos registros', () => {
    test('find() usa índices e reduz candidatos significativamente', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar 500 episódios com distribuição controlada:
      // - caso_uso 1: 100 (20%)
      // - caso_uso 2-5: 400 (80%)
      // - estado DECIDIDO: 250 (50%)
      // - estado CRIADO: 250 (50%)
      // - domínio "Financeiro": 125 (25%)
      // - outros domínios: 375 (75%)
      //
      // Intersecção esperada para caso_uso=1, estado=DECIDIDO, dominio=Financeiro:
      // ~100 * 0.5 * 0.25 = ~12-13 episódios

      const dominios = ['Financeiro', 'Operacional', 'Técnico', 'Estratégico'];

      for (let i = 0; i < 500; i++) {
        await repo.create(criarEpisodioValido(`ep-${i}`, {
          caso_uso: i < 100 ? 1 : ((i % 4) + 2), // 100 com caso_uso=1, resto distribuído em 2-5
          dominio: dominios[i % 4],
          estado: i % 2 === 0 ? EstadoEpisodio.DECIDIDO : EstadoEpisodio.CRIADO
        }));
      }

      // Consulta com filtros que usam todos os índices
      const result = await repo.find({
        caso_uso: 1,
        dominio: 'Financeiro',
        estado: EstadoEpisodio.DECIDIDO,
        limit: 20
      });

      // Obter debug stats
      const stats = (repo as any)._debugIndexStats();

      // ══════════════════════════════════════════════════════════════════════
      // VALIDAÇÕES DETERMINÍSTICAS (sem tempo absoluto)
      // ══════════════════════════════════════════════════════════════════════

      // 1. Verificar que os índices foram usados
      expect(stats).not.toBeNull();
      expect(stats.usedIndexCasoUso).toBe(true);
      expect(stats.usedIndexEstado).toBe(true);
      expect(stats.usedIndexDominio).toBe(true);
      expect(stats.usedOrderedByDataIndex).toBe(true);

      // 2. Verificar que temos 500 registros no total
      expect(stats.totalIds).toBe(500);

      // 3. Verificar que os índices reduziram significativamente os candidatos
      // Com caso_uso=1: ~100 episódios
      // Com caso_uso=1 + estado=DECIDIDO: ~50 episódios
      // Com caso_uso=1 + estado=DECIDIDO + dominio=Financeiro: ~12 episódios
      // A intersecção deve ser MUITO menor que o total
      expect(stats.candidatesAfterIndexes).toBeLessThan(50);
      expect(stats.candidatesBeforeDateFilter).toBeLessThan(50);

      // 4. Verificar que o resultado é significativamente menor que o total
      // Isso prova que os índices estão fazendo seu trabalho
      const reducaoPercentual = (1 - stats.candidatesAfterIndexes / stats.totalIds) * 100;
      expect(reducaoPercentual).toBeGreaterThan(90); // >90% de redução

      // ══════════════════════════════════════════════════════════════════════
      // VALIDAÇÕES FUNCIONAIS (corretude)
      // ══════════════════════════════════════════════════════════════════════

      // 5. Verificar que os resultados estão corretos
      expect(result.episodios.length).toBeLessThanOrEqual(20);
      expect(result.episodios.every(e => e.caso_uso === 1)).toBe(true);
      expect(result.episodios.every(e => e.dominio.toLowerCase().includes('financeiro'))).toBe(true);
      expect(result.episodios.every(e => e.estado === EstadoEpisodio.DECIDIDO)).toBe(true);

      // 6. Verificar ordenação (mais recente primeiro)
      for (let i = 1; i < result.episodios.length; i++) {
        const current = result.episodios[i].data_criacao.getTime();
        const previous = result.episodios[i - 1].data_criacao.getTime();
        expect(current).toBeLessThanOrEqual(previous);
      }

      // 7. Verificar que não há duplicação
      const ids = result.episodios.map(e => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }, 30000); // Timeout de 30s para setup com muitos registros

    test('find() sem filtros indexados não usa índices de filtro', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      // Criar alguns episódios
      for (let i = 0; i < 50; i++) {
        await repo.create(criarEpisodioValido(`ep-${i}`));
      }

      // Consulta sem filtros indexados (apenas limit)
      await repo.find({ limit: 10 });

      const stats = (repo as any)._debugIndexStats();

      // Nenhum índice de filtro foi usado
      expect(stats.usedIndexCasoUso).toBe(false);
      expect(stats.usedIndexEstado).toBe(false);
      expect(stats.usedIndexDominio).toBe(false);

      // Mas o índice de ordenação por data sempre é usado
      expect(stats.usedOrderedByDataIndex).toBe(true);

      // Candidatos = total (sem redução por índices)
      expect(stats.candidatesAfterIndexes).toBe(50);
      expect(stats.totalIds).toBe(50);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // TESTE 12: Garantias do Incremento 1 preservadas
  // ══════════════════════════════════════════════════════════════════════

  describe('TESTE 12: Garantias do Incremento 1 preservadas', () => {
    test('DELETE ainda não existe', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      expect((repo as any).delete).toBeUndefined();
      expect((repo as any).remove).toBeUndefined();
    });

    test('Transições de estado ainda são validadas', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { estado: EstadoEpisodio.CRIADO }));

      // Transição inválida: CRIADO → ENCERRADO
      await expect(
        repo.updateEstado('ep-1', EstadoEpisodio.ENCERRADO)
      ).rejects.toThrow('Transição inválida');
    });

    test('Clone não expõe referência interna', async () => {
      const repo = await EpisodioRepositoryImpl.create(TEST_DATA_DIR);

      await repo.create(criarEpisodioValido('ep-1', { dominio: 'Original' }));

      const ep1 = await repo.getById('ep-1');
      ep1!.dominio = 'Modificado';

      const ep2 = await repo.getById('ep-1');
      expect(ep2!.dominio).toBe('Original');
    });
  });
});
