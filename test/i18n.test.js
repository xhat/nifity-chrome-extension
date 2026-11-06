import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import '../src/lib/i18n.js';

const { messages, supported, normalize, browserLanguage, t } = globalThis.NiftyI18n;
const englishKeys = Object.keys(messages.en).sort();

test('supported locales and selector order match the product spec', () => {
  assert.deepEqual(supported, ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru']);

  const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
  const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, supported);
});

test('every locale has every English key and no empty string', () => {
  for (const locale of supported) {
    const keys = Object.keys(messages[locale]).sort();
    assert.deepEqual(keys, englishKeys, `${locale} keys differ`);
    for (const key of englishKeys) {
      assert.ok(messages[locale][key].trim().length > 0, `${locale}.${key} is empty`);
    }
  }
});

test('zh-CN and zh-TW are separate dictionaries, not glyph conversion', () => {
  assert.notEqual(messages['zh-CN']['popup.videos'], messages['zh-TW']['popup.videos']);
  assert.equal(messages['zh-TW']['popup.videos'], '影片監測');
});

test('normalizes legacy, browser and unknown values', () => {
  assert.equal(normalize('zh'), 'zh-CN');
  assert.equal(normalize('pt'), 'pt-BR');
  assert.equal(normalize('en-US'), 'en');
  assert.equal(normalize('de-DE'), 'de');
  assert.equal(normalize('fr-CA'), 'fr');
  assert.equal(normalize('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalize('zh-Hant-TW'), 'zh-TW');
  assert.equal(normalize('pt-PT'), 'pt-BR');
  assert.equal(normalize('ru-RU'), 'ru');
  assert.equal(normalize('xx-YY'), 'en');
  assert.equal(normalize(undefined), 'en');
});

test('browserLanguage follows Chrome UI language and falls back to English', () => {
  const previous = globalThis.chrome;
  try {
    globalThis.chrome = { i18n: { getUILanguage: () => 'de-DE' } };
    assert.equal(browserLanguage(), 'de');
    globalThis.chrome = { i18n: { getUILanguage: () => 'zh-Hant-TW' } };
    assert.equal(browserLanguage(), 'zh-TW');
    globalThis.chrome = { i18n: { getUILanguage: () => 'xx-YY' } };
    assert.equal(browserLanguage(), 'en');
  } finally {
    globalThis.chrome = previous;
  }
});

test('interpolates every placeholder', () => {
  for (const locale of supported) {
    const text = t(locale, 'overlay.videoCount', { n: 3 });
    assert.ok(text.includes('3'), `${locale} count`);
    assert.ok(!text.includes('{'), `${locale} has an unresolved placeholder`);
  }
});

test('falls back to English for a missing key', () => {
  assert.equal(t('de', 'missing.key'), 'missing.key');
  assert.equal(t('xx', 'popup.downloads'), 'Download monitoring');
});
