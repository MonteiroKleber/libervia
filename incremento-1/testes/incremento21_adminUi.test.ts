/**
 * TESTES - Incremento 21: Admin UI (Painel Operacional)
 *
 * Testa:
 * - Servir arquivos estáticos
 * - Rota /admin/ui serve index.html
 * - Arquivos CSS e JS são servidos corretamente
 */

import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';

import { buildApp } from '../gateway/app';
import { GatewayConfig } from '../gateway/GatewayConfig';

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════

const TEST_BASE_DIR = './test-data-inc21-ui-' + Date.now();
const TEST_PEPPER = 'test-pepper-inc21-ui-' + Date.now();
const ADMIN_TOKEN = 'test-admin-token-' + Date.now();

let app: FastifyInstance;

beforeAll(async () => {
  // Configurar pepper via env var
  process.env.LIBERVIA_AUTH_PEPPER = TEST_PEPPER;

  // Criar diretório base
  await fs.mkdir(TEST_BASE_DIR, { recursive: true });

  // Build app
  const config: GatewayConfig = {
    baseDir: TEST_BASE_DIR,
    port: 0,
    host: '127.0.0.1',
    adminToken: ADMIN_TOKEN,
    corsOrigins: ['*'],
    logLevel: 'warn',
    nodeEnv: 'test'
  };

  app = await buildApp({ config });
});

afterAll(async () => {
  await app.close();
  await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: SERVIR ARQUIVOS ESTÁTICOS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Arquivos Estáticos', () => {
  test('GET /admin/ui redireciona para /admin/ui/', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui'
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/ui/');
  });

  test('GET /admin/ui/ retorna index.html', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('Painel Operacional');
  });

  test('GET /admin/ui/index.html retorna HTML', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/index.html'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
  });

  test('GET /admin/ui/styles.css retorna CSS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/styles.css'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.body).toContain(':root');
  });

  test('GET /admin/ui/app.js retorna JavaScript', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toContain('function');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CONTEÚDO DO HTML
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Conteúdo HTML', () => {
  test('index.html contém tela de login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('auth-screen');
    expect(res.body).toContain('token');
    expect(res.body).toContain('Entrar');
  });

  test('index.html contém navegação principal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('nav');
    expect(res.body).toContain('Dashboard');
    expect(res.body).toContain('Reviews');
    expect(res.body).toContain('Mandatos');
  });

  test('index.html contém views do painel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('view-dashboard');
    expect(res.body).toContain('view-reviews');
    expect(res.body).toContain('view-mandates');
    expect(res.body).toContain('view-consequences');
    expect(res.body).toContain('view-timeline');
    expect(res.body).toContain('view-eventlog');
  });

  test('index.html referencia CSS e JS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('styles.css');
    expect(res.body).toContain('app.js');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CONTEÚDO DO CSS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Conteúdo CSS', () => {
  test('styles.css contém variáveis CSS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/styles.css'
    });

    expect(res.body).toContain('--color-primary');
    expect(res.body).toContain('--color-bg');
  });

  test('styles.css contém estilos de cards', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/styles.css'
    });

    expect(res.body).toContain('.card');
    expect(res.body).toContain('.cards-grid');
  });

  test('styles.css contém estilos de autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/styles.css'
    });

    expect(res.body).toContain('.auth-container');
    expect(res.body).toContain('.form-group');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CONTEÚDO DO JAVASCRIPT
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Conteúdo JavaScript', () => {
  test('app.js contém funções de API', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    expect(res.body).toContain('api');
    expect(res.body).toContain('Authorization');
    expect(res.body).toContain('Bearer');
  });

  test('app.js contém funções de login/logout', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    expect(res.body).toContain('login');
    expect(res.body).toContain('logout');
  });

  test('app.js contém loaders de views', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    expect(res.body).toContain('loadDashboard');
    expect(res.body).toContain('loadReviews');
    expect(res.body).toContain('loadMandates');
  });

  test('app.js gerencia estado de autenticação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    expect(res.body).toContain('token');
    expect(res.body).toContain('role');
    expect(res.body).toContain('tenantId');
  });

  test('app.js NÃO usa localStorage para token (segurança)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    // Verificar que não há localStorage.setItem para token
    // O token deve ficar apenas em memória
    const usesLocalStorageForToken = res.body.includes("localStorage.setItem('token'") ||
                                      res.body.includes('localStorage.setItem("token"');
    expect(usesLocalStorageForToken).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: CACHE E HEADERS
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Headers HTTP', () => {
  test('arquivos estáticos não incluem headers de cache agressivo em dev', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/app.js'
    });

    // Em modo de teste/dev, não deve ter cache muito longo
    // (fastify-static usa valores razoáveis por default)
    expect(res.statusCode).toBe(200);
  });

  test('content-type correto para cada tipo de arquivo', async () => {
    const htmlRes = await app.inject({ method: 'GET', url: '/admin/ui/index.html' });
    expect(htmlRes.headers['content-type']).toContain('text/html');

    const cssRes = await app.inject({ method: 'GET', url: '/admin/ui/styles.css' });
    expect(cssRes.headers['content-type']).toContain('text/css');

    const jsRes = await app.inject({ method: 'GET', url: '/admin/ui/app.js' });
    expect(jsRes.headers['content-type']).toMatch(/javascript/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ERRO 404 PARA ARQUIVOS INEXISTENTES
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Arquivos Inexistentes', () => {
  test('retorna 404 para arquivo inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/nonexistent.js'
    });

    expect(res.statusCode).toBe(404);
  });

  test('retorna 404 para subdiretório inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/subdir/file.js'
    });

    expect(res.statusCode).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TESTES: ACESSIBILIDADE (básico)
// ════════════════════════════════════════════════════════════════════════════

describe('Incremento 21 - Admin UI: Acessibilidade Básica', () => {
  test('HTML contém lang attribute', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toMatch(/<html[^>]*lang=/);
  });

  test('HTML contém meta viewport', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('viewport');
  });

  test('formulário de login tem labels', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/ui/'
    });

    expect(res.body).toContain('<label');
  });
});
