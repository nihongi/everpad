'use strict';
/* macOS / Linux 向けの部分(Mac のメニュー、Mac のショートカットの書き方、AppImage の portable) */
const test = require('node:test');
const assert = require('node:assert');
const { macTemplate } = require('../macmenu');
const { macKeys } = require('../renderer/core');
const { buildTemplate, formatItems } = require('../contextmenu');
const { portableDirFromEnv } = require('../portable');
const I18N = require('../renderer/i18n');

const T = key => I18N.t('ja', key, { app: 'EverPad' });
/* main.js の buildMenu と同じ形の、Windows のメニュー */
function winTemplate() {
  return [
    { label: 'ファイル', submenu: [
      { label: '新しいメモ', accelerator: 'CmdOrCtrl+N' },
      { id: 'back', label: '戻る', accelerator: 'Alt+Left' },
      { type: 'separator' },
      { label: 'エクスポート', submenu: [{ label: 'テキスト', accelerator: 'CmdOrCtrl+Shift+E' }] },
      { id: 'props', label: 'プロパティ', accelerator: 'Alt+Enter' },
      { type: 'separator' },
      { id: 'quit', role: 'quit', label: '終了' }
    ] },
    { label: '編集', submenu: [{ id: 'replace', label: '置換', accelerator: 'CmdOrCtrl+H' }] },
    { label: '表示', submenu: [{ label: '編集', accelerator: 'CmdOrCtrl+1' }] },
    { id: 'help', label: 'ヘルプ', submenu: [
      { label: 'Markdown の書き方' },
      { type: 'separator' },
      { id: 'about', label: 'EverPad について' }
    ] }
  ];
}

test('Mac のメニュー: 最上位はアプリ名・ファイル・編集・表示・ウインドウ・ヘルプ', () => {
  const m = macTemplate(winTemplate(), { T, appName: 'EverPad' });
  assert.deepStrictEqual(m.map(x => x.label), ['EverPad', 'ファイル', '編集', '表示', 'ウインドウ', 'ヘルプ']);
  assert.strictEqual(m[4].role, 'window');
  assert.strictEqual(m[5].role, 'help');
});

test('Mac のメニュー: 「EverPad について」と「終了」はアプリ名のメニューへ移り、残りに余分な区切り線が無い', () => {
  const m = macTemplate(winTemplate(), { T, appName: 'EverPad' });
  const appMenu = m[0].submenu;
  assert.strictEqual(appMenu[0].id, 'about');
  assert.deepStrictEqual(appMenu.filter(x => x.role).map(x => x.role), ['services', 'hide', 'hideOthers', 'unhide', 'quit']);
  assert.strictEqual(appMenu[appMenu.length - 1].label, 'EverPad を終了');
  assert.strictEqual(appMenu.find(x => x.role === 'hide').label, 'EverPad を隠す');
  const file = m[1].submenu, help = m[5].submenu;
  assert.ok(!file.some(x => x.id === 'quit'));
  assert.ok(!help.some(x => x.id === 'about'));
  for (const sub of [file, help]) {
    assert.notStrictEqual(sub[0].type, 'separator');
    assert.notStrictEqual(sub[sub.length - 1].type, 'separator');
    sub.forEach((x, i) => assert.ok(!(x.type === 'separator' && sub[i + 1] && sub[i + 1].type === 'separator')));
  }
  assert.deepStrictEqual(help.map(x => x.label), ['Markdown の書き方']);
});

test('Mac のメニュー: Mac で別の意味があるショートカットを変え、他は変えない', () => {
  const m = macTemplate(winTemplate(), { T, appName: 'EverPad' });
  const all = [];
  const walk = items => items.forEach(x => { all.push(x); if (Array.isArray(x.submenu)) walk(x.submenu); });
  walk(m);
  const key = id => all.find(x => x.id === id).accelerator;
  assert.strictEqual(key('back'), 'Cmd+[');
  assert.strictEqual(key('props'), 'Cmd+I');
  assert.strictEqual(key('replace'), 'Cmd+Alt+F');
  assert.ok(!all.some(x => x.accelerator === 'CmdOrCtrl+H'));   // ⌘H は「隠す」
  assert.ok(all.some(x => x.accelerator === 'CmdOrCtrl+N'));
  assert.ok(all.some(x => x.accelerator === 'CmdOrCtrl+Shift+E'));
});

