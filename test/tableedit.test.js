'use strict';
/* 表の編集(core.js の tableAt・tableEdit・tableCaret・tableCellPos)と、プレビューでクリックした場所から元の文の位置を探す caretFromRendered。
   表の操作は、プレビューのセルの右クリック・「テキスト」表示・「編集」→「表」で使う */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

const T = '前\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n| 3 |\n\n後';
const L = s => s.split('\n');

test('表: 行の読み書き(区切り、エスケープ、両端の |、引用の >)はそのまま戻る', () => {
  for (const line of ['| a | b |', 'a | b', '|a|b|', '| x\\|y | `c\\|d` |', '> | q | r |', '  | s |  ', '| 空 |  |', '|---|:-:|']) {
    assert.strictEqual(C.tableRowBuild(C.tableRowParse(line)), line, line);
  }
  assert.deepStrictEqual(C.tableRowParse('| x\\|y | z |').segs, [' x\\|y ', ' z ']);
  assert.deepStrictEqual(C.tableRowParse('a | b').segs, ['a ', ' b']);
  const q = C.tableRowParse('> > | a |');
  assert.strictEqual(q.pre, '> > ');
  assert.ok(q.lead && q.trail);
});

test('表: 行を含む表を探す(md と同じ読み方。引用の中も、コードの中は表ではない)', () => {
  assert.deepStrictEqual(C.tableAt(T, 4), { head: 2, delim: 3, rows: [4, 5], cols: 2, align: ['', 'r'] });
  assert.strictEqual(C.tableAt(T, 2).head, 2);
  assert.strictEqual(C.tableAt(T, 0), null);
  assert.strictEqual(C.tableAt(T, 7), null);
  assert.deepStrictEqual(C.tableAt('> | a |\n> |:-:|\n> | 1 |', 2), { head: 0, delim: 1, rows: [2], cols: 1, align: ['c'] });
  assert.strictEqual(C.tableAt('```\n| a |\n|---|\n```', 1), null);
  assert.strictEqual(C.tableCell(T, 4, 1), '2');
  assert.strictEqual(C.tableCell(T, 5, 1), '');
});

test('表: 行の挿入と削除(見出しの行には挿入・削除しない)', () => {
  let r = C.tableEdit(T, 4, 1, 'rowAbove');
  assert.deepStrictEqual(L(r.text).slice(2, 7), ['| a | b |', '|---|--:|', '|  |  |', '| 1 | 2 |', '| 3 |']);
  assert.deepStrictEqual([r.row, r.col], [4, 1]);
  r = C.tableEdit(T, 2, 0, 'rowBelow');   // 見出しの行の下 = 本文の最初
  assert.strictEqual(L(r.text)[4], '|  |  |');
  assert.strictEqual(r.row, 4);
  r = C.tableEdit(T, 5, 0, 'rowBelow');
  assert.strictEqual(L(r.text)[6], '|  |  |');
  assert.strictEqual(C.tableEdit(T, 2, 0, 'rowAbove'), null);
  assert.strictEqual(C.tableEdit(T, 3, 0, 'rowDelete'), null);
  r = C.tableEdit(T, 4, 0, 'rowDelete');
  assert.deepStrictEqual(L(r.text).slice(2, 6), ['| a | b |', '|---|--:|', '| 3 |', '']);
  assert.strictEqual(r.row, 4);   // 次の行(詰めたので同じ行番号)
  r = C.tableEdit(T, 5, 0, 'rowDelete');
  assert.strictEqual(r.row, 4);   // 最後の行を消したら前の行
  // 表の外は1文字も変えない
  const v = C.tableEdit(T, 4, 0, 'rowAbove').text;
  assert.ok(v.startsWith('前\n\n| a | b |\n|---|--:|\n') && v.endsWith('| 1 | 2 |\n| 3 |\n\n後'), v);
});

