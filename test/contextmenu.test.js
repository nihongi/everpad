'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildTemplate } = require('../contextmenu');

const labels = t => t.filter(x => x.label).map(x => x.label);
test('右クリック: 編集欄では7項目が並び、使える/使えないは editFlags に従う', () => {
  const t = buildTemplate({ isEditable: true, editFlags: { canUndo: true, canCut: false, canCopy: false, canPaste: true, canDelete: false, canSelectAll: true } });
  assert.deepStrictEqual(labels(t), ['元に戻す', 'やり直し', '切り取り', 'コピー', '貼り付け', '削除', 'すべて選択']);
  const en = Object.fromEntries(t.filter(x => x.label).map(x => [x.label, x.enabled]));
  assert.deepStrictEqual(en, { 元に戻す: true, やり直し: false, 切り取り: false, コピー: false, 貼り付け: true, 削除: false, すべて選択: true });
  assert.deepStrictEqual(t.filter(x => x.role).map(x => x.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']);
});
test('右クリック: 編集できない場所は、文字を選んだときだけコピー', () => {
  assert.deepStrictEqual(buildTemplate({ isEditable: false, selectionText: '', editFlags: {} }), []);
  assert.deepStrictEqual(buildTemplate({ isEditable: false, selectionText: '  ', editFlags: {} }), []);
  assert.deepStrictEqual(labels(buildTemplate({ isEditable: false, selectionText: 'あ', editFlags: { canCopy: true } })), ['コピー', 'すべて選択']);
  assert.deepStrictEqual(buildTemplate({}), []);
});

test('読み取り専用の場所の「すべて選択」は、渡された関数を呼ぶ(メモの範囲だけを選ぶため)', () => {
  let called = 0;
  const t = buildTemplate({ isEditable: false, selectionText: 'あ', editFlags: { canCopy: true } }, { onSelectAll: () => { called++; } });
  const item = t.find(x => x.label === 'すべて選択');
  assert.equal(item.role, undefined);
  item.click();
  assert.equal(called, 1);
});

test('右クリック: 本文では、装飾と行の書式がサブメニューにならずに並び、選ぶと種類が渡される', () => {
  const got = [];
  const onFormat = k => got.push(k);
  // ショートカットは Windows のもの(Mac の分は macos.test.js で確かめる)
  const sel = buildTemplate({ isEditable: true, formControlType: 'text-area', selectionText: 'あ', editFlags: {} }, { onFormat, platform: 'win32' });
  assert.deepStrictEqual(labels(sel), ['元に戻す', 'やり直し', '切り取り', 'コピー', '貼り付け', '削除', 'すべて選択',
    '太字', '斜体', '取り消し線', 'コード', '引用', '箇条書き', '番号付きの箇条書き', 'コードブロック', '字下げ', '字下げを戻す']);
  assert.ok(!sel.some(x => x.submenu), 'サブメニューがある');
  const items = sel.slice(sel.findIndex(x => x.label === '太字')).filter(x => x.label);
  assert.deepStrictEqual(items.map(x => x.accelerator), ['CmdOrCtrl+Shift+B', 'CmdOrCtrl+I', 'CmdOrCtrl+Shift+X', 'CmdOrCtrl+E',
    'CmdOrCtrl+Shift+Q', 'CmdOrCtrl+Shift+8', 'CmdOrCtrl+Shift+7', 'CmdOrCtrl+Shift+K', 'Tab', 'Shift+Tab']);
  // Tab / Shift+Tab は表示だけ(ほかの入力欄の Tab を奪わない)
  assert.deepStrictEqual(items.slice(8).map(x => x.registerAccelerator), [false, false]);
  assert.ok(items.slice(0, 4).every(x => x.enabled));
  items.forEach(x => x.click());
  assert.deepStrictEqual(got, ['bold', 'italic', 'strike', 'icode', 'quote', 'bullet', 'numbered', 'code', 'indent', 'outdent']);
  // 区切り線: 装飾・行の書式・字下げのまとまりの間にあり、続かない。最後は区切り線ではない
  sel.forEach((x, i) => assert.ok(!(x.type === 'separator' && sel[i + 1] && sel[i + 1].type === 'separator')));
  assert.notStrictEqual(sel[sel.length - 1].type, 'separator');
  assert.deepStrictEqual(['太字', '引用', '字下げ'].map(l => sel[sel.findIndex(x => x.label === l) - 1].type), ['separator', 'separator', 'separator']);
  // 文字を選んでいないとき: 同じ並びで、装飾だけグレー
  const none = buildTemplate({ isEditable: true, formControlType: 'text-area', selectionText: '', editFlags: {} }, { onFormat, platform: 'win32' });
  assert.deepStrictEqual(labels(none), labels(sel));
  assert.deepStrictEqual(none.filter(x => x.label && x.click).map(x => x.enabled !== false), [false, false, false, false, true, true, true, true, true, true]);
  // 検索欄などの1行の入力欄には出さない
  const input = buildTemplate({ isEditable: true, formControlType: 'input-text', selectionText: 'あ', editFlags: {} }, { onFormat });
  assert.deepStrictEqual(labels(input), ['元に戻す', 'やり直し', '切り取り', 'コピー', '貼り付け', '削除', 'すべて選択']);
  // 英語
  const en = buildTemplate({ isEditable: true, formControlType: 'text-area', selectionText: 'a', editFlags: {} }, { onFormat, lang: 'en' });
  assert.deepStrictEqual(labels(en).slice(7), ['Bold', 'Italic', 'Strikethrough', 'Code', 'Quote', 'Bulleted List', 'Numbered List', 'Code Block', 'Indent', 'Outdent']);
});
test('右クリック: プレビューで編集している表のセルにも「数式を挿入…」と「表」を出す(検索欄などには出さない)', () => {
  const onFormat = () => {}, onMath = () => {}, onTable = () => {};
  const st = { inTable: true, head: false, cols: 3, align: '' };
  const p = { isEditable: true, formControlType: 'input-text', selectionText: '', editFlags: {} };
  const cell = buildTemplate(p, { onFormat, onMath, onTable, table: st, cell: true, platform: 'win32' });
  assert.deepStrictEqual(labels(cell), ['元に戻す', 'やり直し', '切り取り', 'コピー', '貼り付け', '削除', 'すべて選択', '数式を挿入…', '表']);
  assert.ok(cell.find(x => x.label === '表').submenu.some(x => x.label && /行/.test(x.label)));
  // カーソルが数式の中なら「数式を編集…」
  assert.ok(labels(buildTemplate(p, { onFormat, onMath, onTable, table: st, cell: true, inMath: true })).includes('数式を編集…'));
  // セルでない1行の入力欄(検索欄など)には出さない
  assert.deepStrictEqual(labels(buildTemplate(p, { onFormat, onMath, onTable, table: st })), ['元に戻す', 'やり直し', '切り取り', 'コピー', '貼り付け', '削除', 'すべて選択']);
  // プレビューで編集しているかたまり(テキストエリア)は、本文と同じ並びに「数式を挿入…」と「表」
  const blk = buildTemplate(Object.assign({}, p, { formControlType: 'text-area' }), { onFormat, onMath, onTable, table: { inTable: false, head: false, cols: 2, align: '' } });
  assert.deepStrictEqual(labels(blk).slice(-2), ['数式を挿入…', '表']);
});
