'use strict';
/* 古い履歴の削除(0.21.0)と、添付をごみ箱に入れるときに本文のリンクを消す処理 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, parseLog, applyWire, pruneOps, attachHashes } = require('../store');
const { buildArchive, readArchive } = require('../archive');
const { buildAttachTemplate } = require('../contextmenu');
const core = require('../renderer/core');

const fresh = () => { const s = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-prune-')), 'notes')); s.init(); return s; };
const ID = '20261027-100000-prun';
const textOf = (ops, k) => ops.slice(0, k).reduce(applyWire, '');
// 1文字ずつ打った10版のメモ
const typed = () => { const ops = []; let t = 0; for (const ch of 'abcdefghij') ops.push([t, '', ch, 1000 + t++]); return ops; };
const make = (s, ops) => { s.create(ID, 999); s.append(ID, ops); };
const PNG_A = Buffer.from([0x89, 0x50, 0x4E, 0x47, 1]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4E, 0x47, 2]);

test('pruneOps: 最初の k 個を「版 k の本文を入れる」1つにまとめ、後ろの版は同じ本文になる', () => {
  const ops = typed();
  const out = pruneOps(ops, 4);
  assert.deepStrictEqual(out[0], [0, '', 'abcd', ops[3][3]]);
  assert.strictEqual(out.length, ops.length - 3);
  // 削除後の j 番目 = 削除前の (k-1)+j 番目
  for (let j = 1; j <= out.length; j++) assert.strictEqual(textOf(out, j), textOf(ops, 3 + j));
});

test('prune: 版数は変わらず、ヘッダーに base と pruned を書き、もう一度削除すると base が増える', () => {
  const s = fresh();
  const ops = typed();
  make(s, ops);
  assert.strictEqual(s.listMeta()[0].n, 10);
  const r = s.prune(ID, 4, 10, 5000);
  assert.strictEqual(r.base, 3);
  assert.strictEqual(r.removed, 3);
  const n = s.loadOne(ID);
  assert.strictEqual(n.base, 3);
  assert.strictEqual(n.pruned, 5000);
  assert.strictEqual(n.c, 999);
  assert.strictEqual(n.ops.length, 7);
  assert.strictEqual(n.base + n.ops.length, 10);
  assert.strictEqual(textOf(n.ops, n.ops.length), 'abcdefghij');
  // 一覧の版数も変わらない(索引を使っても、読み直しても)
  assert.strictEqual(s.listMeta()[0].n, 10);
  assert.strictEqual(s.listMeta()[0].base, 3);
  s.writeIndex(); fs.unlinkSync(s.indexPath()); s._idx = null;
  assert.strictEqual(s.listMeta()[0].n, 10);
  // 追記した後も、版の番号は続く
  s.append(ID, [[10, '', 'k', 2000]]);
  assert.strictEqual(s.listMeta()[0].n, 11);
  // 2回目: 残っている8個のうち、最初の5個を削る → base は 3 + 4 = 7
  const r2 = s.prune(ID, 5, 8, 6000);
  assert.strictEqual(r2.base, 7);
  const n2 = s.loadOne(ID);
  assert.strictEqual(n2.base + n2.ops.length, 11);
  assert.strictEqual(n2.ops[0][2], 'abcdefgh');
  assert.strictEqual(textOf(n2.ops, n2.ops.length), 'abcdefghijk');
});

test('prune: 画面と履歴の長さが違う・版の指定がおかしいときは、何も書き換えない', () => {
  const s = fresh();
  make(s, typed());
  const before = fs.readFileSync(s.file(ID, '.jsonl'), 'utf8');
  assert.throws(() => s.prune(ID, 4, 9, 1), e => e.code === 'changed');
  for (const k of [0, 1, 11, 2.5, '3']) assert.throws(() => s.prune(ID, k, 10, 1), e => e.code === 'badRev');
  assert.throws(() => s.prunePlan('20261027-100000-none', 2, 1), e => e.code === 'noFile');
  assert.strictEqual(fs.readFileSync(s.file(ID, '.jsonl'), 'utf8'), before);
  assert.ok(!fs.existsSync(s.file(ID, '.jsonl') + '.tmp'));
});

test('古い EverPad との互換: 削除後のファイルも今までの読み方で読め、削除していないファイルは base 0 として読む', () => {
  const s = fresh();
  make(s, typed());
  s.prune(ID, 4, 10, 5000);
  const raw = fs.readFileSync(s.file(ID, '.jsonl'), 'utf8');
  // 古い版の読み方: 見出し行は id と c があればよく、ほかの項目は読み飛ばす。各行は今までと同じ4つ組
  const r = parseLog(raw);
  assert.ok(r.head && !r.bad);
  assert.strictEqual(r.head.id, ID);
  assert.strictEqual(r.ops.reduce(applyWire, ''), 'abcdefghij');
  // 古い版で書いた(base の無い)ファイル
  const s2 = fresh();
  make(s2, typed());
  const n = s2.loadOne(ID);
  assert.strictEqual(n.base, 0);
  assert.strictEqual(n.pruned, 0);
  // 見出し行の base がおかしければ 0 として扱う
  const f = s2.file(ID, '.jsonl');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines[0] = JSON.stringify({ v: 1, id: ID, c: 999, base: -3 });
  fs.writeFileSync(f, lines.join('\n'));
  assert.strictEqual(s2.loadOne(ID).base, 0);
});

test('アーカイブ: 削除後の履歴を書き出して取り込んでも、base が残る(アーカイブの形式の版は 1 のまま)', () => {
  const s = fresh();
  make(s, typed());
  s.prune(ID, 4, 10, 5000);
  const jsonl = fs.readFileSync(s.file(ID, '.jsonl'), 'utf8');
  const arc = readArchive(buildArchive({ id: ID, title: 'a', created: 999, jsonl: jsonl, md: 'abcdefghij', files: [] }, '0.21.0'));
  assert.strictEqual(arc.manifest.version, 1);
  assert.strictEqual(arc.head.base, 3);
  const s2 = fresh();
  const NEW = '20261027-100000-copy';
  s2.importNote(NEW, arc, 7000);
  const n = s2.loadOne(NEW);
  assert.strictEqual(n.base, 3);
  assert.strictEqual(n.base + n.ops.length, 10);
  assert.strictEqual(s2.readLatest(NEW), 'abcdefghij');
});

test('attachHashes: どれかの版に出てくる添付を見つける(1文字ずつ打った参照や、後で消した参照も)', () => {
  const A = '0123456789abcdef', B = 'fedcba9876543210';
  const ops = [[0, '', 'x ![a](attach:' + A + '.png) y', 1]];
  // B への参照を1文字ずつ打って、その後で消す
  let t = 'x ![a](attach:' + A + '.png) y';
  const ref = '[b](attach:' + B + ')';
  for (const ch of ref) { ops.push([t.length, '', ch, 2]); t += ch; }
  ops.push([t.length - ref.length, ref, '', 3]);
  const set = attachHashes(ops);
  assert.ok(set.has(A));
  assert.ok(set.has(B));
  // 削除で離れた文字がつながってできた参照
  const joined = [[0, '', 'attach:0123456XXX789abcdef', 1], [14, 'XXX', '', 2]];
  assert.ok(attachHashes(joined).has(A));
  assert.strictEqual(attachHashes([[0, '', 'attach:0123', 1]]).size, 0);
});

test('prunePlan / prune: 残る版のどこにも出てこない添付だけを返す(書き換え前に数と大きさがわかる)', () => {
  const s = fresh();
  s.create(ID, 999);
  const a = s.saveAttachment(ID, 'a.png', PNG_A).fileId;
  const b = s.saveAttachment(ID, 'b.png', PNG_B).fileId;
  // 版1: a を貼る 版2: a を消す 版3: b を貼る 版4: 文字を足す
  const ra = '![a](attach:' + a + ')', rb = '![b](attach:' + b + ')';
  s.append(ID, [[0, '', ra, 1], [0, ra, '', 2], [0, '', rb, 3], [rb.length, '', '!', 4]]);
  // 版3から残す → a は残る版に出てこない、b は出てくる
  const plan = s.prunePlan(ID, 3, 4);
  assert.strictEqual(plan.removed, 2);
  assert.deepStrictEqual(plan.orphans.map(o => o.fileId), [a]);
  assert.strictEqual(plan.bytes, PNG_A.length);
  assert.ok(fs.existsSync(s.attachmentPath(ID, a)), 'prunePlan はファイルに触らない');
  const r = s.prune(ID, 3, 4, 10);
  assert.deepStrictEqual(r.orphans.map(o => o.fileId), [a]);
  assert.ok(fs.existsSync(r.orphans[0].path), 'ごみ箱に入れるのは呼ぶ側');
  // 版2(a を消した版)から残す場合も、a は残る版に出てこない
  const s2 = fresh();
  s2.create(ID, 999);
  const a2 = s2.saveAttachment(ID, 'a.png', PNG_A).fileId;
  s2.append(ID, [[0, '', '![a](attach:' + a2 + ')', 1], [0, '![a](attach:' + a2 + ')', 'x', 2], [1, '', 'y', 3]]);
  assert.deepStrictEqual(s2.prunePlan(ID, 2, 3).orphans.map(o => o.fileId), [a2]);
  // 最新の本文で使っている添付は消さない
  const s3 = fresh();
  s3.create(ID, 999);
  const a3 = s3.saveAttachment(ID, 'a.png', PNG_A).fileId;
  s3.append(ID, [[0, '', 'x', 1], [1, '', '![a](attach:' + a3 + ')', 2], [0, '', 'y', 3]]);
  assert.deepStrictEqual(s3.prunePlan(ID, 3, 3).orphans, []);
});

test('removeAttachRefs: その添付へのリンクだけを消し、リンクだけの行は行ごと消す', () => {
  const A = '0123456789abcdef.png', B = 'fedcba9876543210.txt';
  const text = [
    '# 題名',
    '![写真](attach:' + A + ')',
    '前 ![写真](attach:' + A + ') 後',
    '- ![写真](attach:' + A + ')',
    '- [ ] [写真](attach:' + A + ')',
    '> ![写真](attach:' + A + ')',
    '[資料](attach:' + B + ')',
    '最後'
  ].join('\n');
  const r = core.removeAttachRefs(text, A);
  assert.strictEqual(r.count, 5);
  assert.strictEqual(r.text, ['# 題名', '前  後', '[資料](attach:' + B + ')', '最後'].join('\n'));
  // 無いときは何も変えない
  assert.deepStrictEqual(core.removeAttachRefs('abc\n', A), { text: 'abc\n', count: 0 });
  // 末尾の改行は残す
  assert.strictEqual(core.removeAttachRefs('a\n![x](attach:' + A + ')\n', A).text, 'a\n');
  // 拡張子まで同じものだけ(別の拡張子や、ID の一部が同じものは消さない)
  assert.strictEqual(core.removeAttachRefs('![x](attach:0123456789abcdef.jpg)', A).count, 0);
});

test('添付の右クリックメニュー: trash を渡したときだけ「ごみ箱に入れる…」が最後に出る', () => {
  const act = { copy() {}, open() {}, show() {}, save() {}, trash() {} };
  const labels = t => t.filter(x => x.label).map(x => x.label);
  assert.deepStrictEqual(labels(buildAttachTemplate(true, act)).slice(-1), ['ごみ箱に入れる…']);
  assert.strictEqual(labels(buildAttachTemplate(false, act, 'en')).slice(-1)[0], 'Move to Recycle Bin…');
  const noTrash = Object.assign({}, act, { trash: null });
  assert.ok(!labels(buildAttachTemplate(true, noTrash)).includes('ごみ箱に入れる…'));
  assert.ok(!labels(buildAttachTemplate(false, noTrash)).includes('ごみ箱に入れる…'));
});
