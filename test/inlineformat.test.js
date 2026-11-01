'use strict';
/* 選んだ文字の装飾(太字・斜体・取り消し線・コード)。« » が選択の範囲(何も無いところに « » ならカーソル) */
const test = require('node:test');
const assert = require('node:assert');
const { inlineFormat } = require('../renderer/core');

function run(src, kind) {
  const s = src.indexOf('«'), e = src.indexOf('»') - 1;
  const text = src.replace('«', '').replace('»', '');
  const r = inlineFormat(text, s, e, kind);
  if (!r) return null;
  const out = text.slice(0, r.from) + r.insert + text.slice(r.to);
  return out.slice(0, r.selStart) + '«' + out.slice(r.selStart, r.selEnd) + '»' + out.slice(r.selEnd);
}

test('1行: 選んだ部分を囲み、中身を選んだままにする。前後の空白は外に残す', () => {
  assert.strictEqual(run('今日は«晴れ»です', 'bold'), '今日は**«晴れ»**です');
  assert.strictEqual(run('今日は« 晴れ »です', 'bold'), '今日は **«晴れ»** です');
  assert.strictEqual(run('a «b» c', 'italic'), 'a *«b»* c');
  assert.strictEqual(run('a «b» c', 'strike'), 'a ~~«b»~~ c');
  assert.strictEqual(run('a «b» c', 'icode'), 'a `«b»` c');
});

test('切り替え: 内側だけを選んでも、記号まで選んでも外す', () => {
  assert.strictEqual(run('a **«b»** c', 'bold'), 'a «b» c');
  assert.strictEqual(run('a «**b**» c', 'bold'), 'a «b» c');
  assert.strictEqual(run('a *«b»* c', 'italic'), 'a «b» c');
  assert.strictEqual(run('a «~~b~~» c', 'strike'), 'a «b» c');
  assert.strictEqual(run('a `«b»` c', 'icode'), 'a «b» c');
  assert.strictEqual(run('a «`` x`y ``» c', 'icode'), 'a «x`y» c');
});

test('太字と斜体は重ねられ、片方だけを外せる', () => {
  assert.strictEqual(run('a **«b»** c', 'italic'), 'a ***«b»*** c');
  assert.strictEqual(run('a ***«b»*** c', 'bold'), 'a *«b»* c');
  assert.strictEqual(run('a ***«b»*** c', 'italic'), 'a **«b»** c');
  assert.strictEqual(run('a «***b***» c', 'bold'), 'a «*b*» c');
  // 太字の中の文字に斜体を付けるだけなら、太字は外さない
  assert.strictEqual(run('a *«b»* c', 'bold'), 'a ***«b»*** c');
});

test('一部だけ装飾されているときは、中の同じ装飾を外してから全体を囲む', () => {
  assert.strictEqual(run('«a **b** c»', 'bold'), '**«a b c»**');
  // 両端が ** でも、全体が1つの太字ではない
  assert.strictEqual(run('«**a** と **b**»', 'bold'), '**«a と b»**');
  assert.strictEqual(run('«*a* と *b*»', 'italic'), '*«a と b»*');
  assert.strictEqual(run('«a ~~b~~ c»', 'strike'), '~~«a b c»~~');
  // 斜体を付けても、中の太字は残る
  assert.strictEqual(run('«a **b** c»', 'italic'), '*«a **b** c»*');
  // 掛け算の * のように、装飾として表示されない記号は消さない
  assert.strictEqual(run('«2 * 3 = 6»', 'italic'), '*«2 * 3 = 6»*');
});

test('コード: 中にバッククォートがあれば、長い囲みにする', () => {
  assert.strictEqual(run('«a`b»', 'icode'), '``«a`b»``');
  assert.strictEqual(run('«`a»', 'icode'), '`` «`a» ``');
});

