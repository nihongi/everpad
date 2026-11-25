'use strict';
/* 表のセルの中の改行(<br>)。プレビューのセルの編集欄では改行として見せ、Shift+Enter・Alt+Enter で入れる */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const D = require('../docexport');
const help = require('../renderer/help-content');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const BS = String.fromCharCode(92);

test('セルの編集欄に出す文: <br>(<br/>・<br />・大文字も)は改行、\\| は |。コードの中と、エスケープした <br> は文字のまま', () => {
  assert.strictEqual(C.cellLines('a<br>b'), 'a\nb');
  assert.strictEqual(C.cellLines('a<br/>b<BR />c<br  >d'), 'a\nb\nc\nd');
  assert.strictEqual(C.cellLines('x ' + BS + '| y'), 'x | y');
  assert.strictEqual(C.cellLines('`a<br>b` c<br>d'), '`a<br>b` c\nd');
  assert.strictEqual(C.cellLines('``a` <br> ``<br>e'), '``a` <br> ``\ne');
  assert.strictEqual(C.cellLines('`a' + BS + '|b`'), '`a|b`');           // 表の | のエスケープはコードの中でも
  assert.strictEqual(C.cellLines(BS + '<br>z'), BS + '<br>z');
  assert.strictEqual(C.cellLines('a<brx>b<b>c</b>'), 'a<brx>b<b>c</b>');   // ほかのタグはそのまま
  assert.strictEqual(C.cellLines('`open<br>'), '`open\n');                // 閉じていない ` はコードではない
});

test('セルに書く文: 改行は <br>、| は \\|。行の終わりの \\ は \\\\(続く <br> をエスケープしない)', () => {
  assert.strictEqual(C.cellEscape('a\nb'), 'a<br>b');
  assert.strictEqual(C.cellEscape('a\r\nb\rc'), 'a<br>b<br>c');
  assert.strictEqual(C.cellEscape('x | y'), 'x ' + BS + '| y');
  assert.strictEqual(C.cellEscape('a' + BS + '\nb'), 'a' + BS + BS + '<br>b');
  assert.match(C.md('| h |\n|---|\n| ' + C.cellEscape('a' + BS + '\nb') + ' |'), /<td class="al-l">a\\<br>b<\/td>/);
});

test('セルの編集欄に出して、そのまま書き戻すと同じ文になる(<br/> などは <br> にそろう)', () => {
  for (const s of ['a<br>b', '`a<br>b` c<br>d', 'x ' + BS + '| y', BS + '<br>z', '**太字**<br>2行目', '<br>先頭と末尾<br>']) {
    assert.strictEqual(C.cellEscape(C.cellLines(s)), s, s);
  }
  assert.strictEqual(C.cellEscape(C.cellLines('a<br/>b<BR />c')), 'a<br>b<br>c');
  // 行の終わりの \ は、2回目からは変わらない
  const once = C.cellEscape('a' + BS + '\nb');
  assert.strictEqual(C.cellEscape(C.cellLines(once)), once);
});

test('セルの書き換え(tableEdit)で入れた改行は、プレビューと書き出しでセルの中の改行になる', () => {
  const T = '| 品目 | 産地 |\n|---|---|\n| みかん | 愛媛 |';
  const r = C.tableEdit(T, 2, 1, 'cell', '愛媛\n和歌山');
  assert.strictEqual(r.text.split('\n')[2], '| みかん | 愛媛<br>和歌山 |');
  const html = C.md(r.text);
  assert.match(html, /<td class="al-l">愛媛<br>和歌山<\/td>/);
  const tree = D.bodyTree(html);
  assert.match(D.toAsciiDoc(tree, { title: 'T' }), /\|愛媛 \+\n和歌山/);
  assert.match(D.toLatex(tree, { title: 'T' }), /愛媛\\newline\n和歌山/);
});

test('プレビューのセルの編集欄: 複数行の欄で、Shift+Enter・Alt+Enter で改行、↑↓ はセルの中の行を先に移る', () => {
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  assert.match(app, /const inp = document\.createElement\('textarea'\);\n\s+inp\.rows = 1;\n\s+inp\.className = 'pe-cell';/);
  assert.match(app, /inp\.value = cellLines\(tableCell\(cur\(\)\.text, row, col\)\);/);
  assert.match(app, /if \(e\.key === 'Enter' && \(e\.shiftKey \|\| e\.altKey\) && !e\.ctrlKey && !e\.metaKey\) \{ e\.preventDefault\(\); peCellBreak\(\); \}/);
  // Enter だけなら今までどおり終わる(Shift+Enter・Alt+Enter の後に調べる)
  assert.ok(app.indexOf('peCellBreak(); }') < app.indexOf("else if (e.key === 'Enter' && plain) { e.preventDefault(); peClose(); }"));
  assert.match(app, /if \(e\.key === 'ArrowUp' \? line > 0 : line < peCaretLine\(ta, ta\.value\.length, true\)\) return;/);
  assert.match(app, /peReplace\(pe\.box\.selectionStart, pe\.box\.selectionEnd, '\\n'\);/);
  // 高さは中身に合わせる
  assert.match(app, /function peCellFit\(\) \{/);
  assert.match(css, /\.pe-cell \{[^}]*display: block; resize: none; overflow: hidden;/);
});

test('「Markdown の書き方」の「表」に、セルの中の改行(<br> と Shift+Enter・Alt+Enter)を書いた。例は改行のあるセル', () => {
  for (const l of ['ja', 'en']) {
    const sec = help[l].sections.find(s => s.h === (l === 'ja' ? '表' : 'Tables'));
    assert.ok(sec, l);
    assert.ok(sec.note.includes('<br>') && sec.note.includes('Shift+Enter') && sec.note.includes('Alt+Enter'), l);
    assert.match(C.md(sec.src), /<td class="al-c">[^<]+<br>[^<]+<\/td>/, l);
  }
});
