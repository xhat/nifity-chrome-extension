/**
 * Anonymous daily usage counts for the Nifty extension.
 *
 * Privacy rules for this module:
 * - The only identifier is a random UUID generated locally once. Hardware is
 *   described only by the CPU brand string, logical core count and memory
 *   capacity that Chrome's system APIs (or the browser's coarse hints) expose;
 *   no serials, hardware UUIDs, feature flags or device model are read.
 * - Nothing about pages, URLs, filenames, cookies, accounts or IPs is sent;
 *   the request deliberately omits credentials and the Referer.
 * - Only normalized browser/OS names, a coarse OS version, an optional CPU
 *   model/logical cores/memory capacity and three counters leave the machine.
 * - Sending has no user setting: counts are collected while the extension is
 *   installed, and a failed send is retried on the next alarm/start instead of
 *   being hammered. Idle days are never sent.
 *
 * Pure helpers are exported so the counter/date logic can be tested in Node
 * without Chrome APIs; every `chrome.*` access happens inside functions.
 */

export const ANALYTICS_URL = 'https://nifty.ruoxie.com/api/v1/extension/daily';
export const ANALYTICS_ALARM = 'nifty:analytics-daily';
export const CLIENT_ID_KEY = 'niftyAnalyticsClientId';
export const DAILY_KEY = 'niftyAnalyticsDaily';

const DEBOUNCE_MS = 5_000;
const MIN_SEND_GAP_MS = 30_000;
const ALARM_DELAY_MINUTES = 10;
const ALARM_PERIOD_MINUTES = 24 * 60;
const REQUEST_TIMEOUT_MS = 8_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CPU_MODEL_LENGTH = 64;
const MAX_CORE_COUNT = 256;
const MAX_MEMORY_BYTES = 4 * 1024 ** 4; // 4 TiB
const MAX_MEMORY_GB = 1024;
const SYSTEM_INFO_TIMEOUT_MS = 2_000;

// MARK: - Pure helpers (date + counters)

/**
 * Local calendar day. The API accepts a local day as long as it is within one
 * day of UTC, so the extension sends the day the user is actually living in.
 * @param {Date} [date]
 */
export function dayKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** @param {string} day */
export function emptyDaily(day) {
  return { day, active: false, handoffs: 0, popup_opens: 0, lastSentDay: '', lastSentSignature: '', lastSentAt: 0 };
}

/**
 * Return a complete record for `day`, dropping counters from another day so a
 * local midnight resets everything except the send bookkeeping for that day.
 * @param {unknown} raw
 * @param {string} day
 */
export function normalizeDaily(raw, day) {
  if (!raw || typeof raw !== 'object' || raw.day !== day) return emptyDaily(day);
  const sameDay = raw.lastSentDay === day;
  return {
    day,
    active: raw.active === true,
    handoffs: count(raw.handoffs),
    popup_opens: count(raw.popup_opens),
    lastSentDay: sameDay ? day : '',
    lastSentSignature: sameDay && typeof raw.lastSentSignature === 'string' ? raw.lastSentSignature : '',
    lastSentAt: sameDay ? count(raw.lastSentAt) : 0,
  };
}

/** @param {{ day: string, active: boolean, handoffs: number, popup_opens: number }} daily */
export function metricsSignature(daily) {
  return `${daily.day}:${daily.active ? 1 : 0}:${count(daily.handoffs)}:${count(daily.popup_opens)}`;
}

/**
 * Apply one activity event. `active` is recorded daily, handoffs/popup opens
 * increment, and returning `changed` lets the caller skip redundant writes.
 * @param {unknown} raw
 * @param {'active'|'handoff'|'popup'} kind
 * @param {string} day
 */
export function bumpDaily(raw, kind, day) {
  const before = normalizeDaily(raw, day);
  const daily = { ...before };
  if (kind === 'handoff') {
    daily.active = true;
    daily.handoffs += 1;
  } else if (kind === 'popup') {
    daily.active = true;
    daily.popup_opens += 1;
  } else if (kind === 'active') {
    daily.active = true;
  }
  return { daily, changed: metricsSignature(daily) !== metricsSignature(before) };
}

export function hasActivity(daily) {
  return Boolean(daily && (daily.active || daily.handoffs > 0 || daily.popup_opens > 0));
}

/**
 * True only when today has activity that has not already been sent with these
 * exact numbers. The server keys on (product, client_hash, day), so resending
 * an unchanged summary would be a no-op network request.
 * @param {ReturnType<typeof emptyDaily>} daily
 */
export function shouldSend(daily) {
  if (!hasActivity(daily)) return false;
  if (daily.lastSentDay === daily.day && daily.lastSentSignature === metricsSignature(daily)) return false;
  return true;
}

