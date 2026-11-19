'use strict';
/* 「編集」と「プレビュー」を切り替えたときの位置合わせ: md の行の範囲(data-line・data-end)と、行と縦の位置の変換 */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

// 出てきた順に、タグの名前と行の範囲を取り出す
const ranges = html => [...html.matchAll(/<([a-z0-9]+)[^>]*? data-line="(\d+)" data-end="(\d+)"/g)].map(m => [m[1], +m[2], +m[3]]);

test('行の範囲: かたまりごとに、元の文の最初の行と終わりの次の行が付く', () => {
  const src = [
    '# 見出し',          // 0
    '',
    '段落の1行目',       // 2
    '段落の2行目',       // 3
    '',
    '- りんご',          // 5
    '- みかん',          // 6
    '  - 温州',          // 7
    '- ぶどう',          // 8
    '',
    '> 引用1',           // 10
    '>',
    '> 引用2',           // 12
    '',
    '| 品 | 数 |',       // 14
    '|---|---|',
    '| a | 1 |',         // 16
    '| b | 2 |',         // 17
    '',
    '```js',             // 19
    'x = 1',
    '```',               // 21
    '',
    '$$',                // 23
    'x^2',
    '$$',                // 25
    '',
    '---',               // 27
    '',
    '```mermaid',        // 29
    'flowchart LR',
    '  A --> B',
    '```'                // 32
  ].join('\n');
  assert.deepStrictEqual(ranges(L.md(src, { lines: true })), [
    ['h1', 0, 1],
    ['p', 2, 4],
    ['li', 5, 6], ['li', 6, 7], ['li', 7, 8], ['li', 8, 9],
    ['p', 10, 11], ['p', 12, 13],
    ['tr', 14, 16], ['tr', 16, 17], ['tr', 17, 18],
    ['pre', 19, 22],
    ['div', 23, 26],
    ['hr', 27, 28],
    ['div', 29, 33]
  ]);
});

test('行の範囲: 範囲は重ならず、上から順に並ぶ。付けないときは今までと同じ HTML', () => {
  const src = '前の段落\n\n1. 一\n   続き\n2. 二\n\n> - 引用のリスト\n> - 二つ目\n\n後ろの段落\n';
  const r = ranges(L.md(src, { lines: true }));
  for (let k = 1; k < r.length; k++) assert.ok(r[k - 1][2] <= r[k][1], JSON.stringify(r));
  // 項目の続きの段落は、その項目の中の段落として自分の行の範囲を持つ(項目の範囲はその前まで)
  assert.deepStrictEqual(r.filter(x => x[0] === 'li').map(x => [x[1], x[2]]), [[2, 3], [4, 5], [6, 7], [7, 8]]);
  assert.ok(r.some(x => x[0] === 'p' && x[1] === 3 && x[2] === 4), JSON.stringify(r));
  assert.ok(!/data-line/.test(L.md(src)));
  assert.strictEqual(L.md(src, {}), L.md(src));
  // 文の中に同じ形のタグを書いても、行の範囲にはならない(esc される)
  assert.ok(!/<li data-line="9"/.test(L.md('- <li data-line="9">', { lines: true })));
});

test('行の範囲: 閉じていないコードブロックは、本文の終わりまで', () => {
  assert.deepStrictEqual(ranges(L.md('```\nコード\nまだ続く', { lines: true })), [['pre', 0, 3]]);
  assert.deepStrictEqual(ranges(L.md('```mermaid\nflowchart LR', { lines: true })), [['div', 0, 2]]);
});

// 0〜3 行目: 上が 0、高さ 20 の見出し。5〜7 行目: 上が 40、高さ 60 の段落(4 行目は空行)
const A = [{ s: 0, e: 1, top: 0, bottom: 20 }, { s: 1, e: 4, top: 20, bottom: 50 }, { s: 5, e: 8, top: 70, bottom: 130 }];

test('行 → 縦の位置: かたまりの中は割合で、間の空行は前と次の間で割り振る', () => {
  assert.strictEqual(L.lineToY(A, 0), 0);
  assert.strictEqual(L.lineToY(A, 0.5), 10);
  assert.strictEqual(L.lineToY(A, 2.5), 35);
  assert.strictEqual(L.lineToY(A, 4), 50);
  assert.strictEqual(L.lineToY(A, 4.5), 60);
  assert.strictEqual(L.lineToY(A, 6.5), 100);
  assert.strictEqual(L.lineToY(A, 20), 130);   // 最後より後は、最後のかたまりの下
  assert.strictEqual(L.lineToY([], 3), 0);
});

