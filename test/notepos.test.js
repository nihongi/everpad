'use strict';
/* メモごとの見ていた場所とカーソル: 別のメモに移るとき・閉じるときに覚え、また開いたときに戻す(app.js) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('メモを切り替えると、前のメモの場所を覚え、開いたメモの場所に戻す(初めてなら先頭)', () => {
  const app = read('renderer/app.js');
  // 覚えるのは、表示の切り替えと同じ基準(syncCapture: 元の文の行と画面の上からの高さ)とカーソル。保存先ごとに localStorage に、300件まで
  assert.match(app, /const POS_MAX = 300;/);
  assert.match(app, /const posKey = \(\) => 'everpad:pos:' \+ S\.dir;/);
  assert.match(app, /function rememberPos\(\) \{[\s\S]*?syncCapture\(\)[\s\S]*?s: ed\.selectionStart, e: ed\.selectionEnd/);
  // 戻すときは光らせない(quiet)。初めてのメモは、カーソルもスクロールも先頭
  assert.match(app, /function restorePos\(\) \{[\s\S]*?ed\.setSelectionRange\(0, 0\);\n\s+ed\.scrollTop = 0;\n\s+\$\('preview'\)\.scrollTop = 0;[\s\S]*?syncApply\(\{ line: [^}]*caretLine: -1, target: false \}, true\);/);
  // 別のメモに移るとき(一覧・最近見たメモ・リンク・削除のあと)と、検索結果から開くときに覚える
  assert.match(app, /function show\(id, opt\) \{\n\s+if \(pe\.box\) peClose\(true\);\n\s+if \(cur\(\) && cur\(\)\.id !== id\) rememberPos\(\);/);
  assert.match(app, /setMode\(S\.mode\);\n\s+if \(!opt \|\| opt\.pos !== false\) restorePos\(\);/);
  assert.match(app, /if \(!loaded\) \{ toast\(T\('loadFailed'\)\); return; \}\n\s+if \(cur\(\) && cur\(\)\.id !== id\) rememberPos\(\);/);
  // 保存先から読み直したときは、今の場所のまま(呼ぶ側が戻す)
  assert.match(app, /show\(id, \{ pos: false \}\);\n\s+ed\.setSelectionRange/);
  // 閉じるときにも覚え、起動したら最初のメモの場所に戻す
  assert.match(app, /window\.addEventListener\('pagehide', rememberPos\);/);
  assert.match(app, /loadRecent\(\);\n\s+loadPos\(\);/);
  assert.match(app, /else \{ setMode\('edit', true\); restorePos\(\); \}/);
});
