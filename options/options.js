(() => {
  'use strict';

  const browserApi = typeof browser !== 'undefined' ? browser : chrome;
  const textarea = document.getElementById('custom-domains');
  const saveBtn = document.getElementById('save-custom');
  const resetBtn = document.getElementById('reset-custom');
  const blockingCheckbox = document.getElementById('enable-blocking');
  const notificationCheckbox = document.getElementById('enable-notifications');
  const statusEl = document.createElement('p');
  statusEl.className = 'status';
  document.body.appendChild(statusEl);

  const DEFAULT_SETTINGS = {
    blockingEnabled: true,
    notificationsEnabled: true,
    customDomains: []
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    bind();
  });

  async function loadSettings() {
    try {
      const stored = await browserApi.storage.local.get('settings');
      const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
      textarea.value = (settings.customDomains || []).join('\n');
      blockingCheckbox.checked = settings.blockingEnabled;
      notificationCheckbox.checked = settings.notificationsEnabled;
    } catch (error) {
      showStatus('Falha ao carregar configurações.', true);
    }
  }

  function bind() {
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const customDomains = textarea.value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const settings = {
          blockingEnabled: blockingCheckbox.checked,
          notificationsEnabled: notificationCheckbox.checked,
          customDomains
        };
        try {
          await browserApi.storage.local.set({ settings });
          showStatus('Configurações salvas.');
        } catch (error) {
          showStatus('Erro ao salvar configurações.', true);
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        try {
          await browserApi.storage.local.set({ settings: DEFAULT_SETTINGS });
          await loadSettings();
          showStatus('Configurações redefinidas.');
        } catch (error) {
          showStatus('Não foi possível redefinir.', true);
        }
      });
    }
  }

  function showStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('error', isError);
    statusEl.classList.toggle('ok', !isError);
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
  }
})();

