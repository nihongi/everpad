'use strict';
/* 数式エディタ: 元の文の中の数式を探す(inlineMathSpans・mathAt・mathInBlock)、入れる・置き換える(mathInsert・mathReplace)、
   空の {} への移動(emptyBraceAt)、パレットとひな型(mathpalette.js)、画面・メニューへのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const P = require('../renderer/mathpalette');
const katex = require('katex');
require('katex/dist/contrib/mhchem.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const OPTS = { throwOnError: true, trust: false, strict: 'ignore', output: 'html', maxExpand: 1000, maxSize: 50 };

test('文中の数式の位置: $…$・\\(…\\)・$$…$$。コード表記の中と \\$ は数式ではない(md と同じ読み方)', () => {
  const sp = C.inlineMathSpans('a $x$ b `$c$` \\$5 and $$y$$ \\(z\\) $w$ $5 と $10');
  assert.deepStrictEqual(sp.map(x => [x.o, x.tex, x.display]), [['$', 'x', false], ['$$', 'y', true], ['\\(', 'z', false], ['$', 'w', false]]);
  assert.deepStrictEqual(sp[0], { s: 2, e: 5, o: '$', c: '$', tex: 'x', display: false });
  // md が数式にするものと同じ数
  const line = '式 $a$ と \\(b\\) と $$c$$ と `$d$` と \\$e$ と $f $';
  const html = C.md(line);
  assert.strictEqual(C.inlineMathSpans(line).length, (html.match(/class="math/g) || []).length);
});

test('カーソルの数式(mathAt): 文中の数式と、独立した行の数式のかたまり', () => {
  const t = '文 $a+b$ と $$c$$。\n\n$$\nx^2\n$$\n\n> $$\n> y\n> $$\n\n```math\nz\n```\n\n```\n$q$\n```';
  const at = (s, d) => C.mathAt(t, t.indexOf(s) + (d || 0));
  assert.deepStrictEqual(at('a+b'), { s: 2, e: 7, tex: 'a+b', display: false, block: false, o: '$', c: '$' });
  assert.strictEqual(at('a+b', -1).tex, 'a+b');   // 区切りの上でも
  assert.strictEqual(at('c$$').display, true);
  assert.deepStrictEqual(at('x^2'), { s: 18, e: 27, tex: 'x^2', display: true, block: true, line: 2, end: 5 });
  assert.strictEqual(at('> y').tex, 'y');
  assert.strictEqual(at('z\n').tex, 'z');
  assert.strictEqual(at('文'), null);
  assert.strictEqual(at('$q$', 1), null);   // コードブロックの中は数式ではない
});

test('数式の置き換え(mathReplace): 区切りの書き方と引用の > を残す', () => {
  const t = '文 $a+b$ と \\(c\\)。\n\n$$\nx^2\n$$\n\n> $$\n> y\n> $$\n\n```math\nz\n```\n\n単 $$q$$\n\n\\[ w \\]';
  const at = s => C.mathAt(t, t.indexOf(s));
  const L = r => r.text.split('\n');
  assert.strictEqual(L(C.mathReplace(t, at('a+b'), 'k', false))[0], '文 $k$ と \\(c\\)。');
  assert.strictEqual(L(C.mathReplace(t, at('c\\)'), 'k^2', false))[0], '文 $a+b$ と \\(k^2\\)。');
  assert.strictEqual(L(C.mathReplace(t, at('a+b'), 'k', true))[0], '文 $$k$$ と \\(c\\)。');
  assert.deepStrictEqual(L(C.mathReplace(t, at('x^2'), 'X\nY', true)).slice(2, 6), ['$$', 'X', 'Y', '$$']);
  assert.deepStrictEqual(L(C.mathReplace(t, at('> y'), 'Y', true)).slice(6, 9), ['> $$', '> Y', '> $$']);
  assert.deepStrictEqual(L(C.mathReplace(t, at('z\n'), 'Z', true)).slice(10, 13), ['```math', 'Z', '```']);
  assert.strictEqual(L(C.mathReplace(t, at('$$q'), 'r', true))[14], '単 $$r$$');
  assert.strictEqual(L(C.mathReplace(t, at(' w '), 'v', true)).pop(), '\\[v\\]');   // 1行の \[ \] は1行のまま
  // かたまり → 文中
  assert.deepStrictEqual(L(C.mathReplace(t, at('x^2'), 'k', false)).slice(2, 4), ['$k$', '']);
  // 文中の数式は改行を空白にする
  assert.strictEqual(L(C.mathReplace(t, at('a+b'), 'p\nq', false))[0], '文 $p q$ と \\(c\\)。');
});

test('数式の挿入(mathInsert): 文中は選んだ範囲に、独立した行はカーソルの行の次に。閉じの後ろが数字なら \\(…\\)', () => {
  assert.deepStrictEqual(C.mathInsert('abc\ndef', 1, 2, ' x ', false), { text: 'a$x$c\ndef', sel: 2, selEnd: 3 });
  assert.deepStrictEqual(C.mathInsert('a1', 1, 1, 'x', false), { text: 'a\\(x\\)1', sel: 3, selEnd: 4 });
  const r = C.mathInsert('abc\ndef', 1, 1, 'x\ny', true);
  assert.strictEqual(r.text, 'abc\n\n$$\nx\ny\n$$\n\ndef');
  assert.strictEqual(r.text.slice(r.sel, r.selEnd), 'x\ny');
  assert.strictEqual(C.mathInsert('', 0, 0, 'x', true).text, '$$\nx\n$$');
  assert.strictEqual(C.mathInsert('a\nb', 0, 0, 'x', true, 99).text, 'a\nb\n\n$$\nx\n$$');
  assert.strictEqual(C.mathInline('a\n b ', ''), '$a b$');
});

test('プレビューの数式の元の文(mathInBlock): かたまりの中で何番目か、中身で確かめる', () => {
  const t = '| $a$ | $b$ |\n|---|---|\n- $c$ と $c$ と $d$';
  assert.deepStrictEqual(C.mathInBlock(t, 0, 1, 1, 'b'), { s: 8, e: 11, tex: 'b', display: false, block: false, o: '$', c: '$' });
  const third = C.mathInBlock(t, 2, 3, 2, 'd');
  assert.strictEqual(t.slice(third.s, third.e), '$d$');
  // 何番目かがずれていても、中身で探す
  assert.strictEqual(C.mathInBlock(t, 2, 3, 5, 'd').tex, 'd');
  assert.strictEqual(C.mathInBlock(t, 2, 3, 0, 'none'), null);
});

test('空の {} への移動(emptyBraceAt): 次・前、端まで行ったら反対の端から', () => {
  const s = '\\frac{}{}';
  assert.strictEqual(C.emptyBraceAt(s, 0), 6);
  assert.strictEqual(C.emptyBraceAt(s, 6), 8);
  assert.strictEqual(C.emptyBraceAt(s, 8), 6);
  assert.strictEqual(C.emptyBraceAt(s, 8, true), 6);
  assert.strictEqual(C.emptyBraceAt(s, 6, true), 8);
  assert.strictEqual(C.emptyBraceAt('\\frac{a}{b}', 0), -1);
});

test('パレットとひな型: すべて KaTeX で描け(空の {} も)、名前は日本語と英語', () => {
  const tabs = P.tabs.map(t => t.id);
  assert.deepStrictEqual(tabs, ['tpl', 'ops', 'greek', 'rel', 'arrow', 'sym', 'font', 'chem']);
  let n = 0;
  for (const t of P.tabs) {
    assert.ok(t.ja && t.en, t.id);
    for (const s of t.items || []) {
      n++;
      assert.doesNotThrow(() => katex.renderToString(s, OPTS), s);
      // パレットのボタンに描く形(空の {} は □)
      assert.doesNotThrow(() => katex.renderToString(P.show(s), OPTS), s);
    }
  }
  assert.ok(n >= 150, n);
  let k = 0;
  for (const g of P.templates) {
    assert.ok(g.ja && g.en);
    for (const it of g.items) {
      k++;
      assert.strictEqual(it.length, 3);
      assert.ok(it[0] && it[1], it[2]);
      assert.doesNotThrow(() => katex.renderToString(it[2], Object.assign({ displayMode: true }, OPTS)), it[2]);
    }
  }
  assert.ok(k >= 40, k);
});

test('数式エディタ: 画面・メニュー・キー・右クリックへのつなぎ込みと言葉', () => {
  const app = read('renderer/app.js'), main = read('main.js'), cm = read('contextmenu.js'), html = read('renderer/index.html'), css = read('renderer/styles.css');
  assert.match(html, /<script src="diagram\.js"><\/script>\n<script src="mathpalette\.js"><\/script>\n<script src="app\.js"><\/script>/);
  // プレビューは、メモと同じ設定(MATH_OPTS)で描く。誤りがあれば挿入できない
  assert.match(app, /katex\.renderToString\(v, Object\.assign\(\{\}, MATH_OPTS, \{ displayMode: display\(\) \}\)\)/);
  assert.match(app, /ok\.disabled = !v\.trim\(\) \|\| !!e;/);
  // Tab で空の {} に、Ctrl+Enter で挿入
  assert.match(app, /emptyBraceAt\(ta\.value, e\.shiftKey \? ta\.selectionStart : ta\.selectionEnd, e\.shiftKey\)/);
  // 「テキスト」表示は frInsert(元に戻せる)、プレビューは peSetText と peRecord
  assert.match(app, /function mathCommand\(\) \{[\s\S]*?frInsert\(op\.p, op\.p \+ op\.d\.length, op\.i\);/);
  assert.match(app, /function peMathEdit\(m\) \{[\s\S]*?if \(peSetText\(r\.text\)\) \{ peRecord\(before, r\.text\); peRerender\(anchor, top\); \}/);
  // 数式のダブルクリックは編集、図のダブルクリックは「テキスト」表示
  assert.match(app, /if \(m\.classList\.contains\('math'\) && peAllowed\(\)\) peMathEdit\(m\);\n\s+else if \(m\.classList\.contains\('diagram'\)\) switchBase\('edit'\);/);
  assert.match(app, /else if \(name === 'math'\) mathCommand\(\);/);
  // メニュー・キー・右クリック
  assert.match(main, /\{ label: T\('mInsertMath'\), accelerator: A\('math'\), enabled: !ui\.hist && !ui\.ro, click: \(\) => send\('math'\) \}/);
  assert.match(main, /if \(kind === 'math' && canEdit\) items\.unshift\(\{ label: T\('mEditMath'\)/);
  assert.match(cm, /if \(body && opts\.onMath\) fmt\.push\(\{ type: 'separator' \}, \{ label: T\(opts\.inMath \? 'mEditMath' : 'mInsertMath'\)/);
  const K = require('../keymap');
  assert.strictEqual(K.defaults('win32').math, 'CmdOrCtrl+Shift+M');
  assert.match(css, /\.modal\.wide \.modal-box \{/);
  assert.match(css, /\.mathed \{/);
  const I = require('../renderer/i18n');
  for (const l of ['ja', 'en']) for (const k of ['mInsertMath', 'mEditMath', 'mathInsertTitle', 'mathEditTitle', 'mathTexLabel', 'mathPreviewLabel', 'mathDisplay', 'mathInline', 'mathInsertBtn', 'mathReplaceBtn', 'mathEmpty', 'mathError', 'mathNotFound']) {
    assert.ok(I.DICT[l][k], l + ':' + k);
  }
});
