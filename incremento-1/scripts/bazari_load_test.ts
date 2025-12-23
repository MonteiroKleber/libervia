#!/usr/bin/env ts-node

/**
 * ════════════════════════════════════════════════════════════════════════════
 * INCREMENTO 7: LOAD TEST BAZARI ADAPTER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Script de teste de carga para validar o BazariAdapter sob stress.
 *
 * Validacoes:
 * 1. Apenas contratos sao retornados (UNICA SAIDA)
 * 2. Estados do Orquestrador permanecem consistentes
 * 3. EventLog mantem integridade (verifyChain + replay)
 *
 * Uso:
 *   npm run bazari:load-test [N] [DATA_DIR]
 *   npm run bazari:load-test 100 ./data
 */

import * as fs from 'fs';
import * as path from 'path';
import { BazariAdapter, SituacaoInput, ContratoComMetadados, ProtocoloRejeitadoError } from '../integracoes/bazari/Adapter';
import { OrquestradorCognitivo } from '../orquestrador/OrquestradorCognitivo';
import { SituacaoRepositoryImpl } from '../repositorios/implementacao/SituacaoRepositoryImpl';
import { EpisodioRepositoryImpl } from '../repositorios/implementacao/EpisodioRepositoryImpl';
import { DecisaoRepositoryImpl } from '../repositorios/implementacao/DecisaoRepositoryImpl';
import { ContratoRepositoryImpl } from '../repositorios/implementacao/ContratoRepositoryImpl';
import { DecisionProtocolRepositoryImpl } from '../repositorios/implementacao/DecisionProtocolRepositoryImpl';
import { MemoryQueryService } from '../servicos/MemoryQueryService';
import { EventLogRepositoryImpl } from '../event-log/EventLogRepositoryImpl';
import { DadosProtocoloInput, PerfilRisco, ContratoDeDecisao } from '../entidades/tipos';

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURACAO
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_N = 100;
const DEFAULT_DATA_DIR = './data-load-test';

// ════════════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════════════

interface LoadTestResult {
  total_requisicoes: number;
  sucesso: number;
  falhas: number;
  taxa_sucesso: number;
  tempos_ms: number[];
  tempo_medio_ms: number;
  tempo_min_ms: number;
  tempo_max_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  contratos_retornados: number;
  dados_vazados: boolean;
  chain_valid: boolean;
  replay_deterministico: boolean;
  erros: string[];
}

