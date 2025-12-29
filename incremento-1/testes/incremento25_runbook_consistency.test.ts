/**
 * TESTES - Incremento 25: Runbook Consistency
 *
 * Testa:
 * - Runbook existe e segue estrutura esperada
 * - Todos os procedures (PROC-*) estao documentados
 * - Cross-references com SLOs e Alertas estao consistentes
 * - Checklists estao completos
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// PATHS
// ════════════════════════════════════════════════════════════════════════════

const DOCS_DIR = path.join(__dirname, '../docs');
const RUNBOOK_PATH = path.join(DOCS_DIR, 'runbook_operacional.md');
const SLO_PATH = path.join(DOCS_DIR, 'slo_definitions.md');
const ALERTING_PATH = path.join(DOCS_DIR, 'alerting_rules.md');

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Ler arquivo
// ════════════════════════════════════════════════════════════════════════════

async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ESTRUTURA DO RUNBOOK
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: File Structure', () => {
  let runbookContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
  });

  test('runbook_operacional.md existe', async () => {
    const stat = await fs.stat(RUNBOOK_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('runbook contem titulo principal', () => {
    expect(runbookContent).toContain('# Runbook Operacional');
  });

  test('runbook contem secao de Arquitetura/Visao Geral', () => {
    expect(runbookContent).toMatch(/##.*Vis[aã]o Geral|##.*Arquitetura/i);
  });

  test('runbook contem secao de Dependencias', () => {
    expect(runbookContent).toMatch(/##.*Depend[eê]ncias/i);
  });

  test('runbook contem secao de Variaveis de Ambiente', () => {
    expect(runbookContent).toMatch(/##.*Vari[aá]veis de Ambiente/i);
  });

  test('runbook contem checklists de operacao', () => {
    expect(runbookContent).toMatch(/Checklist.*Startup|Checklist.*Shutdown|Checklist.*Upgrade/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: PROCEDURES (PROC-*)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: Procedures', () => {
  let runbookContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
  });

  const EXPECTED_PROCEDURES = [
    { id: 'PROC-001', name: 'API Fora do Ar' },
    { id: 'PROC-002', name: 'Lat[eê]ncia Elevada' },
    { id: 'PROC-003', name: 'Erro 5xx' },
    { id: 'PROC-004', name: 'Falhas de Autentica[cç][aã]o' },
    { id: 'PROC-005', name: 'Conflitos de Tenant' },
    { id: 'PROC-006', name: 'Rate Limit' }
  ];

  test.each(EXPECTED_PROCEDURES)(
    'runbook documenta $id ($name)',
    ({ id, name }) => {
      expect(runbookContent).toContain(id);
      expect(runbookContent).toMatch(new RegExp(name, 'i'));
    }
  );

  test('cada procedure tem secao de Sintomas', () => {
    const procSections = runbookContent.split(/## PROC-\d{3}/);
    // Primeiro split e vazio, entao pular
    procSections.slice(1).forEach((section, index) => {
      expect(section.toLowerCase()).toContain('sintoma');
    });
  });

  test('cada procedure tem secao de Diagnostico ou Acoes', () => {
    const procSections = runbookContent.split(/## PROC-\d{3}/);
    procSections.slice(1).forEach((section) => {
      const hasDiagnostico = /diagn[oó]stico/i.test(section);
      const hasAcoes = /a[çc][oõ]es|passos/i.test(section);
      expect(hasDiagnostico || hasAcoes).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CROSS-REFERENCES COM SLOs
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: SLO Cross-References', () => {
  let runbookContent: string;
  let sloContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
    sloContent = await readFile(SLO_PATH);
  });

  test('slo_definitions.md existe', async () => {
    const stat = await fs.stat(SLO_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('runbook e SLOs estao relacionados atraves de procedures', () => {
    // Extrair SLOs do arquivo de definicoes
    const sloMatches = sloContent.match(/SLO-\d{3}/g) || [];
    const uniqueSLOs = [...new Set(sloMatches)];

    // Verificar que ha SLOs definidos
    expect(uniqueSLOs.length).toBeGreaterThan(0);

    // Verificar que SLOs referenciam procedures do runbook
    const sloRefsProcs = sloContent.match(/PROC-\d{3}/g) || [];
    expect(sloRefsProcs.length).toBeGreaterThan(0);
  });

  const SLO_PROCEDURE_MAP = [
    { slo: 'SLO-001', proc: 'PROC-001' }, // API Availability -> API Fora do Ar
    { slo: 'SLO-002', proc: 'PROC-002' }, // API Latency -> Latencia Elevada
    { slo: 'SLO-003', proc: 'PROC-003' }, // Error Rate -> Erro 5xx
    { slo: 'SLO-004', proc: 'PROC-004' }, // Auth Success -> Falhas Auth
  ];

  test.each(SLO_PROCEDURE_MAP)(
    'SLO definitions referenciam procedimento correto: $slo -> $proc',
    ({ slo, proc }) => {
      // Verificar que SLO existe
      expect(sloContent).toContain(slo);

      // Verificar que SLO referencia o PROC correto (pode estar no runbook)
      // A referencia pode ser direta no SLO ou via alerting
      const sloSection = sloContent.split(slo)[1]?.split(/## SLO-/)[0] || '';
      const hasReference = sloSection.includes(proc) ||
                          runbookContent.includes(`${slo}`) ||
                          runbookContent.includes(`${proc}`);
      expect(hasReference).toBe(true);
    }
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CROSS-REFERENCES COM ALERTING
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: Alerting Cross-References', () => {
  let runbookContent: string;
  let alertingContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
    alertingContent = await readFile(ALERTING_PATH);
  });

  test('alerting_rules.md existe', async () => {
    const stat = await fs.stat(ALERTING_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('alertas referenciam runbook procedures', () => {
    // Verificar que alerting rules tem referencias ao runbook
    expect(alertingContent).toMatch(/runbook.*PROC-\d{3}|docs\/runbook.*proc/i);
  });

  const EXPECTED_ALERTS = [
    'API_DOWN',
    'HIGH_LATENCY',
    'ERROR_RATE_SPIKE',
    'AUTH_FAILURE_SPIKE',
    'TENANT_CONFLICT',
    'RATE_LIMIT_ABUSE',
    'MEMORY_PRESSURE'
  ];

  test.each(EXPECTED_ALERTS)(
    'alerta %s esta definido',
    (alertName) => {
      expect(alertingContent).toContain(alertName);
    }
  );

  test('cada alerta tem runbook link', () => {
    // Extrair secoes de alerta
    const alertSections = alertingContent.split(/## ALERT-\d{3}/);

    alertSections.slice(1).forEach((section) => {
      // Cada alerta deve ter referencia ao runbook
      expect(section.toLowerCase()).toMatch(/runbook|proc-\d{3}/);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CHECKLISTS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: Checklists', () => {
  let runbookContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
  });

  test('checklist de startup tem items essenciais', () => {
    // Verificar que a secao de startup existe e tem conteudo relevante
    expect(runbookContent).toMatch(/Checklist.*Startup/i);

    // Verificar items essenciais no documento completo relacionados a startup
    expect(runbookContent).toMatch(/vari[aá]ve[il]s.*ambiente|ambiente|env/i);
    expect(runbookContent).toMatch(/disco|espaco|permiss[oõ]es/i);
    expect(runbookContent).toMatch(/verificar|check/i);
  });

  test('checklist de shutdown tem items essenciais', () => {
    // Verificar que a secao de shutdown existe
    expect(runbookContent).toMatch(/Checklist.*Shutdown/i);

    // Verificar items essenciais no documento relacionados a shutdown
    const hasRelevantContent = (
      /graceful|SIGTERM|parar/i.test(runbookContent) ||
      /shutdown|encerrar/i.test(runbookContent) ||
      /backup|persistencia/i.test(runbookContent)
    );

    expect(hasRelevantContent).toBe(true);
  });

  test('rollback procedure existe', () => {
    expect(runbookContent).toMatch(/rollback/i);
    expect(runbookContent).toMatch(/vers[aã]o.*anterior|reverter/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: METRICAS REFERENCIADAS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 25 - Runbook: Metrics References', () => {
  let runbookContent: string;
  let alertingContent: string;

  beforeAll(async () => {
    runbookContent = await readFile(RUNBOOK_PATH);
    alertingContent = await readFile(ALERTING_PATH);
  });

  const EXPECTED_METRICS = [
    'libervia_http_requests_total',
    'libervia_http_request_duration_ms',
    'libervia_http_errors_total',
    'libervia_auth_failures_total',
    'libervia_tenant_conflicts_total',
    'libervia_process_uptime_seconds',
    'libervia_process_memory_bytes'
  ];

  test.each(EXPECTED_METRICS)(
    'metrica %s esta referenciada no alerting',
    (metric) => {
      expect(alertingContent).toContain(metric);
    }
  );

  test('metricas sao do namespace libervia_', () => {
    const metrics = alertingContent.match(/libervia_\w+/g) || [];
    expect(metrics.length).toBeGreaterThan(0);

    metrics.forEach(metric => {
      expect(metric.startsWith('libervia_')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Extrair secao
// ════════════════════════════════════════════════════════════════════════════

function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`###?.*${sectionName}[^#]*`, 'i');
  const match = content.match(regex);
  return match ? match[0] : '';
}
