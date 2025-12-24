/**
 * TESTES - CAMADA 6: Isolamento de Tenants (CRITICO)
 *
 * Verifica que dados de um tenant NAO vazam para outro.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { TenantRegistry } from '../../tenant/TenantRegistry';
import { TenantRuntime, CoreInstance } from '../../tenant/TenantRuntime';
import { StatusSituacao, EstadoEpisodio } from '../../camada-3/entidades/tipos';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-tenant-isolation-' + Date.now();

let registry: TenantRegistry;
let runtime: TenantRuntime;
let instanceA: CoreInstance;
let instanceB: CoreInstance;

// Helper para criar uma SituacaoDecisoria valida
// Core exige no minimo 2 alternativas
function criarSituacao(id: string, contexto: string): any {
  return {
    id,
    dominio: 'teste',
    contexto,
    objetivo: 'Testar isolamento',
    incertezas: ['incerteza1'],
    alternativas: [
      { descricao: 'Alternativa 1', riscos_associados: ['risco1'] },
      { descricao: 'Alternativa 2', riscos_associados: ['risco2'] }
    ],
    riscos: [{ descricao: 'Risco 1', tipo: 'operacional', reversibilidade: 'alta' }],
    urgencia: 'baixa',
    capacidade_absorcao: 'alta',
    consequencia_relevante: 'baixa',
    possibilidade_aprendizado: true,
    status: StatusSituacao.RASCUNHO,
    data_criacao: new Date(),
    caso_uso_declarado: 1,
    anexos_analise: []
  };
}

beforeAll(async () => {
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });

  // Criar registry e runtime
  registry = await TenantRegistry.create(TEST_BASE_DIR);
  runtime = TenantRuntime.create(registry);

  // Registrar dois tenants
  await registry.register({ id: 'tenant-a', name: 'Tenant A' });
  await registry.register({ id: 'tenant-b', name: 'Tenant B' });

  // Obter instancias
  instanceA = await runtime.getOrCreate('tenant-a');
  instanceB = await runtime.getOrCreate('tenant-b');
});

afterAll(async () => {
  await runtime.shutdownAll();
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// ISOLAMENTO DE DADOS
// ════════════════════════════════════════════════════════════════════════════

describe('Isolamento de Dados entre Tenants', () => {
  test('tenants tem dataDirs diferentes', () => {
    expect(instanceA.dataDir).not.toBe(instanceB.dataDir);
    expect(instanceA.dataDir).toContain('tenant-a');
    expect(instanceB.dataDir).toContain('tenant-b');
  });

  test('tenants tem orquestradores diferentes', () => {
    expect(instanceA.orquestrador).not.toBe(instanceB.orquestrador);
  });

  test('tenants tem eventLogs diferentes', () => {
    expect(instanceA.eventLog).not.toBe(instanceB.eventLog);
  });

  test('situacao criada em A nao aparece em B', async () => {
    // Criar situacao em A
    const situacaoA = criarSituacao('sit-a-' + Date.now(), 'Contexto secreto de A');
    const episodioA = await instanceA.orquestrador.ProcessarSolicitacao(situacaoA);

    // Verificar que episodio foi criado
    expect(episodioA).toBeDefined();
    expect(episodioA.id).toBeDefined();
    const situacaoIdA = episodioA.situacao_referenciada;

    // Em B, criar situacao diferente
    const situacaoB = criarSituacao('sit-b-' + Date.now(), 'Contexto secreto de B');
    const episodioB = await instanceB.orquestrador.ProcessarSolicitacao(situacaoB);

    // Verificar que B tem sua propria situacao
    expect(episodioB).toBeDefined();
    expect(episodioB.situacao_referenciada).not.toBe(situacaoIdA);
  });

  test('episodios de A nao aparecem em B', async () => {
    // Criar situacao e episodio em A
    const sitA = criarSituacao('ep-a-' + Date.now(), 'Dados secretos A');
    const episodioA = await instanceA.orquestrador.ProcessarSolicitacao(sitA);

    // Em B, criar situacao similar
    const sitB = criarSituacao('ep-b-' + Date.now(), 'Dados secretos B');
    const episodioB = await instanceB.orquestrador.ProcessarSolicitacao(sitB);

    // Episodios sao diferentes
    expect(episodioA.id).not.toBe(episodioB.id);

    // Verificar via EventLog que eventos estao separados
    const eventsA = await instanceA.eventLog.getAll();
    const eventsB = await instanceB.eventLog.getAll();

    // Eventos de A mencionam IDs de A, nao de B
    const eventIdsA = eventsA.map(e => e.entidade_id);
    const eventIdsB = eventsB.map(e => e.entidade_id);

    // Nenhum ID de B deve aparecer em A
    for (const idB of eventIdsB) {
      expect(eventIdsA).not.toContain(idB);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISOLAMENTO DE ARQUIVOS
// ════════════════════════════════════════════════════════════════════════════

describe('Isolamento de Arquivos', () => {
  test('arquivos sao criados apenas no diretorio do tenant', async () => {
    // Criar algo em A para garantir que arquivos existam
    const sit = criarSituacao('file-test-' + Date.now(), 'test');
    await instanceA.orquestrador.ProcessarSolicitacao(sit);

    // Verificar que situacoes.json existe em A
    const situacoesPathA = path.join(instanceA.dataDir, 'situacoes.json');
    const situacoesPathB = path.join(instanceB.dataDir, 'situacoes.json');

    expect(situacoesPathA).not.toBe(situacoesPathB);

    // Verificar que arquivo existe em A
    const statA = await fs.stat(situacoesPathA);
    expect(statA.isFile()).toBe(true);
  });

  test('EventLog usa segmentos separados por tenant', async () => {
    // Criar eventos em A
    await instanceA.eventLog.append(
      'Libervia',
      'TESTE_ISOLAMENTO_A',
      'TesteEntity',
      'test-a-1',
      { secret: 'A' }
    );

    // Criar eventos em B
    await instanceB.eventLog.append(
      'Libervia',
      'TESTE_ISOLAMENTO_B',
      'TesteEntity',
      'test-b-1',
      { secret: 'B' }
    );

    // Verificar que event-log dirs sao diferentes
    const eventLogDirA = path.join(instanceA.dataDir, 'event-log');
    const eventLogDirB = path.join(instanceB.dataDir, 'event-log');

    expect(eventLogDirA).not.toBe(eventLogDirB);

    // Verificar que ambos existem
    const statA = await fs.stat(eventLogDirA);
    const statB = await fs.stat(eventLogDirB);

    expect(statA.isDirectory()).toBe(true);
    expect(statB.isDirectory()).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISOLAMENTO DE EVENTLOG
// ════════════════════════════════════════════════════════════════════════════

describe('Isolamento de EventLog', () => {
  test('count de eventos e independente', async () => {
    const countA = await instanceA.eventLog.count();
    const countB = await instanceB.eventLog.count();

    // Adicionar evento apenas em A
    await instanceA.eventLog.append(
      'Libervia',
      'COUNT_TEST',
      'Test',
      'test-count-' + Date.now(),
      {}
    );

    const newCountA = await instanceA.eventLog.count();
    const newCountB = await instanceB.eventLog.count();

    // A aumentou, B ficou igual
    expect(newCountA).toBe(countA + 1);
    expect(newCountB).toBe(countB);
  });

  test('verifyChain e independente', async () => {
    const resultA = await instanceA.eventLog.verifyChain();
    const resultB = await instanceB.eventLog.verifyChain();

    // Ambos devem ser validos (nao importa o outro)
    expect(resultA.valid).toBe(true);
    expect(resultB.valid).toBe(true);
  });

  test('getAll retorna apenas eventos do tenant', async () => {
    // Criar evento unico em A
    const uniqueId = 'unique-' + Date.now();
    await instanceA.eventLog.append(
      'Libervia',
      'UNIQUE_EVENT',
      'UniqueEntity',
      uniqueId,
      { unique: true }
    );

    // Buscar em A - deve encontrar
    const eventsA = await instanceA.eventLog.getAll();
    const foundInA = eventsA.some(e => e.entidade_id === uniqueId);
    expect(foundInA).toBe(true);

    // Buscar em B - NAO deve encontrar
    const eventsB = await instanceB.eventLog.getAll();
    const foundInB = eventsB.some(e => e.entidade_id === uniqueId);
    expect(foundInB).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CENARIOS DE ATAQUE
// ════════════════════════════════════════════════════════════════════════════

describe('Prevencao de Ataques', () => {
  test('nao e possivel acessar tenant nao registrado', async () => {
    await expect(runtime.getOrCreate('nao-existe'))
      .rejects.toThrow('Tenant nao encontrado');
  });

  test('nao e possivel acessar tenant suspenso', async () => {
    // Registrar e suspender
    await registry.register({ id: 'suspended-tenant', name: 'Suspended' });
    await registry.suspend('suspended-tenant');

    await expect(runtime.getOrCreate('suspended-tenant'))
      .rejects.toThrow('Tenant nao esta ativo');
  });

  test('nao e possivel acessar tenant deletado', async () => {
    // Registrar e remover
    await registry.register({ id: 'deleted-tenant', name: 'Deleted' });
    await registry.remove('deleted-tenant');

    await expect(runtime.getOrCreate('deleted-tenant'))
      .rejects.toThrow('Tenant nao esta ativo');
  });

  test('shutdown de um tenant nao afeta outro', async () => {
    // Garantir que ambos estao ativos
    await runtime.getOrCreate('tenant-a');
    await runtime.getOrCreate('tenant-b');

    expect(runtime.isActive('tenant-a')).toBe(true);
    expect(runtime.isActive('tenant-b')).toBe(true);

    // Shutdown apenas A
    await runtime.shutdown('tenant-a');

    // A nao esta mais ativo
    expect(runtime.isActive('tenant-a')).toBe(false);

    // B continua ativo
    expect(runtime.isActive('tenant-b')).toBe(true);

    // Recriar A para proximos testes
    instanceA = await runtime.getOrCreate('tenant-a');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INTEGRIDADE POS-OPERACOES
// ════════════════════════════════════════════════════════════════════════════

describe('Integridade Pos-Operacoes', () => {
  test('apos multiplas operacoes, EventLogs continuam validos', async () => {
    // Fazer varias operacoes em ambos
    for (let i = 0; i < 5; i++) {
      const sitA = criarSituacao(`integ-a-${i}-${Date.now()}`, `contexto-${i}`);
      await instanceA.orquestrador.ProcessarSolicitacao(sitA);

      const sitB = criarSituacao(`integ-b-${i}-${Date.now()}`, `contexto-${i}`);
      await instanceB.orquestrador.ProcessarSolicitacao(sitB);
    }

    // Verificar integridade
    const resultA = await instanceA.eventLog.verifyChain();
    const resultB = await instanceB.eventLog.verifyChain();

    expect(resultA.valid).toBe(true);
    expect(resultB.valid).toBe(true);
  });

  test('totais de eventos sao consistentes e independentes', async () => {
    const countA = await instanceA.eventLog.count();
    const countB = await instanceB.eventLog.count();

    // Cada tenant tem sua propria contagem
    // Nao precisam ser iguais
    expect(typeof countA).toBe('number');
    expect(typeof countB).toBe('number');
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBeGreaterThan(0);
  });
});
