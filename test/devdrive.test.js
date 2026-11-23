'use strict';
/* tools/devdrive.js(開発中の EverPad を試験用のフォルダで動かす道具)の準備: 一時フォルダの外は使わない。
   設定の保存先は必ず試験用のフォルダ。見本のメモと添付を、EverPad と同じ形で作る */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const devdrive = require('../tools/devdrive.js');

test('一時フォルダの外は使わない(本物の保存先や設定を消さない)', () => {
  // 一時フォルダの隣(リポジトリがどこにあっても、一時フォルダの外)
  const outside = path.join(path.dirname(os.tmpdir()), 'everpad-devdrive-outside-temp');
  assert.throws(() => devdrive.prepare({ dir: outside }), /inside the temp folder/);
  assert.throws(() => devdrive.prepare({ dir: os.tmpdir() }), /inside the temp folder/);
  assert.throws(() => devdrive.prepare({ dir: path.join(os.tmpdir(), '..', 'x') }), /inside the temp folder/);
  assert(!fs.existsSync(outside));
});

test('設定・保存先・見本のメモ・添付を、試験用のフォルダの中に作る', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-devdrive-'));
  try {
    const img = path.join(dir, 'pic.png');
    fs.writeFileSync(img, Buffer.from([1, 2, 3]));
    const w = devdrive.prepare({
      dir,
      notes: [{ id: '20261120-090000-a1', text: '# A\n' }, { id: '20261120-090001-b2', ops: [[0, '', 'ab', 1], [1, 'b', 'c', 2]], head: { imported: 5 } }],
      attach: { '20261120-090000-a1': [img] },
      // 保存先を本物の場所にしようとしても、試験用のフォルダになる
      config: { dataDir: 'C:/Users/somebody/Documents/EverPad', dataDirs: ['C:/Users/somebody/Documents/EverPad'], editor: { scrollPast: false } },
    });
    const cfg = JSON.parse(fs.readFileSync(path.join(w.settings, 'config.json'), 'utf8'));
    assert.strictEqual(cfg.dataDir, w.data);
    assert.deepStrictEqual(cfg.dataDirs, [w.data]);
    assert.deepStrictEqual(cfg.editor, { scrollPast: false });
    assert.strictEqual(fs.readFileSync(path.join(w.data, '20261120-090000-a1.md'), 'utf8'), '# A\n');
    const b = fs.readFileSync(path.join(w.data, '20261120-090001-b2.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepStrictEqual(b[0], { v: 1, id: '20261120-090001-b2', c: b[0].c, imported: 5 });
    assert.strictEqual(fs.readFileSync(path.join(w.data, '20261120-090001-b2.md'), 'utf8'), 'ac');
    const id = devdrive.fileId(img);
    assert.match(id, /^[0-9a-f]{16}\.png$/);
    assert(fs.existsSync(path.join(w.data, '20261120-090000-a1.files', id)));
    // reuse: 前に作ったものをそのまま使う(閉じて起動し直す確かめ)。指定しなければ作り直す
    fs.writeFileSync(path.join(w.settings, 'keep.txt'), 'x');
    devdrive.prepare({ dir, reuse: true });
    assert(fs.existsSync(path.join(w.settings, 'keep.txt')) && fs.existsSync(path.join(w.data, '20261120-090000-a1.md')));
    devdrive.prepare({ dir });
    assert(!fs.existsSync(path.join(w.settings, 'keep.txt')) && !fs.existsSync(path.join(w.data, '20261120-090000-a1.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
