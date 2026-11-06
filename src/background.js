import {
  NIFTY_SUBPROTOCOL,
  NIFTY_HEALTH_URL,
  NIFTY_WS_URL,
  basename,
  buildRequestFrame,
  filenameFromDisposition,
  filenameFromURL,
  makeFilename,
} from './lib/protocol.js';
import { classifyMedia, isNegligibleMedia, parseHlsMaster, responseTotalSize } from './lib/media.js';
import './lib/x-media.js';
import { initAnalytics, recordHandoff, recordPopupOpen } from './analytics.js';

const { mediaKey: xMediaKey, syndicationURL, videosFromTweet } = globalThis.NiftyXMedia;

const SETTINGS_DEFAULTS = Object.freeze({
  monitorDownloads: true,
  monitorVideos: true,
});
const MEDIA_KEY = 'niftyMediaByTab';
const MAX_MEDIA_PER_TAB = 64;
const MAX_RESPONSE_META = 256;

/** @type {Record<string, boolean>} */
let settings = { ...SETTINGS_DEFAULTS };
const settingsReady = chrome.storage.local.get(SETTINGS_DEFAULTS).then((stored) => {
  settings = { ...SETTINGS_DEFAULTS, ...stored };
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (key in changes) settings[key] = Boolean(changes[key].newValue);
  }
  if ('monitorVideos' in changes && !settings.monitorVideos) {
    void clearAllMedia();
  }
});

// MARK: - Analytics

// Registers install/startup/alarm handlers and records today as active. Sends
// only anonymous daily counters; see analytics.js for the exact payload.
initAnalytics();

// MARK: - Bridge

let socket = null;
let connecting = null;
let connected = false;
let offlineFlash = 0;

function setConnected(value) {
  if (connected === value) return;
  connected = value;
  chrome.runtime.sendMessage({ type: 'nifty:status', connected }).catch(() => {});
}

function sendFrame(frame) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(frame);
    return true;
  } catch {
    return false;
  }
}

function openSocket(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let ws;
    try {
      ws = new WebSocket(NIFTY_WS_URL, NIFTY_SUBPROTOCOL);
    } catch {
      resolve(false);
      return;
    }
    socket = ws;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok && socket === ws) {
        socket = null;
        try {
          ws.close();
        } catch {
          // already closed
        }
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), Math.max(200, timeoutMs));

    ws.addEventListener('open', () => {
      setConnected(true);
      finish(true);
    });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      lastProbe = { at: 0, ok: false };
      setConnected(false);
      finish(false);
    });
    ws.addEventListener('error', () => {
      lastProbe = { at: 0, ok: false };
      setConnected(false);
      finish(false);
    });
    // Nifty deliberately sends nothing back. Keep the listener so a future
    // `waiting`/`Version=` message does not surface as an unhandled event.
    ws.addEventListener('message', () => {});
  });
}

/**
 * A WebSocket to a closed port is reported by Chrome on the extension's Errors
 * page even when its `error` event is handled. Probe the bridge's `/health`
 * endpoint first; only then create the WebSocket. A refused fetch is caught and
 * never becomes a runtime error for background.js.
 */
let lastProbe = { at: 0, ok: false };

