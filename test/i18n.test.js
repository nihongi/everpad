'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18N = require('../renderer/i18n');
const { buildTemplate } = require('../contextmenu');
const L = require('../renderer/core');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('言語: 日本語と英語で、文言のキーが同じだけそろっている', () => {
  const ja = Object.keys(I18N.DICT.ja).sort(), en = Object.keys(I18N.DICT.en).sort();
  assert.deepStrictEqual(ja.filter(k => !en.includes(k)), [], '英語に無いキー');
  assert.deepStrictEqual(en.filter(k => !ja.includes(k)), [], '日本語に無いキー');
});

test('言語: 英語の文言に日本語が混ざっていない(言語メニューの「言語」を除く)', () => {
  const re = /[぀-ヿ一-鿿]/;
  const sample = { n: 2, chars: 2, lines: 2, versions: 2, alt: 'a', images: true, hist: true };
  for (const k of Object.keys(I18N.DICT.en)) {
    if (k === 'mLanguage') continue;
    assert.ok(!re.test(I18N.t('en', k, sample)), k + ': ' + I18N.t('en', k, sample));
  }
});

test('言語: 画面・メニューで使っているキーは、すべて辞書にある', () => {
  const keys = new Set();
  const html = read('renderer/index.html');
  for (const m of html.matchAll(/data-i18n(?:-title|-aria|-ph)?="([^"]+)"/g)) keys.add(m[1]);
  for (const f of ['renderer/app.js', 'main.js', 'contextmenu.js']) {
    for (const m of read(f).matchAll(/\bT\('([A-Za-z]+)'[,)]/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 100, '見つけたキーが少なすぎる: ' + keys.size);
  for (const k of keys) {
    assert.ok(k in I18N.DICT.ja, '日本語に無い: ' + k);
    assert.ok(k in I18N.DICT.en, '英語に無い: ' + k);
  }
  // store.js のエラーの種類(code)も訳がある
  for (const m of read('store.js').matchAll(/storeError\('(\w+)'/g)) {
    assert.ok(('err' + m[1][0].toUpperCase() + m[1].slice(1)) in I18N.DICT.en, 'エラーの訳が無い: ' + m[1]);
  }
});

test('言語: 値の埋め込みと、英語の単数・複数', () => {
  assert.strictEqual(I18N.t('ja', 'revNo', { k: 3, n: 10 }), '第3版 / 10');
  assert.strictEqual(I18N.t('en', 'revNo', { k: 3, n: 10 }), 'Version 3 of 10');
  assert.strictEqual(I18N.t('en', 'versions', { n: 1 }), '1 version');
  assert.strictEqual(I18N.t('en', 'versions', { n: 2 }), '2 versions');
  assert.strictEqual(I18N.t('ja', 'versions', { n: 2 }), '2版');
  assert.strictEqual(I18N.t('en', 'matches', { n: 1, hist: true }), '1 match (including deleted text)');
  assert.strictEqual(I18N.t('xx', 'newNote'), '新しいメモ');          // 知らない言語は日本語
  assert.strictEqual(I18N.t('en', 'noSuchKey'), 'noSuchKey');
});

test('言語: Windows の表示言語から選ぶ(日本語以外は英語)', () => {
  assert.strictEqual(I18N.pick('ja-JP'), 'ja');
  assert.strictEqual(I18N.pick('ja'), 'ja');
  assert.strictEqual(I18N.pick('en-US'), 'en');
  assert.strictEqual(I18N.pick('de-DE'), 'en');
  assert.strictEqual(I18N.pick(''), 'en');
  assert.strictEqual(I18N.pick('jav'), 'en');
});

test('言語: 右クリックメニューも英語にできる', () => {
  const labels = t => t.filter(x => x.label).map(x => x.label);
  assert.deepStrictEqual(labels(buildTemplate({ isEditable: true, editFlags: {} }, { lang: 'en' })),
    ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All']);
});

test('題名が無いメモは空文字(表示側で言語に合わせて「無題のメモ」を出す)', () => {
  assert.strictEqual(L.titleOf(''), '');
  assert.strictEqual(L.titleOf('\n  \n# \n'), '');
  assert.strictEqual(L.titleOf('# Hello\nworld'), 'Hello');
});

test('Markdown の書き方: 日本語と英語で例の数と表示の有無がそろい、どの例も表示できる', () => {
  const HELP = require('../renderer/help-content');
  assert.strictEqual(HELP.ja.sections.length, HELP.en.sections.length);
  HELP.ja.sections.forEach((s, i) => {
    const e = HELP.en.sections[i];
    assert.strictEqual(!!s.noRender, !!e.noRender, '表示の有無が違う: ' + s.h);
    for (const sec of [s, e]) {
      if (sec.noRender) continue;
      const html = L.md(sec.src);
      assert.ok(html.length > 0, '表示が空: ' + sec.h);
      assert.ok(!/attach:/.test(html), '添付の書き方は noRender にする: ' + sec.h);
    }
  });
  // 主な書式が、期待どおりの HTML になる(説明と実際の表示がずれないように)
  const out = Object.fromEntries(HELP.ja.sections.filter(s => !s.noRender).map(s => [s.h, L.md(s.src)]));
  assert.match(out['見出し'], /<h1>見出し1<\/h1>/);
  assert.match(out['段落と改行'], /1行目<br>2行目/);
  assert.match(out['文字の強調'], /<strong>太字<\/strong>.*<em>斜体<\/em>.*<del>取り消し線<\/del>/s);
  assert.match(out['箇条書き'], /<li>みかん<ul><li>温州みかん/);
  assert.match(out['チェックボックス'], /type="checkbox"[^>]*checked/);
  assert.match(out['リンク'], /<a href="https:\/\/www\.electronjs\.org\/"/);
  assert.match(out['表'], /class="al-c"/);
  assert.match(out['表'], /class="al-r"/);
});
