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

test('履歴の変更位置: 追加は追加し終えた位置、削除は削除した位置(カーソル位置と同じ数え方)', () => {
  const at = (before, after) => { const op = L.makeOp(before, after, 1); return L.cursorInfo(after, L.changeEnd(op)); };
  assert.deepStrictEqual(at('ab\ncd', 'ab\ncXd'), { line: 2, col: 3 });         // 1文字追加 → その直後
  assert.deepStrictEqual(at('ab\ncXd', 'ab\ncd'), { line: 2, col: 2 });         // 1文字削除 → 削除した位置
  assert.deepStrictEqual(at('ab\ncd', 'ab\ncYYd'.replace('YY', 'Z')), { line: 2, col: 3 });
  assert.deepStrictEqual(at('abc', 'aXYZc'), { line: 1, col: 5 });              // 置き換え(b → XYZ)→ 追加し終えた位置
  assert.deepStrictEqual(at('a', 'a\n\nb'), { line: 3, col: 2 });               // 改行を含む追加
  assert.deepStrictEqual(at('x', 'x😀'), { line: 1, col: 3 });                  // 絵文字は1文字と数える
  assert.strictEqual(L.changeEnd(null), 0);
});

test('スクロールバーが一瞬出て消えない: スクロールバーの幅をいつも空け、状態表示はいつも1行', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  // 同じ選択子の規則が複数あるときは、まとめて見る
  const esc = s => s.replace(/[.#>]/g, '\\$&');
  const rule = sel => [...css.matchAll(new RegExp('(?:^|\\n)' + esc(sel) + ' \\{([^}]*)\\}', 'g'))].map(m => m[1]).join(' ');
  // 本文・プレビュー・履歴の表示: スクロールバーが出ても折り返しの幅が変わらない
  for (const sel of ['#editor', '.pane', '.hv-body']) assert.match(rule(sel), /scrollbar-gutter: stable;/, sel);
  // 状態表示: 折り返さない(「保存中…」やカーソルの位置で幅が変わっても、高さが変わらない)。左側は「…」で縮める
  assert.match(rule('.status'), /flex-wrap: nowrap;/);
  assert.match(rule('#stLeft'), /flex-wrap: nowrap;[^]*min-width: 0;[^]*overflow: hidden;/);
  assert.match(rule('#stLeft > span'), /white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(rule('.stR'), /flex: none;/);
  assert.match(rule('#stLeft > .st-pos, #stLeft > .st-sel'), /flex-shrink: 0;/);   // 縮めるのは「全体」から
});
