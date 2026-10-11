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
