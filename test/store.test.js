'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, validId, validFileId, MAX_ATTACH, parseLog, applyWire } = require('../store');
const core = require('../renderer/core');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-'));
const fresh = () => { const s = new Store(path.join(tmp(), 'sub', 'notes')); s.init(); return s; };

test('保存先フォルダを作る(深い階層でも)', () => {
  const s = fresh();
  assert(fs.statSync(s.dir).isDirectory());
});

test('メモを作って追記し、読み込むと同じ履歴が戻る', () => {
  const s = fresh();
  assert.strictEqual(s.create('20261006-175012-ab12', 1000), true);
  assert.strictEqual(s.create('20261006-175012-ab12', 2000), false); // 同じIDは作り直さない
  s.append('20261006-175012-ab12', [[0, '', 'こんにちは', 1001], [5, '', '\n世界', 1002]]);
  s.append('20261006-175012-ab12', [[0, 'こんにちは', 'Hello', 1003]]);
  const notes = s.loadAll();
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].c, 1000);
  assert.strictEqual(notes[0].ops.length, 3);
  assert.strictEqual(notes[0].ops.reduce(applyWire, ''), 'Hello\n世界');
});

test('ファイルの中身は1行ごとのJSON(追記だけで増える)', () => {
  const s = fresh();
  s.create('note-aaaa', 1);
  const f = path.join(s.dir, 'note-aaaa.jsonl');
  const before = fs.readFileSync(f, 'utf8');
  s.append('note-aaaa', [[0, '', 'a', 2]]);
  const after = fs.readFileSync(f, 'utf8');
  assert(after.startsWith(before), '既存の部分は書き換えない');
  assert.deepStrictEqual(after.slice(before.length), '[0,"","a",2]\n');
});

test('最後の行が途中で切れていても、そこまでの履歴を読み込んで直す', () => {
  const s = fresh();
  s.create('note-bbbb', 1);
  s.append('note-bbbb', [[0, '', 'abc', 2], [3, '', 'def', 3]]);
  const f = path.join(s.dir, 'note-bbbb.jsonl');
  fs.appendFileSync(f, '[6,"","gh'); // 書き込み中に落ちた状態
  const notes = s.loadAll();
  assert.strictEqual(notes[0].ops.length, 2);
  assert.strictEqual(notes[0].ops.reduce(applyWire, ''), 'abcdef');
  assert(fs.readFileSync(f, 'utf8').endsWith('\n'), '直したあとは行末が揃う');
  assert(fs.readdirSync(s.dir).some(n => n.includes('.corrupt-')), '元のファイルは残す');
  // 直したあとに追記しても壊れない
  s.append('note-bbbb', [[6, '', 'ghi', 4]]);
  assert.strictEqual(s.loadAll()[0].ops.reduce(applyWire, ''), 'abcdefghi');
});

test('末尾の改行だけ欠けている場合は、履歴を失わずに直す', () => {
  const s = fresh();
  s.create('note-cccc', 1);
  const f = path.join(s.dir, 'note-cccc.jsonl');
  fs.appendFileSync(f, '[0,"","x",2]'); // 改行なし
  const notes = s.loadAll();
  assert.strictEqual(notes[0].ops.length, 1);
  assert(fs.readFileSync(f, 'utf8').endsWith('\n'));
  assert(!fs.readdirSync(s.dir).some(n => n.includes('.corrupt-')), '壊れてはいないので控えは作らない');
});

test('途中に壊れた行があれば、その手前までを使い、元のファイルは残す', () => {
  const s = fresh();
  s.create('note-dddd', 1);
  const f = path.join(s.dir, 'note-dddd.jsonl');
  fs.appendFileSync(f, '[0,"","ab",2]\nこれはJSONではない\n[2,"","cd",3]\n');
  const notes = s.loadAll();
  assert.strictEqual(notes[0].ops.length, 1);
  assert.strictEqual(notes[0].ops.reduce(applyWire, ''), 'ab');
  assert(fs.readdirSync(s.dir).some(n => n.startsWith('note-dddd.jsonl.corrupt-')));
});

test('ヘッダーが壊れたファイルや関係ないファイルは無視する', () => {
  const s = fresh();
  fs.writeFileSync(path.join(s.dir, 'note-eeee.jsonl'), 'ヘッダーなし\n');
  fs.writeFileSync(path.join(s.dir, 'memo.txt'), 'x');
  fs.writeFileSync(path.join(s.dir, 'bad id.jsonl'), '{"v":1,"id":"x","c":1}\n');
  s.create('note-ffff', 5);
  assert.deepStrictEqual(s.loadAll().map(n => n.id), ['note-ffff']);
});

test('IDに ../ などを入れても保存先の外には書けない', () => {
  const s = fresh();
  for (const bad of ['../evil', '..\\evil', 'a/b', 'abc', '', null, 'x'.repeat(65), 'あいうえおか']) {
    assert.strictEqual(validId(bad), false, String(bad));
    assert.throws(() => s.create(bad, 1));
  }
  assert.throws(() => s.append('note-gggg', [[0, '', 'a', 1]]), /見つかりません/); // 作っていないメモ
});

