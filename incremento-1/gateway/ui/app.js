/**
 * INCREMENTO 21 - Painel Operacional: JavaScript
 *
 * UI leve que consome as Query APIs.
 * Token mantido em memoria (nao persistido).
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const state = {
    token: null,
    role: null,
    tenantId: null,
    currentView: 'dashboard',
    lastRequestId: null
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM ELEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const authScreen = $('#auth-screen');
  const mainApp = $('#main-app');
  const authTokenInput = $('#auth-token');
  const authError = $('#auth-error');
  const btnLogin = $('#btn-login');
  const btnLogout = $('#btn-logout');
  const roleBadge = $('#role-badge');
  const tenantSelector = $('#tenant-selector');
  const currentTenant = $('#current-tenant');
  const navBtns = $$('.nav-btn');
  const requestIdEl = $('#request-id');

  // ═══════════════════════════════════════════════════════════════════════════
  // API HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  async function api(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      // Capturar X-Request-Id
      const reqId = response.headers.get('X-Request-Id');
      if (reqId) {
        state.lastRequestId = reqId;
        requestIdEl.textContent = `Request: ${reqId}`;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════════

  async function login() {
    const token = authTokenInput.value.trim();
    if (!token) {
      authError.textContent = 'Token obrigatorio';
      return;
    }

    state.token = token;
    authError.textContent = '';

    try {
      // Tentar como global_admin primeiro
      const tenantsResult = await api('/admin/query/tenants');

      // Sucesso - e global_admin
      state.role = 'global_admin';
      showMainApp();
      populateTenantSelector(tenantsResult.tenants);
    } catch (err) {
      // Tentar como tenant_admin
      // Para isso, precisamos tentar acessar um dashboard de tenant
      // Mas nao sabemos o tenantId... vamos verificar via /admin/tenants
      try {
        // Tentar listar tenants via admin (mesmo endpoint mas pode funcionar com tenant token)
        const adminTenants = await api('/admin/tenants');
        if (adminTenants && adminTenants.length > 0) {
          // Encontrou tenants - provavelmente e tenant_admin
          state.role = 'tenant_admin';
          // Assumir primeiro tenant (ou extrair do token se possivel)
          const firstTenant = adminTenants[0];
          state.tenantId = firstTenant.id;
          showMainApp();
        } else {
          throw new Error('Nenhum tenant encontrado');
        }
      } catch (innerErr) {
        state.token = null;
        state.role = null;
        authError.textContent = 'Token invalido ou sem permissao';
      }
    }
  }

  function logout() {
    state.token = null;
    state.role = null;
    state.tenantId = null;
    authTokenInput.value = '';
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
  }

  function showMainApp() {
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');

    // Configurar UI baseado no role
    if (state.role === 'global_admin') {
      roleBadge.textContent = 'Global Admin';
      roleBadge.className = 'badge badge-global';
      tenantSelector.classList.remove('hidden');
      $$('.global-only').forEach(el => el.classList.remove('hidden'));
    } else {
      roleBadge.textContent = 'Tenant Admin';
      roleBadge.className = 'badge badge-tenant';
      tenantSelector.classList.add('hidden');
      currentTenant.textContent = `Tenant: ${state.tenantId}`;
      $$('.global-only').forEach(el => el.classList.add('hidden'));
    }

    // Carregar view inicial
    loadView('dashboard');
  }

  function populateTenantSelector(tenants) {
    tenantSelector.innerHTML = '<option value="">Selecionar Tenant...</option>';
    tenants.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.id})`;
      tenantSelector.appendChild(opt);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  function loadView(viewName) {
    state.currentView = viewName;

    // Update nav
    navBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Hide all views, show target
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`#view-${viewName}`).classList.remove('hidden');

    // Load content
    switch (viewName) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'reviews':
        loadReviews();
        break;
      case 'mandates':
        loadMandates();
        break;
      case 'consequences':
        loadConsequences();
        break;
      case 'timeline':
        // Timeline e on-demand (via busca)
        break;
      case 'eventlog':
        loadEventLog();
        break;
      case 'metrics':
        loadMetrics();
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadDashboard() {
    const cardsContainer = $('#dashboard-cards');
    const eventsContainer = $('#recent-events');

    cardsContainer.innerHTML = '<div class="loading">Carregando</div>';
    eventsContainer.innerHTML = '';

    const tenantId = state.tenantId || tenantSelector.value;
    if (!tenantId && state.role !== 'global_admin') {
      cardsContainer.innerHTML = '<p>Selecione um tenant</p>';
      return;
    }

    try {
      if (state.role === 'global_admin' && !tenantId) {
        // Global metrics
        const metrics = await api('/admin/query/metrics');
        cardsContainer.innerHTML = `
          <div class="card">
            <div class="card-title">Total Tenants</div>
            <div class="card-value">${metrics.totalTenants}</div>
          </div>
          <div class="card">
            <div class="card-title">Tenants Ativos</div>
            <div class="card-value success">${metrics.activeTenants}</div>
          </div>
          <div class="card">
            <div class="card-title">Instancias Ativas</div>
            <div class="card-value">${metrics.activeInstances}</div>
          </div>
          <div class="card">
            <div class="card-title">Instancias Degradadas</div>
            <div class="card-value ${metrics.degradedInstances > 0 ? 'warning' : ''}">${metrics.degradedInstances}</div>
          </div>
        `;
      } else {
        // Tenant dashboard
        const dashboard = await api(`/admin/query/${tenantId}/dashboard`);
        cardsContainer.innerHTML = `
          <div class="card">
            <div class="card-title">Mandatos Ativos</div>
            <div class="card-value success">${dashboard.mandates.active}</div>
          </div>
          <div class="card">
            <div class="card-title">Mandatos Suspensos</div>
            <div class="card-value ${dashboard.mandates.suspended > 0 ? 'warning' : ''}">${dashboard.mandates.suspended}</div>
          </div>
          <div class="card">
            <div class="card-title">Reviews Abertos</div>
            <div class="card-value ${dashboard.reviews.open > 0 ? 'warning' : ''}">${dashboard.reviews.open}</div>
          </div>
          <div class="card">
            <div class="card-title">Consequencias (7d)</div>
            <div class="card-value">${dashboard.consequences.last7Days}</div>
          </div>
          <div class="card">
            <div class="card-title">Consequencias Criticas (7d)</div>
            <div class="card-value ${dashboard.consequences.critical > 0 ? 'error' : ''}">${dashboard.consequences.critical}</div>
          </div>
        `;

        // Recent events
        if (dashboard.recentEvents && dashboard.recentEvents.length > 0) {
          eventsContainer.innerHTML = dashboard.recentEvents.map(e => `
            <div class="event-item">
              <span class="event-type">${e.evento}</span>
              <span class="event-entity">${e.entidade}</span>
              <span class="event-time">${formatDate(e.ts)}</span>
            </div>
          `).join('');
        } else {
          eventsContainer.innerHTML = '<div class="event-item">Nenhum evento recente</div>';
        }
      }
    } catch (err) {
      cardsContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEWS
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadReviews() {
    const listContainer = $('#reviews-list');
    const detailPanel = $('#review-detail');

    listContainer.innerHTML = '<div class="loading">Carregando</div>';
    detailPanel.classList.add('hidden');

    const tenantId = state.tenantId || tenantSelector.value;
    if (!tenantId) {
      listContainer.innerHTML = '<p>Selecione um tenant</p>';
      return;
    }

    try {
      const statusFilter = $('#review-status-filter').value;
      let url = `/admin/query/${tenantId}/reviews`;
      if (statusFilter) {
        url += `?status=${statusFilter}`;
      }

      const result = await api(url);

      if (result.reviews.length === 0) {
        listContainer.innerHTML = '<div class="data-item">Nenhum caso de revisao encontrado</div>';
        return;
      }

      listContainer.innerHTML = result.reviews.map(r => `
        <div class="data-item" data-id="${r.id}">
          <div class="data-item-header">
            <span class="data-item-id">${r.id}</span>
            <span class="badge badge-${r.status.toLowerCase()}">${r.status}</span>
          </div>
          <div class="data-item-meta">${formatDate(r.createdAt)}</div>
          <div class="data-item-info">
            Trigger: ${r.triggeredBy?.ruleId || 'N/A'}
          </div>
        </div>
      `).join('');

      // Click handlers
      listContainer.querySelectorAll('.data-item').forEach(item => {
        item.addEventListener('click', () => loadReviewDetail(tenantId, item.dataset.id));
      });
    } catch (err) {
      listContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  async function loadReviewDetail(tenantId, reviewId) {
    const detailPanel = $('#review-detail');
    detailPanel.classList.remove('hidden');
    detailPanel.innerHTML = '<div class="loading">Carregando</div>';

    try {
      const result = await api(`/admin/query/${tenantId}/reviews/${reviewId}`);
      const r = result.reviewCase;

      detailPanel.innerHTML = `
        <div class="detail-header">
          <h3>${r.id}</h3>
          <button class="btn-close" onclick="document.querySelector('#review-detail').classList.add('hidden')">&times;</button>
        </div>
        <div class="detail-section">
          <h4>Status</h4>
          <span class="badge badge-${r.status.toLowerCase()}">${r.status}</span>
        </div>
        <div class="detail-section">
          <h4>Trigger</h4>
          <div class="detail-field"><label>Rule ID:</label> ${r.triggeredBy?.ruleId || 'N/A'}</div>
          <div class="detail-field"><label>Observacao ID:</label> ${r.triggeredBy?.observacaoId || 'N/A'}</div>
          <div class="detail-field"><label>Mandate ID:</label> ${r.triggeredBy?.mandateId || 'N/A'}</div>
        </div>
        ${r.decision ? `
        <div class="detail-section">
          <h4>Decisao</h4>
          <div class="detail-field"><label>Resolucao:</label> ${r.decision.resolution}</div>
          <div class="detail-field"><label>Decidido por:</label> ${r.decision.decidedBy}</div>
          <div class="detail-field"><label>Data:</label> ${formatDate(r.decision.decisionAt)}</div>
          <div class="detail-field"><label>Notas:</label> ${r.decision.notes || 'N/A'}</div>
          <div class="detail-field"><label>Efeitos:</label> ${(r.decision.effectsApplied || []).join(', ') || 'Nenhum'}</div>
        </div>
        ` : ''}
        <div class="detail-section">
          <h4>Timestamps</h4>
          <div class="detail-field"><label>Criado:</label> ${formatDate(r.createdAt)}</div>
          <div class="detail-field"><label>Atualizado:</label> ${formatDate(r.updatedAt)}</div>
        </div>
      `;
    } catch (err) {
      detailPanel.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MANDATES
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadMandates() {
    const listContainer = $('#mandates-list');
    const detailPanel = $('#mandate-detail');

    listContainer.innerHTML = '<div class="loading">Carregando</div>';
    detailPanel.classList.add('hidden');

    const tenantId = state.tenantId || tenantSelector.value;
    if (!tenantId) {
      listContainer.innerHTML = '<p>Selecione um tenant</p>';
      return;
    }

    try {
      const statusFilter = $('#mandate-status-filter').value;
      let url = `/admin/query/${tenantId}/mandates`;
      if (statusFilter) {
        url += `?status=${statusFilter}`;
      }

      const result = await api(url);

      if (result.mandates.length === 0) {
        listContainer.innerHTML = '<div class="data-item">Nenhum mandato encontrado</div>';
        return;
      }

      listContainer.innerHTML = result.mandates.map(m => `
        <div class="data-item" data-id="${m.id}">
          <div class="data-item-header">
            <span class="data-item-id">${m.id}</span>
            <span class="badge badge-${m.status || 'active'}">${m.status || 'active'}</span>
          </div>
          <div class="data-item-meta">Agent: ${m.agentId}</div>
          <div class="data-item-info">
            Modo: ${m.modo} | Perfil: ${m.perfil_risco_maximo}
          </div>
        </div>
      `).join('');

      // Click handlers
      listContainer.querySelectorAll('.data-item').forEach(item => {
        item.addEventListener('click', () => loadMandateDetail(tenantId, item.dataset.id));
      });
    } catch (err) {
      listContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  async function loadMandateDetail(tenantId, mandateId) {
    const detailPanel = $('#mandate-detail');
    detailPanel.classList.remove('hidden');
    detailPanel.innerHTML = '<div class="loading">Carregando</div>';

    try {
      const result = await api(`/admin/query/${tenantId}/mandates/${mandateId}`);
      const m = result.mandate;

      detailPanel.innerHTML = `
        <div class="detail-header">
          <h3>${m.id}</h3>
          <button class="btn-close" onclick="document.querySelector('#mandate-detail').classList.add('hidden')">&times;</button>
        </div>
        <div class="detail-section">
          <h4>Status</h4>
          <span class="badge badge-${m.status || 'active'}">${m.status || 'active'}</span>
        </div>
        <div class="detail-section">
          <h4>Configuracao</h4>
          <div class="detail-field"><label>Agent ID:</label> ${m.agentId}</div>
          <div class="detail-field"><label>Modo:</label> ${m.modo}</div>
          <div class="detail-field"><label>Perfil Risco Max:</label> ${m.perfil_risco_maximo}</div>
          <div class="detail-field"><label>Politicas:</label> ${(m.politicas_permitidas || []).join(', ')}</div>
        </div>
        <div class="detail-section">
          <h4>Limites Temporais</h4>
          <div class="detail-field"><label>Valido desde:</label> ${m.validFrom || 'Imediato'}</div>
          <div class="detail-field"><label>Valido ate:</label> ${m.validUntil || 'Sem limite'}</div>
          <div class="detail-field"><label>Max usos:</label> ${m.maxUses ?? 'Ilimitado'}</div>
          <div class="detail-field"><label>Usos:</label> ${m.uses ?? 0}</div>
        </div>
        <div class="detail-section">
          <h4>Auditoria</h4>
          <div class="detail-field"><label>Concedido por:</label> ${m.concedido_por}</div>
          <div class="detail-field"><label>Concedido em:</label> ${formatDate(m.concedido_em)}</div>
          ${m.revogado ? `<div class="detail-field"><label>Revogado por:</label> ${m.revogado_por || 'N/A'}</div>` : ''}
        </div>
        ${result.history && result.history.length > 0 ? `
        <div class="detail-section">
          <h4>Historico de Eventos</h4>
          ${result.history.map(h => `
            <div class="event-item">
              <span class="event-type">${h.evento}</span>
              <span class="event-time">${formatDate(h.ts)}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}
      `;
    } catch (err) {
      detailPanel.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSEQUENCES
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadConsequences() {
    const listContainer = $('#consequences-list');
    const detailPanel = $('#consequence-detail');

    listContainer.innerHTML = '<div class="loading">Carregando</div>';
    detailPanel.classList.add('hidden');

    const tenantId = state.tenantId || tenantSelector.value;
    if (!tenantId) {
      listContainer.innerHTML = '<p>Selecione um tenant</p>';
      return;
    }

    try {
      const contratoFilter = $('#consequence-contrato-filter').value;
      let url = `/admin/query/${tenantId}/consequences`;
      if (contratoFilter) {
        url += `?contratoId=${contratoFilter}`;
      }

      const result = await api(url);

      if (result.consequences.length === 0) {
        listContainer.innerHTML = '<div class="data-item">Nenhuma consequencia encontrada</div>';
        return;
      }

      listContainer.innerHTML = result.consequences.map(c => `
        <div class="data-item" data-id="${c.id}">
          <div class="data-item-header">
            <span class="data-item-id">${c.id}</span>
            <span class="badge badge-${c.percebida?.sinal === 'NEGATIVO' ? 'error' : c.percebida?.sinal === 'POSITIVO' ? 'success' : 'info'}">${c.percebida?.sinal || 'NEUTRO'}</span>
          </div>
          <div class="data-item-meta">${formatDate(c.data_registro)}</div>
          <div class="data-item-info">
            Contrato: ${c.contrato_id || 'N/A'}
          </div>
        </div>
      `).join('');

      // Click handlers
      listContainer.querySelectorAll('.data-item').forEach(item => {
        item.addEventListener('click', () => loadConsequenceDetail(tenantId, item.dataset.id));
      });
    } catch (err) {
      listContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  async function loadConsequenceDetail(tenantId, observacaoId) {
    const detailPanel = $('#consequence-detail');
    detailPanel.classList.remove('hidden');
    detailPanel.innerHTML = '<div class="loading">Carregando</div>';

    try {
      const result = await api(`/admin/query/${tenantId}/consequences/${observacaoId}`);
      const o = result.observacao;

      detailPanel.innerHTML = `
        <div class="detail-header">
          <h3>${o.id}</h3>
          <button class="btn-close" onclick="document.querySelector('#consequence-detail').classList.add('hidden')">&times;</button>
        </div>
        <div class="detail-section">
          <h4>Observada</h4>
          <div class="detail-field"><label>Descricao:</label> ${o.observada?.descricao || 'N/A'}</div>
          <div class="detail-field"><label>Limites Respeitados:</label> ${o.observada?.limites_respeitados ? 'Sim' : 'Nao'}</div>
          <div class="detail-field"><label>Condicoes Cumpridas:</label> ${o.observada?.condicoes_cumpridas ? 'Sim' : 'Nao'}</div>
        </div>
        <div class="detail-section">
          <h4>Percebida</h4>
          <div class="detail-field"><label>Descricao:</label> ${o.percebida?.descricao || 'N/A'}</div>
          <div class="detail-field"><label>Sinal:</label> <span class="badge badge-${o.percebida?.sinal === 'NEGATIVO' ? 'error' : 'success'}">${o.percebida?.sinal || 'NEUTRO'}</span></div>
          <div class="detail-field"><label>Risco Percebido:</label> ${o.percebida?.risco_percebido || 'N/A'}</div>
        </div>
        <div class="detail-section">
          <h4>Evidencias Minimas</h4>
          <ul>
            ${(o.evidencias_minimas || []).map(e => `<li>${e}</li>`).join('')}
          </ul>
        </div>
        <div class="detail-section">
          <h4>Links</h4>
          <div class="detail-field"><label>Contrato ID:</label> ${o.contrato_id || 'N/A'}</div>
          <div class="detail-field"><label>Episodio ID:</label> ${o.episodio_id || 'N/A'}</div>
        </div>
        <div class="detail-section">
          <h4>Auditoria</h4>
          <div class="detail-field"><label>Registrado por:</label> ${o.registrado_por || 'N/A'}</div>
          <div class="detail-field"><label>Data:</label> ${formatDate(o.data_registro)}</div>
        </div>
      `;
    } catch (err) {
      detailPanel.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════

  async function searchTimeline() {
    const resultContainer = $('#timeline-result');
    const searchInput = $('#timeline-search').value.trim();
    const searchType = $('#timeline-type').value;

    if (!searchInput) {
      resultContainer.innerHTML = '<p>Digite um ID para buscar</p>';
      return;
    }

    const tenantId = state.tenantId || tenantSelector.value;
    if (!tenantId) {
      resultContainer.innerHTML = '<p>Selecione um tenant</p>';
      return;
    }

    resultContainer.innerHTML = '<div class="loading">Carregando</div>';

    try {
      let result;
      if (searchType === 'episode') {
        result = await api(`/admin/query/${tenantId}/episodes/${searchInput}`);
      } else {
        result = await api(`/admin/query/${tenantId}/contracts/${searchInput}`);
      }

      if (result.timeline && result.timeline.length > 0) {
        resultContainer.innerHTML = result.timeline.map(item => `
          <div class="timeline-item ${item.type.toLowerCase()}">
            <div class="timeline-type">${item.type}</div>
            <div class="timeline-timestamp">${formatDate(item.timestamp)}</div>
            <div class="timeline-content">
              <pre>${JSON.stringify(item.data, null, 2).substring(0, 500)}...</pre>
            </div>
          </div>
        `).join('');
      } else {
        // Para contratos, mostrar info basica
        resultContainer.innerHTML = `
          <div class="detail-section">
            <h4>Contrato</h4>
            <pre>${JSON.stringify(result.contrato || result.episodio, null, 2)}</pre>
          </div>
          ${result.consequencias && result.consequencias.length > 0 ? `
          <div class="detail-section">
            <h4>Consequencias (${result.consequencias.length})</h4>
            <pre>${JSON.stringify(result.consequencias, null, 2).substring(0, 1000)}...</pre>
          </div>
          ` : ''}
        `;
      }
    } catch (err) {
      resultContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTLOG
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadEventLog() {
    const listContainer = $('#eventlog-list');
    listContainer.innerHTML = '<div class="loading">Carregando</div>';

    if (state.role !== 'global_admin') {
      listContainer.innerHTML = '<p>Acesso restrito a global_admin</p>';
      return;
    }

    try {
      const tenantFilter = $('#eventlog-tenant-filter').value;
      const typeFilter = $('#eventlog-type-filter').value;

      let url = '/admin/query/eventlog?limit=100';
      if (tenantFilter) url += `&tenantId=${tenantFilter}`;
      if (typeFilter) url += `&eventType=${typeFilter}`;

      const result = await api(url);

      if (result.events.length === 0) {
        listContainer.innerHTML = '<div class="data-item">Nenhum evento encontrado</div>';
        return;
      }

      listContainer.innerHTML = result.events.map(e => `
        <div class="data-item">
          <div class="data-item-header">
            <span class="event-type">${e.evento}</span>
            <span class="data-item-meta">${e._tenantId || 'N/A'}</span>
          </div>
          <div class="data-item-info">
            ${e.entidade}: ${e.entidade_id}
          </div>
          <div class="data-item-meta">${formatDate(e.ts)} | seq: ${e.seq}</div>
        </div>
      `).join('');
    } catch (err) {
      listContainer.innerHTML = `<p class="error-message">Erro: ${err.message}</p>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadMetrics() {
    const outputContainer = $('#metrics-output');
    outputContainer.textContent = 'Carregando...';

    if (state.role !== 'global_admin') {
      outputContainer.textContent = 'Acesso restrito a global_admin';
      return;
    }

    try {
      const prometheusFormat = $('#metrics-prometheus-format')?.checked;
      const endpoint = prometheusFormat ? '/internal/metrics' : '/internal/metrics/json';

      const headers = {
        'Authorization': `Bearer ${state.token}`
      };

      const response = await fetch(endpoint, { headers });

      // Capturar X-Request-Id
      const reqId = response.headers.get('X-Request-Id');
      if (reqId) {
        state.lastRequestId = reqId;
        requestIdEl.textContent = `Request: ${reqId}`;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      if (prometheusFormat) {
        const text = await response.text();
        outputContainer.textContent = text;
      } else {
        const json = await response.json();
        outputContainer.textContent = JSON.stringify(json, null, 2);
      }
    } catch (err) {
      outputContainer.textContent = `Erro: ${err.message}`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('pt-BR');
    } catch {
      return dateStr;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  btnLogin.addEventListener('click', login);
  authTokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
  });

  btnLogout.addEventListener('click', logout);

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => loadView(btn.dataset.view));
  });

  tenantSelector.addEventListener('change', () => {
    state.tenantId = tenantSelector.value;
    if (state.tenantId) {
      currentTenant.textContent = `Tenant: ${state.tenantId}`;
    }
    loadView(state.currentView);
  });

  // Refresh buttons
  $('#btn-refresh-reviews')?.addEventListener('click', loadReviews);
  $('#btn-refresh-mandates')?.addEventListener('click', loadMandates);
  $('#btn-refresh-consequences')?.addEventListener('click', loadConsequences);
  $('#btn-refresh-eventlog')?.addEventListener('click', loadEventLog);
  $('#btn-refresh-metrics')?.addEventListener('click', loadMetrics);
  $('#metrics-prometheus-format')?.addEventListener('change', loadMetrics);

  // Filter changes
  $('#review-status-filter')?.addEventListener('change', loadReviews);
  $('#mandate-status-filter')?.addEventListener('change', loadMandates);

  // Timeline search
  $('#btn-search-timeline')?.addEventListener('click', searchTimeline);
  $('#timeline-search')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchTimeline();
  });

})();
