/**
 * Deciding what counts as a downloadable video URL.
 *
 * A player happily issues hundreds of requests for one film: `.ts` / `.m4s`
 * segments, byte-range `videoplayback` reads, preview thumbnails. None of those
 * are useful to a download manager — Nifty saves one file, it does not assemble
 * an HLS stream. So segments are filtered out, and responses whose known total
 * length is under `MIN_MEDIA_BYTES` are dropped as noise; direct files stay.
 */

const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|mkv|avi|flv|wmv|mpe?g|mpg|3gp|ogv|ogm)$/i;
const HLS_EXTENSIONS = /\.(m3u8|m3u)$/i;
const SEGMENT_EXTENSIONS = /\.(m4s|ts|mp2t|cmfv|cmfa)$/i;
const HLS_MIMES = /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:mpegurl|x-mpegurl)|video\/(?:mpegurl|x-mpegurl))$/i;

export function baseMime(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * A media *file* shorter than this cannot be a playable video: beacons, probes,
 * error bodies, and init fragments all land well under it.
 */
export const MIN_MEDIA_BYTES = 10 * 1024;

/**
 * The file's total length from a response, or `0` when the headers do not
 * describe it.
 *
 * `content-length` on a `206` is the size of the requested range, not the
 * file; the total comes from `content-range` (`bytes 0-391/1234567`). Redirects
 * and error responses describe their own body, so they say nothing about the
 * media and are treated as unknown.
 *
 * @param {number|undefined} statusCode
 * @param {number|string|undefined} contentLength
 * @param {string|undefined} contentRange
 */
export function responseTotalSize(statusCode, contentLength, contentRange) {
  if (statusCode === 206) {
    const match = /\/(\d+)\s*$/.exec(String(contentRange ?? '').trim());
    const total = match ? Number.parseInt(match[1], 10) : NaN;
    return Number.isFinite(total) && total > 0 ? total : 0;
  }
  if (statusCode === 200) {
    const total = Number(contentLength);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }
  return 0;
}

/**
 * True when a known total length is too small to be a video. Unknown size (`0`)
 * is never rejected: chunked responses and MSE streams report no length, and
 * dropping them would hide real videos.
 *
 * HLS manifests are exempt: a master playlist is the video's only addressable
 * URL (X has no progressive MP4), and it is a few hundred bytes no matter how
 * long the video is. Their noise is handled upstream instead — only the master
 * is listed, never its per-rendition children.
 *
 * @param {{size?: number, kind?: string}} info
 */
export function isNegligibleMedia({ size = 0, kind = 'video' } = {}) {
  if (kind === 'hls') return false;
  return Number.isFinite(size) && size > 0 && size < MIN_MEDIA_BYTES;
}

/**
 * Variant URIs listed by an HLS master playlist, resolved against its own URL.
 * Empty for a media playlist (segments) or a body that is not a playlist.
 *
 * @param {string} text
 * @param {string} baseURL
 * @returns {string[]}
 */
export function parseHlsMaster(text, baseURL) {
  const body = String(text ?? '');
  if (!/#EXT-X-(?:STREAM-INF|MEDIA):/i.test(body)) return [];
  const urls = new Set();
  const add = (value) => {
    if (!value) return;
    try {
      urls.add(new URL(value, baseURL).href);
    } catch {
      // A malformed URI is not worth failing the whole manifest over.
    }
  };
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      if (/^#EXT-X-MEDIA:/i.test(trimmed)) {
        add(/URI="([^"]+)"/i.exec(trimmed)?.[1]);
      }
      continue;
    }
    add(trimmed);
  }
  return [...urls];
}

/**
 * @param {string} rawURL
 * @param {string} rawMime
 * @returns {'video'|'hls'|null}
 */
export function classifyMedia(rawURL, rawMime) {
  let url;
  try {
    url = new URL(rawURL);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const path = url.pathname.toLowerCase();
  const mime = baseMime(rawMime);

  // YouTube DASH: one request per fragment, useless as a download.
  if (path.endsWith('/videoplayback') && (url.searchParams.has('range') || url.searchParams.has('sq'))) {
    return null;
  }
  if (SEGMENT_EXTENSIONS.test(path)) return null;
  if (HLS_EXTENSIONS.test(path) || HLS_MIMES.test(mime)) return 'hls';
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.test(path)) return 'video';
  return null;
}

export function formatBytes(bytes) {
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
