'use strict';
/* 保存先フォルダの一覧と、再起動しない切り替え(main.js の dirMenu・switchFolder、画面の起動) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18N = require('../renderer/i18n');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('メニュー: 「ファイル」→「保存先フォルダ」に一覧・追加・一覧から外す', () => {
  const m = read('main.js');
  assert.match(m, /\{ label: T\('mDirs'\), submenu: dirMenu\(\) \}/);
  assert.match(m, /type: 'radio', checked: samePath\(d, cur\), click: \(\) => switchFolder\(d\)/);
  assert.match(m, /\{ label: T\('mDirAdd'\), click: addFolder \}/);
  assert.match(m, /if \(store && samePath\(d, store\.dir\)\) return;   \/\/ 使っている保存先は外せない/);
  assert.ok(!/mChangeDir|changeFolder/.test(m), '前の「保存先フォルダを変更…」は無い');
});

test('切り替え: 開けてから、書き出し → 元の目印のファイルを手放す → 新しい保存先を使う → 画面を読み直す', () => {
  const m = read('main.js');
  const body = m.slice(m.indexOf('async function switchFolder('), m.indexOf("ipcMain.handle('dir:menu'"));
  const order = ['openStoreAt(dir)', 'await prepareRenderer()', 'releaseStore()', 'useStore(r)', 'saveDirs(list, dir)', 'loadPage({ sw:'];
  let at = -1;
  for (const s of order) { const i = body.indexOf(s); assert.ok(i > at, s); at = i; }
  assert.match(body, /if \(!ok && !add\) \{ dialog\.showErrorBox\(APP_NAME, T\('dirMissing'/, '無くなったフォルダは作り直さない');
  assert.match(body, /dirBusy = true;/);
  // 終了のときも同じ手放し方
  assert.match(m, /app\.on\('will-quit', \(\) => \{\n {4}clearInterval\(lockTimer\);\n {4}releaseStore\(\);/);
});

test('画面: 切り替えたあとは、テキストかプレビューかと検索の範囲だけを引き継ぎ、開いていたメモは保存先ごとに覚える', () => {
  const a = read('renderer/app.js');
  assert.match(a, /if \(view && !switched\) restoreView\(view\);/);
  assert.match(a, /const m = view \? \(view\.mode === 'history' \? view\.hbase : view\.mode\) : 'edit';/);
  assert.match(a, /setMode\(m === 'preview' \? 'preview' : 'edit', true\);\n {6}restorePos\(\);/);
  assert.match(a, /if \(switched\) toast\(T\('dirSwitched', \{ name: switched \}\)\);/);
  assert.match(a, /localStorage\.getItem\('everpad:active:' \+ S\.dir\) \|\| localStorage\.getItem\('everpad:active'\)/);
  assert.match(read('renderer/index.html'), /id="switchDirBtn"/);
  assert.match(read('preload.js'), /dirMenu: pos => ipcRenderer\.invoke\('dir:menu', pos\)/);
});

test('文言: 日本語と英語の両方にある', () => {
  for (const k of ['mDirs', 'mDirAdd', 'mDirRemove', 'dirRemoveButton', 'dirRemoveQ', 'dirRemoveDetail', 'dirMissing', 'dirOpenFailed', 'dirSwitched', 'switchDir', 'switchDirTitle']) {
    for (const l of ['ja', 'en']) assert.notStrictEqual(I18N.t(l, k, { name: 'x', dir: 'y' }), k, l + ': ' + k);
  }
  assert.strictEqual(I18N.t('ja', 'dirSwitched', { name: '仕事' }), '保存先を「仕事」に切り替えました');
});
