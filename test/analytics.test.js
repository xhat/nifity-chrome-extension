import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPayload,
  bumpDaily,
  dayKey,
  describeHardware,
  detectBrowser,
  detectEnvironment,
  detectOS,
  emptyDaily,
  metricsSignature,
  normalizeArch,
  normalizeCoreCount,
  normalizeCpuModel,
  normalizeDaily,
  normalizeMemoryBytes,
  normalizeMemoryGb,
  shouldSend,
} from '../src/analytics.js';

const DAY = '2026-11-05';

test('dayKey uses the local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 10, 5, 23, 59, 59)), '2026-11-05');
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01');
  assert.equal(dayKey(new Date(2026, 8, 9, 12)), '2026-09-09');
});

test('normalizeDaily resets counters and send markers across a local midnight', () => {
  const yesterday = {
    day: '2026-11-04',
    active: true,
    handoffs: 9,
    popup_opens: 4,
    lastSentDay: '2026-11-04',
    lastSentSignature: '2026-11-04:1:9:4',
    lastSentAt: 1234,
  };
  assert.deepEqual(normalizeDaily(yesterday, DAY), emptyDaily(DAY));

  const today = { ...yesterday, day: DAY };
  const kept = normalizeDaily(today, DAY);
  assert.equal(kept.handoffs, 9);
  assert.equal(kept.popup_opens, 4);
  assert.equal(kept.active, true);
  assert.equal(kept.lastSentAt, 0, "yesterday's send marker cannot suppress today's summary");
  assert.equal(kept.lastSentSignature, '');
});

test('normalizeDaily rejects corrupt counters without throwing', () => {
  assert.deepEqual(normalizeDaily(null, DAY), emptyDaily(DAY));
  assert.deepEqual(normalizeDaily('nope', DAY), emptyDaily(DAY));
  const dirty = normalizeDaily({ day: DAY, active: 'yes', handoffs: -3, popup_opens: 2.9 }, DAY);
  assert.equal(dirty.active, false);
  assert.equal(dirty.handoffs, 0);
  assert.equal(dirty.popup_opens, 2);
});

test('bumpDaily records actives, handoffs and popup opens', () => {
  let daily = emptyDaily(DAY);
  let result = bumpDaily(daily, 'active', DAY);
  assert.equal(result.daily.active, true);
  assert.equal(result.changed, true);
  daily = result.daily;

  const secondActive = bumpDaily(daily, 'active', DAY);
  assert.equal(secondActive.changed, false, 'a repeat active does not rewrite storage');

  result = bumpDaily(daily, 'handoff', DAY);
  assert.equal(result.daily.handoffs, 1);
  assert.equal(result.daily.active, true);
  daily = result.daily;

  result = bumpDaily(daily, 'popup', DAY);
  assert.equal(result.daily.popup_opens, 1);
  assert.equal(result.daily.handoffs, 1, 'counters are independent');

  const rollover = bumpDaily(daily, 'handoff', '2026-11-06');
  assert.equal(rollover.daily.day, '2026-11-06');
  assert.equal(rollover.daily.handoffs, 1, 'a new day starts at zero before the bump');
});

test('shouldSend sends only new activity and never the same numbers twice', () => {
  const idle = emptyDaily(DAY);
  assert.equal(shouldSend(idle), false);

  const active = { ...idle, active: true };
  assert.equal(shouldSend(active), true);

  const sent = {
    ...active,
    lastSentDay: DAY,
    lastSentSignature: metricsSignature(active),
    lastSentAt: Date.now(),
  };
  assert.equal(shouldSend(sent), false, 'duplicate daily summary is skipped');

  const changed = { ...sent, handoffs: sent.handoffs + 1 };
  assert.equal(shouldSend(changed), true, 'a new handoff pushes an update');

  const nextDay = normalizeDaily(sent, '2026-11-06');
  const newDayActive = { ...nextDay, active: true };
  assert.equal(shouldSend(newDayActive), true, 'a new local day sends again');
});

test('browser detection keeps only the name and major version', () => {
  const chrome =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.55 Safari/537.36';
  assert.deepEqual(detectBrowser(chrome), { name: 'Chrome', version: '141' });
  assert.deepEqual(detectBrowser('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.61'), {
    name: 'Edge',
    version: '120',
  });
  assert.deepEqual(detectBrowser(''), { name: 'Chrome', version: '' });
});

