'use strict';
/* リストの項目の中のかたまり: 項目より字下げした表・引用・注意書き・見出し・コードなどを、その項目の中として表示する(GitHub と同じ) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../renderer/core');
const D = require('../docexport');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ranges = html => [...html.matchAll(/<([a-z0-9]+)[^>]*? data-line="(\d+)" data-end="(\d+)"/g)].map(m => [m[1], +m[2], +m[3]]);
const TABLE = '<div class="tblwrap"><table><thead><tr><th class="al-l">a</th><th class="al-l">b</th></tr></thead><tbody><tr><td class="al-l">1</td><td class="al-l">2</td></tr></tbody></table></div>';

test('リストの項目の中の表: 字下げして続けた表は、その項目の中の表になる(空行をはさんでも)', () => {
  const t = p => p + '| a | b |\n' + p + '|---|---|\n' + p + '| 1 | 2 |\n';
  assert.strictEqual(L.md('- 項目\n' + t('  ')), '<ul><li>項目' + TABLE + '</li></ul>');
  assert.strictEqual(L.md('- 項目\n\n' + t('  ')), '<ul><li>項目' + TABLE + '</li></ul>');
  assert.strictEqual(L.md('1. 項目\n' + t('   ') + '2. 次\n'), '<ol><li>項目' + TABLE + '</li><li>次</li></ol>');
  assert.strictEqual(L.md('- a\n  - b\n\n' + t('    ')), '<ul><li>a<ul><li>b' + TABLE + '</li></ul></li></ul>');
  assert.strictEqual(L.md('- [ ] 作業\n' + t('  ')), '<ul><li><input type="checkbox" disabled> 作業' + TABLE + '</li></ul>');
  // 字下げしていない表は、今までどおりリストのあと
  assert.strictEqual(L.md('- 項目\n\n' + t('')), '<ul><li>項目</li></ul>\n' + TABLE);
  // リストの外の字下げした表も、今までどおり表
  assert.strictEqual(L.md(t('  ')), TABLE);
});

test('リストの項目の中の引用・注意書き・見出し・区切り線', () => {
  assert.strictEqual(L.md('- 手順\n  > 注意\n  > 続き\n- 次\n'), '<ul><li>手順<blockquote><p>注意<br>続き</p></blockquote></li><li>次</li></ul>');
  assert.strictEqual(L.md('- 手順\n\n  > 注意\n'), '<ul><li>手順<blockquote><p>注意</p></blockquote></li></ul>');
  const a = L.md('- 手順\n  > [!WARNING]\n  > 消えます\n');
  assert.match(a, /^<ul><li>手順<blockquote class="alert alert-warning" data-alert="warning">/);
  assert.match(a, /<p>消えます<\/p><\/blockquote><\/li><\/ul>$/);
  assert.strictEqual(L.md('- a\n\n  ## 小見出し\n'), '<ul><li>a<h2>小見出し</h2></li></ul>');
  assert.strictEqual(L.md('- a\n\n  ---\n'), '<ul><li>a<hr></li></ul>');
  // 引用の中のリストは、今までどおり
  assert.strictEqual(L.md('> - 一\n> - 二\n'), '<blockquote><ul><li>一</li><li>二</li></ul></blockquote>');
});

test('リストの項目の中: 段落とコードブロックは今までどおり。コードの中のリストの記号は項目にしない', () => {
  assert.strictEqual(L.md('1. 準備\n2. 導入\n\n   ```\n   npm install\n   ```\n\n   このあと確かめます。\n3. 起動\n'),
    '<ol><li>準備</li><li>導入<pre><code>npm install</code></pre><p>このあと確かめます。</p></li><li>起動</li></ol>');
  assert.strictEqual(L.md('- a\n\n  ```\n  - 項目ではない\n\n  # 見出しではない\n  ```\n- b\n'),
    '<ul><li>a<pre><code>- 項目ではない\n\n# 見出しではない</code></pre></li><li>b</li></ul>');
  assert.strictEqual(L.md('- a\n  続き\n\n  次の段落\n  - 入れ子\n- b\n'), '<ul><li>a<p>続き</p><p>次の段落</p><ul><li>入れ子</li></ul></li><li>b</li></ul>');
  // 字下げしていない次の行は、項目の続きにしない(今までどおり)
  assert.strictEqual(L.md('- a\nb\n'), '<ul><li>a</li></ul>\n<p>b</p>');
  // 字下げを外すのは項目の文の始まりまで(それより深い字下げは残す)
  assert.strictEqual(L.md('- a\n\n  ```\n    深い\n  ```\n'), '<ul><li>a<pre><code>  深い</code></pre></li></ul>');
});

test('リストの項目の中のかたまりの行の範囲: 重ならず、項目の範囲は中のかたまりの前まで', () => {
  const src = '- 手順\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n\n  > 注意\n- 次\n';
  const r = ranges(L.md(src, { lines: true }));
  assert.deepStrictEqual(r, [['li', 0, 1], ['tr', 1, 3], ['tr', 3, 4], ['p', 5, 6], ['li', 6, 7]]);
  for (let k = 1; k < r.length; k++) assert.ok(r[k - 1][2] <= r[k][1], JSON.stringify(r));
});

test('リストの項目の中の表も、プレビューでセルごとに編集でき、字下げを保つ', () => {
  const s = '- 手順\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- 次\n';
  assert.deepStrictEqual(L.tableAt(s, 3), { heads: [1], head: 1, delim: 2, rows: [3], cols: 2, align: ['', ''], caption: -1, first: 1, last: 3 });
  assert.strictEqual(L.tableCell(s, 3, 1), '2');
  assert.strictEqual(L.tableEdit(s, 3, 0, 'cell', 'X').text, '- 手順\n  | a | b |\n  |---|---|\n  | X | 2 |\n- 次\n');
  assert.strictEqual(L.tableEdit(s, 3, 1, 'rowBelow').text, '- 手順\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n  |  |  |\n- 次\n');
});

test('リストの項目の中の表と引用は、書き出しでも項目の中に入る', () => {
  const t = D.bodyTree(L.md('1. 手順\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\n   > 注意\n2. 次\n'));
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].t, 'list');
  assert.deepStrictEqual(t[0].items[0].c.map(b => b.t), ['p', 'table', 'quote']);
  const a = D.toAsciiDoc(t, { title: 'T' });
  assert.match(a, /\. 手順\n\+\n\[cols="<,<",options="header"\]\n\|===/);
});

test('プレビュー: 項目の中のかたまりのあとに表などを入れるときは、いちばん外側のかたまりの次に入れる', () => {
  const app = read('renderer/app.js');
  assert.match(app, /el\.tagName !== 'LI' && el\.parentElement && el\.parentElement\.closest\('li'\)/);
});
