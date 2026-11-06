import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const html = source('../src/popup.html');
const css = source('../src/popup.css');
const popupJs = source('../src/popup.js');
const backgroundJs = source('../src/background.js');
const analyticsJs = source('../src/analytics.js');
const manifest = JSON.parse(source('../manifest.json'));
const pkg = JSON.parse(source('../package.json'));

const combinedRow = html.match(/<section class="row links-row">([\s\S]*?)<\/section>/)?.[1] ?? '';

test('popup only exposes the download and video switches', () => {
  assert.equal([...html.matchAll(/role="switch"/g)].length, 2);
  assert.ok(!html.includes('analyticsEnabled'), 'analytics toggle input is gone');
  assert.ok(!/Anonymous usage stats/i.test(html), 'analytics settings row is gone');
  assert.ok(!/popup\.analytics/.test(html), 'analytics i18n keys are gone from the markup');
});

test('no source file still reads or writes an analytics setting', () => {
  for (const [name, code] of [
    ['popup.js', popupJs],
    ['background.js', backgroundJs],
    ['analytics.js', analyticsJs],
  ]) {
    assert.ok(!code.includes('analyticsEnabled'), `${name} must not reference analyticsEnabled`);
  }
  assert.ok(!analyticsJs.includes('ANALYTICS_ENABLED_KEY'), 'opt-out key is removed');
  assert.ok(!analyticsJs.includes('storage.onChanged'), 'analytics no longer reacts to settings changes');
  assert.ok(!/analyticsEnabled/.test(JSON.stringify(manifest)), 'manifest declares no analytics flag');
});

test('popup header has no privacy link', () => {
  const header = html.match(/<div class="sub">([\s\S]*?)<\/div>/);
  assert.ok(header, 'version subtitle is present');
  assert.ok(header[1].includes('id="version"'));
  assert.ok(!header[1].includes('<a '), 'privacy link is removed');
  assert.ok(!/privacy\.html|popup\.privacy|inline-link/.test(html), 'no privacy link or key remains');
});

test('Website, GitHub and language share exactly one row', () => {
  assert.ok(combinedRow, 'combined links row exists');
  assert.equal((combinedRow.match(/<section/g) || []).length, 0, 'row is flat');
  assert.equal((combinedRow.match(/<a\b/g) || []).length, 2, 'Website and GitHub are the only links');
  assert.equal((combinedRow.match(/<select\b/g) || []).length, 1, 'language select lives in the same row');

  const website = combinedRow.match(/<a class="icon-only" href="https:\/\/nifty\.ruoxie\.com\/"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(website, 'Website is an icon-only control');
  assert.match(website[1], /<svg class="icon"[\s\S]*<\/svg>/, 'Website has an icon');
  assert.match(website[0], /data-i18n-aria-label="popup\.website"/, 'Website keeps a localized accessible label');

  const github = combinedRow.match(/<a class="icon-only" href="https:\/\/github\.com\/xhat\/nifty"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(github, 'GitHub is an icon-only control');
  assert.match(github[1], /<svg class="icon"[\s\S]*<\/svg>/, 'GitHub has an icon');

  const language = combinedRow.match(/<div class="language-control icon-only">[\s\S]*?<select class="select-native" id="language"[^>]*data-i18n-aria-label="popup\.language"/);
  assert.ok(language, 'language control wraps the native picker');
  assert.match(language[0], /<svg class="icon"[\s\S]*?<\/svg>/, 'language button has a globe icon');
  assert.ok(!language[0].includes('id="languageLabel"'), 'language control has no visible text');
  assert.ok(!/<span[^>]*data-i18n="popup\.website"/.test(combinedRow), 'links row has no visible text labels');
});

test('separate language and Nifty download rows are gone', () => {
  assert.equal((html.match(/class="row(?: |")/g) || []).length, 3, 'two switches + one combined row');
  assert.ok(!html.includes('id="tabHint"'), 'old hint area is removed');
  assert.ok(!/class="hint"/.test(html), 'old hint markup is removed');
  assert.ok(!html.includes('popup.download"'), 'download-row label key is removed');
  assert.ok(!html.includes('popup.downloadDesc'), 'download-row description key is removed');
  assert.ok(!html.includes('popup.hint.'), 'hint keys are removed from the markup');
  assert.ok(!html.includes('for="language"'), 'language no longer has its own label row');
});

test('package and popup fallback track the manifest version', () => {
  const { version } = manifest;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, version);
  assert.ok(
    html.includes(`<span id="version">v${version}</span>`),
    `static header version matches manifest ${version}`,
  );
});
