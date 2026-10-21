'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

test('メモへのリンク: [表示名](note:メモID) はリンクになり、箇条書きや表の中でも使える', () => {
  assert.strictEqual(L.md('[会議メモ](note:20261021-120000-math) を参照'), '<p><a class="note-link" href="#" data-note="20261021-120000-math">会議メモ</a> を参照</p>');
  assert.match(L.md('- [a](note:abcdef1) と [b](note:abcdef2)'), /data-note="abcdef1".*data-note="abcdef2"/);
  assert.match(L.md('| [表](note:abcdef1) |\n|---|'), /<th class="al-l"><a class="note-link" href="#" data-note="abcdef1">表<\/a><\/th>/);
  // 表示名の HTML は文字として扱う
  assert.strictEqual(L.md('[<b>x</b>](note:abcdef1)'), '<p><a class="note-link" href="#" data-note="abcdef1">&lt;b&gt;x&lt;/b&gt;</a></p>');
});

test('メモへのリンク: ID として正しくないもの・コード表記の中はリンクにしない', () => {
  assert.doesNotMatch(L.md('[x](note:ab)'), /note-link/);                  // 短すぎる
  assert.doesNotMatch(L.md('[x](note:../../etc)'), /note-link/);           // 使えない文字
  assert.doesNotMatch(L.md('`[x](note:abcdef1)`'), /note-link/);
});

test('メモへのリンク: カーソルの位置にあるリンク(編集画面の Ctrl+クリック)', () => {
  const t = '前の行\n見て → [会議](note:abcdef1) と [予定](note:abcdef2)\n次の行';
  const at = s => L.noteLinkAt(t, t.indexOf(s));
  assert.strictEqual(at('[会議'), 'abcdef1');                              // リンクの先頭
  assert.strictEqual(at('note:abcdef1') , 'abcdef1');                       // ID の上
  assert.strictEqual(at('予定'), 'abcdef2');
  assert.strictEqual(at('見て'), null);
  assert.strictEqual(at('次の行'), null);
  assert.strictEqual(L.noteLinkAt(t, t.indexOf(') と') + 1), 'abcdef1');   // リンクの直後(閉じかっこの後ろ)
});

test('メモへのリンク: 表示名から [ ] と改行を取り除く', () => {
  assert.strictEqual(L.linkText('[重要] 会議\nメモ'), '重要 会議 メモ');
  assert.strictEqual(L.linkText('メモ(1)'), 'メモ(1)');
  assert.strictEqual(L.linkText(''), '');
});

test('最近見たメモ: 開いたメモをいちばん上に移し、件数を超えたら古いものから落とす', () => {
  let r = [];
  for (const id of ['a1', 'b2', 'c3']) r = L.pushRecent(r, id, 'T' + id, 3);
  assert.deepStrictEqual(r.map(x => x.id), ['c3', 'b2', 'a1']);
  r = L.pushRecent(r, 'a1', '新しい題名', 3);
  assert.deepStrictEqual(r.map(x => x.id), ['a1', 'c3', 'b2']);             // 同じメモは重ねない
  assert.strictEqual(r[0].title, '新しい題名');
  r = L.pushRecent(r, 'd4', 'Td4', 3);
  assert.deepStrictEqual(r.map(x => x.id), ['d4', 'a1', 'c3']);
  assert.deepStrictEqual(L.pushRecent(null, 'x1', 'X', 3).map(x => x.id), ['x1']);
});
