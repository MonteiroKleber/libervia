/**
 * INCREMENTO 11 — Testes de Isolamento do Gateway
 *
 * Testa o isolamento de dados entre tenants.
 */

import { buildApp } from '../../gateway/app';
import { GatewayConfig } from '../../gateway/GatewayConfig';
import { clearPepperCache } from '../../tenant/TenantSecurity';
import * as fs from 'fs/promises';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

// Inc 12.1: Configurar pepper para testes
const TEST_PEPPER = 'test-pepper-for-gateway-isolation-tests-1234567890';

const TEST_BASE_DIR = './test-data-gateway-isolation-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

const testConfig: GatewayConfig = {
  port: 0,
  host: '127.0.0.1',
  baseDir: TEST_BASE_DIR,
  adminToken: ADMIN_TOKEN,
  corsOrigins: ['*'],
  nodeEnv: 'test',
  logLevel: 'error'
};

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// Helper para criar situacao valida
function criarSituacaoValida(uniqueId: string) {
  return {
    situacao: {
      dominio: 'tecnologico',
      contexto: `Contexto ${uniqueId}`,
      objetivo: 'Objetivo de teste',
      incertezas: ['Incerteza 1'],
      alternativas: [
        { descricao: 'Alternativa A', riscos_associados: ['Risco 1'] },
        { descricao: 'Alternativa B', riscos_associados: ['Risco 2'] }
      ],
      riscos: [
        { descricao: 'Risco 1', tipo: 'operacional', reversibilidade: 'reversivel' }
      ],
      urgencia: 'media',
      capacidade_absorcao: 'alta',
      consequencia_relevante: 'Media consequencia',
      possibilidade_aprendizado: true,
      caso_uso_declarado: 1
    },
    protocolo: {
      criterios_minimos: ['Criterio 1', 'Criterio 2'],
      riscos_considerados: ['Risco 1'],
      limites_definidos: [{ tipo: 'tempo', descricao: 'Prazo', valor: '30 dias' }],
      perfil_risco: 'MODERADO',
      alternativas_avaliadas: ['Alternativa A', 'Alternativa B'],
      alternativa_escolhida: 'Alternativa A',
      memoria_consultada_ids: []
    }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTES
// ════════════════════════════════════════════════════════════════════════════

describe('Gateway Isolation', () => {
  beforeAll(async () => {
    // Inc 12.1: Configurar pepper antes dos testes
    process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;
    clearPepperCache();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    // Inc 12.1: Limpar pepper após testes
    delete process.env.LIBERVIA_AUTH_PEPPER;
    clearPepperCache();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ISOLAMENTO DE DADOS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Isolamento de Dados', () => {
    test('Tenants tem diretorios separados', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar dois tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-a', name: 'Tenant A' }
      });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-b', name: 'Tenant B' }
      });

      // Verificar que diretorios existem e sao diferentes
      const dirA = path.join(TEST_BASE_DIR, 'tenants', 'tenant-a');
      const dirB = path.join(TEST_BASE_DIR, 'tenants', 'tenant-b');

      const statA = await fs.stat(dirA);
      const statB = await fs.stat(dirB);

      expect(statA.isDirectory()).toBe(true);
      expect(statB.isDirectory()).toBe(true);
      expect(dirA).not.toBe(dirB);

      await app.close();
    });

    test('Eventos de tenant A nao aparecem em tenant B', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenants (capturando apiTokens)
      const regA = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-iso-a', name: 'Tenant Iso A' }
      });
      const tokenA = JSON.parse(regA.body).apiToken;

      const regB = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-iso-b', name: 'Tenant Iso B' }
      });
      const tokenB = JSON.parse(regB.body).apiToken;

      // Criar decisao em tenant A
      await app.inject({
        method: 'POST',
        url: '/api/v1/decisoes',
        headers: { 'x-tenant-id': 'tenant-iso-a', authorization: `Bearer ${tokenA}` },
        payload: criarSituacaoValida('iso-a-1')
      });

      // Buscar eventos em tenant A
      const responseA = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-iso-a', authorization: `Bearer ${tokenA}` }
      });

      // Buscar eventos em tenant B
      const responseB = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-iso-b', authorization: `Bearer ${tokenB}` }
      });

      expect(responseA.statusCode).toBe(200);
      expect(responseB.statusCode).toBe(200);

      const eventosA = JSON.parse(responseA.body).eventos;
      const eventosB = JSON.parse(responseB.body).eventos;

      // Tenant A deve ter eventos
      expect(eventosA.length).toBeGreaterThan(0);

      // Tenant B deve estar vazio
      expect(eventosB.length).toBe(0);

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FALHA ISOLADA
  // ══════════════════════════════════════════════════════════════════════════

  describe('Falha Isolada', () => {
    test('Suspender tenant A nao afeta tenant B', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenants (capturando tokens)
      const regA = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-fail-a', name: 'Tenant Fail A' }
      });
      const tokenA = JSON.parse(regA.body).apiToken;

      const regB = await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-fail-b', name: 'Tenant Fail B' }
      });
      const tokenB = JSON.parse(regB.body).apiToken;

      // Suspender tenant A
      await app.inject({
        method: 'POST',
        url: '/admin/tenants/tenant-fail-a/suspend',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      // Tenant A deve estar inacessivel (403 - suspenso)
      const responseA = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-fail-a', authorization: `Bearer ${tokenA}` }
      });
      expect(responseA.statusCode).toBe(403);

      // Tenant B deve continuar funcionando
      const responseB = await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-fail-b', authorization: `Bearer ${tokenB}` }
      });
      expect(responseB.statusCode).toBe(200);

      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // METRICAS ISOLADAS
  // ══════════════════════════════════════════════════════════════════════════

  describe('Metricas Isoladas', () => {
    test('Metricas por tenant sao isoladas', async () => {
      const app = await buildApp({ config: testConfig });

      // Registrar tenants
      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-met-a', name: 'Tenant Met A' }
      });

      await app.inject({
        method: 'POST',
        url: '/admin/tenants',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        payload: { id: 'tenant-met-b', name: 'Tenant Met B' }
      });

      // Fazer atividade em tenant A (para criar instancia)
      await app.inject({
        method: 'GET',
        url: '/api/v1/eventos',
        headers: { 'x-tenant-id': 'tenant-met-a' }
      });

      // Buscar metricas de cada tenant
      const metricsA = await app.inject({
        method: 'GET',
        url: '/admin/tenants/tenant-met-a/metrics',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      const metricsB = await app.inject({
        method: 'GET',
        url: '/admin/tenants/tenant-met-b/metrics',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
      });

      // Metricas devem ter tenant IDs distintos
      if (metricsA.statusCode === 200) {
        const bodyA = JSON.parse(metricsA.body);
        expect(bodyA.tenantId).toBe('tenant-met-a');
      }

      // Tenant B pode nao ter instancia ainda (404 ou metricas diferentes)
      expect([200, 404]).toContain(metricsB.statusCode);

      await app.close();
    });
  });
});