test('OS normalization uses the coarse platform version and architecture', () => {
  const mac = detectOS({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    platform: 'macOS',
    platformVersion: '26.1.0',
    architecture: 'arm',
    bitness: '64',
  });
  assert.deepEqual(mac, { name: 'macOS', version: '26', arch: 'arm64' });

  const win = detectOS({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0',
    platform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
  });
  assert.deepEqual(win, { name: 'Windows', version: '15', arch: 'x86_64' });

  // No high-entropy values: fall back to the reduced UA.
  assert.deepEqual(detectOS({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0' }), {
    name: 'Linux',
    version: '',
    arch: 'x86_64',
  });
});

test('normalizeArch maps Chrome high-entropy values', () => {
  assert.equal(normalizeArch('arm', '64'), 'arm64');
  assert.equal(normalizeArch('arm', '32'), 'arm');
  assert.equal(normalizeArch('x86', '64'), 'x86_64');
  assert.equal(normalizeArch('x86', '32'), 'x86');
  assert.equal(normalizeArch('', '', 'Mozilla/5.0 (Macintosh; arm64)'), 'arm64');
  assert.equal(normalizeArch('', ''), 'unknown');
});

test('payload matches the extension analytics contract and carries no PII', () => {
  const payload = buildPayload({
    clientId: '3f24b9f0-5c9b-4f24-9f37-6a1c8b7d2e11',
    day: DAY,
    extensionVersion: '0.1.2',
    browser: { name: 'Chrome', version: '141' },
    os: { name: 'macOS', version: '26', arch: 'arm64' },
    metrics: { active: true, handoffs: 2, popup_opens: 1 },
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    'browser',
    'client_id',
    'day',
    'extension_version',
    'metrics',
    'os',
  ]);
  assert.deepEqual(Object.keys(payload.metrics).sort(), ['active', 'handoffs', 'popup_opens']);
  assert.deepEqual(payload.os, { name: 'macOS', version: '26', arch: 'arm64' });
  assert.equal(payload.metrics.active, true);
  assert.equal(payload.metrics.handoffs, 2);
  assert.equal(payload.metrics.popup_opens, 1);

  const serialized = JSON.stringify(payload);
  for (const forbidden of ['user_agent', 'User-Agent', 'Mozilla', 'http', 'cookie', 'referer', 'ip', 'hostname']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `payload leaks ${forbidden}`);
  }
  assert.equal('cpu_bucket' in payload.os, false, 'legacy CPU bucket is not sent');
  assert.equal('memory_bucket' in payload.os, false, 'legacy memory bucket is not sent');
});

