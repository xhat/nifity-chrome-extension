const DEFAULTS = { monitorDownloads: true, monitorVideos: true, language: null };

const els = {
  downloads: document.getElementById('monitorDownloads'),
  videos: document.getElementById('monitorVideos'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  version: document.getElementById('version'),
  language: document.getElementById('language'),
};

let retryTimer = 0;
let retryDelay = 1000;
let connecting = false;
let lang = 'en';
let currentStatus = 'off';

function t(key, vars) {
  return NiftyI18n.t(lang, key, vars);
}

function applyLanguage(value) {
  lang = NiftyI18n.normalize(value);
  els.language.value = lang;
  NiftyI18n.apply(document, lang);
  setStatus(currentStatus);
}

function stopAutoRetry() {
  clearTimeout(retryTimer);
  retryTimer = 0;
}

function scheduleAutoRetry() {
  if (retryTimer || connecting) return;
  retryTimer = setTimeout(() => {
    retryTimer = 0;
    void reconnect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10000);
}

async function reconnect() {
  if (connecting || els.status.dataset.state === 'on') return;
  connecting = true;
  stopAutoRetry();
  let ok = false;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'nifty:reconnect' });
    ok = Boolean(result?.connected);
  } catch {
    ok = false;
  }
  connecting = false;
  setStatus(ok ? 'on' : 'off');
  if (ok) {
    retryDelay = 1000;
  } else {
    scheduleAutoRetry();
  }
}

function setStatus(state) {
  currentStatus = state === 'on' ? 'on' : 'off';
  if (state === 'on') {
    els.status.dataset.state = 'on';
    els.statusText.textContent = '';
    els.status.title = t('popup.status.connected');
    els.status.setAttribute('aria-label', t('popup.status.connected'));
  } else {
    // Keep this exact state during retries: swapping to a "connecting" state
    // made the prompt flash away and back on every failed attempt.
    els.status.dataset.state = 'off';
    els.statusText.textContent = t('popup.status.offline');
    els.status.title = '';
    els.status.setAttribute('aria-label', t('popup.status.offlineAria'));
  }
}

function setToggle(input, value) {
  input.checked = Boolean(value);
}

async function refreshState() {
  let state = null;
  try {
    state = await chrome.runtime.sendMessage({ type: 'nifty:get-state' });
  } catch {
    state = null;
  }

  if (!state) {
    setStatus('off');
    scheduleAutoRetry();
    return;
  }
  if (typeof state.settings?.monitorDownloads === 'boolean') {
    setToggle(els.downloads, state.settings.monitorDownloads);
  }
  if (typeof state.settings?.monitorVideos === 'boolean') {
    setToggle(els.videos, state.settings.monitorVideos);
  }
  setStatus(state.connected ? 'on' : 'off');
  if (state.connected) {
    retryDelay = 1000;
    stopAutoRetry();
  } else {
    void reconnect();
  }
}

for (const input of [els.downloads, els.videos]) {
  input.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ [input.id]: input.checked });
    } catch {
      input.checked = !input.checked;
      return;
    }
  });
}

window.addEventListener('pagehide', stopAutoRetry);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'nifty:status') return;
  const on = Boolean(message.connected);
  setStatus(on ? 'on' : 'off');
  if (on) {
    retryDelay = 1000;
    stopAutoRetry();
  } else {
    scheduleAutoRetry();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('monitorDownloads' in changes) setToggle(els.downloads, changes.monitorDownloads.newValue);
  if ('monitorVideos' in changes) setToggle(els.videos, changes.monitorVideos.newValue);
  if ('language' in changes) applyLanguage(changes.language.newValue);
});

els.version.textContent = `v${chrome.runtime.getManifest().version}`;

els.language.addEventListener('change', async () => {
  const value = NiftyI18n.normalize(els.language.value);
  applyLanguage(value);
  try {
    await chrome.storage.local.set({ language: value });
  } catch {
    // storage is unavailable; the UI still switched for this session
  }
});

chrome.storage.local
  .get(DEFAULTS)
  .then((stored) => {
    applyLanguage(stored.language || NiftyI18n.browserLanguage());
    setToggle(els.downloads, stored.monitorDownloads);
    setToggle(els.videos, stored.monitorVideos);
  })
  .catch(() => {});

// Counted once per popup open; no page or tab data is involved.
chrome.runtime.sendMessage({ type: 'nifty:popup-open' }).catch(() => {});

void refreshState();