test('正しくない編集データは書き込まない', () => {
  const s = fresh();
  s.create('note-hhhh', 1);
  for (const bad of [[[-1, '', 'a', 1]], [[0.5, '', 'a', 1]], [[0, 1, 'a', 1]], [[0, '', 'a']], [[0, '', 'a', NaN]], 'x', [null]]) {
    assert.throws(() => s.append('note-hhhh', bad), /正しくありません/);
  }
  assert.strictEqual(s.loadAll()[0].ops.length, 0);
});

test('最新の本文(.md)を書き出し、上書きできる', () => {
  const s = fresh();
  s.create('note-iiii', 1);
  s.saveText('note-iiii', '# 見出し\n本文');
  s.saveText('note-iiii', '# 見出し\n本文を直した');
  assert.strictEqual(fs.readFileSync(path.join(s.dir, 'note-iiii.md'), 'utf8'), '# 見出し\n本文を直した');
  assert(!fs.existsSync(path.join(s.dir, 'note-iiii.md.tmp')));
});

test('削除の対象はそのメモの2ファイルだけ', () => {
  const s = fresh();
  s.create('note-jjjj', 1); s.create('note-kkkk', 2);
  s.saveText('note-jjjj', 'x');
  assert.deepStrictEqual(s.paths('note-jjjj').map(p => path.basename(p)).sort(), ['note-jjjj.jsonl', 'note-jjjj.md']);
  assert.deepStrictEqual(s.paths('note-kkkk').map(p => path.basename(p)), ['note-kkkk.jsonl']);
});

test('画面のコードと同じ流れ: 編集→追記→再読み込みで、全版を再現できる', () => {
  const s = fresh();
  s.create('note-llll', 1);
  const steps = ['あ', 'あい', 'あいう', 'あいう\n', 'あいう\n# 見出し', 'あう\n# 見出し', 'あう\n# 見出し\n| a | b |\n|---|---|\n| 1 | 2 |'];
  let cur = '', t = 100;
  const sent = [];
  for (const nx of steps) { const o = core.makeOp(cur, nx, t++); sent.push([o.p, o.d, o.i, o.t]); cur = nx; }
  // まとめて送る・1件ずつ送る、どちらでも同じ
  s.append('note-llll', sent.slice(0, 3));
  for (const w of sent.slice(3)) s.append('note-llll', [w]);
  const n = s.loadAll()[0];
  n.ops = n.ops.map(o => ({ p: o[0], d: o[1], i: o[2], t: o[3] }));
  for (let k = 0; k <= steps.length; k++) assert.strictEqual(core.textAt(n, k), k ? steps[k - 1] : '', 'rev ' + k);
});

test('parseLog: 空ファイルや空行だけでも落ちない', () => {
  assert.strictEqual(parseLog('').head, null);
  assert.strictEqual(parseLog('\n\n').head, null);
});

test('日本語・絵文字・改行を含む編集も、そのまま保存して読み戻せる', () => {
  const s = fresh();
  s.create('note-mmmm', 1);
  const text = '🙂日本語\r\nと"引用符"と\\バックスラッシュと 行区切り';
  s.append('note-mmmm', [[0, '', text, 2]]);
  assert.strictEqual(s.loadAll()[0].ops[0][2], text);
});

test('添付: 保存・同じ内容は1つだけ・拡張子は小文字・本文から消えても残る', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  s.create('note-aaa111', 1);
  const a = s.saveAttachment('note-aaa111', 'Photo.PNG', Buffer.from([1, 2, 3, 4]));
  assert(/^[0-9a-f]{16}\.png$/.test(a.fileId), a.fileId);
  const b = s.saveAttachment('note-aaa111', '別名.png', new Uint8Array([1, 2, 3, 4]));
  assert.strictEqual(a.fileId, b.fileId);
  const c = s.saveAttachment('note-aaa111', 'readme', Buffer.from('xyz'));
  assert(/^[0-9a-f]{16}$/.test(c.fileId));
  assert.strictEqual(fs.readdirSync(path.join(dir, 'note-aaa111.files')).length, 2);
  assert.deepStrictEqual([...fs.readFileSync(s.attachmentPath('note-aaa111', a.fileId))], [1, 2, 3, 4]);
  // 本文の編集では添付に触れない(削除する処理が無い)
  s.append('note-aaa111', [[0, '', '![x](attach:' + a.fileId + ')', 5]]);
  s.append('note-aaa111', [[0, '![x](attach:' + a.fileId + ')', '', 6]]);
  assert(s.attachmentPath('note-aaa111', a.fileId));
  assert.strictEqual(s.loadAll().length, 1, '添付フォルダはメモとして数えない');
});
test('添付: 不正なID・存在しないメモ・大きすぎるファイル・フォルダ外への参照を拒否する', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  s.create('note-bbb222', 1);
  assert.throws(() => s.saveAttachment('note-zzz999', 'a.png', Buffer.from('x')), /見つかりません/);
  assert.throws(() => s.saveAttachment('../x', 'a.png', Buffer.from('x')));
  assert.throws(() => s.saveAttachment('note-bbb222', 'a.bin', Buffer.alloc(MAX_ATTACH + 1)), /大きすぎ/);
  const ok = s.saveAttachment('note-bbb222', 'a.txt', Buffer.from('hello'));
  for (const bad of ['../note-bbb222.jsonl', '..\\x', ok.fileId + '/..', '', null, 'ABCDEF0123456789.png', ok.fileId.replace('.txt', '.t/x')]) assert.strictEqual(s.attachmentPath('note-bbb222', bad), null, String(bad));
  assert.strictEqual(s.attachmentPath('../x', ok.fileId), null);
  assert.strictEqual(s.attachmentPath('note-ccc333', ok.fileId), null);
  assert(validFileId(ok.fileId) && !validFileId('x.png'));
});
test('添付: メモを消すときのごみ箱の対象に、添付フォルダも入る', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  s.create('note-ddd444', 1); s.saveText('note-ddd444', 'x'); s.saveAttachment('note-ddd444', 'a.png', Buffer.from('1'));
  const p = s.paths('note-ddd444').map(x => path.basename(x)).sort();
  assert.deepStrictEqual(p, ['note-ddd444.files', 'note-ddd444.jsonl', 'note-ddd444.md']);
});

