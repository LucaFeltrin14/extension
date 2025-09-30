(function() {
  'use strict';

  const browserApi = typeof browser !== 'undefined' ? browser : chrome;

  const DEFAULT_SETTINGS = {
    blockingEnabled: true,
    notificationsEnabled: true,
    customDomains: []
  };

  const SECOND_LEVEL_TLDS = new Set([
    'com.br', 'com.au', 'com.cn', 'com.mx', 'com.ar', 'co.uk', 'org.uk', 'gov.uk',
    'com.tr', 'com.sa', 'com.pl', 'com.ru', 'com.jp', 'co.jp', 'co.kr'
  ]);

  const HIJACKING_KEYWORDS = [
    'beef', 'hook.js', 'browser-hijack', 'keylogger', 'toolbar/installer', 'extension-dll'
  ];

  const EASYLIST_URLS = [
    'https://easylist.to/easylist/easylist.txt',
    'https://cdn.jsdelivr.net/gh/easylist/easylist/easylist.txt'
  ];

  const tabState = new Map();
  const trackerLists = {
    fallback: new Set(),
    remote: new Set(),
    custom: new Set()
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    trackerCache: new Set()
  };

  browserApi.runtime.onInstalled.addListener(async () => {
    const stored = await browserApi.storage.local.get('settings');
    if (!stored.settings) {
      await browserApi.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });

  init();

  async function init() {
    await Promise.all([loadFallbackTrackers(), loadSettings()]);
    registerListeners();
    loadRemoteTrackers().catch((error) => {
      console.error('[Privacy Sentinel] Falha ao carregar EasyList', error);
    });
  }

  async function loadFallbackTrackers() {
    try {
      const response = await fetch(browserApi.runtime.getURL('data/tracker-list.json'));
      const json = await response.json();
      const fallback = new Set();
      (json.domains || []).forEach((entry) => {
        if (!entry || typeof entry !== 'string') return;
        fallback.add(entry.trim().toLowerCase());
      });
      trackerLists.fallback = fallback;
      rebuildTrackerCache();
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao carregar lista padrao de rastreadores', error);
    }
  }

  async function loadRemoteTrackers() {
    for (const url of EASYLIST_URLS) {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) {
          continue;
        }
        const text = await response.text();
        const parsed = parseEasyList(text);
        if (parsed.size > 0) {
          trackerLists.remote = parsed;
          rebuildTrackerCache();
          console.info(`[Privacy Sentinel] EasyList carregado (${parsed.size} dominios)`);
          return;
        }
      } catch (error) {
        console.warn(`[Privacy Sentinel] Falha ao processar EasyList de ${url}`, error);
      }
    }
  }

  function parseEasyList(text) {
    const domains = new Set();
    if (!text) return domains;

    const rulePattern = /^\|\|([^\^\/\*:]+)\^/i;
    const hostsPattern = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+\.[a-z]{2,})$/i;
    const plainDomainPattern = /^([a-z0-9.-]+\.[a-z]{2,})$/i;

    text.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('@@')) {
        return;
      }
      let match = rulePattern.exec(line);
      if (match) {
        const domain = cleanDomain(match[1]);
        if (domain) domains.add(domain);
        return;
      }
      match = hostsPattern.exec(line);
      if (match) {
        const domain = cleanDomain(match[1]);
        if (domain) domains.add(domain);
        return;
      }
      if (!line.includes('/')) {
        match = plainDomainPattern.exec(line.replace(/^\|\|/, ''));
        if (match) {
          const domain = cleanDomain(match[1]);
          if (domain) domains.add(domain);
        }
      }
    });

    return domains;
  }

  function cleanDomain(value) {
    if (!value) return '';
    const trimmed = value.replace(/^\.+/, '').replace(/\.+$/, '').toLowerCase();
    if (!trimmed || trimmed.includes('*') || trimmed.includes('^')) {
      return '';
    }
    return trimmed;
  }

  async function loadSettings() {
    try {
      const stored = await browserApi.storage.local.get('settings');
      state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      trackerLists.custom = new Set((state.settings.customDomains || []).map((d) => d.toLowerCase().trim()).filter(Boolean));
      rebuildTrackerCache();
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao carregar configuracoes', error);
    }
  }

  function registerListeners() {
    browserApi.storage.onChanged.addListener(handleStorageChange);
    browserApi.tabs.onRemoved.addListener(handleTabRemoved);
    browserApi.tabs.onUpdated.addListener(handleTabUpdated);
    browserApi.runtime.onMessage.addListener(handleMessage);

    browserApi.webRequest.onBeforeRequest.addListener(
      handleWebRequest,
      { urls: ['<all_urls>'] },
      ['blocking']
    );

    browserApi.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId === 0) {
        resetTab(details.tabId, details.url);
      }
    });
  }

  function rebuildTrackerCache() {
    state.trackerCache = new Set([
      ...trackerLists.fallback,
      ...trackerLists.remote,
      ...trackerLists.custom
    ]);
  }

  function handleStorageChange(changes, area) {
    if (area !== 'local' || !changes.settings) return;
    state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    trackerLists.custom = new Set((state.settings.customDomains || []).map((d) => d.toLowerCase().trim()).filter(Boolean));
    rebuildTrackerCache();
  }

  function handleTabRemoved(tabId) {
    tabState.delete(tabId);
  }

  function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status === 'loading' && tab.url) {
      resetTab(tabId, tab.url);
    }
    if (changeInfo.status === 'complete' && tab.url) {
      refreshCookies(tabId, tab.url);
    }
  }

  function resetTab(tabId, url) {
    const domain = extractBaseDomain(url);
    tabState.set(tabId, createEmptyTabRecord(url, domain));
  }

  function createEmptyTabRecord(url, domain) {
    return {
      url,
      firstPartyDomain: domain,
      thirdPartyRequests: [],
      trackerHits: [],
      blockedRequests: [],
      cookies: {
        total: 0,
        firstParty: 0,
        thirdParty: 0,
        session: 0,
        persistent: 0,
        superCookies: []
      },
      cookieSyncSignals: [],
      storage: {
        local: { entries: 0, size: 0 },
        session: { entries: 0, size: 0 },
        indexedDB: { databases: 0 }
      },
      canvasFingerprints: [],
      hijackingAlerts: [],
      score: { value: 100, label: 'Sem dados' },
      lastUpdated: Date.now()
    };
  }

  function ensureTab(tabId, fallbackUrl) {
    if (!tabState.has(tabId)) {
      resetTab(tabId, fallbackUrl || '');
    }
    return tabState.get(tabId);
  }

  function handleWebRequest(details) {
    if (details.tabId === -1) return {};

    const tabInfo = ensureTab(details.tabId, details.documentUrl || details.initiator || details.url);
    if (details.type === 'main_frame') {
      resetTab(details.tabId, details.url);
      return {};
    }

    const targetHost = safeHostname(details.url);
    if (!targetHost) return {};

    const baseDomain = extractBaseDomainFromHost(targetHost);
    const firstParty = tabInfo.firstPartyDomain || extractBaseDomain(details.documentUrl || tabInfo.url || details.url);
    tabInfo.firstPartyDomain = firstParty;

    const isThirdParty = Boolean(firstParty && baseDomain && firstParty !== baseDomain);
    const isTracker = matchesTracker(targetHost) || (baseDomain && matchesTracker(baseDomain));
    const isSuspicious = detectHijacking(details.url);

    const record = {
      id: `${details.requestId}-${details.timeStamp}`,
      url: details.url,
      domain: baseDomain || targetHost,
      host: targetHost,
      type: details.type,
      tracker: isTracker,
      thirdParty: isThirdParty,
      timeStamp: details.timeStamp,
      blocked: false
    };

    let shouldBlock = false;
    if (isTracker && state.settings.blockingEnabled) {
      shouldBlock = true;
      record.blocked = true;
      tabInfo.blockedRequests.push(record);
      if (!tabInfo.trackerHits.find((hit) => hit.domain === record.domain)) {
        tabInfo.trackerHits.push({ domain: record.domain, host: record.host, url: record.url, timeStamp: record.timeStamp });
      }
      maybeNotifyBlocking(record);
    } else {
      if (isThirdParty) {
        tabInfo.thirdPartyRequests.push(record);
      }
      if (isTracker && !tabInfo.trackerHits.find((hit) => hit.domain === record.domain)) {
        tabInfo.trackerHits.push({ domain: record.domain, host: record.host, url: record.url, timeStamp: record.timeStamp });
      }
    }

    if (isSuspicious) {
      tabInfo.hijackingAlerts.push({
        url: details.url,
        reason: 'Possivel tentativa de hijacking detectada pelo padrao da URL',
        timeStamp: details.timeStamp
      });
      maybeNotifyHijacking(tabInfo, details.url);
    }

    tabInfo.lastUpdated = Date.now();
    recomputeScore(tabInfo);
    tabState.set(details.tabId, tabInfo);

    if (shouldBlock) {
      return { cancel: true };
    }

    return {};
  }

  function matchesTracker(hostOrDomain) {
    if (!hostOrDomain) return false;
    const target = hostOrDomain.toLowerCase();
    if (state.trackerCache.has(target)) return true;
    const parts = target.split('.');
    while (parts.length > 2) {
      parts.shift();
      const candidate = parts.join('.');
      if (state.trackerCache.has(candidate)) return true;
    }
    return state.trackerCache.has(parts.join('.'));
  }

  function detectHijacking(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return HIJACKING_KEYWORDS.some((keyword) => lower.includes(keyword));
  }

  function maybeNotifyBlocking(record) {
    if (!state.settings.notificationsEnabled) return;
    try {
      browserApi.notifications.create(`blocking-${record.id}`, {
        type: 'basic',
        iconUrl: browserApi.runtime.getURL('icons/icon-48.png'),
        title: 'Rastreador bloqueado',
        message: `${record.domain} foi bloqueado.`
      });
    } catch (error) {
      console.warn('[Privacy Sentinel] Falha ao gerar notificacao', error);
    }
  }

  function maybeNotifyHijacking(tabInfo, url) {
    if (!state.settings.notificationsEnabled) return;
    const text = `Possivel sequestro de navegador detectado em ${url}`;
    try {
      browserApi.notifications.create(`hijack-${Date.now()}`, {
        type: 'basic',
        iconUrl: browserApi.runtime.getURL('icons/icon-48.png'),
        title: 'Alerta de Hijacking',
        message: text
      });
    } catch (error) {
      console.warn('[Privacy Sentinel] Falha ao gerar notificacao de hijacking', error);
    }
  }

  function handleMessage(message, sender) {
    if (!message || typeof message !== 'object') return undefined;
    const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
    switch (message.type) {
      case 'storageSnapshot':
        if (!tabId) return undefined;
        updateStorageSnapshot(tabId, message.payload || {}, sender.tab && sender.tab.url);
        return undefined;
      case 'canvasFingerprint':
        if (!tabId) return undefined;
        registerCanvasFingerprint(tabId, message.payload || {});
        return undefined;
      case 'getTabData':
        return handleGetTabData(message.tabId);
      default:
        return undefined;
    }
  }

  function updateStorageSnapshot(tabId, payload, url) {
    const tabInfo = ensureTab(tabId, url);
    tabInfo.storage.local = payload.local || tabInfo.storage.local;
    tabInfo.storage.session = payload.session || tabInfo.storage.session;
    tabInfo.storage.indexedDB = payload.indexedDB || tabInfo.storage.indexedDB;
    recomputeScore(tabInfo);
    tabInfo.lastUpdated = Date.now();
    tabState.set(tabId, tabInfo);
  }

  function registerCanvasFingerprint(tabId, payload) {
    const tabInfo = ensureTab(tabId);
    tabInfo.canvasFingerprints.push({
      method: payload.method,
      stack: payload.stack,
      timeStamp: Date.now()
    });
    recomputeScore(tabInfo);
    tabInfo.lastUpdated = Date.now();
    tabState.set(tabId, tabInfo);
  }

  async function handleGetTabData(requestedTabId) {
    try {
      let targetTabId = requestedTabId;
      if (!targetTabId) {
        const [activeTab] = await browserApi.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab ? activeTab.id : undefined;
      }
      if (typeof targetTabId === 'undefined') {
        return { error: 'TAB_NOT_FOUND' };
      }

      let tabInfo = tabState.get(targetTabId);
      if (!tabInfo) {
        const tab = await browserApi.tabs.get(targetTabId);
        if (!isSupportedUrl(tab.url)) {
          return { error: 'UNSUPPORTED_URL' };
        }
        resetTab(targetTabId, tab.url);
        tabInfo = tabState.get(targetTabId);
      }

      if (!isSupportedUrl(tabInfo.url)) {
        return { error: 'UNSUPPORTED_URL' };
      }

      await refreshCookies(targetTabId, tabInfo.url);
      return serializeTabRecord(tabState.get(targetTabId));
    } catch (error) {
      console.error('[Privacy Sentinel] Erro ao buscar dados da aba', error);
      return { error: 'UNEXPECTED_ERROR' };
    }
  }

  async function refreshCookies(tabId, url) {
    try {
      const tabInfo = ensureTab(tabId, url);
      if (!tabInfo || !tabInfo.url || !isSupportedUrl(tabInfo.url)) return;
      if (!tabInfo.firstPartyDomain) return;

      const domainsToCheck = new Set();
      domainsToCheck.add(tabInfo.firstPartyDomain);
      const firstPartyHost = safeHostname(tabInfo.url);
      if (firstPartyHost) domainsToCheck.add(firstPartyHost);
      tabInfo.thirdPartyRequests.forEach((req) => {
        if (req.domain) domainsToCheck.add(req.domain);
        if (req.host) domainsToCheck.add(req.host);
      });
      tabInfo.blockedRequests.forEach((req) => {
        if (req.domain) domainsToCheck.add(req.domain);
        if (req.host) domainsToCheck.add(req.host);
      });

      const cookiesEntries = [];
      for (const domain of domainsToCheck) {
        try {
          const domainCookies = await browserApi.cookies.getAll({ domain });
          cookiesEntries.push(...domainCookies);
        } catch (error) {
          // ignorar dominios inacessiveis
        }
      }

      const aggregated = {
        total: 0,
        firstParty: 0,
        thirdParty: 0,
        session: 0,
        persistent: 0,
        superCookies: []
      };

      const syncCandidates = new Map();
      const firstPartyDomain = tabInfo.firstPartyDomain;

      cookiesEntries.forEach((cookie) => {
        aggregated.total += 1;
        const cookieDomain = extractBaseDomainFromCookie(cookie.domain);
        const isFirstParty = cookieDomain === firstPartyDomain;
        if (isFirstParty) {
          aggregated.firstParty += 1;
        } else {
          aggregated.thirdParty += 1;
        }
        if (cookie.session) {
          aggregated.session += 1;
        } else {
          aggregated.persistent += 1;
        }
        if (!cookie.session && cookie.expirationDate) {
          const lifetime = cookie.expirationDate * 1000 - Date.now();
          if (lifetime > 1000 * 60 * 60 * 24 * 365) {
            aggregated.superCookies.push({
              name: cookie.name,
              domain: cookie.domain,
              lifetimeDays: Math.round(lifetime / (1000 * 60 * 60 * 24))
            });
          }
        }
        if (cookie.value && cookie.value.length > 16) {
          const key = `${cookie.name}:${cookie.value}`;
          if (!syncCandidates.has(key)) {
            syncCandidates.set(key, new Set());
          }
          syncCandidates.get(key).add(cookieDomain || cookie.domain);
        }
      });

      tabInfo.cookies = aggregated;
      tabInfo.cookieSyncSignals = [];
      syncCandidates.forEach((domains, key) => {
        if (domains.size > 1) {
          tabInfo.cookieSyncSignals.push({
            cookie: key.split(':')[0],
            domains: Array.from(domains)
          });
        }
      });

      recomputeScore(tabInfo);
      tabInfo.lastUpdated = Date.now();
      tabState.set(tabId, tabInfo);
    } catch (error) {
      console.error('[Privacy Sentinel] Falha ao atualizar cookies', error);
    }
  }

  function serializeTabRecord(record) {
    if (!record) return null;
    return {
      url: record.url,
      firstPartyDomain: record.firstPartyDomain,
      thirdPartyRequests: record.thirdPartyRequests.slice(-100),
      trackerHits: record.trackerHits.slice(-100),
      blockedRequests: record.blockedRequests.slice(-100),
      cookies: record.cookies,
      cookieSyncSignals: record.cookieSyncSignals,
      storage: record.storage,
      canvasFingerprints: record.canvasFingerprints.slice(-20),
      hijackingAlerts: record.hijackingAlerts.slice(-20),
      score: record.score,
      lastUpdated: record.lastUpdated
    };
  }

  function recomputeScore(tabInfo) {
    if (!tabInfo) return;
    let score = 100;

    const thirdParty = Array.isArray(tabInfo.thirdPartyRequests) ? tabInfo.thirdPartyRequests : [];
    const uniqueThirdPartyDomains = new Set(
      thirdParty.filter((req) => !req.blocked).map((req) => req.domain).filter(Boolean)
    );
    score -= Math.min(40, uniqueThirdPartyDomains.size * 5);

    const blockedList = Array.isArray(tabInfo.blockedRequests) ? tabInfo.blockedRequests : [];
    const blockedTrackers = blockedList.filter((req) => req.tracker).length;
    score -= Math.min(20, blockedTrackers * 4);

    const cookiesInfo = tabInfo.cookies || {};
    const totalCookies = safeNumber(cookiesInfo.total);
    score -= Math.min(20, Math.floor(totalCookies / 5) * 5);

    const syncCount = Array.isArray(tabInfo.cookieSyncSignals) ? tabInfo.cookieSyncSignals.length : 0;
    if (syncCount > 0) {
      score -= Math.min(15, syncCount * 5);
    }

    const storageObj = tabInfo.storage || {};
    const storageEntries =
      safeNumber(storageObj.local && storageObj.local.entries) +
      safeNumber(storageObj.session && storageObj.session.entries);
    if (storageEntries > 0) {
      score -= 10;
    }

    const canvasCount = Array.isArray(tabInfo.canvasFingerprints) ? tabInfo.canvasFingerprints.length : 0;
    if (canvasCount > 0) {
      score -= 15;
    }

    const hijackCount = Array.isArray(tabInfo.hijackingAlerts) ? tabInfo.hijackingAlerts.length : 0;
    if (hijackCount > 0) {
      score -= Math.min(20, hijackCount * 5);
    }

    score = Math.max(0, Math.min(100, score));

    let label = 'Baixo risco';
    if (score < 40) {
      label = 'Alto risco';
    } else if (score < 70) {
      label = 'Atencao';
    }

    tabInfo.score = {
      value: score,
      label
    };
  }

  function isSupportedUrl(url) {
    if (!url) return false;
    try {
      const protocol = new URL(url).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function safeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function extractBaseDomain(url) {
    const hostname = safeHostname(url);
    if (!hostname) return '';
    return extractBaseDomainFromHost(hostname);
  }

  function extractBaseDomainFromHost(hostname) {
    if (!hostname) return '';
    const host = hostname.toLowerCase();
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (SECOND_LEVEL_TLDS.has(lastTwo)) {
      return parts.slice(-3).join('.');
    }
    return lastTwo;
  }

  function extractBaseDomainFromCookie(cookieDomain) {
    if (!cookieDomain) return '';
    const domain = cookieDomain.replace(/^\.+/, '');
    return extractBaseDomainFromHost(domain);
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return '';
    }
  }
})();
