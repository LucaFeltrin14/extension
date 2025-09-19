(() => {
  'use strict';

  const browserApi = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    blockingEnabled: true,
    notificationsEnabled: true,
    customDomains: []
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    bindActions();
    switchView('dashboard');
    refreshDashboard();
  });

  function cacheElements() {
    elements.body = document.body;
    elements.app = document.getElementById('app');
    elements.score = document.getElementById('score');
    elements.summary = document.getElementById('summary');
    elements.details = document.getElementById('details');
    elements.dashboardView = document.getElementById('view-dashboard');
    elements.settingsView = document.getElementById('view-settings');
    elements.openSettings = document.getElementById('open-settings');
    elements.closeSettings = document.getElementById('close-settings');
    elements.refreshDashboard = document.getElementById('refresh-dashboard');
    elements.blockingCheckbox = document.getElementById('settings-enable-blocking');
    elements.notificationsCheckbox = document.getElementById('settings-enable-notifications');
    elements.customDomains = document.getElementById('settings-custom-domains');
    elements.saveSettings = document.getElementById('settings-save');
    elements.resetSettings = document.getElementById('settings-reset');
    elements.settingsStatus = document.getElementById('settings-status');
  }

  function bindActions() {
    if (elements.openSettings) {
      elements.openSettings.addEventListener('click', async () => {
        switchView('settings');
        await loadSettingsIntoForm();
      });
    }

    if (elements.closeSettings) {
      elements.closeSettings.addEventListener('click', () => {
        switchView('dashboard');
      });
    }

    if (elements.refreshDashboard) {
      elements.refreshDashboard.addEventListener('click', () => {
        refreshDashboard();
      });
    }

    if (elements.saveSettings) {
      elements.saveSettings.addEventListener('click', async () => {
        await saveSettingsFromForm();
      });
    }

    if (elements.resetSettings) {
      elements.resetSettings.addEventListener('click', async () => {
        await resetSettings();
      });
    }
  }

  function switchView(target) {
    const isSettings = target === 'settings';
    if (elements.body) {
      elements.body.setAttribute('data-view', target);
    }
    if (elements.dashboardView) {
      elements.dashboardView.classList.toggle('active', !isSettings);
    }
    if (elements.settingsView) {
      elements.settingsView.classList.toggle('active', isSettings);
    }
  }

  async function refreshDashboard() {
    showLoading();
    try {
      const data = await loadTabData();
      if (!data || data.error) {
        const message = data && data.error ? translateError(data.error) : 'Nao foi possivel obter os dados da aba.';
        showError(message);
        return;
      }
      renderScore(data.score);
      renderSummary(data);
      renderDetails(data);
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao atualizar painel', error);
      showError('Ocorreu um erro ao carregar os dados.');
    }
  }

  function translateError(code) {
    if (!code) return 'Nao foi possivel obter os dados da aba.';
    switch (code) {
      case 'TAB_NOT_FOUND':
        return 'Nenhuma aba ativa foi encontrada.';
      case 'UNSUPPORTED_URL':
        return 'Abra o painel em uma pagina http ou https para visualizar os dados.';
      case 'BACKGROUND_UNAVAILABLE':
        return 'O servico da extensao foi reiniciado. Recarregue a extensao e tente novamente.';
      case 'UNEXPECTED_ERROR':
        return 'Ocorreu um erro ao obter as informacoes da aba.';
      default:
        return 'Ocorreu um erro ao obter as informacoes da aba.';
    }
  }

  function showLoading() {
    if (!elements.score) return;
    elements.score.innerHTML = '<p class="muted">Carregando...</p>';
    if (elements.summary) elements.summary.innerHTML = '';
    if (elements.details) elements.details.innerHTML = '';
  }

  function showError(message) {
    if (!elements.score) return;
    elements.score.innerHTML = `<p class="error">${escapeHtml(message)}</p>`;
  }

  async function loadTabData() {
    try {
      const response = await browserApi.runtime.sendMessage({ type: 'getTabData' });
      return response || { error: 'UNEXPECTED_ERROR' };
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao carregar dados da aba', error);
      if (error && error.message === 'Could not establish connection. Receiving end does not exist.') {
        return { error: 'BACKGROUND_UNAVAILABLE' };
      }
      return { error: 'UNEXPECTED_ERROR' };
    }
  }

  function renderScore(score) {
    if (!elements.score) return;
    if (!score) {
      showError('Sem dados disponiveis para esta aba.');
      return;
    }
    elements.score.innerHTML = `
      <div class="score-card">
        <div class="score-value">${Number.isFinite(score.value) ? score.value : 'N/A'}</div>
        <div class="score-label">${escapeHtml(score.label || '')}</div>
      </div>
    `;
  }

  function renderSummary(data) {
    if (!elements.summary) return;
    const thirdParty = safeArray(data.thirdPartyRequests);
    const blocked = safeArray(data.blockedRequests);
    const cookies = isObject(data.cookies)
      ? data.cookies
      : { total: 0, thirdParty: 0, firstParty: 0 };
    const canvas = safeArray(data.canvasFingerprints);

    const uniqueThirdParty = new Set(thirdParty.map((req) => req.domain).filter(Boolean)).size;
    const blockedTrackers = blocked.length;

    elements.summary.innerHTML = `
      <ul class="metrics">
        <li>
          <span class="metric-label">Dominios de 3a parte</span>
          <span class="metric-value">${uniqueThirdParty}</span>
        </li>
        <li>
          <span class="metric-label">Rastreadores bloqueados</span>
          <span class="metric-value">${blockedTrackers}</span>
        </li>
        <li>
          <span class="metric-label">Cookies</span>
          <span class="metric-value">${safeNumber(cookies.total)}</span>
        </li>
        <li>
          <span class="metric-label">Canvas fingerprint</span>
          <span class="metric-value">${canvas.length}</span>
        </li>
      </ul>
    `;
  }

  function renderDetails(data) {
    if (!elements.details) return;
    const fragments = [
      sectionThirdParty(safeArray(data.thirdPartyRequests), safeArray(data.blockedRequests)),
      sectionCookies(isObject(data.cookies) ? data.cookies : undefined, safeArray(data.cookieSyncSignals)),
      sectionStorage(isObject(data.storage) ? data.storage : undefined),
      sectionCanvas(safeArray(data.canvasFingerprints)),
      sectionHijacking(safeArray(data.hijackingAlerts))
    ];
    elements.details.innerHTML = '';
    fragments.forEach((section) => {
      if (section) elements.details.appendChild(section);
    });
  }

  function sectionThirdParty(requests, blocked) {
    const limit = 5;
    const list = document.createElement('section');
    list.className = 'detail-section';
    const unique = aggregateByDomain(requests);
    const blockedUnique = aggregateByDomain(blocked);

    list.innerHTML = `
      <h2>Conexoes de 3a Parte</h2>
      <div class="detail-body">
        ${renderDomainList(unique.slice(0, limit), 'Nenhuma conexao de terceiros registrada.')}
        <h3>Bloqueadas</h3>
        ${renderDomainList(blockedUnique.slice(0, limit), 'Nenhum bloqueio ate agora.')}
      </div>
    `;
    return list;
  }

  function sectionCookies(cookies, syncSignals) {
    const info = cookies || { total: 0, firstParty: 0, thirdParty: 0, session: 0, persistent: 0, superCookies: [] };
    const section = document.createElement('section');
    section.className = 'detail-section';
    const superCookies = safeArray(info.superCookies)
      .slice(0, 5)
      .map((cookie) => {
        const lifetime = safeNumber(cookie.lifetimeDays);
        const lifetimeLabel = lifetime > 0 ? `${lifetime} dias` : 'duracao desconhecida';
        return `<li>${escapeHtml(cookie.name)} (${escapeHtml(cookie.domain)}) - ${escapeHtml(lifetimeLabel)}</li>`;
      })
      .join('');
    const sync = safeArray(syncSignals)
      .slice(0, 5)
      .map((entry) => {
        const domains = safeArray(entry.domains).join(', ');
        const domainLabel = domains || 'dominios desconhecidos';
        return `<li>${escapeHtml(entry.cookie)}: ${escapeHtml(domainLabel)}</li>`;
      })
      .join('');

    section.innerHTML = `
      <h2>Cookies</h2>
      <div class="detail-body">
        <ul class="stats">
          <li>Total: <strong>${safeNumber(info.total)}</strong></li>
          <li>1a parte: <strong>${safeNumber(info.firstParty)}</strong></li>
          <li>3a parte: <strong>${safeNumber(info.thirdParty)}</strong></li>
          <li>Sessao: <strong>${safeNumber(info.session)}</strong></li>
          <li>Persistentes: <strong>${safeNumber(info.persistent)}</strong></li>
        </ul>
        <h3>Supercookies</h3>
        <ul class="list">${superCookies || '<li>Nenhum identificado</li>'}</ul>
        <h3>Sincronismo</h3>
        <ul class="list">${sync || '<li>Nenhum sinal detectado</li>'}</ul>
      </div>
    `;
    return section;
  }

  function sectionStorage(storage) {
    const section = document.createElement('section');
    section.className = 'detail-section';
    const local = isObject(storage && storage.local) ? storage.local : { entries: 0, size: 0 };
    const session = isObject(storage && storage.session) ? storage.session : { entries: 0, size: 0 };
    const indexed = storage && storage.indexedDB !== undefined ? storage.indexedDB : { databases: 'desconhecido' };

    section.innerHTML = `
      <h2>Storage HTML5</h2>
      <div class="detail-body">
        <ul class="stats">
          <li>LocalStorage: <strong>${safeNumber(local.entries)}</strong> entradas (${safeNumber(local.size)} chars)</li>
          <li>SessionStorage: <strong>${safeNumber(session.entries)}</strong> entradas (${safeNumber(session.size)} chars)</li>
          <li>IndexedDB: <strong>${escapeHtml(String(indexed.databases ?? indexed))}</strong> bancos</li>
        </ul>
      </div>
    `;
    return section;
  }

  function sectionCanvas(entries) {
    const section = document.createElement('section');
    section.className = 'detail-section';
    const list = safeArray(entries)
      .slice(0, 5)
      .map((entry) => `<li>${escapeHtml(entry.method)}</li>`)
      .join('');

    section.innerHTML = `
      <h2>Canvas Fingerprint</h2>
      <div class="detail-body">
        <ul class="list">${list || '<li>Sem eventos registrados</li>'}</ul>
      </div>
    `;
    return section;
  }

  function sectionHijacking(alerts) {
    const section = document.createElement('section');
    section.className = 'detail-section';
    const list = safeArray(alerts)
      .slice(0, 5)
      .map((alert) => `<li>${escapeHtml(alert.reason)}<br><small>${escapeHtml(alert.url)}</small></li>`)
      .join('');

    section.innerHTML = `
      <h2>Hijacking</h2>
      <div class="detail-body">
        <ul class="list">${list || '<li>Nenhuma ameaca detectada</li>'}</ul>
      </div>
    `;
    return section;
  }

  function aggregateByDomain(items) {
    const map = new Map();
    items.forEach((item) => {
      const key = item.domain || item.host || 'desconhecido';
      if (!map.has(key)) {
        map.set(key, { domain: key, count: 0 });
      }
      map.get(key).count += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  function renderDomainList(items, emptyMessage) {
    if (!items.length) {
      return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
    }
    return `
      <ol class="list">
        ${items.map((item) => `<li><strong>${escapeHtml(item.domain)}</strong> - ${item.count} requisicoes</li>`).join('')}
      </ol>
    `;
  }

  async function loadSettingsIntoForm() {
    try {
      const stored = await browserApi.storage.local.get('settings');
      const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      if (elements.blockingCheckbox) elements.blockingCheckbox.checked = Boolean(settings.blockingEnabled);
      if (elements.notificationsCheckbox) elements.notificationsCheckbox.checked = Boolean(settings.notificationsEnabled);
      if (elements.customDomains) elements.customDomains.value = safeArray(settings.customDomains).join('\n');
      showSettingsStatus('');
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao carregar configuracoes', error);
      showSettingsStatus('Falha ao carregar configuracoes.', true);
    }
  }

  async function saveSettingsFromForm() {
    if (!elements.customDomains) return;
    const customDomains = elements.customDomains.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const settings = {
      blockingEnabled: elements.blockingCheckbox ? elements.blockingCheckbox.checked : DEFAULT_SETTINGS.blockingEnabled,
      notificationsEnabled: elements.notificationsCheckbox ? elements.notificationsCheckbox.checked : DEFAULT_SETTINGS.notificationsEnabled,
      customDomains
    };
    try {
      await browserApi.storage.local.set({ settings });
      showSettingsStatus('Configuracoes salvas.', false);
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao salvar configuracoes', error);
      showSettingsStatus('Nao foi possivel salvar.', true);
    }
  }

  async function resetSettings() {
    try {
      const defaults = {
        blockingEnabled: DEFAULT_SETTINGS.blockingEnabled,
        notificationsEnabled: DEFAULT_SETTINGS.notificationsEnabled,
        customDomains: [...DEFAULT_SETTINGS.customDomains]
      };
      await browserApi.storage.local.set({ settings: defaults });
      await loadSettingsIntoForm();
      showSettingsStatus('Configuracoes redefinidas.', false);
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao redefinir configuracoes', error);
      showSettingsStatus('Nao foi possivel redefinir.', true);
    }
  }

  function showSettingsStatus(message, isError = false) {
    if (!elements.settingsStatus) return;
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.classList.remove('ok', 'error');
    if (!message) return;
    elements.settingsStatus.classList.add(isError ? 'error' : 'ok');
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();





