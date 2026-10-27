'use strict';
/* 改行と字下げ: 自動インデント・箇条書きの続き・Tab(core.js の newlineEdit / indentEdit / tabEdit) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

// 「|」がカーソル、「«」〜「»」が選択(テストを読みやすくするため)
function caret(s) { const p = s.indexOf('|'); return { text: s.slice(0, p) + s.slice(p + 1), s: p, e: p }; }
function range(s) { const a = s.indexOf('«'), b = s.indexOf('»'); return { text: s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1), s: a, e: b - 1 }; }
function apply(t, r) {
  if (!r) return null;
  const out = t.text.slice(0, r.from) + r.insert + t.text.slice(r.to);
  // 結果もカーソル・選択の印で返す
  return r.selStart === r.selEnd ? out.slice(0, r.selStart) + '|' + out.slice(r.selStart) : out.slice(0, r.selStart) + '«' + out.slice(r.selStart, r.selEnd) + '»' + out.slice(r.selEnd);
}
const ON = { indent: true, list: true };
const enter = (s, o) => { const t = s.indexOf('«') >= 0 ? range(s) : caret(s); return apply(t, L.newlineEdit(t.text, t.s, t.e, o || ON)); };
const tab = (s, w, shift) => { const t = s.indexOf('«') >= 0 ? range(s) : caret(s); return apply(t, L.tabEdit(t.text, t.s, t.e, w || 4, shift)); };

test('自動インデント: 行の先頭の半角スペースとタブを引き継ぐ', () => {
  assert.strictEqual(enter('    abc|'), '    abc\n    |');
  assert.strictEqual(enter('\t\tabc|'), '\t\tabc\n\t\t|');
  assert.strictEqual(enter(' \tabc|'), ' \tabc\n \t|');
  assert.strictEqual(enter('abc|'), null);                                    // 字下げが無ければ普通の改行(ブラウザに任せる)
  assert.strictEqual(enter('　段落|'), null);                                  // 全角スペースは引き継がない
});

test('自動インデント: 行の途中・字下げの途中・選択中の改行', () => {
  assert.strictEqual(enter('    ab|cd'), '    ab\n    |cd');
  assert.strictEqual(enter('  |  abc'), '  \n  |  abc');                       // カーソルより前の空白だけを引き継ぐ(後ろの文字の位置はずれない)
  assert.strictEqual(enter('|    abc'), null);
  assert.strictEqual(enter('    a«bc»d'), '    a\n    |d');                   // 選んだ部分は消える
});

test('自動インデント: 空白だけの行では、その行の空白を消して次の行に同じ字下げを付ける', () => {
  assert.strictEqual(enter('a\n    |'), 'a\n\n    |');
  assert.strictEqual(enter('a\n  |  '), 'a\n\n    |');
  assert.strictEqual(enter('a\n    |\nb'), 'a\n\n    |\nb');
});

test('自動インデント: オフなら何もしない(箇条書きの続きだけ有効にもできる)', () => {
  const off = { indent: false, list: false };
  assert.strictEqual(enter('    abc|', off), null);
  assert.strictEqual(enter('- abc|', off), null);
  assert.strictEqual(enter('    abc|', { indent: false, list: true }), null);
  assert.strictEqual(enter('  - abc|', { indent: false, list: true }), '  - abc\n  - |');
});

test('箇条書きの続き: 記号・番号・チェックボックス・引用', () => {
  assert.strictEqual(enter('- abc|'), '- abc\n- |');
  assert.strictEqual(enter('* abc|'), '* abc\n* |');
  assert.strictEqual(enter('+ abc|'), '+ abc\n+ |');
  assert.strictEqual(enter('  - abc|'), '  - abc\n  - |');                    // 入れ子は字下げも引き継ぐ
  assert.strictEqual(enter('1. abc|'), '1. abc\n2. |');
  assert.strictEqual(enter('9) abc|'), '9) abc\n10) |');                      // ) はそのまま、番号は1つ増やす
  assert.strictEqual(enter('- [x] done|'), '- [x] done\n- [ ] |');            // チェックは外す
  assert.strictEqual(enter('- [ ] todo|'), '- [ ] todo\n- [ ] |');
  assert.strictEqual(enter('> quote|'), '> quote\n> |');
  assert.strictEqual(enter('>quote|'), '>quote\n> |');
});

test('箇条書きの続き: 記号だけの行では記号を消して箇条書きを終える', () => {
  assert.strictEqual(enter('- a\n- |'), '- a\n|');
  assert.strictEqual(enter('- a\n  - |'), '- a\n|');
  assert.strictEqual(enter('1. a\n2. |'), '1. a\n|');
  assert.strictEqual(enter('- [ ] a\n- [ ] |'), '- [ ] a\n|');
  assert.strictEqual(enter('> a\n> |'), '> a\n|');
  assert.strictEqual(enter('- a\n- |\nb'), '- a\n|\nb');
});

test('箇条書きの続き: 行の途中、カーソルが記号より前、コードブロックの中', () => {
  assert.strictEqual(enter('- ab|cd'), '- ab\n- |cd');
  assert.strictEqual(enter('  |- abc'), '  \n  |- abc');                      // 記号より前: 字下げだけ
  assert.strictEqual(enter('|- abc'), null);
  assert.strictEqual(enter('```\n- abc|\n```'), null);                         // コードブロックの中は記号を付けない
  assert.strictEqual(enter('```\n  - abc|\n```'), '```\n  - abc\n  |\n```');  // 字下げだけ引き継ぐ
  assert.strictEqual(enter('```\ncode\n```\n- abc|'), '```\ncode\n```\n- abc\n- |');
  assert.strictEqual(enter('~~~~\n```\n- a|'), null);                          // ~~~~ の中の ``` では閉じない
  assert.strictEqual(enter('-abc|'), null);                                    // 記号の後に空白が無いものは箇条書きではない
});

test('Shift+Enter: 記号を付けず、項目の文字の位置まで字下げする', () => {
  const soft = { indent: true, list: true, soft: true };
  assert.strictEqual(enter('- abc|', soft), '- abc\n  |');
  assert.strictEqual(enter('  1. abc|', soft), '  1. abc\n     |');
  assert.strictEqual(enter('- [ ] abc|', soft), '- [ ] abc\n      |');
  assert.strictEqual(enter('    abc|', soft), '    abc\n    |');               // 箇条書きでなければ Enter と同じ
});

test('Tab: カーソルの位置に、次の字下げの位置までスペースを入れる(幅 2 / 4)', () => {
  assert.strictEqual(tab('|abc', 4), '    |abc');
  assert.strictEqual(tab('|abc', 2), '  |abc');
  assert.strictEqual(tab('a|bc', 4), 'a   |bc');
  assert.strictEqual(tab('ab|c', 2), 'ab  |c');
  assert.strictEqual(tab('abc|', 2), 'abc |');
  assert.strictEqual(tab('\t|x', 4), '\t    |x');
});

test('Tab: 箇条書きの行では、行の先頭を字下げして入れ子にする(コードブロックの中を除く)', () => {
  assert.strictEqual(tab('- a\n- b|', 4), '- a\n    - b|');
  assert.strictEqual(tab('- a\n- |', 2), '- a\n  - |');
  assert.strictEqual(tab('1. a|', 4), '    1. a|');
  assert.strictEqual(tab('> a|', 4), '> a |');                                // 引用はカーソルの位置にスペース
  assert.strictEqual(tab('```\n- a|', 4), '```\n- a |');
});

test('Tab: 選んだ行をまとめて字下げする(空の行には付けない、選んだ文字は消さない)', () => {
  assert.strictEqual(tab('«a\nb»', 4), '«    a\n    b»');
  assert.strictEqual(tab('«a\n\nb»', 2), '«  a\n\n  b»');
  assert.strictEqual(tab('x«yz»', 4), '    x«yz»');                          // 1行の中の選択でも、文字は消さずに行を字下げ
  assert.strictEqual(tab('«a\n»b', 4), '«    a\n»b');                         // 終わりが次の行の先頭ちょうどなら、その行は含めない
});

test('Shift+Tab: 字下げを1段戻す(スペース width 個まで、またはタブ1つ)', () => {
  assert.strictEqual(tab('      a|', 4, true), '  a|');
  assert.strictEqual(tab('      a|', 2, true), '    a|');
  assert.strictEqual(tab('  a|', 4, true), 'a|');
  assert.strictEqual(tab('\t\ta|', 4, true), '\ta|');
  assert.strictEqual(tab('a|', 4, true), null);                                 // 字下げが無ければ何もしない
  assert.strictEqual(tab('«    a\n  b\nc»', 4, true), '«a\nb\nc»');
  assert.strictEqual(tab('  |  a', 4, true), '|a');                             // 字下げの途中のカーソルは行の先頭へ
});
