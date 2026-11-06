import test from 'node:test';
import assert from 'node:assert/strict';

import {
  basename,
  buildRequestFrame,
  filenameFromDisposition,
  filenameFromURL,
  makeFilename,
} from '../src/lib/protocol.js';
import { classifyMedia, formatBytes, isNegligibleMedia, parseHlsMaster, responseTotalSize } from '../src/lib/media.js';

const base = {
  url: 'https://example.com/files/movie.mp4',
  filename: 'movie.mp4',
  pageTitle: 'Example',
  openerURL: 'https://example.com/watch',
  kind: 'media',
  headers: {
    Cookie: 'sid=abc123',
    Referer: 'https://example.com/watch',
    Origin: 'https://example.com',
    'User-Agent': 'UA/1',
  },
  size: 10485760,
  mime: 'video/mp4',
};

test('buildRequestFrame emits the expected wire format', () => {
  const frame = buildRequestFrame(base);
  assert.equal(
    frame,
    [
      '1:GET',
      '2:https://example.com/files/movie.mp4',
      '3:movie.mp4',
      '6:media',
      '4:Example',
      '5:https://example.com/watch',
      'Cookie: sid=abc123',
      'Referer: https://example.com/watch',
      'Origin: https://example.com',
      'User-Agent: UA/1',
      '7:10485760',
      '8:video/mp4',
    ].join('\r\n'),
  );
});

test('buildRequestFrame refuses non-http URLs', () => {
  assert.throws(() => buildRequestFrame({ url: 'file:///etc/passwd' }), TypeError);
  assert.throws(() => buildRequestFrame({ url: 'blob:https://x/y' }), TypeError);
});

test('embedded newlines cannot forge fields', () => {
  const frame = buildRequestFrame({
    ...base,
    pageTitle: 'Line one\r\n7:1\r\nCookie: stolen',
    filename: 'a.mp4\r\n6:normal',
    headers: { 'X-Evil\r\nCookie': 'x' },
  });
  const lines = frame.split('\r\n');
  assert.equal(lines.filter((line) => line.startsWith('7:')).length, 1);
  assert.equal(lines.filter((line) => line.startsWith('Cookie:')).length, 0);
  assert.ok(lines.includes('4:Line one 7:1 Cookie: stolen'));
  assert.ok(!frame.includes('X-Evil'));
});

test('zero or missing size is omitted', () => {
  const frame = buildRequestFrame({ url: 'https://example.com/a.bin', size: 0 });
  assert.ok(!frame.includes('7:'));
  assert.ok(frame.endsWith('6:normal'));
});

test('filenameFromDisposition handles both parameter forms', () => {
  assert.equal(filenameFromDisposition('attachment; filename="a b.mp4"'), 'a b.mp4');
  assert.equal(
    filenameFromDisposition("attachment; filename*=UTF-8''%E7%94%B5%E5%BD%B1.mp4"),
    '电影.mp4',
  );
  assert.equal(filenameFromDisposition('inline'), '');
  assert.equal(filenameFromDisposition(''), '');
});

test('filename helpers do not leak path separators', () => {
  assert.equal(filenameFromURL('https://example.com/a/%E7%94%B5%E5%BD%B1.mp4?x=1'), '电影.mp4');
  assert.equal(basename('/Users/a/Downloads/file.zip'), 'file.zip');
  assert.equal(basename('C:\\Users\\a\\file.zip'), 'file.zip');
  assert.equal(makeFilename('My/Movie', '.mp4'), 'My Movie.mp4');
  assert.equal(makeFilename('already.mp4', '.mp4'), 'already.mp4');
});

test('classifyMedia keeps files and playlists, drops segments', () => {
  assert.equal(classifyMedia('https://example.com/a.mp4', ''), 'video');
  assert.equal(classifyMedia('https://example.com/stream', 'video/mp4; codecs="avc1"'), 'video');
  assert.equal(classifyMedia('https://example.com/master.m3u8', ''), 'hls');
  assert.equal(classifyMedia('https://example.com/live', 'application/vnd.apple.mpegurl'), 'hls');
  assert.equal(classifyMedia('https://example.com/a.m4s', 'video/iso.segment'), null);
  assert.equal(classifyMedia('https://example.com/a.ts', 'video/mp2t'), null);
  assert.equal(classifyMedia('https://example.com/videoplayback?range=0-999&itag=18', 'video/mp4'), null);
  assert.equal(classifyMedia('https://example.com/videoplayback?itag=18', 'video/mp4'), 'video');
  assert.equal(classifyMedia('https://example.com/poster.jpg', 'image/jpeg'), null);
  assert.equal(classifyMedia('blob:https://example.com/abc', 'video/mp4'), null);
  assert.equal(classifyMedia('not a url', 'video/mp4'), null);
});

test('formatBytes keeps rows compact', () => {
  assert.equal(formatBytes(0), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(10485760), '10.0 MB');
});

test('isNegligibleMedia rejects tiny files but keeps manifests', () => {
  assert.equal(isNegligibleMedia({ size: 43 }), true);
  assert.equal(isNegligibleMedia({ size: 749 }), true); // X init fragment
  assert.equal(isNegligibleMedia({ size: 10 * 1024 - 1 }), true);
  assert.equal(isNegligibleMedia({ size: 10 * 1024 }), false);
  assert.equal(isNegligibleMedia({ size: 5 * 1024 * 1024 }), false);
  // A master playlist is the video's only URL, whatever its byte count.
  assert.equal(isNegligibleMedia({ size: 492, kind: 'hls' }), false);
  // Unknown length: chunked streams and MSE have no content-length.
  assert.equal(isNegligibleMedia({ size: 0 }), false);
  assert.equal(isNegligibleMedia(), false);
});

test('parseHlsMaster lists rendition URIs, ignoring segments', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,URI="/a/audio.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=295162,RESOLUTION=480x270',
    '/a/480x270.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2533120,RESOLUTION=1280x720',
    'https://cdn.example.com/a/720p.m3u8',
  ].join('\n');
  assert.deepEqual(parseHlsMaster(master, 'https://cdn.example.com/a/master.m3u8'), [
    'https://cdn.example.com/a/audio.m3u8',
    'https://cdn.example.com/a/480x270.m3u8',
    'https://cdn.example.com/a/720p.m3u8',
  ]);

  const media = ['#EXTM3U', '#EXT-X-MAP:URI="/a/init.mp4"', '#EXTINF:3,', '/a/seg.m4s'].join('\n');
  assert.deepEqual(parseHlsMaster(media, 'https://cdn.example.com/a/play.m3u8'), []);
  assert.deepEqual(parseHlsMaster('not a playlist', 'https://cdn.example.com/a.m3u8'), []);
});

test('responseTotalSize ignores range and redirect bodies', () => {
  assert.equal(responseTotalSize(200, '5242880', ''), 5242880);
  assert.equal(responseTotalSize(200, 'NaN', ''), 0);
  assert.equal(responseTotalSize(200, undefined, ''), 0);
  // 206: content-length is the range, the total comes from content-range.
  assert.equal(responseTotalSize(206, '391', 'bytes 0-391/987654'), 987654);
  assert.equal(responseTotalSize(206, '391', 'bytes 0-391/*'), 0);
  assert.equal(responseTotalSize(206, '391', ''), 0);
  // Redirects and errors describe their own body, not the media.
  assert.equal(responseTotalSize(302, '512', ''), 0);
  assert.equal(responseTotalSize(undefined, '512', ''), 0);
});