test('縦の位置 → 行: 行 → 縦の位置の逆になる', () => {
  for (const line of [0, 0.25, 1, 2.5, 3.9, 4, 4.5, 5, 6.25, 7.5]) assert.ok(Math.abs(L.yToLine(A, L.lineToY(A, line)) - line) < 1e-9, String(line));
  assert.strictEqual(L.yToLine(A, -5), 0);     // 最初のかたまりより上は最初の行
  assert.strictEqual(L.yToLine(A, 500), 8);    // 最後より下は、最後のかたまりの終わり
  assert.strictEqual(L.yToLine([], 10), 0);
});

test('目印を光らせる先: 行を含むかたまり。間の空行なら次のかたまり、最後より後なら最後のかたまり', () => {
  assert.strictEqual(L.anchorAt(A, 2), A[1]);
  assert.strictEqual(L.anchorAt(A, 4.5), A[2]);
  assert.strictEqual(L.anchorAt(A, 50), A[2]);
  assert.strictEqual(L.anchorAt([], 1), null);
});

test('プレビューを作り直しても位置がずれない: 中身を入れ替えた直後の描画の間だけ、スクロールアンカーを止める', () => {
  // 検索のたびに作り直すと、Chromium のスクロールアンカー(overflow-anchor)が同じ向きに同じだけ位置をずらしていった
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const fn = app.match(/function renderPreview\(inPlace\) \{[\s\S]*?\n {2}\}/)[0];
  const off =fn.indexOf("pv.style.overflowAnchor = 'none';"), html = fn.indexOf('pv.innerHTML = ');
  assert.ok(off >= 0 && off < html, '入れ替える前に止める');
  // 2回あとの描画で戻す(続けて作り直したときは、最後の分だけが戻す)
  assert.match(fn, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{ if \(tok === pvAnchorTok\) pv\.style\.overflowAnchor = ''; \}\)\);/);
  assert.match(fn, /const tok = \+\+pvAnchorTok;/);
});

test('プレビューを作り直しても、最後のあたりの位置が縮まない: 足りない高さを足し、落ち着くまで位置を合わせ直す', () => {
  // 長いメモの終わりにリンクを落とすと、作り直した直後の仮の高さ(content-visibility)で位置が縮み、ずっと上へ飛んでいた
  const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const fn = app.match(/function renderPreview\(inPlace\) \{[\s\S]*?\n {2}\}/)[0];
  assert.ok(fn.indexOf('const oldH = inPlace && pv.clientHeight && pvShownId === cur().id ? pv.scrollHeight : 0;') >= 0, '見えているプレビューで同じメモを作り直すときだけ');
  assert.ok(fn.indexOf('const oldH = ') < fn.indexOf('pv.innerHTML = '), '入れ替える前の高さを覚える');
  // 「テキスト」から切り替えたときは保たない(プレビューのまま作り直すときだけ)。peRerender はプレビューのまま
  assert.match(app, /const pvShown = !\$\('preview'\)\.hidden;[^\n]*\n\s+\$\('edwrap'\)\.hidden = /);
  assert.match(app, /if \(m === 'preview'\) renderPreview\(pvShown\);/);
  assert.match(app, /function peRerender\(anchor, top\) \{\n\s+const pv = \$\('preview'\);\n\s+renderPreview\(true\);/);
  assert.match(fn, /pvHold\(pv, oldH, lastHydrate\);/);
  const hold = app.match(/function pvHold\(pv, oldH, drawn\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(hold, /const short = oldH - pv\.scrollHeight;\n\s+if \(short <= 0\) return;/);
  assert.match(hold, /sp\.style\.height = short \+ 'px';/);
  assert.match(hold, /Promise\.race\(\[Promise\.all\(loaded\.concat\(\[Promise\.resolve\(drawn\)\]\)\), new Promise\(r => setTimeout\(r, 4000\)\)\]\)/);
  const re = app.match(/function peRerender\(anchor, top\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(re, /if \(anchor == null \|\| top == null\) return Promise\.resolve\(\);/);
  assert.match(re, /if \(!stop && tok === pvAnchorTok && \+\+n <= 60 && calm < 3\) \{/);
  assert.match(re, /const evs = \['wheel', 'mousedown', 'keydown', 'touchstart'\];/);
  // 入れたかたまり・表の編集欄・図を見せるのは、落ち着いてから
  assert.match(app, /peRerender\(el \? \+el\.dataset\.line : r\.at, top\)\.then\(\(\) => \{\n\s+const added = /);
  assert.match(app, /if \(box\) settled\.then\(\(\) => \{ if \(pe\.box === box\) box\.scrollIntoView\(\{ block: 'nearest' \}\); \}\);/);
  assert.match(app, /peRerender\(el \? \+el\.dataset\.line : r\.line, top\)\.then\(\(\) => \{\n\s+const d = /);
});
