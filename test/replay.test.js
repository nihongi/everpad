'use strict';
/* 履歴の当て直し: かたまりで持つ本文(ChunkText)と、まばらなチェックポイントの textAt(core.js)、保存層の wireText(store.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core.js');
const { wireText, applyWire, attachHashes, pruneOps } = require('../store.js');

// 乱数(毎回同じ並びにする)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const CHARS = 'abcあいう漢字😀\n ';
const word = (r, n) => { let s = ''; for (let i = 0; i < n; i++) s += CHARS[Math.floor(r() * CHARS.length)]; return s; };

test('ChunkText: どんな編集も applyOp と同じ本文になる(かたまりをまたぐ削除・大きな挿入・本文の外の位置も)', () => {
  for (const seed of [1, 2, 3, 4]) {
    const r = rng(seed);
    const b = new L.ChunkText('');
    let s = '';
    for (let i = 0; i < 4000; i++) {
      const x = r();
      let p = Math.floor(r() * (s.length + 1)), d = '', ins = '';
      if (x < 0.5) ins = word(r, 1 + Math.floor(r() * 4));
      else if (x < 0.75) d = s.slice(p, p + 1 + Math.floor(r() * 6));
      else if (x < 0.85) { d = s.slice(p, p + Math.floor(r() * 9000)); ins = word(r, Math.floor(r() * 3)); }   // かたまりをまたいで消す
      else if (x < 0.95) ins = word(r, 3000 + Math.floor(r() * 6000));                                         // かたまりより大きく入れる
      else { p = s.length + Math.floor(r() * 50); d = 'xyz'.slice(0, Math.floor(r() * 4)); ins = word(r, 2); } // 本文の外(壊れた履歴など)
      const op = { p, d, i: ins };
      s = L.applyOp(s, op);
      b.apply(op.p, op.d.length, op.i);
      assert.strictEqual(b.length, s.length, 'length seed ' + seed + ' op ' + i);
      if (i % 97 === 0) {
        assert.strictEqual(b.toString(), s, 'text seed ' + seed + ' op ' + i);
        const lo = Math.floor(r() * (s.length + 1)), hi = lo + Math.floor(r() * 5000);
        assert.strictEqual(b.slice(lo, hi), s.slice(lo, hi), 'slice seed ' + seed + ' op ' + i);
      }
    }
    assert.strictEqual(b.toString(), s);
    assert.strictEqual(b.slice(0), s);
    assert.strictEqual(b.slice(-5, 3), s.slice(0, 3));
    assert.strictEqual(b.slice(10, 5), '');
  }
});

test('ChunkText: 初めの本文を渡せる。snippetOf に文字列の代わりに渡せる', () => {
  const text = 'あ'.repeat(5000) + 'KEY' + 'い'.repeat(5000);
  const b = new L.ChunkText(text);
  assert.strictEqual(b.toString(), text);
  assert.strictEqual(L.snippetOf(b, 5000, 5003), L.snippetOf(text, 5000, 5003));
  assert.strictEqual(new L.ChunkText('').toString(), '');
});

// 1文字ずつ書き、ときどき消したり途中に入れたりする長い履歴
function longHistory(N) {
  const src = '振り子の周期は糸の長さの平方根に比例する。The period of a pendulum. ';
  const ops = [];
  let text = '';
  for (let i = 0; i < N; i++) {
    let op;
    if (i % 17 === 16 && text.length > 3) { const p = text.length - 2; op = { p, d: text.slice(p, p + 2), i: '', t: i }; }
    else if (i % 997 === 0 && text.length > 100) { const p = Math.floor(text.length / 3); op = { p, d: text.slice(p, p + 40), i: 'X', t: i }; }
    else { const p = text.length > 200 && i % 5 === 0 ? Math.floor(text.length / 2) : text.length; op = { p, d: '', i: src[i % src.length], t: i }; }
    text = L.applyOp(text, op);
    ops.push(op);
  }
  return { ops, text };
}

test('textAt: どの版も最初から当て直した本文と同じ。チェックポイントはまばらで、覚える本文は履歴の大きさ程度', () => {
  const { ops, text } = longHistory(30000);
  const n = { ops };
  assert.strictEqual(L.textAt(n, ops.length), text);
  // 最初から当て直した本文と比べる(いくつかの版)
  const want = new Map();
  const ks = [0, 1, 99, 100, 101, 2500, 12345, 20000, 29999, 30000];
  let s = '';
  for (let k = 0; k <= ops.length; k++) { if (ks.includes(k)) want.set(k, s); if (k < ops.length) s = L.applyOp(s, ops[k]); }
  for (const k of ks) assert.strictEqual(L.textAt(n, k), want.get(k), 'rev ' + k);
  // チェックポイント: 版の番号は小さい順、間は 100版以上、本文の合計は履歴の大きさ(編集の量)程度
  const cp = n._cp;
  for (let j = 1; j < cp.k.length; j++) assert(cp.k[j] - cp.k[j - 1] >= 100, 'gap ' + j);
  const histSize = ops.reduce((a, o) => a + 32 + o.d.length + o.i.length, 0);
  const cpSize = cp.t.reduce((a, t) => a + t.length, 0);
  assert(cpSize <= histSize * 1.2, 'checkpoints ' + cpSize + ' > history ' + histSize);
  assert(cp.k.length < ops.length / 100, 'checkpoints ' + cp.k.length);
  // 編集を後ろに足しても、覚えたチェックポイントのまま正しい
  const extra = { p: 0, d: '', i: '先頭', t: 1 };
  ops.push(extra);
  assert.strictEqual(L.textAt(n, ops.length), L.applyOp(text, extra));
  assert.strictEqual(L.textAt(n, 12345), want.get(12345));
});

test('textAt: 10万版の長い履歴でも、最新の本文をすぐ作れる', () => {
  const { ops, text } = longHistory(100000);
  const t0 = Date.now();
  const got = L.textAt({ ops }, ops.length);
  const ms = Date.now() - t0;
  assert.strictEqual(got, text);
  assert(ms < 1500, '時間: ' + ms + 'ms');
});

test('wireText(保存層): 最初から当て直した本文と同じ。古い履歴の削除と添付の参照も同じ結果', () => {
  const { ops } = longHistory(5000);
  const wire = ops.map(o => [o.p, o.d, o.i, o.t]);
  wire.splice(2000, 0, [10, '', ' attach:0123456789abcdef ', 1], [500, '', 'attach:fedcba9876543210', 2]);
  let s = '';
  const at = new Map();
  for (let i = 0; i < wire.length; i++) { s = applyWire(s, wire[i]); at.set(i + 1, s); }
  assert.strictEqual(wireText(wire), s);
  assert.strictEqual(wireText(wire, 1234), at.get(1234));
  assert.strictEqual(wireText([]), '');
  assert.deepStrictEqual(pruneOps(wire, 1234)[0], [0, '', at.get(1234), wire[1233][3]]);
  assert.deepStrictEqual([...attachHashes(wire)].sort(), ['0123456789abcdef', 'fedcba9876543210']);
});

test('検索(履歴すべて)と色の帯: 長い本文でも、文字列で当て直したときと同じ結果', () => {
  const { ops } = longHistory(20000);
  const tail = ops.length;
  // 検索語を書いて、あとで消す
  let text = ops.reduce((t, o) => L.applyOp(t, o), '');
  for (const [p, d, i] of [[100, '', 'KEYWORD'], [5000, '', 'KEYWORD'], [100, 'KEYWORD', '']]) {
    const op = { p, d, i, t: ops.length };
    text = L.applyOp(text, op);
    ops.push(op);
  }
  const n = { id: 'x', ops, text };
  const r = L.searchHistory([n], 'keyword', 10);
  assert.strictEqual(r.total, 2);
  const byA = r.res.map(x => [x.a, x.b]).sort((a, b) => a[0] - b[0]);
  assert.deepStrictEqual(byA, [[tail + 1, tail + 2], [tail + 2, tail + 3]]);
  const live = r.res.find(x => x.b === ops.length);
  assert.strictEqual(live.snippet, L.snippetOf(text, live.s, live.e));
  const c = L.historyCounter(ops, L.buildRe('keyword', {}), 7);
  while (!c.step(5000)) { /* 進める */ }
  assert.deepStrictEqual([c.counts[tail], c.counts[tail + 1], c.counts[tail + 2], c.counts[tail + 3]], [0, 1, 2, 1]);
});
