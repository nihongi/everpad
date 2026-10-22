'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { portableLayout, dataDirToConfig, dataDirFromConfig } = require('../portable');
const { checkLock, writeLock, touchLock, releaseLock, LOCK_NAME, STALE_MS } = require('../datalock');

const W = (...p) => path.join(...p);
const base = { appData: W('C:', 'Users', 'a', 'AppData', 'Roaming'), documents: W('C:', 'Users', 'a', 'Documents') };

test('portable: インストール版・開発中はこれまでどおり', () => {
  assert.deepStrictEqual(portableLayout(Object.assign({ portableDir: '', canWrite: () => true }, base)), { mode: 'installed', base: null });
});

test('portable: 実行ファイルの隣の「EverPad Data」に設定とメモを置く', () => {
  const l = portableLayout(Object.assign({ portableDir: W('E:', 'tools'), canWrite: () => true }, base));
  assert.deepStrictEqual(l, { mode: 'portable', base: W('E:', 'tools', 'EverPad Data'), userData: W('E:', 'tools', 'EverPad Data', 'settings'), notes: W('E:', 'tools', 'EverPad Data', 'notes') });
});

test('portable: 書き込めない場所なら %APPDATA% と ドキュメントの「EverPad Portable」を使う', () => {
  const l = portableLayout(Object.assign({ portableDir: W('C:', 'Program Files', 'x'), canWrite: () => false }, base));
  assert.deepStrictEqual(l, { mode: 'portableFallback', base: null, userData: W(base.appData, 'EverPad Portable'), notes: W(base.documents, 'EverPad Portable') });
});

test('portable: 「EverPad Data」の中の保存先は相対で覚え、ドライブ文字が変わっても戻せる', () => {
  const l = { base: W('E:', 'tools', 'EverPad Data') };
  assert.strictEqual(dataDirToConfig(W('E:', 'tools', 'EverPad Data', 'notes'), l), 'notes');
  assert.strictEqual(dataDirToConfig(W('E:', 'tools', 'EverPad Data', 'a', 'b'), l), W('a', 'b'));
  assert.strictEqual(dataDirToConfig(W('D:', 'other'), l), W('D:', 'other'));                         // 外は絶対パスのまま
  assert.strictEqual(dataDirToConfig(W('E:', 'tools', 'x'), l), W('E:', 'tools', 'x'));
  const moved = { base: W('F:', 'tools', 'EverPad Data') };                                             // USB メモリのドライブ文字が変わった
  assert.strictEqual(dataDirFromConfig('notes', moved), W('F:', 'tools', 'EverPad Data', 'notes'));
  assert.strictEqual(dataDirFromConfig(W('D:', 'other'), moved), W('D:', 'other'));
  assert.strictEqual(dataDirFromConfig('notes', { base: null }), null);                                 // インストール版では相対は使わない
  assert.strictEqual(dataDirFromConfig(undefined, moved), null);
  assert.strictEqual(dataDirToConfig(W('C:', 'x'), { base: null }), W('C:', 'x'));
});

test('使用中の印: 別の動いているプロセスの新しい印だけを「使用中」とみなす', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-lock-'));
  try {
    const now = Date.now();
    assert.deepStrictEqual(checkLock(dir, now, () => true, 100), { busy: false });                          // 印が無い
    writeLock(dir, { pid: 200, app: 'portable' });
    assert.strictEqual(checkLock(dir, now, () => true, 100).busy, true);                                    // 別のプロセスが動いている
    assert.strictEqual(checkLock(dir, now, () => true, 100).info.app, 'portable');
    assert.strictEqual(checkLock(dir, now, () => false, 100).busy, false);                                  // そのプロセスは終わっている
    assert.strictEqual(checkLock(dir, now + STALE_MS + 1000, () => true, 100).busy, false);                 // 長く更新されていない
    assert.strictEqual(checkLock(dir, now, () => true, 200).busy, false);                                   // 自分の印
    releaseLock(dir, 100);
    assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)));                                                    // 他人の印は消さない
    touchLock(dir);
    releaseLock(dir, 200);
    assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
    fs.writeFileSync(path.join(dir, LOCK_NAME), 'こわれた印');
    assert.strictEqual(checkLock(dir, now, () => true, 100).busy, false);                                   // 壊れた印は無視
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