/* ---- 一覧用の索引(開かないメモの履歴は読まない) ---- */
test('listMeta: 題名・版数・更新時刻を返し、2回目は索引を使って読み直さない', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  for (const id of ['20260101-000001-aaaa', '20260101-000002-bbbb']) {
    s.create(id, Date.now());
    s.append(id, [[0, '', '# 題名' + id.slice(-4), 1000], [0, '', 'x', 2000]]);
  }
  let m = s.listMeta();
  assert.equal(m.length, 2);
  assert.equal(m[0].n, 2);
  assert.equal(m[0].t, 2000);
  assert.ok(m[0].title.length > 0);
  s.writeIndex();
  assert.ok(fs.existsSync(path.join(dir, '.everpad-index.json')));
  const s2 = new Store(dir); s2.init();
  m = s2.listMeta();
  assert.equal(s2.scans, 0, '索引が合っていれば履歴を読まない');
  assert.equal(m.length, 2);
});

test('listMeta: 大きさが変わったメモだけ読み直す', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  s.create('20260101-000001-aaaa', 1); s.create('20260101-000002-bbbb', 2);
  s.listMeta(); s.writeIndex();
  fs.appendFileSync(path.join(dir, '20260101-000002-bbbb.jsonl'), JSON.stringify([0, '', 'hello', 5000]) + '\n'); // 外から追記
  const s2 = new Store(dir); s2.init();
  const m = s2.listMeta();
  assert.equal(s2.scans, 1);
  assert.equal(m.find(x => x.id === '20260101-000002-bbbb').n, 1);
  assert.equal(m.find(x => x.id === '20260101-000002-bbbb').title, 'hello');
});

test('listMeta: 索引が壊れていても、消えたメモがあっても動く', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  s.create('20260101-000001-aaaa', 1); s.create('20260101-000002-bbbb', 2);
  s.listMeta(); s.writeIndex();
  fs.writeFileSync(path.join(dir, '.everpad-index.json'), '{broken');
  let s2 = new Store(dir); s2.init();
  assert.equal(s2.listMeta().length, 2);
  s2.writeIndex();
  fs.unlinkSync(path.join(dir, '20260101-000001-aaaa.jsonl'));
  s2 = new Store(dir); s2.init();
  assert.deepEqual(s2.listMeta().map(x => x.id), ['20260101-000002-bbbb']);
});

test('append/saveText/create/forget が索引を更新する', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  const id = '20260101-000001-aaaa';
  s.listMeta();   // アプリは起動時に必ず一覧を作る
  s.create(id, 10);
  s.append(id, [[0, '', 'abc', 20]]);
  s.saveText(id, 'abc');
  let m = s.listMeta();
  assert.equal(s.scans, 0, '自分で更新した分は読み直さない');
  assert.equal(m[0].n, 1); assert.equal(m[0].t, 20); assert.equal(m[0].title, 'abc');
  s.forget(id);
  assert.equal(s._entry(id), null);
});

test('loadOne / readLatest', () => {
  const dir = tmp(); const s = new Store(dir); s.init();
  const id = '20260101-000001-aaaa';
  s.create(id, 10);
  s.append(id, [[0, '', 'abc', 20], [3, '', 'def', 30]]);
  assert.equal(s.loadOne(id).ops.length, 2);
  assert.equal(s.readLatest(id), 'abcdef');       // .md が無いので履歴から組み立てる
  s.saveText(id, 'abcdef');
  assert.equal(s.readLatest(id), 'abcdef');       // .md を使う
  assert.equal(s.loadOne('../evil'), null);
  assert.equal(s.readLatest('../evil'), null);
  assert.equal(s.loadOne('20260101-000009-zzzz'), null);
});