test('payload values satisfy the backend validators', () => {
  const label = /^[\x20-\x7e]{1,32}$/;
  const version = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;
  const payload = buildPayload({
    clientId: '3f24b9f0-5c9b-4f24-9f37-6a1c8b7d2e11',
    day: DAY,
    extensionVersion: '0.1.2',
    browser: { name: 'Chrome', version: '141' },
    // An older caller may still supply legacy buckets; the payload must ignore them.
    os: { name: 'Windows', version: '15', arch: 'x86_64', cpu_bucket: '2-3', memory_bucket: '<2' },
    metrics: { active: true, handoffs: 0, popup_opens: 0 },
  });
  assert.match(payload.client_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.match(payload.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(payload.extension_version, version);
  assert.match(payload.browser.name, label);
  assert.match(payload.browser.version, label);
  assert.match(payload.os.name, label);
  assert.match(payload.os.version, label);
  assert.match(payload.os.arch, label);
  assert.equal('cpu_bucket' in payload.os, false, 'legacy CPU bucket is dropped');
  assert.equal('memory_bucket' in payload.os, false, 'legacy memory bucket is dropped');
});

test('normalizeCpuModel keeps a short printable ASCII brand string only', () => {
  assert.equal(normalizeCpuModel('  Apple\tM1\nMax  '), 'Apple M1 Max');
  assert.equal(normalizeCpuModel('Apple M1 Max\u0000\u0007'), 'Apple M1 Max');
  assert.equal(normalizeCpuModel('Apple \u00e9 M1'), 'Apple M1');
  assert.equal(normalizeCpuModel('Intel(R) Xeon(R) '.repeat(6)).length, 64);
  assert.equal(normalizeCpuModel(''), '');
  assert.equal(normalizeCpuModel(undefined), '');
});

test('hardware numeric fields reject values outside the backend contract', () => {
  assert.equal(normalizeCoreCount(10), 10);
  assert.equal(normalizeCoreCount(1), 1);
  assert.equal(normalizeCoreCount(256), 256);
  for (const bad of [0, -2, 257, 4.5, '4', null, undefined, NaN]) {
    assert.equal(normalizeCoreCount(bad), '', `core count ${bad} must be rejected`);
  }

  assert.equal(normalizeMemoryBytes(34359738368), 34359738368);
  for (const bad of [0, -1, 4 * 1024 ** 4 + 1, 1.5, '34359738368', null]) {
    assert.equal(normalizeMemoryBytes(bad), '', `memory bytes ${bad} must be rejected`);
  }

  assert.equal(normalizeMemoryGb(8), 8);
  assert.equal(normalizeMemoryGb(1024), 1024);
  for (const bad of [0, 0.5, -1, 1025, NaN, '8', undefined]) {
    assert.equal(normalizeMemoryGb(bad), '', `memory GB ${bad} must be rejected`);
  }
});

test('describeHardware prefers exact Chrome system values', () => {
  assert.deepEqual(
    describeHardware({
      cpuInfo: { modelName: 'Apple M1 Max', numOfProcessors: 10, features: ['sse'] },
      memoryInfo: { capacity: 34359738368, availableCapacity: 1024 },
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }),
    {
      cpu_model: 'Apple M1 Max',
      cpu_logical_cores: 10,
      memory_bytes: 34359738368,
      memory_gb: 8,
    },
  );
});

test('describeHardware falls back to browser hints and never invents a CPU model', () => {
  assert.deepEqual(describeHardware({ hardwareConcurrency: 6, deviceMemory: 4 }), {
    cpu_logical_cores: 6,
    memory_gb: 4,
  });

  // APIs exist but return unusable numbers: stay on the coarse hints.
  assert.deepEqual(
    describeHardware({
      cpuInfo: { numOfProcessors: 0, modelName: '' },
      memoryInfo: { capacity: 0 },
      hardwareConcurrency: 2,
      deviceMemory: 2,
    }),
    { cpu_logical_cores: 2, memory_gb: 2 },
  );

  assert.deepEqual(describeHardware({}), {});
});

test('payload carries detailed hardware fields when available', () => {
  const payload = buildPayload({
    clientId: '3f24b9f0-5c9b-4f24-9f37-6a1c8b7d2e11',
    day: DAY,
    extensionVersion: '0.1.4',
    browser: { name: 'Chrome', version: '141' },
    os: {
      name: 'macOS',
      version: '26',
      arch: 'arm64',
      cpu_model: 'Apple M1 Max',
      cpu_logical_cores: 10,
      memory_bytes: 34359738368,
      memory_gb: 8,
    },
    metrics: { active: true, handoffs: 2, popup_opens: 1 },
  });

  assert.deepEqual(payload.os, {
    name: 'macOS',
    version: '26',
    arch: 'arm64',
    cpu_model: 'Apple M1 Max',
    cpu_logical_cores: 10,
    memory_bytes: 34359738368,
    memory_gb: 8,
  });
  assert.equal(payload.os.cpu_physical_cores, undefined, 'Chrome exposes logical processors only');
  assert.equal('performance_cores' in payload.os, false);
  assert.equal('efficiency_cores' in payload.os, false);
});

test('payload drops detailed fields that violate the contract', () => {
  const payload = buildPayload({
    clientId: '3f24b9f0-5c9b-4f24-9f37-6a1c8b7d2e11',
    day: DAY,
    extensionVersion: '0.1.4',
    browser: { name: 'Chrome', version: '141' },
    os: {
      name: 'Windows',
      version: '15',
      arch: 'x86_64',
      cpu_model: '\u0000\u0007',
      cpu_logical_cores: 0,
      memory_bytes: -1,
      memory_gb: 2048,
    },
    metrics: { active: true, handoffs: 0, popup_opens: 0 },
  });
  assert.deepEqual(payload.os, { name: 'Windows', version: '15', arch: 'x86_64' });
});

test('detailed hardware payload leaks no identifiers or fingerprint flags', () => {
  const payload = buildPayload({
    clientId: '3f24b9f0-5c9b-4f24-9f37-6a1c8b7d2e11',
    day: DAY,
    extensionVersion: '0.1.4',
    browser: { name: 'Chrome', version: '141' },
    os: {
      name: 'macOS',
      version: '26',
      arch: 'arm64',
      cpu_model: 'Apple M1 Max',
      cpu_logical_cores: 10,
      memory_bytes: 34359738368,
      memory_gb: 8,
    },
    metrics: { active: true, handoffs: 0, popup_opens: 0 },
  });
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'features',
    'serial',
    'hardware_uuid',
    'hostname',
    'device_model',
    'mac_address',
    'user_agent',
    'mozilla',
  ]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `payload leaks ${forbidden}`);
  }
  assert.match(payload.os.cpu_model, /^[\x20-\x7e]{1,64}$/);
  assert.ok(payload.os.cpu_logical_cores >= 1 && payload.os.cpu_logical_cores <= 256);
  assert.ok(payload.os.memory_bytes <= 4 * 1024 ** 4);
  assert.ok(payload.os.memory_gb <= 1024);
});

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.55 Safari/537.36';

