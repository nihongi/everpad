'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { writeZip, readZip } = require('../ziplite');
const { buildArchive, readArchive, looksLikeArchive } = require('../archive');
const { Store } = require('../store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-arc-'));
const ID = '20261022-100000-arcv';
const head = { v: 1, id: ID, c: 1000 };
const ops = [[0, '', '# 題名\n', 1000], [5, '', '本文 ![図](attach:0123456789abcdef.png)', 2000]];
const jsonl = [head].concat(ops).map(o => JSON.stringify(o)).join('\n') + '\n';
const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4]);
const note = { id: ID, title: '題名', created: 1000, jsonl: jsonl, md: '# 題名\n本文', files: [{ fileId: '0123456789abcdef.png', data: png }] };

test('ZIP: 書いたものを読み戻せる(圧縮・無圧縮・日本語の名前)', () => {
  const big = Buffer.from('あいうえお'.repeat(1000));
  const z = writeZip([{ name: 'a.txt', data: big }, { name: '日本語/b.bin', data: Buffer.from([1, 2, 3]) }]);
  const r = readZip(z);
  assert.deepStrictEqual(r.map(e => e.name), ['a.txt', '日本語/b.bin']);
  assert.ok(r[0].data.equals(big));
  assert.ok(z.length < big.length / 2);                     // 圧縮されている
  assert.deepStrictEqual([...r[1].data], [1, 2, 3]);
});

test('ZIP: 壊れたもの・ZIP でないもの・展開すると大きすぎるものは読まない', () => {
  const z = writeZip([{ name: 'a.txt', data: Buffer.from('hello world hello world hello world') }]);
  const bad = Buffer.from(z); bad[40] ^= 0xff;               // 中身を壊す
  assert.throws(() => readZip(bad), e => e.code === 'broken');
  assert.throws(() => readZip(Buffer.from('not a zip')), e => e.code === 'notZip');
  assert.throws(() => readZip(z.slice(0, z.length - 10)), e => e.code === 'broken');
  // 圧縮すると小さいが、展開すると上限を超えるもの
  const bomb = writeZip([{ name: 'zero', data: Buffer.alloc(5 * 1024 * 1024) }]);
  assert.throws(() => readZip(bomb, { entry: 1024 * 1024 }), e => e.code === 'tooLarge');
  // 暗号化の印が付いたもの
  const enc = Buffer.from(z); const cd = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); enc.writeUInt16LE(0x0801, cd + 8);
  assert.throws(() => readZip(enc), e => e.code === 'unsupported');
});

test('アーカイブ: 本文・履歴・添付をまとめ、読み戻すと同じ内容になる', () => {
  const a = buildArchive(note, '0.14.0', new Date(2026, 9, 22, 10, 0, 0));
  assert.ok(looksLikeArchive(a));
  assert.ok(!looksLikeArchive(Buffer.from('テキスト')));
  const names = readZip(a).map(e => e.name);
  assert.deepStrictEqual(names, ['manifest.json', 'note.jsonl', 'note.md', 'files/0123456789abcdef.png']);
  const r = readArchive(a);
  assert.strictEqual(r.manifest.format, 'everpad-note');
  assert.strictEqual(r.manifest.version, 1);
  assert.strictEqual(r.manifest.id, ID);
  assert.strictEqual(r.manifest.title, '題名');
  assert.strictEqual(r.manifest.app, 'EverPad 0.14.0');
  assert.deepStrictEqual(r.ops, ops);
  assert.strictEqual(r.files.length, 1);
  assert.ok(r.files[0].data.equals(png));
});

test('アーカイブ: 形式・メモID・履歴・添付のファイル名が正しくなければ読まない', () => {
  const mk = (entries) => writeZip(entries.map(([name, data]) => ({ name, data: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) })));
  const man = { format: 'everpad-note', version: 1, id: ID };
  const ok = [['manifest.json', man], ['note.jsonl', jsonl]];
  assert.ok(readArchive(mk(ok)));
  assert.throws(() => readArchive(mk([['note.jsonl', jsonl]])), e => e.code === 'notArchive');                                      // manifest が無い
  assert.throws(() => readArchive(mk([['manifest.json', { format: 'other', version: 1, id: ID }], ['note.jsonl', jsonl]])), e => e.code === 'notArchive');
  assert.throws(() => readArchive(mk([['manifest.json', Object.assign({}, man, { version: 2 })], ['note.jsonl', jsonl]])), e => e.code === 'newerFormat');
  assert.throws(() => readArchive(mk([['manifest.json', Object.assign({}, man, { id: '../x' })], ['note.jsonl', jsonl]])), e => e.code === 'broken');
  assert.throws(() => readArchive(mk([['manifest.json', man], ['note.jsonl', '壊れた履歴\n']])), e => e.code === 'broken');
  assert.throws(() => readArchive(mk([['manifest.json', Object.assign({}, man, { id: '20261022-999999-diff' })], ['note.jsonl', jsonl]])), e => e.code === 'broken');   // 履歴の ID と違う
  assert.throws(() => readArchive(mk(ok.concat([['files/../../evil.exe', 'x']]))), e => e.code === 'broken');                     // 保存先の外を指す
});

test('アーカイブ: 保存先に取り込むと、ID を差し替え、取り込んだ時刻を記録し、一覧の上に来る', () => {
  const dir = tmpDir();
  try {
    const s = new Store(dir); s.init();
    // 既にあるメモ(後で編集されたもの)
    fs.writeFileSync(path.join(dir, '20261022-090000-oldn.jsonl'), JSON.stringify({ v: 1, id: '20261022-090000-oldn', c: 5000 }) + '\n' + JSON.stringify([0, '', 'old', 9000]) + '\n');
    const arc = readArchive(buildArchive(note, '0.14.0'));
    const newId = '20261022-110000-copy';
    assert.strictEqual(s.importNote(newId, arc, 50000), true);
    const loaded = s.loadOne(newId);
    assert.strictEqual(loaded.id, newId);
    assert.strictEqual(loaded.imported, 50000);
    assert.deepStrictEqual(loaded.ops, ops);
    assert.strictEqual(fs.readFileSync(path.join(dir, newId + '.md'), 'utf8'), '# 題名\n本文 ![図](attach:0123456789abcdef.png)');
    assert.ok(fs.readFileSync(path.join(dir, newId + '.files', '0123456789abcdef.png')).equals(png));
    const meta = s.listMeta();
    const m = meta.find(x => x.id === newId);
    assert.strictEqual(m.t, 50000);                      // 最後の編集(2000)より新しい、取り込んだ時刻
    assert.strictEqual(m.imported, 50000);
    assert.ok(m.t > meta.find(x => x.id === '20261022-090000-oldn').t);
    assert.throws(() => s.importNote(newId, arc, 60000), e => e.code === 'exists');   // 上書きは、呼ぶ側が先に消す
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
