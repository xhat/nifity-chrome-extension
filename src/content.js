/**
 * Video overlay: one small Nifty badge in the top-left corner of each video.
 * Hovering it lists the media URLs sniffed for this tab; clicking one hands it
 * to the Nifty app through the background worker.
 *
 * Each badge and the panel live in closed shadow roots, so host-page CSS cannot
 * restyle them and the page cannot easily read the sniffed URLs out of the DOM.
 * Placement is CSS anchor positioning, not JS: the badge is painted with the
 * video in the same frame, so it stays on the corner while the page scrolls.
 */
(() => {
  if (window.__niftyVideoOverlayInstalled) return;
  window.__niftyVideoOverlayInstalled = true;

  const NIFTY_MARK = `<svg viewBox="230 330 564 368" aria-hidden="true"><path fill="currentColor" d="M366 332 L442 332 Q456 332 456 346 L456 425 Q456 439 442 439 L400 439 C384 439 379 445 391 455 L498 568 Q512 583 526 568 L633 455 C645 445 640 439 624 439 L582 439 Q568 439 568 425 L568 346 Q568 332 582 332 L650 332 Q674 332 692 362 L782 513 Q794 535 794 559 L794 620 Q794 698 716 698 L308 698 Q230 698 230 620 L230 559 Q230 535 242 513 L332 362 Q348 332 366 332 Z"/></svg>`;
  const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="m7 9 5 5 5-5"/><path d="M5 20h14"/></svg>`;

  const HOST_ID = 'nifty-video-overlay-host';
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;' +
    'z-index:2147483647!important;pointer-events:none!important;overflow:visible!important;' +
    'margin:0!important;padding:0!important;border:0!important;background:none!important;';

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .badge {
      position: relative;
      display: flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 8px;
      appearance: none;
      -webkit-appearance: none;
      border: 0;
      border-radius: 8px;
      background: rgba(24, 24, 27, .86);
      color: #d4d4d8;
      box-shadow: 0 2px 10px rgba(0, 0, 0, .25);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
      cursor: default;
      pointer-events: auto;
      font: 400 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      font-variant-numeric: tabular-nums;
      letter-spacing: .01em;
      margin: 0;
      outline: none;
      opacity: .9;
      transition: opacity .12s ease;
    }
    .badge:hover {
      opacity: 1;
    }
    .badge svg { width: 15px; height: 15px; flex: 0 0 auto; display: block; }
    .badge .count { color: inherit; font-weight: 400; line-height: 1; }

    .panel {
      position: relative;
      width: 368px;
      max-width: calc(100vw - 16px);
      padding: 7px;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      background: #18181b;
      color: #fafafa;
      box-shadow: 0 14px 44px rgba(0, 0, 0, .45);
      pointer-events: auto;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      text-align: left;
      isolation: isolate;
    }
    .panel .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 3px 7px 7px;
    }
    .panel .brand {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 700;
      letter-spacing: .01em;
    }
    .panel .brand svg { width: 14px; height: 14px; display: block; }
    .panel .hint { color: #a1a1aa; font-size: 10.5px; font-weight: 400; }
    .panel .list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      max-height: min(288px, calc(100vh - 110px));
      overflow: auto;
      overscroll-behavior: contain;
    }
    .row {
      display: block;
      width: 100%;
      margin: 0;
      padding: 8px 8px 7px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: default;
      outline: none;
    }
    .row:hover, .row:focus-visible { background: #27272a; }
    .row .name {
      display: block;
      overflow: hidden;
      color: #fafafa;
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .row .url {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      color: #a1a1aa;
      font: 10.5px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .row .meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      color: #71717a;
      font-size: 10.5px;
    }
    .row .meta .tag {
      padding: 1px 4px;
      border: 1px solid #3f3f46;
      border-radius: 4px;
      color: #a1a1aa;
      font-size: 9.5px;
      line-height: 1.35;
    }
    .row .action {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      color: #a3e635;
      font-weight: 400;
      white-space: nowrap;
      transition: filter .12s ease;
    }
    .row .action svg { width: 12px; height: 12px; display: block; flex: 0 0 auto; }
    .row .action:hover { color: #bef264; }
    .row[data-state="ok"] .action { color: #4ade80; }
    .row[data-state="error"] .action { color: #f87171; }
    .panel .empty { padding: 10px 8px; color: #a1a1aa; }
  `);

  /**
   * Every floating piece is a light-DOM box holding a closed shadow root. The
   * box is what CSS anchor positioning moves: anchor names are tree-scoped, so
   * a box anchored to a page `<video>` must live in the document tree. Its
   * contents stay in the shadow root, out of reach of page CSS and scripts.
   *
   * Anchoring is resolved by the browser in the same frame as the scroll, so
   * the badge sits on the video's corner instead of chasing it from JS.
   */
  const BOX_STYLE =
    'position:fixed!important;margin:0!important;padding:0!important;border:0!important;' +
    'width:auto!important;height:auto!important;background:none!important;' +
    'pointer-events:none!important;z-index:auto!important;';
  const BADGE_STYLE =
    'display:block!important;right:auto!important;bottom:auto!important;' +
    'top:calc(anchor(top) + 8px)!important;left:calc(anchor(left) + 8px)!important;' +
    'position-visibility:anchors-visible!important;';
  // Below the badge, aligned to its left edge; flips above / leftwards when the
  // viewport has no room, without any JS measuring.
  const PANEL_STYLE =
    'display:none!important;inset:auto!important;margin:6px 0 0!important;' +
    'position-area:bottom span-right!important;' +
    'position-try-fallbacks:flip-block, flip-inline, flip-block flip-inline!important;';

  function overlayBox(style) {
    const box = document.createElement('div');
    box.style.cssText = BOX_STYLE + style;
    const root = box.attachShadow({ mode: 'closed' });
    root.adoptedStyleSheets = [sheet];
    host.appendChild(box);
    return { box, root };
  }

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="head">
      <span class="brand">
        <svg viewBox="230 330 564 368" aria-hidden="true"><path fill="#fafafa" d="M366 332 L442 332 Q456 332 456 346 L456 425 Q456 439 442 439 L400 439 C384 439 379 445 391 455 L498 568 Q512 583 526 568 L633 455 C645 445 640 439 624 439 L582 439 Q568 439 568 425 L568 346 Q568 332 582 332 L650 332 Q674 332 692 362 L782 513 Q794 535 794 559 L794 620 Q794 698 716 698 L308 698 Q230 698 230 620 L230 559 Q230 535 242 513 L332 362 Q348 332 366 332 Z"/></svg>
        Nifty
      </span>
      <span class="hint"></span>
    </div>
    <div class="list"></div>
  `;
  const listEl = panel.querySelector('.list');
  const hintEl = panel.querySelector('.hint');

  function refreshOverlayText() {
    for (const entry of badges.values()) {
      entry.el.title = t('overlay.badgeTitle');
      entry.el.setAttribute('aria-label', t('overlay.badgeTitle'));
    }
    if (panelEntry && !panel.hidden) showPanel(panelEntry);
  }

  const panelBox = overlayBox(PANEL_STYLE);
  panelBox.root.append(panel);
  const attachHost = () => {
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen && !fullscreen.contains(host) ? fullscreen : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  };
  attachHost();

  let enabled = true;
  let lang = 'en';
  let media = [];

  function t(key, vars) {
    return globalThis.NiftyI18n ? globalThis.NiftyI18n.t(lang, key, vars) : key;
  }

  /** @type {Map<HTMLVideoElement, {el: HTMLButtonElement, count: HTMLElement, list: object[]}>} */
  const badges = new Map();
  let panelEntry = null;
  let hideTimer = 0;
  let scanTimer = 0;
  let refreshTimer = 0;
  let refreshRetries = 0;
  let ticking = false;
  let knownVideos = [];
  const registeredSources = new Set();
  const XMedia = globalThis.NiftyXMedia;
  const onX = Boolean(XMedia?.isXHost(location.hostname));
  /** X media key → resolution request state; see `resolveXVideos`. */
  const xRequests = new Map();

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unit]}`;
  }

  function mergeMedia(current, incoming) {
    const merged = new Map();
    for (const item of current) merged.set(item.url, item);
    for (const item of incoming) merged.set(item.url, item);
    return [...merged.values()];
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  function videoSources(video) {
    const sources = new Set();
    for (const candidate of [video.currentSrc, video.src]) {
      if (candidate && /^https?:/i.test(candidate)) sources.add(candidate);
    }
    for (const source of video.querySelectorAll('source')) {
      if (source.src && /^https?:/i.test(source.src)) sources.add(source.src);
    }
    return [...sources];
  }

  /** X plays from `blob:`; the poster URL is the only stable link to the media. */
  function xKeyOf(video) {
    return onX ? XMedia.mediaKey(video.poster) : '';
  }

  /**
   * Tweet ids around a video, nearest first, so a quoted tweet's own permalink
   * is tried before the quoting tweet's. The background picks the one whose
   * metadata actually contains the video's media key.
   */
  function tweetIdsFor(video) {
    const ids = [];
    const add = (href) => {
      const id = XMedia.statusId(href);
      if (id && !ids.includes(id)) ids.push(id);
    };
    const article = video.closest('article');
    let node = video.parentElement;
    while (node && node !== document.body && ids.length < 6) {
      for (const link of node.querySelectorAll('a[href*="/status/"]')) add(link.getAttribute('href'));
      if (node === article) break;
      node = node.parentElement;
    }
    add(location.pathname);
    return ids.slice(0, 6);
  }

  function resolveXVideos() {
    if (!onX || !enabled) return;
    for (const video of knownVideos) {
      const key = xKeyOf(video);
      if (!key) continue;
      const state = xRequests.get(key) || { attempts: 0, busy: false, done: false };
      if (state.done || state.busy || state.attempts >= 2) continue;
      const tweetIds = tweetIdsFor(video);
      if (!tweetIds.length) continue;
      state.busy = true;
      state.attempts++;
      xRequests.set(key, state);
      chrome.runtime
        .sendMessage({ type: 'nifty:resolve-x-media', key, tweetIds })
        .then((result) => {
          state.done = Boolean(result?.ok);
        })
        .catch(() => {})
        .finally(() => {
          state.busy = false;
          if (!state.done && state.attempts < 2) scheduleScan(2000);
        });
    }
  }

  function hasLayout(video) {
    if (!video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return false;
    const computed = getComputedStyle(video);
    return (
      computed.display !== 'none' &&
      computed.visibility !== 'hidden' &&
      computed.visibility !== 'collapse' &&
      Number(computed.opacity || 1) > 0
    );
  }

  function collectVideos(root, out) {
    for (const video of root.querySelectorAll('video')) out.add(video);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) collectVideos(element.shadowRoot, out);
    }
  }

  function visibleVideos() {
    return knownVideos.filter(hasLayout);
  }

  function assignMedia(videos) {
    const assignments = new Map();
    if (!enabled || !media.length || !videos.length) return assignments;

    let matchedAny = false;
    for (const video of videos) {
      const sources = videoSources(video);
      const key = xKeyOf(video);
      const matched = media.filter(
        (item) => sources.includes(item.url) || (key !== '' && item.mediaKey === key),
      );
      if (matched.length) {
        assignments.set(video, matched);
        matchedAny = true;
      }
    }
    if (matchedAny) return assignments;

    // MSE players expose a blob: URL, and redirected media lands on a CDN URL
    // different from the element's src. Fall back to the largest video so the
    // indicator is still discoverable, with the tab's sniffed URLs.
    const target = [...videos].sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0];
    if (target) assignments.set(target, media);
    return assignments;
  }

  let anchorSeq = 0;

  /**
   * Name the video as this badge's anchor, keeping any anchor-name the page set.
   * Re-run on every layout pass: a framework that rewrites the element's style
   * attribute would otherwise silently detach the badge.
   */
  function anchorVideo(video, entry) {
    const inline = video.style.getPropertyValue('anchor-name');
    if (inline.split(',').some((name) => name.trim() === entry.videoAnchor)) return;
    if (!entry.restore) {
      entry.restore = { value: inline, priority: video.style.getPropertyPriority('anchor-name') };
    }
    const own = getComputedStyle(video).getPropertyValue('anchor-name').trim();
    const names = own && own !== 'none' ? `${own}, ${entry.videoAnchor}` : entry.videoAnchor;
    video.style.setProperty('anchor-name', names, 'important');
  }

  function removeBadge(video) {
    const entry = badges.get(video);
    if (!entry) return;
    if (panelEntry === entry) hidePanel();
    entry.box.remove();
    badges.delete(video);
    if (entry.restore) {
      if (entry.restore.value) video.style.setProperty('anchor-name', entry.restore.value, entry.restore.priority);
      else video.style.removeProperty('anchor-name');
    }
  }

  function badgeFor(video) {
    const existing = badges.get(video);
    if (existing && existing.box.isConnected) return existing;
    if (existing) removeBadge(video);

    const seq = ++anchorSeq;
    const { box, root } = overlayBox(BADGE_STYLE);
    const videoAnchor = `--nifty-video-${seq}`;
    const badgeAnchor = `--nifty-badge-${seq}`;
    box.style.setProperty('position-anchor', videoAnchor, 'important');
    box.style.setProperty('anchor-name', badgeAnchor, 'important');

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'badge';
    el.title = t('overlay.badgeTitle');
    el.setAttribute('aria-label', t('overlay.badgeTitle'));
    el.innerHTML = `${NIFTY_MARK}<span class="count">0</span>`;
    const count = el.querySelector('.count');
    root.append(el);

    const entry = { box, el, count, list: [], videoAnchor, badgeAnchor, restore: null };
    el.addEventListener('mouseenter', () => showPanel(entry));
    el.addEventListener('mouseleave', scheduleHide);
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (panelEntry === entry && !panel.hidden) hidePanel();
      else showPanel(entry);
    });
    el.addEventListener('focus', () => showPanel(entry));

    badges.set(video, entry);
    anchorVideo(video, entry);
    return entry;
  }

  function showPanel(entry) {
    if (!entry || !entry.list.length || !enabled) return;
    clearTimeout(hideTimer);
    panelEntry = entry;

    listEl.replaceChildren();
    hintEl.textContent = t('overlay.videoCount', { n: entry.list.length });
    // Highest quality first; otherwise newest first.
    const rows = [...entry.list].reverse().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    for (const item of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.dataset.busy = '0';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.filename || t('overlay.videoFile');
      name.title = item.filename || '';

      const url = document.createElement('span');
      url.className = 'url';
      url.textContent = item.url;
      url.title = item.url;

      const meta = document.createElement('span');
      meta.className = 'meta';
      const tagText = item.kind === 'hls' ? 'HLS' : item.quality ? item.quality.replace('x', '×') : '';
      if (tagText) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = tagText;
        meta.appendChild(tag);
      }
      const host = document.createElement('span');
      host.textContent = hostOf(item.url);
      meta.appendChild(host);
      // A playlist's byte count describes the index, not the video; showing
      // "492 B" next to a real video is misleading.
      const size = item.kind === 'hls' ? '' : formatBytes(item.size);
      if (size) {
        const sizeEl = document.createElement('span');
        sizeEl.textContent = `· ${size}`;
        meta.appendChild(sizeEl);
      }
      const action = document.createElement('span');
      action.className = 'action';
      action.innerHTML = `${DOWNLOAD_ICON}<span class="action-label"></span>`;
      action.querySelector('.action-label').textContent = t('overlay.download');
      meta.appendChild(action);

      row.append(name, url, meta);
      row.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void requestDownload(item, row, action);
      });
      listEl.appendChild(row);
    }

    panel.hidden = false;
    // An anchor must precede its anchored box in tree order; badges created
    // after the panel box would otherwise be unusable as its anchor.
    if (host.lastChild !== panelBox.box) host.appendChild(panelBox.box);
    panelBox.box.style.setProperty('position-anchor', entry.badgeAnchor, 'important');
    panelBox.box.style.setProperty('display', 'block', 'important');
    startTicking();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePanel, 180);
  }

  function hidePanel() {
    clearTimeout(hideTimer);
    panel.hidden = true;
    panelBox.box.style.setProperty('display', 'none', 'important');
    panelEntry = null;
  }

  async function requestDownload(item, row, action) {
    if (row.dataset.busy === '1') return;
    row.dataset.busy = '1';
    row.dataset.state = '';
    const label = action.querySelector('.action-label');
    label.textContent = t('overlay.sending');
    let ok = false;
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'nifty:download-media',
        url: item.url,
      });
      ok = Boolean(result?.ok);
      if (ok) {
        label.textContent = t('overlay.sent');
        row.dataset.state = 'ok';
      } else if (result?.reason === 'offline') {
        label.textContent = t('overlay.offline');
        row.dataset.state = 'error';
      } else {
        label.textContent = t('overlay.failed');
        row.dataset.state = 'error';
      }
    } catch {
      label.textContent = t('overlay.failed');
      row.dataset.state = 'error';
    }
    setTimeout(() => {
      if (!row.isConnected) return;
      row.dataset.busy = '0';
      row.dataset.state = '';
      label.textContent = t('overlay.download');
    }, ok ? 2400 : 3200);
  }

  /** Decides which videos get a badge and what it lists; CSS does the placing. */
  function layout() {
    if (!enabled || document.hidden) return;

    const videos = visibleVideos();
    for (const video of [...badges.keys()]) {
      if (!video.isConnected || !videos.includes(video)) removeBadge(video);
    }

    const assignments = assignMedia(videos);
    if (!badges.size && panelEntry) hidePanel();
    for (const video of videos) {
      const list = assignments.get(video) || [];
      if (!list.length) {
        removeBadge(video);
        continue;
      }
      const entry = badgeFor(video);
      entry.list = list;
      entry.count.textContent = String(list.length);
      anchorVideo(video, entry);
    }
  }

  // Placement is CSS; this loop only notices videos appearing, disappearing or
  // changing their media, which does not need per-frame precision.
  let lastFrame = 0;
  function tick(now) {
    if (!enabled) {
      ticking = false;
      return;
    }
    if (now - lastFrame > 180) {
      lastFrame = now;
      layout();
    }
    if (badges.size || media.length) requestAnimationFrame(tick);
    else ticking = false;
  }

  function startTicking() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(tick);
  }

  function scan() {
    const found = new Set();
    collectVideos(document, found);
    knownVideos = [...found].filter((video) => video.isConnected);
    if (enabled) {
      for (const video of knownVideos) {
        for (const source of videoSources(video)) {
          if (registeredSources.has(source)) continue;
          registeredSources.add(source);
          chrome.runtime
            .sendMessage({ type: 'nifty:register-media', url: source })
            .catch(() => {});
        }
      }
    }
    resolveXVideos();
    layout();
    startTicking();
    if (!media.length) scheduleRetry();
  }

  function scheduleScan(delay = 250) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  function applyEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      hidePanel();
      for (const video of [...badges.keys()]) removeBadge(video);
      media = [];
      // The background drops its list when the toggle goes off; forget what we
      // registered so turning it back on re-registers the current <video> srcs.
      registeredSources.clear();
      xRequests.clear();
    } else {
      refreshRetries = 0;
      scheduleScan(0);
      void refreshState();
    }
  }

  function scheduleRetry() {
    if (refreshTimer || refreshRetries >= 3 || !enabled || !knownVideos.length) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      refreshRetries++;
      // The worker may not have heard the first registration (e.g. a session
      // restore racing extension startup); registering again is cheap.
      registeredSources.clear();
      scheduleScan(0);
      void refreshState();
    }, 800);
  }

  async function refreshState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'nifty:get-state' });
      if (!state) return;
      if (typeof state.settings?.monitorVideos === 'boolean' && state.settings.monitorVideos !== enabled) {
        applyEnabled(state.settings.monitorVideos);
      }
      // A `media-updated` push can beat this response; merging prevents the
      // older snapshot from wiping the URL that just arrived.
      if (Array.isArray(state.media)) media = mergeMedia(media, state.media);
      if (media.length) refreshRetries = 0;
      else scheduleRetry();
      layout();
      startTicking();
    } catch {
      // The extension was reloaded; this content script is orphaned.
      scheduleRetry();
    }
  }

  chrome.storage.local
    .get({ monitorVideos: true, language: null })
    .then((stored) => {
      const language = stored.language || (globalThis.NiftyI18n ? globalThis.NiftyI18n.browserLanguage() : 'en');
      lang = globalThis.NiftyI18n ? globalThis.NiftyI18n.normalize(language) : 'en';
      applyEnabled(stored.monitorVideos);
      refreshOverlayText();
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('language' in changes) {
      lang = globalThis.NiftyI18n ? globalThis.NiftyI18n.normalize(changes.language.newValue) : 'en';
      refreshOverlayText();
    }
    if ('monitorVideos' in changes) {
      applyEnabled(changes.monitorVideos.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'nifty:media-updated') {
      media = Array.isArray(message.items) ? message.items : [];
      layout();
      startTicking();
    }
  });

  // Get anything already sniffed before this frame's content script ran.
  void refreshState();

  panel.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  panel.addEventListener('mouseleave', scheduleHide);

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.composedPath().includes(host)) hidePanel();
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePanel();
  });

  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      if (record.type === 'attributes') {
        const tag = record.target?.tagName;
        if (tag === 'VIDEO' || tag === 'SOURCE') relevant = true;
        if (relevant) break;
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE' || node.querySelector?.('video, source')) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (relevant) scheduleScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // X sets `poster` after inserting the <video>; it carries the media key.
    attributeFilter: ['src', 'poster'],
  });

  document.addEventListener('fullscreenchange', () => {
    attachHost();
    scheduleScan(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) startTicking();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleScan(0), { once: true });
  } else {
    scheduleScan(0);
  }
})();