test('複数行: 行ごとに、その行の選んだ部分だけを装飾する。空の行は飛ばす', () => {
  assert.strictEqual(run('今日は«晴れ\n\n明日は»雨', 'bold'), '今日は«**晴れ**\n\n**明日は**»雨');
  assert.strictEqual(run('«一\n二\n三\n»四', 'bold'), '«**一**\n**二**\n**三**»\n四');
  // もう一度かけると外れる
  assert.strictEqual(run('«**一**\n**二**\n**三**»\n四', 'bold'), '«一\n二\n三»\n四');
});

test('複数行: 行頭の記号(箇条書き・チェックボックス・番号・引用・見出し・字下げ)は外に残す', () => {
  const src = '«# 見出し\n- りんご\n  - [ ] みかん\n3. ぶどう\n> 引用\n> - 引用の中の項目»';
  assert.strictEqual(run(src, 'bold'), '# «**見出し**\n- **りんご**\n  - [ ] **みかん**\n3. **ぶどう**\n> **引用**\n> - **引用の中の項目**»');
  // 行の途中から選んだときは、選んだところから
  assert.strictEqual(run('- りん«ご\n- みか»ん', 'strike'), '- りん«~~ご~~\n- ~~みか~~»ん');
  // 箇条書きの記号ではない * や数字は残さない
  assert.strictEqual(run('«*強調*\n1.5 kg»', 'bold'), '«***強調***\n**1.5 kg**»');
});

test('複数行: コードブロック・区切り線・表の区切りの行は飛ばし、表の行はセルごとに装飾する', () => {
  const src = '«前\n```\nコード\n```\n---\n| 品名 | 値段 |\n|---|---|\n| りんご | 100 |\n後»';
  assert.strictEqual(run(src, 'bold'), '«**前**\n```\nコード\n```\n---\n| **品名** | **値段** |\n|---|---|\n| **りんご** | **100** |\n**後**»');
  // 「|」があっても、表でなければ普通の行
  assert.strictEqual(run('«a | b\nc»', 'bold'), '«**a | b**\n**c**»');
  // コードブロックの途中から選んでも、中の行は装飾しない
  assert.strictEqual(run('```\nx«\n```\ny»', 'bold'), '```\nx\n```\n**«y»**');
});

test('選択の終わりが行の先頭ちょうどなら、その行は含めない。装飾できる部分が無ければ何もしない', () => {
  assert.strictEqual(run('«a\n»b', 'bold'), '**«a»**\nb');
  assert.strictEqual(run('«- »a', 'bold'), null);
  assert.strictEqual(run('«\n\n»', 'bold'), null);
  assert.strictEqual(run('```\n«x»\n```', 'bold'), null);
});

test('何も選んでいないとき: 記号の組を入れてカーソルを真ん中に。空の組の真ん中なら消す', () => {
  assert.strictEqual(run('a«»b', 'bold'), 'a**«»**b');
  assert.strictEqual(run('a**«»**b', 'bold'), 'a«»b');
  assert.strictEqual(run('a«»b', 'icode'), 'a`«»`b');
  assert.strictEqual(run('a*«»*b', 'italic'), 'a«»b');
  assert.strictEqual(run('a«»b', 'unknown'), null);
});

test('題名: 装飾の記号は外す(太字にした見出しが「買い物**」にならない)', () => {
  const { titleOf } = require('../renderer/core');
  assert.strictEqual(titleOf('# **買い物**\n本文'), '買い物');
  assert.strictEqual(titleOf('# ***買い物***'), '買い物');
  assert.strictEqual(titleOf('- 今日は*晴れ*です'), '今日は晴れです');
  assert.strictEqual(titleOf('~~古い~~ `新しい` 予定'), '古い 新しい 予定');
  // 閉じていない記号は、これまでどおり先頭のものだけ外す
  assert.strictEqual(titleOf('**メモ'), 'メモ');
  assert.strictEqual(titleOf('2 * 3 = 6'), '2 * 3 = 6');
});
