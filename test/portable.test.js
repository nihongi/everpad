'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { portableLayout, dataDirToConfig, dataDirFromConfig } = require('../portable');

const W = (...p) => path.join(...p);
// ドライブの最上位(Windows は E:、Mac と Linux は /mnt/e)。どの OS でも絶対パスになるようにする
const drv = l => (process.platform === 'win32' ? l + ':\\' : '/mnt/' + l.toLowerCase());
const base = { appData: W(drv('C'), 'Users', 'a', 'AppData', 'Roaming'), documents: W(drv('C'), 'Users', 'a', 'Documents') };

test('portable: インストール版・開発中はこれまでどおり', () => {
  assert.deepStrictEqual(portableLayout(Object.assign({ portableDir: '', canWrite: () => true }, base)), { mode: 'installed', base: null });
});

test('portable: 実行ファイルの隣の「EverPad Data」に設定とメモを置く', () => {
  const l = portableLayout(Object.assign({ portableDir: W(drv('E'), 'tools'), canWrite: () => true }, base));
  assert.deepStrictEqual(l, { mode: 'portable', base: W(drv('E'), 'tools', 'EverPad Data'), userData: W(drv('E'), 'tools', 'EverPad Data', 'settings'), notes: W(drv('E'), 'tools', 'EverPad Data', 'notes') });
});

test('portable: 書き込めない場所なら %APPDATA% と ドキュメントの「EverPad Portable」を使う', () => {
  const l = portableLayout(Object.assign({ portableDir: W(drv('C'), 'Program Files', 'x'), canWrite: () => false }, base));
  assert.deepStrictEqual(l, { mode: 'portableFallback', base: null, userData: W(base.appData, 'EverPad Portable'), notes: W(base.documents, 'EverPad Portable') });
});

test('portable: 「EverPad Data」の中の保存先は相対で覚え、ドライブ文字が変わっても戻せる', () => {
  const l = { base: W(drv('E'), 'tools', 'EverPad Data') };
  assert.strictEqual(dataDirToConfig(W(drv('E'), 'tools', 'EverPad Data', 'notes'), l), 'notes');
  assert.strictEqual(dataDirToConfig(W(drv('E'), 'tools', 'EverPad Data', 'a', 'b'), l), W('a', 'b'));
  assert.strictEqual(dataDirToConfig(W(drv('D'), 'other'), l), W(drv('D'), 'other'));                         // 外は絶対パスのまま
  assert.strictEqual(dataDirToConfig(W(drv('E'), 'tools', 'x'), l), W(drv('E'), 'tools', 'x'));
  const moved = { base: W(drv('F'), 'tools', 'EverPad Data') };                                             // USB メモリのドライブ文字が変わった
  assert.strictEqual(dataDirFromConfig('notes', moved), W(drv('F'), 'tools', 'EverPad Data', 'notes'));
  assert.strictEqual(dataDirFromConfig(W(drv('D'), 'other'), moved), W(drv('D'), 'other'));
  assert.strictEqual(dataDirFromConfig('notes', { base: null }), null);                                 // インストール版では相対は使わない
  assert.strictEqual(dataDirFromConfig(undefined, moved), null);
  assert.strictEqual(dataDirToConfig(W(drv('C'), 'x'), { base: null }), W(drv('C'), 'x'));
});
