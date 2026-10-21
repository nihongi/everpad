'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

test('文字数・単語数・行数: Notepad++ の「要約」と同じ数え方', () => {
  assert.deepStrictEqual(L.textStats(''), { chars: 0, words: 0, lines: 1 });          // 空のメモは1行
  assert.deepStrictEqual(L.textStats('abc\n'), { chars: 3, words: 1, lines: 2 });     // 最後の改行の後の空の行も数える
  assert.deepStrictEqual(L.textStats('Hello, world! foo-bar x=1'), { chars: 25, words: 6, lines: 1 });
  assert.deepStrictEqual(L.textStats('a\tb  c\n\nd'), { chars: 7, words: 4, lines: 3 });   // タブと空白も1文字
  // 半角の記号はすべて区切り
  assert.strictEqual(L.textStats('a\\b.c,d;e:f!g?h(i)j+k-l*m/n=o]p[q{r}s&t~u"v\'w`x|y@z$1%2<3>4^5').words, 31);
  // 全角の句読点は区切りにならない(Notepad++ と同じ)
  assert.deepStrictEqual(L.textStats('こんにちは、世界。\n日本語 の 文'), { chars: 16, words: 4, lines: 2 });
  assert.strictEqual(L.textStats('😀👍').chars, 2);
});

const apply = (text, s, e, kind) => {
  const r = L.formatLines(text, s, e, kind);
  return { text: text.slice(0, r.from) + r.insert + text.slice(r.to), sel: text.slice(0, r.from).length === r.selStart ? (text.slice(0, r.from) + r.insert + text.slice(r.to)).slice(r.selStart, r.selEnd) : null };
};

test('書式: 対象は選択がかかっている行(終わりが次の行の先頭ちょうどなら含めない)', () => {
  const t = 'one\ntwo\nthree\nfour';
  assert.strictEqual(apply(t, 5, 5, 'quote').text, 'one\n> two\nthree\nfour');                // カーソルの行
  assert.strictEqual(apply(t, 1, 9, 'quote').text, '> one\n> two\n> three\nfour');           // one の途中〜three の途中
  assert.strictEqual(apply(t, 0, 8, 'quote').text, '> one\n> two\nthree\nfour');             // three の先頭ちょうどで終わる
  assert.strictEqual(apply(t, 1, 9, 'quote').sel, '> one\n> two\n> three');                  // 書式を付けた行を選んだ状態にする
});

test('書式: 引用は空の行にも > を付け、もう一度で外す', () => {
  const t = 'a\n\nb';
  const q = apply(t, 0, t.length, 'quote').text;
  assert.strictEqual(q, '> a\n>\n> b');
  assert.strictEqual(apply(q, 0, q.length, 'quote').text, t);
});

test('書式: 箇条書きは字下げの後に付け、空の行は飛ばす。番号付きから切り替わる', () => {
  const t = 'a\n  b\n\nc';
  const b = apply(t, 0, t.length, 'bullet').text;
  assert.strictEqual(b, '- a\n  - b\n\n- c');
  assert.strictEqual(apply(b, 0, b.length, 'bullet').text, t);                               // もう一度で外す
  assert.strictEqual(apply('1. x\n2. y', 0, 9, 'bullet').text, '- x\n- y');                    // 番号付き → 箇条書き
});

test('書式: 番号付きは 1. から順に付け、空の行は飛ばす。箇条書きから切り替わる', () => {
  const t = 'a\n\nb\nc';
  const n = apply(t, 0, t.length, 'numbered').text;
  assert.strictEqual(n, '1. a\n\n2. b\n3. c');
  assert.strictEqual(apply(n, 0, n.length, 'numbered').text, t);
  assert.strictEqual(apply('- x\n- y', 0, 7, 'numbered').text, '1. x\n2. y');
});

test('書式: コードブロックは前後に ``` の行を入れ、もう一度で外す(囲みを選んでいても、中を選んでいても)', () => {
  const t = 'before\ncode1\ncode2\nafter';
  const c = apply(t, 7, 18, 'code').text;
  assert.strictEqual(c, 'before\n```\ncode1\ncode2\n```\nafter');
  const inner = c.indexOf('code1');
  assert.strictEqual(apply(c, inner, inner + 11, 'code').text, t);                            // 中の行だけ選んで外す
  const fence = c.indexOf('```');
  assert.strictEqual(apply(c, fence, c.lastIndexOf('```') + 3, 'code').text, t);              // 囲みごと選んで外す
  assert.strictEqual(apply('x', 0, 1, 'code').text, '```\nx\n```');                             // 1行だけ
});

test('書式: 表や見出しも区別せずに処理する', () => {
  assert.strictEqual(apply('# 見出し\n| a | b |', 0, 12, 'quote').text, '> # 見出し\n> | a | b |');
});
