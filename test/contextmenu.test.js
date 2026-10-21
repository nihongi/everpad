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

test('右クリック: 編集画面(テキストエリア)だけに「書式」が出て、選ぶと種類が渡される', () => {
  const got = [];
  const onFormat = k => got.push(k);
  const area = buildTemplate({ isEditable: true, formControlType: 'text-area', editFlags: {} }, { onFormat });
  const fmt = area.find(x => x.label === '書式');
  assert.ok(fmt, '書式が無い');
  assert.deepStrictEqual(fmt.submenu.map(x => x.label), ['引用', '箇条書き', '番号付きの箇条書き', 'コードブロック']);
  assert.deepStrictEqual(fmt.submenu.map(x => x.accelerator), ['CmdOrCtrl+Shift+Q', 'CmdOrCtrl+Shift+8', 'CmdOrCtrl+Shift+7', 'CmdOrCtrl+Shift+K']);
  fmt.submenu.forEach(x => x.click());
  assert.deepStrictEqual(got, ['quote', 'bullet', 'numbered', 'code']);
  // 検索欄などの1行の入力欄には出さない
  const input = buildTemplate({ isEditable: true, formControlType: 'input-text', editFlags: {} }, { onFormat });
  assert.ok(!input.some(x => x.label === '書式'));
  // 英語
  const en = buildTemplate({ isEditable: true, formControlType: 'text-area', editFlags: {} }, { onFormat, lang: 'en' });
  assert.deepStrictEqual(en.find(x => x.label === 'Format').submenu.map(x => x.label), ['Quote', 'Bulleted List', 'Numbered List', 'Code Block']);
});
