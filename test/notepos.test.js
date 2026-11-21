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
  assert.match(app, /async function openAt\(id, opt\) \{[\s\S]*?if \(pe\.box\) peClose\(true\);\n\s+if \(cur\(\) && cur\(\)\.id !== id\) rememberPos\(\);/);
  // 保存先から読み直したときは、今の場所のまま(呼ぶ側が戻す)
  assert.match(app, /show\(id, \{ pos: false \}\);\n\s+ed\.setSelectionRange/);
  // 閉じるときにも覚え、起動したら最初のメモの場所に戻す
  assert.match(app, /window\.addEventListener\('pagehide', rememberPos\);/);
  assert.match(app, /loadRecent\(\);\n\s+loadPos\(\);/);
  assert.match(app, /else \{ setMode\('edit', true\); restorePos\(\); \}/);
});

test('検索結果から開くとき: プレビューならプレビューのまま、テキスト表示なら見つかった箇所を選ぶ', () => {
  const app = read('renderer/app.js');
  const m = app.match(/async function openAt\(id, opt\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m);
  const f = m[0];
  // プレビュー(と、プレビューから入った履歴の表示)で開いたかを先に見る
  assert.match(f, /const inPv = S\.mode === 'preview' \|\| \(S\.mode === 'history' && S\.hbase === 'preview'\);/);
  // 一覧から開くとき(show)と同じく、プレビューでの編集の取り消しの記録を捨て、読み取り専用の状態を合わせる
  assert.match(f, /peUndo\.length = 0;\n\s+peRedo\.length = 0;\n\s+peLastCell = null;/);
  assert.match(f, /\$\('editor'\)\.value = loaded\.text;\n\s+applyRO\(\);/);
  // 「履歴すべて」の結果は履歴の表示。タグだけの検索の結果は、一覧から開いたときと同じく今の表示のまま前に見ていた場所。
  // 文字の検索の結果は、プレビューならプレビューで見つかった箇所へ、それ以外はテキスト表示で見つかった箇所を選ぶ
  assert.match(f, /if \(opt\.rev != null\) \{[\s\S]*?setMode\('history'\);[\s\S]*?\} else if \(opt\.tag\) \{\n(?:\s*\/\/[^\n]*\n)*\s+setMode\(inPv \? 'preview' : 'edit'\);\n\s+restorePos\(\);\n\s+\} else if \(inPv\) \{\n\s+setMode\('preview'\);\n[\s\S]*?\$\('editor'\)\.setSelectionRange\(opt\.s, opt\.e\);\n\s+pvShowFound\(opt\.s, opt\.find\);\n\s+\} else \{\n\s+setMode\('edit'\);/);
  // タグを選んで見せる処理は、もう無い
  assert.doesNotMatch(f, /tagHit\(/);
  // プレビューでは、その行のかたまりの中の一致を今の箇所にし、無ければその行を出して光らせる。図があとから描かれても同じ箇所を見せる
  assert.match(app, /function pvShowFound\(s, find\) \{[\s\S]*?pvPick\(k, false\);[\s\S]*?keepAnchor\(a, sc, domAnchors\(sc\)\);[\s\S]*?syncApply\(\{ line, offset: sc\.clientHeight \/ 3, edge: null, caretLine: -1, target: false \}, false\);/);
});
