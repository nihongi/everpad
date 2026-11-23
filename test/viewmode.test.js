'use strict';
/* テキストかプレビューかを、アプリを閉じて起動し直しても引き継ぐ(app.js)。履歴の表示は覚えず、その元の表示で始める */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

test('表示を切り替えたら覚える(起動の途中では覚えない。履歴の表示は覚えない)', () => {
  assert.match(app, /if \(m !== 'history'\) \{\n\s+S\.hbase = m;\n(?:\s+\/\/[^\n]*\n)+\s+if \(S\.booted\) \{ try \{ localStorage\.setItem\('everpad:mode', m\); \}/);
});

test('起動したときは、覚えた表示で始める(言語の切り替えで読み直したときは、預けた表示)', () => {
  assert.match(app, /let last = 'edit';\n\s+try \{ last = localStorage\.getItem\('everpad:mode'\) \|\| 'edit'; \}[^\n]*\n\s+const m = view \? \(view\.mode === 'history' \? view\.hbase : view\.mode\) : last;\n[^\n]*\n\s+setMode\(m === 'preview' \? 'preview' : 'edit', true\);/);
  // 覚えた表示を読むのは、起動の最後(S.booted を立てたあと)
  assert(app.indexOf('S.booted = true;') < app.indexOf("last = localStorage.getItem('everpad:mode')"));
});