function setGlobal(key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else delete globalThis[key];
  };
}

test('detectEnvironment uses chrome.system CPU and memory when exposed', async () => {
  const restoreChrome = setGlobal('chrome', {
    system: {
      cpu: {
        getInfo: async () => ({ modelName: 'Apple M1 Max', numOfProcessors: 10, features: ['sse4_2'] }),
      },
      memory: {
        getInfo: (callback) => callback({ capacity: 34359738368, availableCapacity: 1024 }),
      },
    },
  });
  const restoreNavigator = setGlobal('navigator', {
    userAgent: CHROME_UA,
    platform: 'MacIntel',
    hardwareConcurrency: 8,
    deviceMemory: 8,
  });
  try {
    const { browser, os } = await detectEnvironment();
    assert.deepEqual(browser, { name: 'Chrome', version: '141' });
    assert.deepEqual(os, {
      name: 'macOS',
      version: '10',
      arch: 'unknown',
      cpu_model: 'Apple M1 Max',
      cpu_logical_cores: 10,
      memory_bytes: 34359738368,
      memory_gb: 8,
    });
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

test('detectEnvironment falls back to browser hints without the system APIs', async () => {
  const restoreChrome = setGlobal('chrome', undefined);
  const restoreNavigator = setGlobal('navigator', {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    platform: 'Win32',
    hardwareConcurrency: 6,
    deviceMemory: 4,
  });
  try {
    const { os } = await detectEnvironment();
    assert.deepEqual(os, {
      name: 'Windows',
      version: '10',
      arch: 'x86_64',
      cpu_logical_cores: 6,
      memory_gb: 4,
    });
    assert.equal('cpu_model' in os, false, 'no CPU model is claimed without chrome.system.cpu');
    assert.equal('memory_bytes' in os, false, 'no exact capacity is claimed without chrome.system.memory');
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

test('detectEnvironment handles a promise-only getInfo signature', async () => {
  const restoreChrome = setGlobal('chrome', {
    system: {
      cpu: {
        // Promise-only APIs throw when handed a callback ("No matching signature").
        getInfo: (callback) => {
          if (callback) throw new Error('No matching signature');
          return Promise.resolve({
            modelName: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz',
            numOfProcessors: 12,
            features: ['sse4_2'],
          });
        },
      },
      memory: {
        getInfo: () => Promise.resolve({ capacity: 17179869184, availableCapacity: 1 }),
      },
    },
  });
  const restoreNavigator = setGlobal('navigator', {
    userAgent: CHROME_UA,
    platform: 'MacIntel',
    hardwareConcurrency: 12,
    deviceMemory: 8,
  });
  try {
    const { os } = await detectEnvironment();
    assert.deepEqual(os, {
      name: 'macOS',
      version: '10',
      arch: 'unknown',
      cpu_model: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz',
      cpu_logical_cores: 12,
      memory_bytes: 17179869184,
      memory_gb: 8,
    });
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

test('detectEnvironment survives system APIs that throw or reject', async () => {
  const restoreChrome = setGlobal('chrome', {
    system: {
      cpu: {
        getInfo: () => {
          throw new Error('not supported on this platform');
        },
      },
      memory: { getInfo: () => Promise.reject(new Error('unavailable')) },
    },
  });
  const restoreNavigator = setGlobal('navigator', {
    userAgent: CHROME_UA,
    platform: 'MacIntel',
    hardwareConcurrency: 3,
    deviceMemory: 2,
  });
  try {
    const { os } = await detectEnvironment();
    assert.deepEqual(os, {
      name: 'macOS',
      version: '10',
      arch: 'unknown',
      cpu_logical_cores: 3,
      memory_gb: 2,
    });
  } finally {
    restoreNavigator();
    restoreChrome();
  }
});

