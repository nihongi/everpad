'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

test('カーソル位置: 改行で区切った行と、行の先頭からの文字数(1から)', () => {
  const t = 'abc\nde\n\nfgh';
  assert.deepStrictEqual(L.cursorInfo(t, 0), { line: 1, col: 1 });
  assert.deepStrictEqual(L.cursorInfo(t, 3), { line: 1, col: 4 });   // 1行目の行末
  assert.deepStrictEqual(L.cursorInfo(t, 4), { line: 2, col: 1 });   // 改行の直後
  assert.deepStrictEqual(L.cursorInfo(t, 7), { line: 3, col: 1 });   // 空の行
  assert.deepStrictEqual(L.cursorInfo(t, t.length), { line: 4, col: 4 });
  assert.deepStrictEqual(L.cursorInfo('', 0), { line: 1, col: 1 });
  assert.deepStrictEqual(L.cursorInfo(t, 999), { line: 4, col: 4 }); // 範囲外は端に寄せる
});

test('カーソル位置: 絵文字や日本語も1文字と数える', () => {
  const t = 'あ😀い\nx';
  assert.deepStrictEqual(L.cursorInfo(t, 3), { line: 1, col: 3 });   // 😀 は2単位だが1文字
  assert.deepStrictEqual(L.cursorInfo(t, 4), { line: 1, col: 4 });
});

test('選択: 文字数は改行を数えず、行数は最後の改行だけの行を数えない', () => {
  assert.deepStrictEqual(L.selectionInfo(''), { chars: 0, lines: 0 });
  assert.deepStrictEqual(L.selectionInfo('abc'), { chars: 3, lines: 1 });
  assert.deepStrictEqual(L.selectionInfo('ab\ncd'), { chars: 4, lines: 2 });
  assert.deepStrictEqual(L.selectionInfo('ab\ncd\n'), { chars: 4, lines: 2 });
  assert.deepStrictEqual(L.selectionInfo('\n'), { chars: 0, lines: 2 });
  assert.deepStrictEqual(L.selectionInfo('😀日本\n語'), { chars: 4, lines: 2 });
});