// MARK: - Pure helpers (environment normalization)

/** Major version only; undefined input stays empty rather than throwing. */
export function normalizeChromeVersion(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? match[1] : '';
}

/**
 * CPU brand string as exposed by `chrome.system.cpu`. Printable ASCII only,
 * whitespace collapsed, truncated to the 64 characters the backend accepts.
 * A missing or unusable value stays empty; nothing is invented.
 * @param {unknown} value
 */
export function normalizeCpuModel(value) {
  const text = String(value ?? '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, MAX_CPU_MODEL_LENGTH);
}

/** Logical processor count from Chrome or `navigator.hardwareConcurrency`. */
export function normalizeCoreCount(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CORE_COUNT) return '';
  return value;
}

/** Exact memory capacity in bytes; values outside 1 B..4 TiB stay empty. */
export function normalizeMemoryBytes(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_MEMORY_BYTES) return '';
  return value;
}

/** Coarse GB value from `navigator.deviceMemory`; Chrome caps this at 8. */
export function normalizeMemoryGb(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > MAX_MEMORY_GB) return '';
  return Math.floor(value);
}

/**
 * Chrome's reduced UA is stable enough to name the engine and major version.
 * @param {string} userAgent
 */
export function detectBrowser(userAgent = '') {
  const ua = String(userAgent);
  if (/Edg\//.test(ua)) return { name: 'Edge', version: normalizeChromeVersion(ua.match(/Edg\/([^ ]+)/)?.[1]) };
  if (/OPR\//.test(ua)) return { name: 'Opera', version: normalizeChromeVersion(ua.match(/OPR\/([^ ]+)/)?.[1]) };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: normalizeChromeVersion(ua.match(/Firefox\/([^ ]+)/)?.[1]) };
  return { name: 'Chrome', version: normalizeChromeVersion(ua.match(/Chrome\/([^ ]+)/)?.[1]) };
}

function archFromUA(ua) {
  if (/arm64|aarch64/i.test(ua)) return 'arm64';
  if (/x86_64|Win64|x64|amd64|WOW64/i.test(ua)) return 'x86_64';
  if (/\barm\b/i.test(ua)) return 'arm';
  if (/i[3-6]86|i686/i.test(ua)) return 'x86';
  return 'unknown';
}

/**
 * Map high-entropy architecture/bitness to the same values the desktop app
 * reports. Falls back to the UA only when Chrome does not expose them.
 * @param {string} architecture
 * @param {string} bitness
 * @param {string} userAgent
 */
export function normalizeArch(architecture = '', bitness = '', userAgent = '') {
  const arch = String(architecture || '').toLowerCase();
  const bits = String(bitness || '');
  if (arch === 'arm' || arch === 'aarch64' || arch === 'arm64') return bits === '32' ? 'arm' : 'arm64';
  if (arch === 'x86' || arch === 'x86_64' || arch === 'amd64' || arch === 'x64') {
    return arch === 'x86' && bits !== '64' ? 'x86' : 'x86_64';
  }
  return archFromUA(String(userAgent || ''));
}

function versionFromUA(name, ua) {
  const pick = (pattern) => {
    const match = ua.match(pattern);
    return match ? normalizeChromeVersion(match[1]) : '';
  };
  if (name === 'macOS') return pick(/Mac OS X (\d+)/);
  if (name === 'Windows') return pick(/Windows NT (\d+)/);
  if (name === 'Chrome OS') return pick(/CrOS \w+ (\d+)/);
  if (name === 'Android') return pick(/Android (\d+)/);
  return '';
}

/**
 * @param {{ userAgent?: string, platform?: string, platformVersion?: string, architecture?: string, bitness?: string }} input
 */
export function detectOS(input = {}) {
  const ua = String(input.userAgent || '');
  const env = `${input.platform || ''} ${ua}`;
  let name = 'Unknown';
  if (/mac/i.test(env)) name = 'macOS';
  else if (/cros/i.test(env)) name = 'Chrome OS';
  else if (/win/i.test(env)) name = 'Windows';
  else if (/android/i.test(env)) name = 'Android';
  else if (/linux/i.test(env)) name = 'Linux';

  let version = '';
  const platformVersion = String(input.platformVersion || '');
  const major = platformVersion.match(/^\d+/);
  if (major) version = major[0];
  if (!version) version = versionFromUA(name, ua);

  return {
    name,
    version,
    arch: normalizeArch(input.architecture, input.bitness, ua),
  };
}

/**
 * `chrome.system.cpu` / `chrome.system.memory` are extension-only APIs: absent
 * without their manifest permissions, a service worker context, or platform
 * support. Promise and callback signatures both exist, so accept either and
 * never reject — fallbacks handle a missing value.
 * @param {'cpu'|'memory'} name
 * @returns {Promise<object|null>}
 */
function readSystemInfo(name) {
  const api = typeof chrome !== 'undefined' ? chrome?.system?.[name] : null;
  if (!api || typeof api.getInfo !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value && typeof value === 'object' ? value : null);
    };
    const timer = setTimeout(() => finish(null), SYSTEM_INFO_TIMEOUT_MS);
    try {
      const maybe = api.getInfo(finish);
      if (maybe && typeof maybe.then === 'function') maybe.then(finish, () => finish(null));
    } catch {
      // Some Chrome versions expose only the promise signature, so a callback
      // argument throws "No matching signature": retry without it.
      try {
        const maybe = api.getInfo();
        if (maybe && typeof maybe.then === 'function') maybe.then(finish, () => finish(null));
        else finish(null);
      } catch {
        finish(null);
      }
    }
  });
}

