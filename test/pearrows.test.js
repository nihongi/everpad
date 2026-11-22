'use strict';
/* プレビューの編集欄の ↑↓: 折り返した行の中では同じかたまりの中で動き、見た目の最初・最後の行でだけ前後のかたまりに移る(app.js) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('↑↓ で前後のかたまりに移るのは、見た目の最初・最後の行にいるとき', () => {
  const app = read('renderer/app.js');
  // 見た目の行で決める(元の文の改行だけで決めない)。最後の行の数は、覚えている行を使わずに測る
  assert.match(app, /if \(e\.key === 'ArrowUp' && line <= 0\) \{ e\.preventDefault\(\); peMove\(-1\); return; \}/);
  assert.match(app, /if \(e\.key === 'ArrowDown' && line >= peCaretLine\(ta, v\.length, true\)\) \{ e\.preventDefault\(\); peMove\(1\); return; \}/);
  assert.doesNotMatch(app, /e\.key === 'ArrowDown' && plain && !e\.shiftKey && s === en && v\.indexOf\('\\n', s\) < 0\) \{ e\.preventDefault\(\); peMove\(1\)/);
  // 行は、全文を入れた見えない複製で、位置の文字を印で囲んで測る(折り返しの境目では、カーソルと同じく次の行)
  assert.match(app, /function peLineTop\(ta, pos\) \{[\s\S]*?mirror\.textContent = v\.slice\(0, pos\);[\s\S]*?mirror\.appendChild\(document\.createTextNode\(v\.slice\(pos \+ one\.length\)\)\);/);
});

test('折り返しの境目のために、↑↓・Home・End・クリックで置いた行を覚え、ほかの操作で忘れる', () => {
  const app = read('renderer/app.js');
  assert.match(app, /let peComposing = false, peNext = null, peLastCell = null, peCaret = null;/);
  // 覚えた行は、同じ編集欄・同じ位置・同じ中身のときだけ使う
  assert.match(app, /if \(!fresh && peCaret && peCaret\.ta === ta && peCaret\.pos === pos && peCaret\.v === ta\.value\) return peCaret\.line;/);
  // ↑ は 1 行上、↓ は 1 行下、Home・End は同じ行。ほかのキーでは忘れる
  assert.match(app, /const to = e\.key === 'ArrowUp' \? line - 1 : e\.key === 'ArrowDown' \? line \+ 1 : line;/);
  assert.match(app, /\} else peCaret = null;/);
  // クリックは押した高さの行(最後の行より下なら最後の行)
  assert.match(app, /\$\('preview'\)\.addEventListener\('mousedown', e => \{ if \(e\.target === pe\.box\) peCaret = null; \}\);/);
  assert.match(app, /Math\.max\(0, Math\.min\(peCaretLine\(ta, ta\.value\.length, true\), Math\.floor\(y \/ lh\)\)\)/);
});