async function probeNifty(timeoutMs = 700) {
  const now = Date.now();
  if (now - lastProbe.at < 1000) return lastProbe.ok;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let ok = false;
  try {
    await fetch(NIFTY_HEALTH_URL, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    ok = true;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  lastProbe = { at: Date.now(), ok };
  return ok;
}

/** Resolve true when a socket is open, waiting at most `timeoutMs` for one. */
async function ensureSocket(timeoutMs = 1400) {
  if (socket && socket.readyState === WebSocket.OPEN) return true;
  if (!(await probeNifty())) return false;
  if (!connecting) {
    connecting = openSocket(timeoutMs).finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

function flashOffline() {
  const now = Date.now();
  if (now - offlineFlash < 3000) return;
  offlineFlash = now;
  chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setTitle({ title: 'Nifty 未运行，下载仍由 Chrome 处理' });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Nifty' });
  }, 4000);
}

// No idle polling: when Nifty is closed, every `new WebSocket` attempt is logged
// by Chrome as ERR_CONNECTION_REFUSED. Connect only for a real download, a video
// hand-off, or an explicit popup retry.

// MARK: - Download interception

/** Response metadata captured before Chrome hands the download to `downloads`. */
const responseMeta = new Map();
const recentlySent = new Map();

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  const found = (headers || []).find((h) => String(h.name).toLowerCase() === wanted);
  return found ? String(found.value ?? '') : '';
}

function rememberResponse(details) {
  const mime = headerValue(details.responseHeaders, 'content-type');
  const length = Number.parseInt(headerValue(details.responseHeaders, 'content-length'), 10);
  const disposition = headerValue(details.responseHeaders, 'content-disposition');
  const filename = filenameFromDisposition(disposition);
  // A 206 carries only the requested range; `content-range` has the file total.
  // Redirects and errors are not the media at all, so their bodies are ignored.
  const size = responseTotalSize(
    details.statusCode,
    length,
    headerValue(details.responseHeaders, 'content-range'),
  );

  if (/^https?:/i.test(details.url) && (mime || size || filename)) {
    responseMeta.set(details.url, { mime, size, filename, at: Date.now() });
    if (responseMeta.size > MAX_RESPONSE_META) {
      for (const [url, value] of responseMeta) {
        if (Date.now() - value.at > 60_000 || responseMeta.size > MAX_RESPONSE_META) {
          responseMeta.delete(url);
        }
        if (responseMeta.size <= MAX_RESPONSE_META) break;
      }
    }
  }

  const kind = classifyMedia(details.url, mime);
  const statusCode = details.statusCode;
  if (kind) {
    void recordMedia(details, { kind, mime, size, filename, statusCode });
  } else if (details.type === 'media') {
    // A <video>/<audio> request whose response looks opaque is still a media
    // stream; Nifty may or may not be able to fetch it, but hiding it would be
    // worse than listing it.
    void recordMedia(details, { kind: 'video', mime, size, filename, statusCode });
  }
}

chrome.webRequest.onHeadersReceived.addListener(
  rememberResponse,
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'object', 'xmlhttprequest', 'media', 'other'] },
  ['responseHeaders'],
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Some streams never expose headers to webRequest; the request type alone
    // is the signal. Headers (when they arrive) will enrich this row.
    if (details.type === 'media') {
      void recordMedia(details, { kind: 'video', mime: '', size: 0, filename: '' });
    }
  },
  { urls: ['<all_urls>'], types: ['media'] },
);

function chooseDownloadFilename(item, meta) {
  const fromHeaders = meta?.filename || '';
  if (fromHeaders) return fromHeaders;
  const fromURL = filenameFromURL(item.finalUrl || item.url);
  if (fromURL && /\.[A-Za-z0-9]{1,8}$/.test(fromURL)) return fromURL;
  const proposed = basename(item.filename);
  if (proposed && proposed !== 'download' && proposed !== '下载') return proposed;
  return fromURL || proposed;
}

async function tabInfo(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function cookieHeader(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    const usable = cookies.filter((cookie) => cookie.name && cookie.value != null);
    return usable.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  } catch {
    return '';
  }
}

function headersFor(url, pageURL, cookies) {
  const headers = {};
  if (cookies) headers.Cookie = cookies;
  if (pageURL) {
    headers.Referer = pageURL;
    try {
      headers.Origin = new URL(pageURL).origin;
    } catch {
      // pageURL may be a data: or blob: URL; no Origin then.
    }
  }
  headers['User-Agent'] = navigator.userAgent;
  return headers;
}

function cappedFrame(args) {
  let frame = buildRequestFrame(args);
  // The official bridge silently drops frames above 118784 bytes. A giant
  // cookie jar is the only realistic way to get there; dropping the Cookie
  // header is better than handing Nifty nothing.
  if (frame.length > 118_000 && args.headers.Cookie) {
    const headers = { ...args.headers };
    delete headers.Cookie;
    frame = buildRequestFrame({ ...args, headers });
  }
  return frame;
}

async function buildDownloadFrame(item, kind) {
  const url = item.finalUrl || item.url;
  const [tab, cookies] = await Promise.all([tabInfo(item.tabId), cookieHeader(url)]);
  const meta = responseMeta.get(url) || responseMeta.get(item.url);
  const pageURL = item.referrer || tab?.url || '';
  return cappedFrame({
    method: 'GET',
    url,
    filename: chooseDownloadFilename(item, meta),
    pageTitle: tab?.title || '',
    openerURL: tab?.url || pageURL,
    kind,
    headers: headersFor(url, pageURL, cookies),
    size: meta?.size || item.totalBytes || item.fileSize || 0,
    mime: meta?.mime || item.mime || '',
  });
}

