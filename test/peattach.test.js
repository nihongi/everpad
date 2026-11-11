'use strict';
/* プレビューでの画像・ファイルの追加: 入れ方(blockInsert で1つのかたまりにする)と、画面・メニューへのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('編集していないプレビュー: 添付はかたまりの次に、空の行をはさんだ1つのかたまりとして入る', () => {
  const marks = [C.attachMarkup('a.png', '0123456789abcdef.png', true), C.attachMarkup('b.pdf', 'fedcba9876543210.pdf', false)];
  // 段落の次
  assert.strictEqual(C.blockInsert('p1\n\np2', 0, marks).text, 'p1\n\n![a.png](attach:0123456789abcdef.png)\n[b.pdf](attach:fedcba9876543210.pdf)\n\np2');
  // メモの最後
  const end = C.blockInsert('p1', 1, marks);
  assert.strictEqual(end.text, 'p1\n\n![a.png](attach:0123456789abcdef.png)\n[b.pdf](attach:fedcba9876543210.pdf)');
  assert.strictEqual(end.at, 2);
  // 空のメモ
  assert.strictEqual(C.blockInsert('', 1, marks).text, '![a.png](attach:0123456789abcdef.png)\n[b.pdf](attach:fedcba9876543210.pdf)');
  // 入れたかたまりは、プレビューで画像とファイルのリンクになる
  const html = C.md(end.text, { lines: true });
  assert.match(html, /data-line="2"/);
  assert.match(html, /<img[^>]*data-att="0123456789abcdef.png"/);
});

test('プレビューへの貼り付け・ドロップ・「添付」ボタンのつなぎ込み', () => {
  const app = read('renderer/app.js');
  // 編集欄への貼り付け(文字のある貼り付けはそのまま)
  assert.match(app, /\$\('preview'\)\.addEventListener\('paste', e => \{\n\s+const cd = e\.clipboardData;\n\s+if \(e\.target !== pe\.box \|\| !cd \|\| !cd\.files \|\| !cd\.files\.length \|\| cd\.getData\('text\/plain'\)\) return;/);
  // ドロップは、プレビューなら落とした場所に
  assert.match(app, /ingestFiles\(\[\.\.\.e\.dataTransfer\.files\], S\.mode === 'preview' \? peDropTarget\(e\) : null\)/);
  // プレビューでは「テキスト」表示に切り替えない
  assert.match(app, /if \(S\.mode === 'preview'\) \{\n\s+if \(!peAllowed\(\)\) return;/);
  assert.match(app, /\} else if \(S\.mode !== 'edit'\) \{ toast\(T\('attachEditOnly'\)\); return; \}/);
  assert.doesNotMatch(app, /\n\s+if \(S\.mode !== 'edit'\) \{ toast\(T\('attachEditOnly'\)\)/);
  // セルの中は横に並べる(改行を入れると表が壊れる)
  assert.match(app, /const v = marks\.join\(' '\);/);
  // 「添付」ボタンは履歴の表示でだけ隠す。押しても編集欄を閉じない
  assert.match(app, /\$\('attBtn'\)\.hidden = m === 'history';/);
  assert.match(app, /e\.target\.closest\('#attBtn'\)\) \{ e\.preventDefault\(\); return; \}/);
  // メニューの「添付」もプレビューで押せる
  assert.match(read('main.js'), /label: T\('mAttach'\), accelerator: A\('attach'\), enabled: !ui\.hist && !ui\.ro,/);
});