test('表: 列の挿入と削除(すべての行と区切りの行。セルの足りない行は補う)', () => {
  let r = C.tableEdit(T, 4, 0, 'colRight');
  assert.deepStrictEqual(L(r.text).slice(2, 6), ['| a |  | b |', '|---| --- |--:|', '| 1 |  | 2 |', '| 3 |  |  |']);
  assert.deepStrictEqual([r.row, r.col], [4, 1]);
  r = C.tableEdit(T, 2, 0, 'colLeft');
  assert.deepStrictEqual(L(r.text).slice(2, 4), ['|  | a | b |', '| --- |---|--:|']);
  assert.strictEqual(r.col, 0);
  r = C.tableEdit(T, 4, 1, 'colDelete');
  assert.deepStrictEqual(L(r.text).slice(2, 6), ['| a |', '|---|', '| 1 |', '| 3 |']);
  assert.strictEqual(r.col, 0);
  assert.strictEqual(C.tableEdit('| a |\n|---|\n| 1 |', 2, 0, 'colDelete'), null);
  // 両端に | の無い表
  r = C.tableEdit('a | b\n--|--\n1 | 2', 2, 1, 'colRight');
  // 端の | の無い行は、空のセルを最後に足すと | を付ける(付けないと端の | と読まれて列が減る)
  assert.deepStrictEqual(L(r.text), ['a | b|  |', '--|--| --- ', '1 | 2|  |']);
  assert.strictEqual(C.tableAt(r.text, 2).cols, 3);
});

test('表: 列の配置は区切りの行だけを変える(- の数と空白はそのまま)', () => {
  assert.strictEqual(L(C.tableEdit(T, 4, 0, 'alignCenter').text)[3], '|:---:|--:|');
  assert.strictEqual(L(C.tableEdit(T, 4, 0, 'alignRight').text)[3], '|---:|--:|');
  assert.strictEqual(L(C.tableEdit(T, 4, 1, 'alignLeft').text)[3], '|---|:---|');
  assert.strictEqual(L(C.tableEdit('| a |\n| :-----: |\n| 1 |', 2, 0, 'alignNone').text)[1], '| ----- |');
  assert.deepStrictEqual(C.tableAt(C.tableEdit(T, 4, 0, 'alignCenter').text, 4).align, ['c', 'r']);
});

test('表: セルの書き換え(前後の空白はそのまま、| はエスケープ、足りないセルは補う)と、表の削除', () => {
  let r = C.tableEdit(T, 4, 1, 'cell', 'x|y');
  assert.strictEqual(L(r.text)[4], '| 1 | x\\|y |');
  r = C.tableEdit(T, 5, 1, 'cell', 'z');
  assert.strictEqual(L(r.text)[5], '| 3 | z |');
  r = C.tableEdit('|a|b|\n|-|-|\n|1|2|', 2, 0, 'cell', '新');
  assert.strictEqual(L(r.text)[2], '|新|2|');
  assert.strictEqual(L(C.tableEdit(T, 4, 0, 'cell', 'a\\|b').text)[4], '| a\\|b | 2 |');   // すでにエスケープしたものはそのまま
  assert.strictEqual(L(C.tableEdit(T, 4, 0, 'cell', '改\n行').text)[4], '| 改 行 | 2 |');
  r = C.tableEdit(T, 4, 0, 'delete');
  assert.strictEqual(r.text, '前\n\n後');
  assert.deepStrictEqual([r.row, r.col], [2, -1]);
  // 引用の中の表
  r = C.tableEdit('> | a |\n> |---|\n> | 1 |', 2, 0, 'rowBelow');
  assert.strictEqual(L(r.text)[3], '> |  |');
  // CRLF はそのまま
  assert.ok(/\r\n/.test(C.tableEdit('| a |\r\n|---|\r\n| 1 |', 2, 0, 'rowBelow').text));
});

test('表を挿入: 空の表(見出しの行 + 3行、3列)を次の行に。前後が文なら空の行をはさむ', () => {
  const NEW = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |';
  // 段落の途中の行で: その行の次(段落はそこで分かれる)
  let r = C.tableInsert('a\nb\nc', 0);
  assert.strictEqual(r.text, 'a\n\n' + NEW + '\n\nb\nc');
  assert.deepStrictEqual([r.row, r.col], [2, 0]);
  assert.deepStrictEqual(C.tableAt(r.text, r.row), { head: 2, delim: 3, rows: [4, 5, 6], cols: 3, align: ['', '', ''] });
  // 空の行で: その行に
  assert.strictEqual(C.tableInsert('a\n\nb', 1).text, 'a\n\n' + NEW + '\n\nb');
  // 最後(文の無い下の方): 最後の行の後ろ。終わりの空の行はまとめる
  assert.strictEqual(C.tableInsert('a\nb', 99).text, 'a\nb\n\n' + NEW);
  assert.strictEqual(C.tableInsert('a\n\n\n', 3).text, 'a\n\n' + NEW);
  // 空のメモ・先頭
  assert.deepStrictEqual(C.tableInsert('', 0), { text: NEW, row: 0, col: 0 });
  assert.strictEqual(C.tableInsert('a', -1).text, NEW + '\n\na');
  // CRLF はそのまま
  assert.ok(/\r\n\| --- \|/.test(C.tableInsert('a\r\nb', 0).text));
});

