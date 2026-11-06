/**
 * The wire format Nifty speaks. Nifty parses it by numeric key, never by
 * position, so field order is a readability choice here — not a contract.
 *
 *   1:GET
 *   2:https://example.com/a.mp4
 *   3:a.mp4
 *   6:normal | media
 *   4:Page title
 *   5:https://example.com/watch
 *   Cookie: sid=...
 *   Referer: https://example.com/watch
 *   Origin: https://example.com
 *   User-Agent: Mozilla/5.0 ...
 *   7:10485760
 *   8:video/mp4
 */

export const NIFTY_PORT = 10007;
export const NIFTY_PATH = '/download';
export const NIFTY_WS_URL = `ws://127.0.0.1:${NIFTY_PORT}${NIFTY_PATH}`;
export const NIFTY_HEALTH_URL = `http://127.0.0.1:${NIFTY_PORT}/health`;
export const NIFTY_SUBPROTOCOL = 'neatextension.v1';

/** A single line; the frame is line-based, so embedded CR/LF would forge fields. */
export function line(value) {
  return String(value ?? '')
    .replace(/[\u0000\r\n]+/g, ' ')
    .trim();
}

export function buildRequestFrame({
  method = 'GET',
  url,
  filename,
  pageTitle,
  openerURL,
  kind = 'normal',
  headers = {},
  size,
  mime,
} = {}) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) {
    throw new TypeError('Nifty only accepts http(s) URLs');
  }
  const out = [`1:${line(method || 'GET').toUpperCase()}`, `2:${line(url)}`];
  if (filename) out.push(`3:${line(filename)}`);
  out.push(`6:${line(kind) || 'normal'}`);
  if (pageTitle) out.push(`4:${line(pageTitle)}`);
  if (openerURL) out.push(`5:${line(openerURL)}`);
  for (const [name, value] of Object.entries(headers)) {
    if (!name || value == null || value === '') continue;
    if (/[\s:]/.test(name)) continue; // refuse malformed / injected header names
    out.push(`${name}: ${line(value)}`);
  }
  if (Number.isFinite(size) && size > 0) out.push(`7:${Math.round(size)}`);
  if (mime) out.push(`8:${line(mime)}`);
  return out.join('\r\n');
}

/** `attachment; filename="a.mp4"` and RFC 5987 `filename*=UTF-8''a.mp4`. */
export function filenameFromDisposition(value) {
  if (!value) return '';
  for (const part of String(value).split(';')) {
    const piece = part.trim();
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    let raw = piece.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!raw) continue;
    if (key === 'filename*') {
      const encoded = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw;
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }
    if (key === 'filename') {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return '';
}

/** Last path segment, decoded. Never returns path separators. */
export function filenameFromURL(url) {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    let name = decodeURIComponent(segment).replace(/[\\/:*?"<>|]+/g, ' ').trim();
    return name;
  } catch {
    return '';
  }
}

/** Chrome reports the proposed download path; only its last component is useful. */
export function basename(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

export function makeFilename(name, fallbackExtension) {
  const base = line(name)
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  if (!base) return '';
  const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(base);
  return hasExtension ? base : `${base}${fallbackExtension || ''}`;
}