async function handleDownload(item) {
  await settingsReady;
  if (!settings.monitorDownloads) return;
  if (!/^https?:/i.test(item.url || '')) return;
  if (item.byExtensionId === chrome.runtime.id) return; // our own fallback re-download

  const key = item.finalUrl || item.url;
  const sentAt = recentlySent.get(key);
  if (sentAt && Date.now() - sentAt < 2500) return;

  // Don't cancel a transfer that already finished while the bridge was asleep.
  let live = null;
  try {
    [live] = await chrome.downloads.search({ id: item.id });
  } catch {
    return;
  }
  if (!live || live.state !== 'in_progress') return;

  const online = await ensureSocket(1300);
  if (!online) {
    flashOffline();
    return;
  }

  try {
    [live] = await chrome.downloads.search({ id: item.id });
  } catch {
    // keep the item we already have
  }
  if (!live || live.state !== 'in_progress') return;

  if (recentlySent.size > 200) {
    const cutoff = Date.now() - 60_000;
    for (const [url, at] of recentlySent) {
      if (at < cutoff) recentlySent.delete(url);
    }
    if (recentlySent.size > 300) recentlySent.clear();
  }
  recentlySent.set(key, Date.now());
  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch (error) {
    console.warn('[nifty] could not cancel Chrome download', error);
  }

  let frame = '';
  try {
    frame = await buildDownloadFrame(live, 'normal');
  } catch (error) {
    console.warn('[nifty] could not build request', error);
  }

  if (!frame || !sendFrame(frame)) {
    // Nifty vanished between the connect check and the send. Put the download
    // back in Chrome's hands rather than losing it.
    recentlySent.delete(key);
    try {
      await chrome.downloads.download({
        url: live.finalUrl || live.url,
        conflictAction: 'uniquify',
      });
    } catch (error) {
      console.warn('[nifty] could not hand the download back to Chrome', error);
    }
  } else {
    void recordHandoff();
  }
}

chrome.downloads.onCreated.addListener((item) => {
  void handleDownload(item).catch((error) => console.warn('[nifty] download interception failed', error));
});

// MARK: - Video sniffing

/** @type {Record<string, Array<object>>} */
let mediaByTab = {};
/** Pending record chains, keyed by tab + URL; see `recordMedia`. */
const mediaQueues = new Map();
/** Rendition playlist URLs claimed by a master, per tab; only masters are listed. */
const hlsVariants = new Map();
/** X media keys resolved to their MP4 files, per tab; sniffed fragments of them are dropped. */
const xResolved = new Map();
const mediaReady = chrome.storage.session
  .get(MEDIA_KEY)
  .then((stored) => {
    mediaByTab = stored?.[MEDIA_KEY] && typeof stored[MEDIA_KEY] === 'object' ? stored[MEDIA_KEY] : {};
    for (const [tabId, list] of Object.entries(mediaByTab)) {
      const variants = new Set();
      const resolved = new Set();
      for (const item of list) {
        for (const url of item.variants || []) variants.add(url);
        if (item.source === 'x' && item.mediaKey) resolved.add(item.mediaKey);
      }
      if (variants.size) hlsVariants.set(String(tabId), variants);
      if (resolved.size) xResolved.set(String(tabId), resolved);
    }
  })
  .catch(() => {
    mediaByTab = {};
  });

function persistMedia() {
  return chrome.storage.session.set({ [MEDIA_KEY]: mediaByTab }).catch(() => {});
}

function pushTabMedia(tabId) {
  chrome.tabs
    .sendMessage(tabId, {
      type: 'nifty:media-updated',
      items: mediaByTab[tabId] || [],
    })
    .catch(() => {});
}

function inferMediaFilename(url, pageTitle, kind) {
  const fromURL = filenameFromURL(url);
  if (fromURL && /\.(mp4|m4v|webm|mov|mkv|avi|flv|wmv|mpe?g|mpg|3gp|ogv|ogm|m3u8|m3u)$/i.test(fromURL)) {
    return fromURL;
  }
  const title = makeFilename(pageTitle || '', '');
  if (!title) return fromURL;
  return kind === 'hls' ? `${title}.m3u8` : `${title}.mp4`;
}

function knownHlsVariant(tabId, url) {
  return hlsVariants.get(String(tabId))?.has(url) === true;
}

function isXResolved(tabId, key) {
  return Boolean(key) && xResolved.get(String(tabId))?.has(key) === true;
}