/**
 * Hardware fields for the payload `os` object.
 *
 * `chrome.system.cpu/memory` are primary because they expose exact values;
 * `navigator.hardwareConcurrency` / `navigator.deviceMemory` are the coarse
 * fallbacks. Physical/performance/efficiency core counts are never reported:
 * Chrome exposes only logical processors, so none are claimed.
 * @param {{
 *   cpuInfo?: { modelName?: string, numOfProcessors?: number } | null,
 *   memoryInfo?: { capacity?: number } | null,
 *   hardwareConcurrency?: number,
 *   deviceMemory?: number,
 * }} input
 */
export function describeHardware(input = {}) {
  const cpuInfo = input.cpuInfo || {};
  const memoryInfo = input.memoryInfo || {};
  const cores = normalizeCoreCount(cpuInfo.numOfProcessors) || normalizeCoreCount(input.hardwareConcurrency);
  const cpuModel = normalizeCpuModel(cpuInfo.modelName);
  const memoryBytes = normalizeMemoryBytes(memoryInfo.capacity);
  const memoryGb = normalizeMemoryGb(input.deviceMemory);

  const hardware = {};
  if (cpuModel) hardware.cpu_model = cpuModel;
  if (cores) hardware.cpu_logical_cores = cores;
  if (memoryBytes) hardware.memory_bytes = memoryBytes;
  if (memoryGb) hardware.memory_gb = memoryGb;
  return hardware;
}

/** Environment facts available to an extension service worker. */
export async function detectEnvironment() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const uaData = nav.userAgentData || null;
  const [cpuInfo, memoryInfo] = await Promise.all([readSystemInfo('cpu'), readSystemInfo('memory')]);
  let high = {};
  if (uaData && typeof uaData.getHighEntropyValues === 'function') {
    try {
      high = await uaData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness']);
    } catch {
      high = {};
    }
  }
  const browser = detectBrowser(nav.userAgent || '');
  const os = detectOS({
    userAgent: nav.userAgent || '',
    platform: high.platform || uaData?.platform || nav.platform || '',
    platformVersion: high.platformVersion || '',
    architecture: high.architecture || '',
    bitness: high.bitness || '',
  });

  // chrome.system.cpu counts logical processors; Chrome exposes no physical,
  // performance or efficiency core split. navigator.hardwareConcurrency is the
  // coarse fallback when the API is unavailable (or reports nonsense).
  Object.assign(os, describeHardware({
    cpuInfo,
    memoryInfo,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
  }));
  return { browser, os };
}

/** @param {{ clientId: string, day: string, extensionVersion: string, browser?: object, os?: object, metrics?: object }} input */
export function buildPayload(input) {
  const browser = input.browser || {};
  const os = input.os || {};
  const metrics = input.metrics || {};
  const payload = {
    client_id: String(input.clientId || ''),
    day: String(input.day || ''),
    extension_version: String(input.extensionVersion || ''),
    browser: {
      name: String(browser.name || 'Chrome'),
      version: String(browser.version || 'unknown'),
    },
    os: {
      name: String(os.name || 'Unknown'),
      version: String(os.version || 'unknown'),
      arch: String(os.arch || 'unknown'),
    },
    metrics: {
      active: metrics.active === true,
      handoffs: count(metrics.handoffs),
      popup_opens: count(metrics.popup_opens),
    },
  };
  const cpuModel = normalizeCpuModel(os.cpu_model);
  const cores = normalizeCoreCount(os.cpu_logical_cores);
  const memoryBytes = normalizeMemoryBytes(os.memory_bytes);
  const memoryGb = normalizeMemoryGb(os.memory_gb);
  if (cpuModel) payload.os.cpu_model = cpuModel;
  if (cores) payload.os.cpu_logical_cores = cores;
  if (memoryBytes) payload.os.memory_bytes = memoryBytes;
  if (memoryGb) payload.os.memory_gb = memoryGb;
  return payload;
}