test('Windows のメニューは組み替えない(元の形を変えない)', () => {
  const w = winTemplate();
  macTemplate(w, { T, appName: 'EverPad' });
  assert.deepStrictEqual(w.map(x => x.label), ['ファイル', '編集', '表示', 'ヘルプ']);
  assert.ok(w[0].submenu.some(x => x.id === 'quit'));
  assert.ok(w[3].submenu.some(x => x.id === 'about'));
});

test('Mac のメニューの文言は日本語と英語の両方にある', () => {
  for (const k of ['mServices', 'mHide', 'mHideOthers', 'mShowAll', 'mQuitApp', 'mWindow', 'mMinimize', 'mZoomWindow', 'mFront']) {
    for (const lang of ['ja', 'en']) assert.notStrictEqual(I18N.t(lang, k, { app: 'EverPad' }), k, lang + ':' + k);
  }
});

test('書式と右クリック: Mac では ⌘⇧Q(ログアウト)を使わず、やり直しは ⇧⌘Z', () => {
  const noop = () => {};
  assert.strictEqual(formatItems(T, noop, 'darwin')[0].accelerator, "Cmd+'");
  assert.strictEqual(formatItems(T, noop, 'win32')[0].accelerator, 'CmdOrCtrl+Shift+Q');
  const params = { isEditable: true, editFlags: {} };
  const redo = p => buildTemplate(params, { platform: p }).find(x => x.role === 'redo').accelerator;
  assert.strictEqual(redo('darwin'), 'Shift+Cmd+Z');
  assert.strictEqual(redo('win32'), 'CmdOrCtrl+Y');
});

test('macKeys: 文中のショートカットを Mac の書き方にする', () => {
  assert.strictEqual(macKeys('添付 (Ctrl+Shift+U)。'), '添付 (⇧⌘U)。');
  assert.strictEqual(macKeys('一覧 (Ctrl+B)'), '一覧 (⌘B)');
  assert.strictEqual(macKeys('編集画面では Ctrl+クリックで'), '編集画面では ⌘+クリックで');
  assert.strictEqual(macKeys('or Ctrl+click it in the editor (Ctrl+K)'), 'or ⌘+click it in the editor (⌘K)');
  assert.strictEqual(macKeys('ショートカットなし'), 'ショートカットなし');
});

test('portableDirFromEnv: Windows の portable 版と Linux の AppImage', () => {
  assert.strictEqual(portableDirFromEnv({ PORTABLE_EXECUTABLE_DIR: 'E:\\Tools' }, 'win32', 'C:\\x\\EverPad.exe'), 'E:\\Tools');
  const env = { APPIMAGE: '/media/usb/apps/EverPad-0.18.0.AppImage', APPDIR: '/tmp/.mount_EverPaAbc' };
  assert.strictEqual(portableDirFromEnv(env, 'linux', '/tmp/.mount_EverPaAbc/everpad'), '/media/usb/apps');
  // 他の AppImage から起動され、APPIMAGE を引き継いだだけのとき(自分は APPDIR の外)は portable にしない
  assert.strictEqual(portableDirFromEnv(env, 'linux', '/opt/EverPad/everpad'), '');
  assert.strictEqual(portableDirFromEnv(env, 'linux', '/tmp/.mount_EverPaAbcd/everpad'), '');
  assert.strictEqual(portableDirFromEnv(env, 'darwin', '/tmp/.mount_EverPaAbc/everpad'), '');
  assert.strictEqual(portableDirFromEnv({}, 'linux', '/usr/bin/everpad'), '');
});
