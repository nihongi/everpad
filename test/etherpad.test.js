'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyChangeset, emptyDoc, render, convertPad, parseDump } = require('../tools/import-etherpad');

const pool = { numToAttrib: { 0: ['author', 'a.x'], 1: ['bold', 'true'], 2: ['list', 'bullet1'], 3: ['lmkr', '1'], 4: ['heading', 'h2'] } };

test('変更の再生: 挿入・保持・削除', () => {
  let d = emptyDoc();
  d = applyChangeset(d, 'Z:1>5+5$Hello', pool.numToAttrib);   // "Hello\n"
  assert.equal(d.text, 'Hello\n');
  d = applyChangeset(d, 'Z:6>1=5+1$!', pool.numToAttrib);
  assert.equal(d.text, 'Hello!\n');
  d = applyChangeset(d, 'Z:7<3=1-3$', pool.numToAttrib);       // 末尾までの保持は省略される
  assert.equal(d.text, 'Ho!\n');   // 位置1から3文字('ell')を消す
  assert.throws(() => applyChangeset(d, 'Z:9>1+1$x', pool.numToAttrib), /長さ/);
});

test('見出し・箇条書き・太字・表', () => {
  const attrs = (t, f) => ({ text: t, attrs: [...t].map((_, i) => f(i)) });
  const A = pairs => pairs.map(([k, v]) => k + '\u0002' + v).join('\u0001');
  const t1 = '*項目\n*題\n' + '太字です\n';
  const doc = attrs(t1, i => (i === 0 ? A([['lmkr', '1'], ['list', 'bullet1']]) : i >= 4 && i < 5 ? A([['lmkr', '1'], ['heading', 'h2']]) : i >= 7 && i < 9 ? A([['bold', 'true']]) : ''));
  assert.equal(render(doc), '- 項目\n## 題\n**太字**です');
  const row = c => '{"payload":[' + JSON.stringify(c) + '],"tblId":"1","tblClass":"data-tables"}\n';
  const t2 = '前\n' + row([' A', ' B']) + row([' ', ' ']) + row([' 1', ' 2|3']) + '後\n';
  assert.equal(render({ text: t2, attrs: [...t2].map(() => '') }), '前\n\n| A | B |\n| --- | --- |\n| 1 | 2\\|3 |\n\n後');
});

test('新規パッドの見本の文章は取り込まず、変更のない版は飛ばす', () => {
  const r = convertPad({ pool }, [
    { cs: 'Z:1>k+k$Welcome to Etherpad!', ts: 1000 },
    { cs: 'Z:l<h-k+3$abc', ts: 2000 },
    { cs: 'Z:4>0*0=3$', ts: 3000 },                   // 作者の色だけ
  ]);
  assert.equal(r.skippedWelcome, true);
  assert.equal(r.text, 'abc');
  assert.equal(r.ops.length, 1);
  assert.deepEqual([r.ops[0].p, r.ops[0].d, r.ops[0].i, r.ops[0].t], [0, '', 'abc', 2000]);
});

test('パッド名を1行目に足す(本文が空の版には足さない)', () => {
  const revs = [{ cs: 'Z:1>k+k$Welcome to Etherpad!', ts: 1000 }, { cs: 'Z:l<h-k+3$abc', ts: 2000 }];
  const r = convertPad({ pool }, revs, '20171010_メモ');
  assert.equal(r.text, '20171010_メモ\nabc');
  assert.equal(convertPad({ pool }, revs, '').text, 'abc');
});

test('MySQLダンプの読み取り(エスケープ・引用符・複数行)', () => {
  const sql = "INSERT INTO `store` VALUES ('a:1','x\\ny\\'z'),('b','it''s \\\\ ok');\nINSERT INTO `store` VALUES ('c','3');";
  assert.deepEqual([...parseDump(sql)], [['a:1', "x\ny'z"], ['b', "it's \\ ok"], ['c', '3']]);
});
