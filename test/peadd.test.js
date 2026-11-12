'use strict';
/* プレビューで段落を書き足す: 最後のかたまりの下を押す・「段落を挿入」(表の外・数式・図の右クリック)。
   書いた文が入る場所(blockInsert)と、画面・メニュー・言葉へのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const I18N = require('../renderer/i18n');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const F = '```';

test('書き足す段落の入る場所: 図で終わるメモの最後・真ん中の図の次・引用の外', () => {
  // メモの最後(図で終わる): 空の行で分ける
  const end = ['# 題', '', F + 'mermaid', 'flowchart TD', '    A --> B', F].join('\n');
  let r = C.blockInsert(end, end.split('\n').length, ['続き', '二行目']);
  assert.strictEqual(r.text, end + '\n\n続き\n二行目');
  assert.strictEqual(r.at, 7);
  // 最後に空の行があっても、空の行は1つ
  r = C.blockInsert(end + '\n\n', (end + '\n\n').split('\n').length, ['続き']);
  assert.strictEqual(r.text, end + '\n\n続き');
  // 真ん中の図の次(図の閉じの行のあと): 前後を空の行で分ける
  const mid = ['# 真ん中', '', F + 'mermaid', 'flowchart LR', '    X --> Y', F, '', '## 次', '', '最後。'].join('\n');
  r = C.blockInsert(mid, 5, ['間']);
  assert.strictEqual(r.text, ['# 真ん中', '', F + 'mermaid', 'flowchart LR', '    X --> Y', F, '', '間', '', '## 次', '', '最後。'].join('\n'));
  assert.strictEqual(r.at, 7);
  // すぐ次の行に文があるときも空の行を足す
  r = C.blockInsert(['$$', 'x', '$$', '後ろ。'].join('\n'), 2, ['式のあと']);
  assert.strictEqual(r.text, ['$$', 'x', '$$', '', '式のあと', '', '後ろ。'].join('\n'));
  // 引用の中の図: 引用の全体の次(引用の外)
  const quo = ['> 引用:', '>', '> ' + F + 'mermaid', '> flowchart LR', '>     P --> Q', '> ' + F, '', '後ろ。'].join('\n');
  r = C.blockInsert(quo, 5, ['引用のあと']);
  assert.strictEqual(r.text, ['> 引用:', '>', '> ' + F + 'mermaid', '> flowchart LR', '>     P --> Q', '> ' + F, '', '引用のあと', '', '後ろ。'].join('\n'));
  // CRLF のメモは CRLF のまま
  r = C.blockInsert('a\r\n\r\nb', 2, ['c']);
  assert.strictEqual(r.text, 'a\r\n\r\nb\r\n\r\nc');
});

test('プレビュー: 最後のかたまりの下を押すと、メモの最後に書き足す空の編集欄', () => {
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  // 編集できるメモ(空のメモ以外)だけ、最後に書き足す所を置く
  assert.match(app, /if \(!ro && !peBlank\(\)\) \{\n\s+const tail = document\.createElement\('div'\);\n\s+tail\.className = 'pe-tail';\n\s+tail\.dataset\.hint = T\('peAddHint'\);\n\s+pv\.appendChild\(tail\);/);
  // 書き足す所か、最後のかたまりより下の何もない所を押したとき
  assert.match(app, /if \(t\.closest\('\.pe-tail'\)\) return \{ add: true \};/);
  assert.match(app, /return last && e\.clientY > last\.getBoundingClientRect\(\)\.bottom \? \{ add: true \} : null;/);
  assert.match(app, /if \(d\.add\) \{ peOpenAdd\(null\); return; \}/);
  // 書き足す所は、カーソルが文字の形で、指すと案内を出す
  assert.match(css, /#preview > \.pe-tail \{[^}]*cursor: text;/);
  assert.match(css, /#preview > \.pe-tail:hover::before \{ content: attr\(data-hint\);/);
});

test('書き足す編集欄: 空なら元の文を変えず、書いたら段落として入れる。閉じる・移る・ほかの挿入とつなぐ', () => {
  const app = read('renderer/app.js');
  // いちばん外側のかたまり(引用・リスト・表の全体)の次。無ければメモの最後(脚注の前)
  assert.match(app, /const after = top \? peBlockEnd\(top\) : n\.text\.split\('\\n'\)\.length;/);
  assert.match(app, /const next = pv\.querySelector\(':scope > \.footnotes, :scope > \.pe-tail'\);/);
  assert.match(app, /kind: 'block', add: \{ after: after, ref: top, line: line == null \? null : line \}, s: after \+ 1, e: after \+ 1, n: 1, start: n\.text \}/);
  // 書いた文は、開いたときの文のその場所に入れる(空なら開いたときのまま)
  assert.match(app, /const v = pe\.box\.value, r = v\.trim\(\) \? blockInsert\(pe\.start, pe\.add\.after, v\.split\('\\n'\)\) : null;\n\s+pe\.s = r \? r\.at : pe\.add\.after \+ 1;\n\s+peSetText\(r \? r\.text : pe\.start\);/);
  // 閉じたとき: 後ろのかたまりの行のずれは、増えた行の数
  assert.match(app, /const delta = pe\.add \? lineCount\(cur\(\)\.text\) - lineCount\(pe\.start\) : /);
  assert.match(app, /if \(peAddEmpty\(\)\) \{ anchor = pe\.add\.line;/);
  assert.match(app, /pe\.kind = '';\n\s+pe\.add = null;/);
  // ほかの編集欄は書き足す編集欄ではない
  assert.match(app, /kind: 'block', add: null, s: s, e: e,/);
  assert.match(app, /kind: 'cell', add: null,/);
  // 空の書き足す編集欄からの「表を挿入」「図を挿入…」は、前のかたまりの次に入れる
  assert.match(app, /if \(peAddEmpty\(\)\) \{ const at = peCloseAdd\(\); peInsertTable\(at \? peAfter\(at\) : null, at\); return; \}/);
  assert.match(app, /if \(peAddEmpty\(\)\) \{ peInsertDiagram\(peCloseAdd\(\)\); return; \}/);
});

test('「段落を挿入」: 表の外の右クリックと、数式・図の右クリック(編集できるメモだけ)', () => {
  const app = read('renderer/app.js'), main = read('main.js');
  assert.match(main, /items\.unshift\(\{ label: T\('mInsertPara'\), click: \(\) => \{ chosen = true; resolve\('para'\); \} \}, \{ type: 'separator' \},/);
  assert.match(main, /if \(canEdit\) items\.splice\(1, 0, \{ label: T\('mInsertPara'\), click: \(\) => \{ chosen = true; resolve\(\{ status: 'para' \}\); \} \}\);/);
  assert.match(app, /action !== 'diagram' && action !== 'para'\) return;/);
  assert.match(app, /if \(action === 'para'\) peOpenAdd\(el\);/);
  assert.match(app, /else if \(r && r\.status === 'para' && m\.isConnected\) peOpenAdd\(m\);/);
});

test('段落を書き足す: 言葉(日本語と英語)', () => {
  assert.strictEqual(I18N.DICT.ja.mInsertPara, '段落を挿入');
  assert.strictEqual(I18N.DICT.en.mInsertPara, 'Insert Paragraph');
  assert.strictEqual(I18N.DICT.ja.peAddHint, 'クリックして段落を書き足す');
  assert.strictEqual(I18N.DICT.en.peAddHint, 'Click to add a paragraph');
});