interface RequestResult {
  sucesso: boolean;
  tempo_ms: number;
  contrato?: ContratoDeDecisao;
  erro?: string;
  dados_vazados: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// GERADORES DE DADOS
// ════════════════════════════════════════════════════════════════════════════

function gerarSituacaoAleatoria(index: number): SituacaoInput {
  const dominios = ['financeiro', 'operacional', 'estrategico', 'tecnologico', 'humano'];
  const urgencias = ['baixa', 'media', 'alta', 'critica'];
  const capacidades = ['baixa', 'media', 'alta'];

  return {
    dominio: dominios[index % dominios.length],
    contexto: `Contexto de teste para situacao ${index}`,
    objetivo: `Objetivo do teste ${index}: validar comportamento sob carga`,
    incertezas: [
      `Incerteza A-${index}`,
      `Incerteza B-${index}`
    ],
    alternativas: [
      {
        descricao: `Alternativa 1 para situacao ${index}`,
        riscos_associados: [`Risco A1-${index}`]
      },
      {
        descricao: `Alternativa 2 para situacao ${index}`,
        riscos_associados: [`Risco A2-${index}`]
      }
    ],
    riscos: [
      {
        descricao: `Risco principal da situacao ${index}`,
        tipo: 'operacional',
        reversibilidade: 'reversivel'
      }
    ],
    urgencia: urgencias[index % urgencias.length],
    capacidade_absorcao: capacidades[index % capacidades.length],
    consequencia_relevante: `Consequencia relevante para teste ${index}`,
    possibilidade_aprendizado: index % 2 === 0,
    caso_uso_declarado: 1
  };
}

function gerarProtocoloParaSituacao(situacao: SituacaoInput): DadosProtocoloInput {
  const perfis: PerfilRisco[] = [PerfilRisco.CONSERVADOR, PerfilRisco.MODERADO, PerfilRisco.AGRESSIVO];

  return {
    criterios_minimos: [
      'Criterio de viabilidade',
      'Criterio de risco aceitavel',
      'Criterio de alinhamento'
    ],
    riscos_considerados: situacao.riscos.map(r => r.descricao),
    limites_definidos: [
      { tipo: 'tempo', descricao: 'Prazo maximo', valor: '30 dias' },
      { tipo: 'custo', descricao: 'Orcamento', valor: '10000' }
    ],
    perfil_risco: perfis[Math.floor(Math.random() * perfis.length)],
    alternativas_avaliadas: situacao.alternativas.map(a => a.descricao),
    alternativa_escolhida: situacao.alternativas[0].descricao,
    memoria_consultada_ids: []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDADORES
// ════════════════════════════════════════════════════════════════════════════

function validarContrato(resultado: ContratoComMetadados): boolean {
  const c = resultado.contrato;

  // Verificar campos obrigatorios
  if (!c.id || !c.episodio_id || !c.decisao_id) return false;
  if (!c.alternativa_autorizada) return false;
  if (!c.data_emissao) return false;
  if (c.emitido_para !== 'Bazari') return false;

  // Verificar metadados
  const m = resultado.metadados;
  if (!m.request_id || !m.timestamp_solicitacao || !m.timestamp_emissao) return false;
  if (m.versao_contrato !== 'v1') return false;

  return true;
}

function verificarVazamentoDados(resultado: ContratoComMetadados): boolean {
  // Converter para JSON e verificar se ha campos internos vazados
  const json = JSON.stringify(resultado);

  // Lista de campos que NAO devem aparecer
  const camposProibidos = [
    'eventLog',
    'repositorio',
    'situacaoRepo',
    'episodioRepo',
    'decisaoRepo',
    'protocoloRepo',
    'memoryService',
    'errorBuffer',
    'degraded'
  ];

  for (const campo of camposProibidos) {
    if (json.includes(`"${campo}"`)) {
      return true; // Vazamento detectado
    }
  }

  return false; // Sem vazamento
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTOR DE TESTE
// ════════════════════════════════════════════════════════════════════════════

async function executarRequisicao(
  adapter: BazariAdapter,
  index: number
): Promise<RequestResult> {
  const inicio = Date.now();

  try {
    const situacao = gerarSituacaoAleatoria(index);
    const protocolo = gerarProtocoloParaSituacao(situacao);

    const resultado = await adapter.solicitarDecisao(situacao, protocolo);
    const fim = Date.now();

    // Validar resultado
    const contratoValido = validarContrato(resultado);
    const vazamento = verificarVazamentoDados(resultado);

    if (!contratoValido) {
      return {
        sucesso: false,
        tempo_ms: fim - inicio,
        erro: 'Contrato invalido',
        dados_vazados: vazamento
      };
    }

    return {
      sucesso: true,
      tempo_ms: fim - inicio,
      contrato: resultado.contrato,
      dados_vazados: vazamento
    };

  } catch (error) {
    const fim = Date.now();

    if (error instanceof ProtocoloRejeitadoError) {
      return {
        sucesso: false,
        tempo_ms: fim - inicio,
        erro: `Protocolo rejeitado: ${error.motivo}`,
        dados_vazados: false
      };
    }

    return {
      sucesso: false,
      tempo_ms: fim - inicio,
      erro: error instanceof Error ? error.message : String(error),
      dados_vazados: false
    };
  }
}

function calcularPercentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const sorted = [...valores].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const N = parseInt(args[0]) || DEFAULT_N;
  const DATA_DIR = args[1] || DEFAULT_DATA_DIR;

  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('LOAD TEST - BAZARI ADAPTER');
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log(`Data: ${new Date().toISOString()}`);
  console.log(`Requisicoes: ${N}`);
  console.log(`Data Dir: ${DATA_DIR}`);
  console.log('');

  // Limpar diretorio de teste
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Inicializar repositorios
  console.log('1. Inicializando repositorios...');
  const situacaoRepo = new SituacaoRepositoryImpl();
  const episodioRepo = new EpisodioRepositoryImpl();
  const decisaoRepo = new DecisaoRepositoryImpl();
  const contratoRepo = new ContratoRepositoryImpl();
  const protocoloRepo = new DecisionProtocolRepositoryImpl();
  const memoryService = new MemoryQueryService(episodioRepo, decisaoRepo, contratoRepo);
  const eventLog = new EventLogRepositoryImpl(DATA_DIR);

  // Criar orquestrador
  const orquestrador = new OrquestradorCognitivo(
    situacaoRepo,
    episodioRepo,
    decisaoRepo,
    contratoRepo,
    memoryService,
    protocoloRepo,
    eventLog
  );

  await orquestrador.init();
  console.log('   Orquestrador inicializado');

  // Criar adapter
  const adapter = new BazariAdapter(orquestrador);
  console.log('   Adapter criado');
  console.log('');

  // Executar requisicoes
  console.log('2. Executando requisicoes...');
  const resultados: RequestResult[] = [];
  const erros: string[] = [];

  const inicioTotal = Date.now();

  for (let i = 0; i < N; i++) {
    const resultado = await executarRequisicao(adapter, i);
    resultados.push(resultado);

    if (!resultado.sucesso && resultado.erro) {
      erros.push(`[${i}] ${resultado.erro}`);
    }

    // Progresso
    if ((i + 1) % 10 === 0 || i === N - 1) {
      const percent = Math.round(((i + 1) / N) * 100);
      process.stdout.write(`\r   Progresso: ${i + 1}/${N} (${percent}%)`);
    }
  }

  const fimTotal = Date.now();
  console.log('\n');

  // Calcular metricas
  console.log('3. Calculando metricas...');
  const tempos = resultados.map(r => r.tempo_ms);
  const sucessos = resultados.filter(r => r.sucesso);
  const contratosRetornados = resultados.filter(r => r.contrato).length;
  const vazamentos = resultados.filter(r => r.dados_vazados).length;

  const resultado: LoadTestResult = {
    total_requisicoes: N,
    sucesso: sucessos.length,
    falhas: N - sucessos.length,
    taxa_sucesso: (sucessos.length / N) * 100,
    tempos_ms: tempos,
    tempo_medio_ms: tempos.reduce((a, b) => a + b, 0) / tempos.length,
    tempo_min_ms: Math.min(...tempos),
    tempo_max_ms: Math.max(...tempos),
    p50_ms: calcularPercentil(tempos, 50),
    p95_ms: calcularPercentil(tempos, 95),
    p99_ms: calcularPercentil(tempos, 99),
    contratos_retornados: contratosRetornados,
    dados_vazados: vazamentos > 0,
    chain_valid: false,
    replay_deterministico: false,
    erros: erros.slice(0, 10) // Apenas primeiros 10 erros
  };

  // Verificar integridade do EventLog
  console.log('4. Verificando integridade do EventLog...');

  try {
    const chainResult = await eventLog.verifyChain();
    resultado.chain_valid = chainResult.valid;
    console.log(`   Chain valid: ${chainResult.valid}`);
    if (!chainResult.valid) {
      console.log(`   Motivo: ${chainResult.reason}`);
    }
  } catch (error) {
    console.log(`   Erro ao verificar chain: ${error}`);
  }

  // Verificar replay deterministico
  console.log('5. Verificando replay deterministico...');

  try {
    const replay1 = await eventLog.replay();
    const replay2 = await eventLog.replay();

    // Comparar replays
    resultado.replay_deterministico =
      replay1.totalEventos === replay2.totalEventos &&
      JSON.stringify(replay1.porEvento) === JSON.stringify(replay2.porEvento) &&
      JSON.stringify(replay1.porAtor) === JSON.stringify(replay2.porAtor);

    console.log(`   Replay deterministico: ${resultado.replay_deterministico}`);
    console.log(`   Total eventos: ${replay1.totalEventos}`);
  } catch (error) {
    console.log(`   Erro ao verificar replay: ${error}`);
  }

  console.log('');

  // Exibir resultados
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('RESULTADOS');
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Requisicoes:');
  console.log(`  Total: ${resultado.total_requisicoes}`);
  console.log(`  Sucesso: ${resultado.sucesso}`);
  console.log(`  Falhas: ${resultado.falhas}`);
  console.log(`  Taxa de Sucesso: ${resultado.taxa_sucesso.toFixed(2)}%`);
  console.log('');
  console.log('Tempos (ms):');
  console.log(`  Medio: ${resultado.tempo_medio_ms.toFixed(2)}`);
  console.log(`  Min: ${resultado.tempo_min_ms}`);
  console.log(`  Max: ${resultado.tempo_max_ms}`);
  console.log(`  P50: ${resultado.p50_ms}`);
  console.log(`  P95: ${resultado.p95_ms}`);
  console.log(`  P99: ${resultado.p99_ms}`);
  console.log('');
  console.log('Validacoes:');
  console.log(`  Contratos Retornados: ${resultado.contratos_retornados}`);
  console.log(`  Vazamento de Dados: ${resultado.dados_vazados ? 'SIM (FALHA!)' : 'NAO'}`);
  console.log(`  Chain Valida: ${resultado.chain_valid ? 'SIM' : 'NAO (FALHA!)'}`);
  console.log(`  Replay Deterministico: ${resultado.replay_deterministico ? 'SIM' : 'NAO (FALHA!)'}`);
  console.log('');

  if (resultado.erros.length > 0) {
    console.log('Primeiros erros:');
    resultado.erros.forEach(e => console.log(`  - ${e}`));
    console.log('');
  }

  // Tempo total
  console.log(`Tempo total: ${((fimTotal - inicioTotal) / 1000).toFixed(2)}s`);
  console.log('');

  // Status final
  const passou =
    resultado.taxa_sucesso === 100 &&
    !resultado.dados_vazados &&
    resultado.chain_valid &&
    resultado.replay_deterministico;

  console.log('════════════════════════════════════════════════════════════════════════════');
  if (passou) {
    console.log('STATUS: PASSOU');
  } else {
    console.log('STATUS: FALHOU');
    process.exitCode = 1;
  }
  console.log('════════════════════════════════════════════════════════════════════════════');

  // Salvar resultados em arquivo
  const resultadoPath = path.join(DATA_DIR, 'load-test-result.json');
  fs.writeFileSync(resultadoPath, JSON.stringify(resultado, null, 2));
  console.log(`\nResultados salvos em: ${resultadoPath}`);

  // Limpar diretorio de teste
  if (passou) {
    fs.rmSync(DATA_DIR, { recursive: true });
    console.log(`Diretorio de teste removido: ${DATA_DIR}`);
  }
}

main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