/** `fetch` with a deadline; resolves `null` on network failure or timeout. */
async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// MARK: - X videos

/** Syndication lookups by tweet id, shared across tabs; failures are not cached. */
const tweetCache = new Map();
const MAX_TWEET_CACHE = 200;

function fetchTweet(tweetId) {
  const cached = tweetCache.get(tweetId);
  if (cached) return cached;
  const pending = timedFetch(syndicationURL(tweetId), { cache: 'no-store', credentials: 'omit' }, 6000)
    .then((response) => (response?.ok ? response.json() : null))
    .catch(() => null);
  tweetCache.set(tweetId, pending);
  if (tweetCache.size > MAX_TWEET_CACHE) tweetCache.delete(tweetCache.keys().next().value);
  void pending.then((tweet) => {
    if (!tweet && tweetCache.get(tweetId) === pending) tweetCache.delete(tweetId);
  });
  return pending;
}

async function remoteSize(url) {
  const response = await timedFetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'omit' }, 5000);
  return response?.ok ? responseTotalSize(200, response.headers.get('content-length'), '') : 0;
}

/**
 * Replace everything sniffed for one X video (master playlist, renditions) with
 * its progressive MP4 files, one row per resolution. The content script names
 * the media key (from the `<video>` poster) and the tweet ids around it; the
 * first tweet whose metadata contains that key wins.
 *
 * @returns {Promise<boolean>} whether the video was resolved
 */
async function resolveXMedia(tabId, frameId, key, tweetIds, pageURL) {
  await Promise.all([settingsReady, mediaReady]);
  if (!settings.monitorVideos) return false;
  if (isXResolved(tabId, key)) {
    pushTabMedia(tabId);
    return true;
  }

  let video = null;
  for (const tweetId of tweetIds) {
    const tweet = await fetchTweet(tweetId);
    video = tweet ? videosFromTweet(tweet).find((entry) => entry.key === key) : null;
    if (video) break;
  }
  if (!video) return false;

  const [tab, sizes] = await Promise.all([
    tabInfo(tabId),
    Promise.all(video.variants.map((variant) => remoteSize(variant.url))),
  ]);
  // The lookups yield; a navigation in between makes this answer stale.
  if (!settings.monitorVideos || !tab || (pageURL && tab.url !== pageURL)) return false;

  const base = [video.screenName, video.tweetId].filter(Boolean).join('_') || key.replace(/\W+/g, '_');
  const rows = video.variants.map((variant, index) => ({
    url: variant.url,
    kind: 'video',
    mime: 'video/mp4',
    size: sizes[index] || 0,
    filename: makeFilename(variant.resolution ? `${base}_${variant.resolution}` : base, '.mp4'),
    pageURL: tab.url || '',
    pageTitle: tab.title || '',
    frameId,
    mediaKey: key,
    source: 'x',
    quality: variant.resolution,
    bitrate: variant.bitrate,
    at: Date.now(),
  }));

  const tabKey = String(tabId);
  const resolved = xResolved.get(tabKey) || new Set();
  resolved.add(key);
  xResolved.set(tabKey, resolved);

  const urls = new Set(rows.map((row) => row.url));
  const list = (mediaByTab[tabId] || []).filter((entry) => entry.mediaKey !== key && !urls.has(entry.url));
  list.push(...rows);
  if (list.length > MAX_MEDIA_PER_TAB) list.splice(0, list.length - MAX_MEDIA_PER_TAB);
  mediaByTab[tabId] = list;
  await persistMedia();
  pushTabMedia(tabId);
  return true;
}

const MAX_PLAYLIST_BYTES = 256 * 1024;

/**
 * Read a recorded HLS playlist and remember the renditions its master lists, so
 * their own rows never appear. X publishes one playlist per resolution plus one
 * per audio bitrate — six rows of a few hundred bytes for a single video — and
 * the master is the only entry that addresses the video as a whole.
 */
async function inspectPlaylist(tabId, item) {
  item.playlistChecked = true;
  const response = await timedFetch(item.url, { credentials: 'include', cache: 'force-cache' }, 4000);
  let text = '';
  try {
    if (response?.ok) text = (await response.text()).slice(0, MAX_PLAYLIST_BYTES);
  } catch {
    return;
  }

  const variants = parseHlsMaster(text, item.url);
  if (!variants.length) return;

  item.variants = variants;
  const key = String(tabId);
  const owners = hlsVariants.get(key) || new Set();
  for (const url of variants) owners.add(url);
  hlsVariants.set(key, owners);

  const list = mediaByTab[tabId] || [];
  const kept = list.filter((entry) => entry === item || !owners.has(entry.url));
  if (kept.length === list.length) return;
  mediaByTab[tabId] = kept;
  await persistMedia();
  pushTabMedia(tabId);
}