test('表を挿入: 「テキスト」表示で入れる行(表・コード・数式・図の中なら、その後ろ)', () => {
  const s = '文\n\n```\nx\ny\n```\n後\n\n$$\nx^2\n$$\n\n| a |\n|---|\n| 1 |\n| 2 |';
  assert.strictEqual(C.tableInsertAfter(s, 0), 0);
  assert.strictEqual(C.tableInsertAfter(s, s.indexOf('y')), 5);
  assert.strictEqual(C.tableInsertAfter(s, s.indexOf('x^2')), 10);
  assert.strictEqual(C.tableInsertAfter(s, s.indexOf('| 1 |')), 15);
  assert.strictEqual(C.tableInsertAfter(s, s.indexOf('後') + 1), 6);
});

test('表: カーソルのセル(tableCaret)と、セルの位置(tableCellPos)', () => {
  const s = '| a | b |\n|---|--:|\n| 1 | 2 |';
  assert.deepStrictEqual(C.tableCaret(s, 2), { row: 0, col: 0 });
  assert.deepStrictEqual(C.tableCaret(s, 6), { row: 0, col: 1 });
  assert.deepStrictEqual(C.tableCaret(s, 14), { row: 0, col: 0 });   // 区切りの行は見出しの行として
  assert.deepStrictEqual(C.tableCaret(s, s.length), { row: 2, col: 1 });
  assert.strictEqual(C.tableCaret('文\n\n' + s, 0), null);
  assert.strictEqual(s.slice(C.tableCellPos(s, 2, 1)), '2 |');
  assert.strictEqual(C.tableCellPos('|  |  |', 0, 1), 5);   // 空のセルは真ん中
  assert.strictEqual(C.tableCellPos('| a |', 0, 5), 5);   // 無いセルは行の終わり
});

test('プレビューでクリックした場所 → 元の文の位置(caretFromRendered)', () => {
  assert.strictEqual(C.caretFromRendered('- 項目 **太字** です', '項目 太', 8), 8);
  assert.strictEqual(C.caretFromRendered('# 見出し', '', 3), 2);
  assert.strictEqual(C.caretFromRendered('- [ ] やること', '', 4), 6);
  assert.strictEqual(C.caretFromRendered('> 引用', '', 2), 2);
  assert.strictEqual(C.caretFromRendered('abc', 'abc', 3), 3);
  // 同じ文字が何度も出るときは、表示の割合から見た位置に近いもの
  assert.strictEqual(C.caretFromRendered('ああ x ああ x ああ', 'ああ x ああ', 13), 7);
  assert.strictEqual(C.caretFromRendered('[リンク](https://example.com) の後', 'リンク', 7), 4);
});

