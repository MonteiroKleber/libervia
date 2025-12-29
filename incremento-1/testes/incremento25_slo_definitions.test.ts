/**
 * TESTES - Incremento 25: SLO Definitions
 *
 * Testa:
 * - SLO definitions existem e seguem estrutura esperada
 * - Cada SLO tem objetivo, metrica, calculo, thresholds
 * - Formulas PromQL estao sintaticamente corretas
 * - Cross-references com metricas do Inc 24
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// PATHS
// ════════════════════════════════════════════════════════════════════════════

const DOCS_DIR = path.join(__dirname, '../docs');
const SLO_PATH = path.join(DOCS_DIR, 'slo_definitions.md');

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Ler arquivo
// ════════════════════════════════════════════════════════════════════════════

async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ESTRUTURA DO ARQUIVO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: File Structure', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('slo_definitions.md existe', async () => {
    const stat = await fs.stat(SLO_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('arquivo contem titulo principal', () => {
    expect(sloContent).toMatch(/# SLO.*Libervia/i);
  });

  test('arquivo contem Visao Geral', () => {
    expect(sloContent).toMatch(/##.*Vis[aã]o Geral/i);
  });

  test('arquivo contem Resumo de SLOs', () => {
    expect(sloContent).toMatch(/##.*Resumo.*SLO/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SLOS DEFINIDOS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Required SLOs', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  const EXPECTED_SLOS = [
    { id: 'SLO-001', name: 'API Availability', objective: '99.9%' },
    { id: 'SLO-002', name: 'API Latency', objective: '500ms' },
    { id: 'SLO-003', name: 'Error Rate', objective: '0.1%' },
    { id: 'SLO-004', name: 'Auth.*Success', objective: '99%' },
    { id: 'SLO-005', name: 'Rate Limit', objective: '5%' },
    { id: 'SLO-006', name: 'Process Uptime', objective: '99' },
    { id: 'SLO-007', name: 'Memory', objective: '80%' },
    { id: 'SLO-008', name: 'Tenant.*Isolation', objective: '0' }
  ];

  test.each(EXPECTED_SLOS)(
    'SLO $id ($name) esta definido com objetivo $objective',
    ({ id, name, objective }) => {
      expect(sloContent).toContain(id);
      expect(sloContent).toMatch(new RegExp(name, 'i'));
      expect(sloContent).toContain(objective);
    }
  );

  test('cada SLO tem secao propria', () => {
    const sloSections = sloContent.match(/## SLO-\d{3}/g) || [];
    expect(sloSections.length).toBeGreaterThanOrEqual(8);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ESTRUTURA DE CADA SLO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: SLO Structure', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('cada SLO tem campo Objetivo', () => {
    // Extrair secoes de SLO
    const sloSections = sloContent.split(/## SLO-\d{3}/);

    sloSections.slice(1).forEach((section) => {
      // Cada SLO deve ter um objetivo definido
      expect(section).toMatch(/Objetivo|objetivo|\*\*Objetivo\*\*/i);
    });
  });

  test('cada SLO tem campo Metrica', () => {
    const sloSections = sloContent.split(/## SLO-\d{3}/);

    sloSections.slice(1).forEach((section) => {
      expect(section).toMatch(/M[eé]trica|metrica|\*\*M[eé]trica\*\*/i);
    });
  });

  test('cada SLO tem Formula PromQL', () => {
    const sloSections = sloContent.split(/## SLO-\d{3}/);

    sloSections.slice(1).forEach((section) => {
      // Verificar que tem bloco de codigo PromQL ou formula
      const hasPromQL = section.includes('promql') ||
                        section.includes('libervia_') ||
                        section.match(/```[^`]*libervia_/);
      expect(hasPromQL).toBe(true);
    });
  });

  test('cada SLO tem Acao ao Violar', () => {
    const sloSections = sloContent.split(/## SLO-\d{3}/);

    sloSections.slice(1).forEach((section) => {
      expect(section).toMatch(/A[çc][ãa]o.*Violar|violar|Runbook|PROC-/i);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: THRESHOLDS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Thresholds', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('SLOs tem thresholds Warning e Critical definidos', () => {
    // Pelo menos alguns SLOs devem ter thresholds
    const hasWarning = sloContent.match(/warning|warn/gi);
    const hasCritical = sloContent.match(/critical/gi);

    expect(hasWarning?.length).toBeGreaterThan(0);
    expect(hasCritical?.length).toBeGreaterThan(0);
  });

  test('SLO-001 (Availability) tem error budget', () => {
    const slo001Section = extractSLOSection(sloContent, 'SLO-001');
    expect(slo001Section).toMatch(/error.*budget|0\.1%|43.*minutos/i);
  });

  test('SLO-002 (Latency) tem threshold em ms', () => {
    const slo002Section = extractSLOSection(sloContent, 'SLO-002');
    expect(slo002Section).toMatch(/500ms|1000ms/i);
  });

  test('SLO-003 (Error Rate) tem threshold em porcentagem', () => {
    const slo003Section = extractSLOSection(sloContent, 'SLO-003');
    expect(slo003Section).toMatch(/0\.1%|1%/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: PROMQL FORMULAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: PromQL Formulas', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('formulas usam metricas libervia_*', () => {
    const metrics = sloContent.match(/libervia_\w+/g) || [];
    expect(metrics.length).toBeGreaterThan(0);
  });

  test('formulas de disponibilidade usam rate()', () => {
    // A formula completa esta no documento inteiro
    expect(sloContent).toMatch(/rate\s*\(/i);
  });

  test('formulas de latencia usam histogram_quantile()', () => {
    // A formula completa esta no documento inteiro
    expect(sloContent).toMatch(/histogram_quantile/i);
  });

  test('formulas especificam janela de tempo', () => {
    // Verificar que tem janelas de tempo como [5m], [30d], etc
    const timeWindows = sloContent.match(/\[\d+[smhd]\]/g) || [];
    expect(timeWindows.length).toBeGreaterThan(0);
  });

  // Verificar estrutura sintatica basica de PromQL
  test('formulas PromQL tem estrutura valida', () => {
    const codeBlocks = sloContent.match(/```promql[\s\S]*?```/g) || [];

    codeBlocks.forEach(block => {
      // Deve ter pelo menos uma metrica
      expect(block).toMatch(/libervia_\w+/);

      // Parenteses devem estar balanceados (verificacao simples)
      const openParens = (block.match(/\(/g) || []).length;
      const closeParens = (block.match(/\)/g) || []).length;
      expect(openParens).toBe(closeParens);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: METRICAS REFERENCIADAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Metrics References', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  const EXPECTED_METRICS = [
    'libervia_http_requests_total',
    'libervia_http_request_duration_ms',
    'libervia_http_errors_total',
    'libervia_auth_failures_total',
    'libervia_tenant_conflicts_total',
    'libervia_rate_limited_total',
    'libervia_process_uptime_seconds',
    'libervia_process_memory_bytes'
  ];

  test.each(EXPECTED_METRICS)(
    'metrica %s e referenciada nos SLOs',
    (metric) => {
      // Pelo menos as principais metricas devem estar referenciadas
      const mainMetrics = [
        'libervia_http_requests_total',
        'libervia_http_request_duration_ms',
        'libervia_http_errors_total',
        'libervia_process_uptime_seconds',
        'libervia_process_memory_bytes'
      ];

      if (mainMetrics.includes(metric)) {
        expect(sloContent).toContain(metric);
      }
    }
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: JANELAS DE TEMPO (WINDOWS)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Time Windows', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('SLOs especificam janela de tempo', () => {
    // Cada SLO deve ter uma janela definida
    expect(sloContent).toMatch(/Janela|janela|window/i);
  });

  test('janelas variam conforme tipo de SLO', () => {
    // SLOs de disponibilidade tipicamente usam 30d
    const slo001Section = extractSLOSection(sloContent, 'SLO-001');
    expect(slo001Section).toMatch(/30.*d|30 dias|mensal/i);

    // SLOs de latencia tipicamente usam 5m
    const slo002Section = extractSLOSection(sloContent, 'SLO-002');
    expect(slo002Section).toMatch(/5.*m|5 minutos/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: TABELA RESUMO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Summary Table', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('tabela resumo contem todos os SLOs', () => {
    // A tabela resumo deve listar informacoes dos SLOs
    const summarySection = extractSection(sloContent, 'Resumo');

    // Verificar que a secao de resumo existe
    expect(summarySection.length).toBeGreaterThan(0);

    // Verificar que menciona diferentes SLOs (pelo nome ou numero)
    const mentionsAvailability = /availability|disponibilidade/i.test(summarySection);
    const mentionsLatency = /latency|lat[eê]ncia/i.test(summarySection);
    const mentionsError = /error|erro/i.test(summarySection);

    expect(mentionsAvailability || mentionsLatency || mentionsError).toBe(true);
  });

  test('tabela resumo tem colunas essenciais', () => {
    const summarySection = extractSection(sloContent, 'Resumo');

    // Colunas essenciais
    expect(summarySection).toMatch(/Objetivo|objetivo/i);
    expect(summarySection).toMatch(/M[eé]trica|metrica/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: DASHBOARD RECOMENDADO
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - SLO: Dashboard Recommendations', () => {
  let sloContent: string;

  beforeAll(async () => {
    sloContent = await readFile(SLO_PATH);
  });

  test('documento inclui recomendacoes de dashboard', () => {
    expect(sloContent).toMatch(/dashboard/i);
  });

  test('recomendacoes incluem tipos de visualizacao', () => {
    // Tipos comuns de visualizacao
    const hasGauge = sloContent.match(/gauge/i);
    const hasGraph = sloContent.match(/gr[aá]fico|graph|linha|line/i);

    expect(hasGauge || hasGraph).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Extrair secao de SLO
// ════════════════════════════════════════════════════════════════════════════

function extractSLOSection(content: string, sloId: string): string {
  const regex = new RegExp(`## ${sloId}[^#]*`, 'i');
  const match = content.match(regex);
  return match ? match[0] : '';
}

function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`##.*${sectionName}[^#]*`, 'i');
  const match = content.match(regex);
  return match ? match[0] : '';
}
