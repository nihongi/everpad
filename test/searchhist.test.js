'use strict';
/* 検索した言葉の候補(「設定」の「検索した言葉を覚えて、候補に出す」) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

test('検索の履歴: 新しい言葉を先頭に足し、同じ言葉は1つにまとめ、20件まで', () => {
  assert.deepStrictEqual(core.pushSearch([], 'a'), ['a']);
  assert.deepStrictEqual(core.pushSearch(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepStrictEqual(core.pushSearch(['A'], 'a'), ['a', 'A']);   // 大文字と小文字は別の言葉
  const many = Array.from({ length: 25 }, (_, i) => 'w' + i);
  const r = core.pushSearch(many, 'new');
  assert.strictEqual(r.length, core.SEARCH_HIST_MAX);
  assert.strictEqual(core.SEARCH_HIST_MAX, 20);
  assert.strictEqual(r[0], 'new');
  assert.deepStrictEqual(core.pushSearch(['a', 'b'], 'c', 2), ['c', 'a']);
});

test('検索の履歴: 空の言葉・空白だけ・長すぎる言葉・文字列でないものは覚えない(壊れた値は捨てる)', () => {
  for (const s of ['', '   ', null, undefined, 3, 'x'.repeat(501)]) assert.deepStrictEqual(core.pushSearch(['a'], s), ['a'], String(s));
  assert.deepStrictEqual(core.pushSearch(['x'.repeat(500)], 'b'), ['b', 'x'.repeat(500)]);
  assert.deepStrictEqual(core.pushSearch(['a', 3, null, '', 'b'], null), ['a', 'b']);
  assert.deepStrictEqual(core.pushSearch('broken', 'a'), ['a']);
  assert.deepStrictEqual(core.pushSearch(undefined, null), []);
  // 検索と置換では前後の空白も言葉のうち(そのまま覚える)
  assert.deepStrictEqual(core.pushSearch([], ' a '), [' a ']);
});

test('検索の候補: 打った文字を含むもの(大文字と小文字は区別しない)。空ならすべて。打った文字と同じものは出さない', () => {
  const list = ['EverPad', 'evening', 'tag:work', 'Pad', 'everpad'];
  assert.deepStrictEqual(core.searchSuggest(list, ''), list);
  assert.deepStrictEqual(core.searchSuggest(list, 'ev'), ['EverPad', 'evening', 'everpad']);
  assert.deepStrictEqual(core.searchSuggest(list, 'pad'), ['EverPad', 'Pad', 'everpad']);
  assert.deepStrictEqual(core.searchSuggest(list, 'everpad'), ['EverPad']);
  assert.deepStrictEqual(core.searchSuggest(list, 'zzz'), []);
  assert.deepStrictEqual(core.searchSuggest(list, '', 2), ['EverPad', 'evening']);
  assert.strictEqual(core.searchSuggest(Array.from({ length: 20 }, (_, i) => 'w' + i), '').length, 10);
  assert.deepStrictEqual(core.searchSuggest(null, 'a'), []);
});

test('検索の履歴: main.js は config.json の searchHistory に置き、既定はオン。オフにすると覚えた言葉も消す', () => {
  const main = read('main.js');
  assert.match(main, /const SEARCH_KINDS = \['q', 'fr'\];/);
  assert.match(main, /const c = readConfig\(\)\.searchHistory \|\| \{\};\n  const h = \{ on: c\.on !== false \};/);
  assert.match(main, /h\[k\] = h\.on \? pushSearch\(c\[k\], null, SEARCH_HIST_MAX\) : \[\];/);
  assert.match(main, /writeConfig\(Object\.assign\(readConfig\(\), \{ searchHistory: h \}\)\)/);
  // ほかのウィンドウからは受け付けない。決まった種類だけ
  assert.ok(main.includes("ipcMain.handle('shist:get', e => (fromOurWindow(e) ? searchHist() : null));"));
  for (const ch of ['shist:add', 'shist:del']) {
    assert.ok(main.includes("ipcMain.handle('" + ch + "', (e, kind, text) => {\n  if (!fromOurWindow(e) || !SEARCH_KINDS.includes(kind)) return null;"), ch);
  }
  assert.match(main, /if \(!h\.on \|\| typeof text !== 'string'\) return h;/);
  assert.match(main, /key === 'searchHist' && typeof value === 'boolean'\) setSearchHist\(emptySearchHist\(value\)\)/);
  assert.match(main, /key === 'searchHistClear' && value === true\) setSearchHist\(emptySearchHist\(searchHist\(\)\.on\)\)/);
  assert.match(main, /searchHist: \(h => \(\{ on: h\.on, n: h\.q\.length \+ h\.fr\.length \}\)\)\(searchHist\(\)\),/);
  const pre = read('preload.js');
  for (const s of ["searchHistGet: () => ipcRenderer.invoke('shist:get')", "searchHistAdd: (kind, text) => ipcRenderer.invoke('shist:add', kind, text)", "searchHistDel: (kind, text) => ipcRenderer.invoke('shist:del', kind, text)"]) assert.ok(pre.includes(s), s);
});

test('検索の履歴: 画面が覚えるのは Enter・検索結果を開いたとき・検索と置換で探したとき。設定の窓にオン・オフと「覚えた言葉を消す」', () => {
  const app = read('renderer/app.js');
  assert.match(app, /\$\('q'\)\.addEventListener\('keydown', e => \{ if \(e\.key === 'Enter' && !e\.isComposing && e\.keyCode !== 229\) shAdd\('q', \$\('q'\)\.value\); \}\);/);
  assert.match(app, /b\.addEventListener\('click', \(\) => \{ shAdd\('q', S\.q\); openAt\(/);
  assert.match(app, /function frGo\(dir\) \{\n    const re = frRegex\(\);\n    if \(re && !re\.error\) shAdd\('fr', \$\('frFind'\)\.value\);/);
  assert.match(app, /shAdd\('fr', \$\('frFind'\)\.value\);\n    const r = replaceAllText\(/);
  // 候補: q で tag: の候補が出ている間は出さない。Shift+Delete で消す
  assert.match(app, /!\(kind === 'q' && tp\.box\)/);
  assert.match(app, /e\.key === 'Delete' && e\.shiftKey/);
  assert.match(app, /api\.searchHistDel\(kind, s\)/);
  assert.match(app, /for \(const kind of \['q', 'fr'\]\) \{/);
  // 設定の窓
  assert.match(app, /const sr = section\(T\('setSearch'\)\);/);
  assert.match(app, /check\(sr, T\('setSearchHist'\), T\('setSearchHistHint'\), P\.searchHist\.on, async v => \{ await setPref\('searchHist', v\);/);
  assert.match(app, /await setPref\('searchHistClear', true\)/);
});

test('検索の履歴: 画面の言葉は日本語と英語の両方にある', () => {
  for (const l of ['ja', 'en']) {
    for (const k of ['setSearch', 'setSearchHist', 'setSearchHistHint', 'setSearchHistClear', 'histPick', 'histPickTip']) {
      const s = I18N.t(l, k);
      assert.ok(typeof s === 'string' && s && s !== k, l + ' ' + k);
    }
    assert.match(I18N.t(l, 'setSearchHistCount', { n: 3 }), /3/);
  }
  assert.strictEqual(I18N.t('ja', 'setSearchHistCount', { n: 3 }), '覚えている言葉: 3件');
});