test('プレビューでの編集: 画面・メニュー・main.js へのつなぎ込み', () => {
  const app = read('renderer/app.js'), main = read('main.js'), preload = read('preload.js'), cm = read('contextmenu.js'), css = read('renderer/styles.css');
  const sec = app.slice(app.indexOf('/* ---------- プレビューでの編集 ----------'), app.indexOf('  api.onMenu(name => {'));
  // かたまりの元の文は data-line〜data-end(リストの項目は下の項目も含む)。数式・図・脚注の一覧は編集しない
  assert.match(sec, /el\.querySelectorAll\('\[data-end\]'\)\.forEach\(x => \{ e = Math\.max\(e, \+x\.dataset\.end\); \}\)/);
  assert.match(sec, /const PE_SKIP = 'a, img, \.math, \.diagram, [^']*\.footnotes/);
  assert.match(sec, /const peAllowed = \(\) => S\.mode === 'preview' && !!cur\(\) && !isRO\(cur\(\)\)/);
  // 書いた文字は、「テキスト」表示と同じく commit で履歴に入る
  assert.match(sec, /function peSetText\(v\) \{[\s\S]*?ed\.setRangeText\(op\.i, op\.p, op\.p \+ op\.d\.length, 'preserve'\);\n\s+commit\(\);/);
  // 日本語入力の変換中は書かない
  assert.match(sec, /if \(!pe\.box \|\| peComposing\) return;/);
  // セルは tableEdit で、表の操作も tableEdit
  assert.match(sec, /tableEdit\(cur\(\)\.text, pe\.row, pe\.col, 'cell', pe\.box\.value\)/);
  // 表示の切り替え・メモの移動で閉じる
  assert.match(app, /function setMode\(m, focusEditor\) \{\n\s+if \(pe\.box\) peClose\(true\);/);
  assert.match(app, /function show\(id\) \{\n\s+if \(pe\.box\) peClose\(true\);\n\s+peUndo\.length = 0;/);
  assert.match(app, /if \(m === 'preview'\) renderPreview\(\);/);
  // 書式はかたまりの編集欄にも、メニューの「表」は tbl:… で
  assert.match(app, /const ed = blk \? pe\.box : \$\('editor'\);/);
  assert.match(app, /else if \(name\.indexOf\('tbl:'\) === 0\) tableMenuAction\(name\.slice\(4\)\);/);
  // main.js: プレビューのセルの右クリックのメニュー、「テキスト」表示の右クリックの「表」、メニューバーの「編集」→「表」
  assert.match(main, /ipcMain\.handle\('table:menu', \(e, st\) => \{\n\s+if \(!fromOurWindow\(e\)\) return null;/);
  assert.match(main, /ipcMain\.on\('edit:ctx', \(e, st\) => \{[\s\S]*?e\.returnValue = true;/);
  assert.match(main, /onTable: id => send\('tbl:' \+ id\), table: ctx && ctx\.table,/);
  assert.match(preload, /tableMenu: st => ipcRenderer\.invoke\('table:menu', st\),\n\s+editContext: st => ipcRenderer\.sendSync\('edit:ctx', st\),/);
  assert.match(cm, /if \(body && opts\.table && opts\.onTable\) fmt\.push/);
  assert.match(css, /\.pe-edit \{/);
  assert.match(css, /\.pe-cell \{/);
});

test('プレビューでの編集: 表のメニューの項目(見出しの行・1列の表では押せないもの、今の配置に印)', () => {
  const { tableItems } = require('../contextmenu');
  const I = require('../renderer/i18n');
  const T2 = k => I.t('ja', k);
  const flat = items => items.reduce((a, x) => a.concat(x.submenu ? [x].concat(x.submenu) : [x]), []);
  let it = flat(tableItems(T2, () => {}, { head: true, cols: 1, align: 'c' }, {}, 'win32'));
  const by = label => it.find(x => x.label === label);
  assert.strictEqual(by('上に行を挿入').enabled, false);
  assert.strictEqual(by('行を削除').enabled, false);
  assert.strictEqual(by('列を削除').enabled, false);
  assert.strictEqual(by('下に行を挿入').enabled, true);
  assert.strictEqual(by('中央揃え').checked, true);
  assert.strictEqual(by('左寄せ').checked, false);
  assert.strictEqual(it[0].label, '表を挿入');
  it = flat(tableItems(T2, () => {}, null, {}, 'win32'));
  assert.ok(it.filter(x => x.label).every(x => x.enabled !== false));
  assert.ok(!it.some(x => x.type === 'checkbox'));
  // 表の外では「表を挿入」だけ
  let chosen = null;
  it = tableItems(T2, id => { chosen = id; }, { inTable: false }, {}, 'win32');
  assert.deepStrictEqual(it.map(x => x.label), ['表を挿入']);
  it[0].click();
  assert.strictEqual(chosen, 'insert');
  // メニューの言葉は日本語と英語の両方
  for (const l of ['ja', 'en']) for (const k of ['mTable', 'mTblInsert', 'mTblRowAbove', 'mTblRowBelow', 'mTblRowDelete', 'mTblColLeft', 'mTblColRight', 'mTblColDelete', 'mTblAlign', 'mTblAlignLeft', 'mTblAlignCenter', 'mTblAlignRight', 'mTblDelete', 'tblNotInTable', 'tblCannot']) {
    assert.ok(I.DICT[l][k], l + ':' + k);
  }
  // 「編集」は「テキスト」に
  assert.strictEqual(I.DICT.ja.edit, 'テキスト');
  assert.strictEqual(I.DICT.en.edit, 'Text');
  assert.strictEqual(I.DICT.ja.mModeEdit, 'テキスト');
  assert.strictEqual(I.DICT.en.mModeEdit, 'Text');
});