/**
 * Serialize recording per URL.
 *
 * `onBeforeRequest` and `onHeadersReceived` fire for the same URL and both
 * await Chrome APIs, so without a queue the header event can inspect the list
 * before the request event has inserted its row: a sub-10 KB response would be
 * judged with no row to delete, and the otherwise-unknown row would survive.
 */
function recordMedia(details, info, force = false) {
  const key = `${details.tabId}\u0000${details.url}`;
  const previous = mediaQueues.get(key) || Promise.resolve();
  const next = previous
    .then(() => recordMediaNow(details, info, force))
    .catch((error) => console.warn('[nifty] media record failed', error))
    .finally(() => {
      if (mediaQueues.get(key) === next) mediaQueues.delete(key);
    });
  mediaQueues.set(key, next);
  return next;
}

async function recordMediaNow(details, info, force = false) {
  await settingsReady;
  if (!settings.monitorVideos) return;
  if (!/^https?:/i.test(details.url || '')) return;
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  await mediaReady;

  let list = mediaByTab[details.tabId] || [];
  let item = list.find((entry) => entry.url === details.url);
  const key = xMediaKey(details.url);

  // A rendition named by its master playlist is not a second video; the master
  // is the one row that addresses the whole stream. And once an X video has
  // been resolved to its MP4 files, its playlists are redundant too.
  if ((info.kind === 'hls' && knownHlsVariant(details.tabId, details.url)) || isXResolved(details.tabId, key)) {
    if (!item || item.source === 'x') return;
    mediaByTab[details.tabId] = list.filter((entry) => entry !== item);
    await persistMedia();
    pushTabMedia(details.tabId);
    return;
  }

  // A request is first recorded from its request type alone (size unknown),
  // then enriched by the response headers. Drop it once the length proves it is
  // a beacon or a placeholder rather than video, and drop any stale row.
  if (isNegligibleMedia(info)) {
    if (!item) return;
    mediaByTab[details.tabId] = list.filter((entry) => entry !== item);
    await persistMedia();
    pushTabMedia(details.tabId);
    return;
  }

  list = mediaByTab[details.tabId] || (mediaByTab[details.tabId] = []);
  let changed = false;

  if (!item) {
    const tab = await tabInfo(details.tabId);
    // The tab lookup yields, so the tab may have been cleared meanwhile;
    // re-check before inserting.
    list = mediaByTab[details.tabId] || (mediaByTab[details.tabId] = []);
    item = list.find((entry) => entry.url === details.url);
    if (!item) {
      item = {
        url: details.url,
        kind: info.kind,
        mime: info.mime || '',
        size: info.size || 0,
        filename: info.filename || inferMediaFilename(details.url, tab?.title, info.kind),
        pageURL: tab?.url || '',
        pageTitle: tab?.title || '',
        frameId: details.frameId || 0,
        mediaKey: key,
        at: Date.now(),
      };
      list.push(item);
      if (list.length > MAX_MEDIA_PER_TAB) list.splice(0, list.length - MAX_MEDIA_PER_TAB);
      changed = true;
    }
  }

  if (item) {
    if (info.size && item.size !== info.size) {
      item.size = info.size;
      changed = true;
    }
    if (info.mime && item.mime !== info.mime) {
      item.mime = info.mime;
      changed = true;
    }
    if (info.filename && item.filename !== info.filename) {
      item.filename = info.filename;
      changed = true;
    }
    if (info.kind === 'hls' && item.kind !== 'hls') {
      // A <video src> is registered as "video" before headers prove it is a
      // playlist; the manifest is the more specific answer.
      item.kind = 'hls';
      changed = true;
    } else if (info.kind === 'video' && item.kind !== 'video' && item.kind !== 'hls') {
      item.kind = 'video';
      changed = true;
    }
  }

  if (!changed) {
    // A content script that just re-enabled sniffing re-registers the same
    // URLs; it still needs the list, or its overlay stays empty.
    if (force) pushTabMedia(details.tabId);
  } else {
    await persistMedia();
    pushTabMedia(details.tabId);
  }
  if (item.kind === 'hls' && !item.playlistChecked) void inspectPlaylist(details.tabId, item);
}