// MARK: - Runtime (Chrome storage + network)

let queue = Promise.resolve();
let flushTimer = 0;
let started = false;

/** Serialize read/modify/write so concurrent events cannot lose a counter. */
function serialized(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function hasChrome() {
  return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id) && Boolean(chrome?.storage?.local);
}

async function saveDaily(daily) {
  await chrome.storage.local.set({ [DAILY_KEY]: daily });
}

async function readDaily(day) {
  const stored = await chrome.storage.local.get(DAILY_KEY);
  return { stored: stored?.[DAILY_KEY], daily: normalizeDaily(stored?.[DAILY_KEY], day) };
}

async function ensureClientId() {
  const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
  const existing = stored?.[CLIENT_ID_KEY];
  if (typeof existing === 'string' && UUID_RE.test(existing)) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: id });
  return id;
}

export function scheduleFlush(delayMs = DEBOUNCE_MS) {
  if (typeof setTimeout !== 'function') return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    void flushAnalytics('debounce');
  }, Math.max(0, delayMs));
}

/**
 * Record one activity event for today, then debounce a summary push.
 * @param {'active'|'handoff'|'popup'} kind
 */
export function record(kind) {
  if (!hasChrome()) return Promise.resolve(null);
  return serialized(async () => {
    const day = dayKey();
    const { stored, daily } = await readDaily(day);
    const result = bumpDaily(stored, kind, day);
    if (result.changed || (stored && stored.day !== day)) await saveDaily(result.daily);
    return result.daily;
  })
    .then((daily) => {
      if (daily) scheduleFlush();
      return daily;
    })
    .catch((error) => {
      console.warn('[nifty] could not record analytics', error);
      return null;
    });
}

export const recordActive = () => record('active');
export const recordHandoff = () => record('handoff');
export const recordPopupOpen = () => record('popup');

/**
 * Send today's counters if they changed. Never throws; a failure simply leaves
 * the record unsent so the next alarm or startup retries.
 * @param {'install'|'startup'|'alarm'|'debounce'|'event'} reason
 */
export function flushAnalytics(reason = 'event') {
  if (!hasChrome()) return Promise.resolve({ sent: false, reason: 'unavailable' });
  return serialized(async () => {
    const day = dayKey();
    const { stored, daily } = await readDaily(day);
    if (stored && JSON.stringify(stored) !== JSON.stringify(daily)) await saveDaily(daily);
    if (!shouldSend(daily)) return { sent: false, reason: 'unchanged' };

    const wait = daily.lastSentAt ? MIN_SEND_GAP_MS - (Date.now() - daily.lastSentAt) : 0;
    if (wait > 0) {
      scheduleFlush(wait);
      return { sent: false, reason: 'throttled' };
    }

    const clientId = await ensureClientId();
    const { browser, os } = await detectEnvironment();
    const payload = buildPayload({
      clientId,
      day,
      extensionVersion: chrome.runtime.getManifest().version,
      browser,
      os,
      metrics: daily,
    });

    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined;
    let response;
    try {
      response = await fetch(ANALYTICS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch {
      return { sent: false, reason: 'network' };
    }
    if (!response.ok) return { sent: false, reason: 'http', status: response.status };

    await saveDaily({
      ...daily,
      lastSentDay: day,
      lastSentSignature: metricsSignature(daily),
      lastSentAt: Date.now(),
    });
    return { sent: true, reason };
  }).catch((error) => {
    console.warn('[nifty] analytics send failed', error);
    return { sent: false, reason: 'error' };
  });
}

async function ensureAlarm() {
  try {
    const existing = await chrome.alarms.get(ANALYTICS_ALARM);
    if (existing) return;
    await chrome.alarms.create(ANALYTICS_ALARM, {
      delayInMinutes: ALARM_DELAY_MINUTES,
      periodInMinutes: ALARM_PERIOD_MINUTES,
    });
  } catch (error) {
    console.warn('[nifty] could not schedule analytics alarm', error);
  }
}

async function activate(reason) {
  await recordActive();
  await flushAnalytics(reason);
}

/**
 * Register install/startup/alarm handling and record one active day. Safe to
 * call from the service worker's top level; Chrome may evaluate the module on
 * every wake-up, so this only does work once per worker instance.
 */
export function initAnalytics() {
  if (started || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  started = true;

  chrome.runtime.onInstalled.addListener(() => {
    void activate('install');
  });
  chrome.runtime.onStartup.addListener(() => {
    void activate('startup');
  });
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name === ANALYTICS_ALARM) void flushAnalytics('alarm');
  });
  void ensureAlarm();
  void recordActive();
}