async function clearTabMedia(tabId) {
  await mediaReady;
  hlsVariants.delete(String(tabId));
  xResolved.delete(String(tabId));
  if (!mediaByTab[tabId]) return;
  delete mediaByTab[tabId];
  await persistMedia();
  pushTabMedia(tabId);
}

async function clearAllMedia() {
  await mediaReady;
  mediaByTab = {};
  hlsVariants.clear();
  xResolved.clear();
  await persistMedia();
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) {
    if (tab.id != null) pushTabMedia(tab.id);
  }
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) void clearTabMedia(details.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  hlsVariants.delete(String(tabId));
  xResolved.delete(String(tabId));
  void mediaReady.then(() => {
    if (!mediaByTab[tabId]) return;
    delete mediaByTab[tabId];
    void persistMedia();
  });
});

// MARK: - Popup / content messages

async function stateFor(tabId) {
  await Promise.all([settingsReady, mediaReady]);
  return {
    settings,
    connected,
    media: Number.isInteger(tabId) ? mediaByTab[tabId] || [] : [],
  };
}

async function downloadMedia(url, tabId) {
  await settingsReady;
  if (!settings.monitorVideos) return { ok: false, reason: 'disabled' };
  if (!Number.isInteger(tabId)) return { ok: false, reason: 'no-tab' };
  if (!/^https?:/i.test(url || '')) return { ok: false, reason: 'invalid-url' };

  await mediaReady;
  const list = mediaByTab[tabId] || [];
  const item = list.find((entry) => entry.url === url);
  if (!item) return { ok: false, reason: 'unknown-media' };

  const online = await ensureSocket(1600);
  if (!online) return { ok: false, reason: 'offline' };

  const tab = await tabInfo(tabId);
  const cookies = await cookieHeader(item.url);
  const pageURL = tab?.url || item.pageURL || '';
  let frame;
  try {
    frame = cappedFrame({
      method: 'GET',
      url: item.url,
      filename: item.filename || filenameFromURL(item.url),
      pageTitle: tab?.title || item.pageTitle || '',
      openerURL: pageURL,
      kind: 'media',
      headers: headersFor(item.url, pageURL, cookies),
      size: item.size,
      mime: item.mime,
    });
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (!sendFrame(frame)) return { ok: false, reason: 'send-failed' };
  void recordHandoff();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.id !== chrome.runtime.id) return false;

  switch (message.type) {
    case 'nifty:get-state': {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      stateFor(tabId).then(sendResponse);
      return true;
    }
    case 'nifty:download-media': {
      // The content overlay sends from a tab; the popup has no sender.tab and
      // passes its active tab id explicitly.
      const tabId = sender.tab?.id ?? (Number.isInteger(message.tabId) ? message.tabId : null);
      downloadMedia(String(message.url || ''), tabId).then(sendResponse);
      return true;
    }
    case 'nifty:resolve-x-media': {
      const tabId = sender.tab?.id;
      const key = String(message.key || '');
      const tweetIds = (Array.isArray(message.tweetIds) ? message.tweetIds : [])
        .map(String)
        .filter((id) => /^\d{5,25}$/.test(id))
        .slice(0, 6);
      if (tabId == null || !key || !tweetIds.length) {
        sendResponse({ ok: false });
        return false;
      }
      resolveXMedia(tabId, sender.frameId || 0, key, tweetIds, sender.tab?.url || '').then(
        (ok) => sendResponse({ ok }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    case 'nifty:register-media': {
      const url = String(message.url || '');
      if (!/^https?:/i.test(url) || sender.tab?.id == null) {
        sendResponse({ ok: false });
        return false;
      }
      recordMedia(
        { url, tabId: sender.tab.id, frameId: sender.frameId || 0, type: 'media' },
        { kind: 'video', mime: '', size: 0, filename: '' },
        true,
      ).then(() => sendResponse({ ok: true }));
      return true;
    }
    case 'nifty:popup-open': {
      void recordPopupOpen();
      sendResponse({ ok: true });
      return false;
    }
    case 'nifty:reconnect': {
      ensureSocket(1600).then((ok) => sendResponse({ connected: ok }));
      return true;
    }
    case 'nifty:status': {
      sendResponse({ connected });
      return false;
    }
    default:
      return false;
  }
});

// The worker starts cold. It opens a socket on the first actual hand-off or when
// the popup's status button is clicked; nothing connects in the background.
