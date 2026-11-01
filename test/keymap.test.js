'use strict';
/* キーボードショートカット(keymap.js)と、メニュー・画面へのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const K = require('../keymap');
const I18N = require('../renderer/i18n');
const { formatItems, inlineItems, buildTemplate } = require('../contextmenu');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T = key => I18N.t('ja', key);

test('キーの書き方をそろえる(Windows と Mac で Ctrl の意味が違う)', () => {
  assert.strictEqual(K.normalize('Ctrl+Shift+b', 'win32'), 'CmdOrCtrl+Shift+B');
  assert.strictEqual(K.normalize('shift+control+B', 'win32'), 'CmdOrCtrl+Shift+B');
  assert.strictEqual(K.normalize('CommandOrControl+Plus', 'win32'), 'CmdOrCtrl+Plus');
  assert.strictEqual(K.normalize('Alt+Return', 'win32'), 'Alt+Enter');
  assert.strictEqual(K.normalize('f11', 'win32'), 'F11');
  assert.strictEqual(K.normalize('Cmd+B', 'win32'), null);           // Windows に ⌘ は無い
  assert.strictEqual(K.normalize('Cmd+B', 'darwin'), 'CmdOrCtrl+B');
  assert.strictEqual(K.normalize('Ctrl+B', 'darwin'), 'Ctrl+B');     // Mac の Control
  assert.strictEqual(K.normalize('Shift+Cmd+Ctrl+F', 'darwin'), 'CmdOrCtrl+Ctrl+Shift+F');
  for (const bad of ['', 'Ctrl+', 'Ctrl+Shift', 'Ctrl+Foo', 'B+Ctrl', 'Ctrl+;', null, 3]) assert.strictEqual(K.normalize(bad, 'win32'), null, String(bad));
});

test('既定のキー: 書き方がそろっていて、重ならない。文言は日本語と英語にある', () => {
  const ids = K.COMMANDS.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const p of ['win32', 'darwin', 'linux']) {
    const d = K.defaults(p), used = Object.values(d).filter(Boolean);
    assert.strictEqual(new Set(used).size, used.length, p + ' で重なる: ' + used);
    for (const v of used) assert.strictEqual(K.normalize(v, p), v, p + ': ' + v);
  }
  const keys = new Set();
  K.COMMANDS.forEach(c => { keys.add(c.label); c.group.split('>').forEach(g => keys.add(g)); });
  K.fixedKeys('win32').forEach(f => keys.add(f.label));
  for (const k of keys) for (const l of ['ja', 'en']) assert.notStrictEqual(I18N.t(l, k), k, l + ':' + k);
  // 今までの既定のキー(README に書いてあるもの)は変わらない
  const w = K.defaults('win32');
  assert.deepStrictEqual([w.new, w.search, w.side, w.lines, w['mode:edit'], w['fmt:bold'], w['fmt:italic'], w.link],
    ['CmdOrCtrl+N', 'CmdOrCtrl+F', 'CmdOrCtrl+B', 'CmdOrCtrl+L', 'CmdOrCtrl+1', 'CmdOrCtrl+Shift+B', 'CmdOrCtrl+I', 'CmdOrCtrl+K']);
  assert.strictEqual(w.html, '');
});

test('割り当てられるキー: Ctrl か Alt を含むか F キー。文字の入力・編集・システムのキーは使えない', () => {
  const ok = (a, p) => assert.strictEqual(K.check(a, p || 'win32'), null, a);
  const ng = (a, why, p) => assert.strictEqual(K.check(a, p || 'win32'), why, a + ' (' + (p || 'win32') + ')');
  ok('CmdOrCtrl+J'); ok('Ctrl+Shift+8'); ok('Alt+Left'); ok('F5'); ok('Shift+F5'); ok('Alt+J'); ok('CmdOrCtrl+num1'); ok('CmdOrCtrl+Enter');
  ng('J', 'needMod'); ng('Shift+J', 'needMod'); ng('Enter', 'needMod'); ng('Shift+Space', 'needMod');
  for (const a of ['CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+X', 'CmdOrCtrl+Z', 'CmdOrCtrl+Y', 'CmdOrCtrl+A', 'CmdOrCtrl+Left', 'CmdOrCtrl+Shift+Right', 'CmdOrCtrl+Backspace', 'F3', 'Shift+F3', 'Alt+F4', 'F10']) ng(a, 'reserved');
  ng('CmdOrCtrl+;', 'badKey'); ng('CmdOrCtrl+Plus', 'badKey'); ng('nonsense', 'badKey');
  // Mac: Option+文字は特別な文字の入力、⌘Q・⌘H・⌘W などはシステム、Control+A などは入力欄の操作
  ng('Alt+E', 'reserved', 'darwin'); ng('Alt+Left', 'reserved', 'darwin'); ng('CmdOrCtrl+Q', 'reserved', 'darwin'); ng('CmdOrCtrl+H', 'reserved', 'darwin'); ng('Ctrl+A', 'reserved', 'darwin');
  ok('CmdOrCtrl+Alt+E', 'darwin'); ok('Ctrl+J', 'darwin'); ok('F10', 'darwin'); ok('Alt+F5', 'darwin');
});

test('使うキー: 変えたキーを先に決め、重なった既定のキーはキーなしにする。読めない設定は捨てる', () => {
  const d = K.defaults('win32');
  assert.deepStrictEqual(K.resolve({}, 'win32'), d);
  assert.deepStrictEqual(K.resolve(null, 'win32'), d);
  const r = K.resolve({ search: 'Ctrl+B' }, 'win32');
  assert.strictEqual(r.search, 'CmdOrCtrl+B');
  assert.strictEqual(r.side, '');
  assert.deepStrictEqual(K.resolve({ new: 'garbage', zzz: 'CmdOrCtrl+J', lines: 'CmdOrCtrl+C', print: 7 }, 'win32'), d);
  assert.strictEqual(K.resolve({ lines: '' }, 'win32').lines, '');
  const two = K.resolve({ html: 'CmdOrCtrl+J', mhtml: 'CmdOrCtrl+J' }, 'win32');
  assert.deepStrictEqual([two.html, two.mhtml], ['CmdOrCtrl+J', '']);
  assert.deepStrictEqual(K.cleanOverrides({ new: 'Ctrl+N', html: null, side: '' }, 'win32'), { side: '' });
});

test('キーを変える: 重なる操作はキーなしにし、既定と同じなら覚えない', () => {
  let ov = K.assign({}, 'search', 'Ctrl+B', 'win32');
  assert.deepStrictEqual(ov, { search: 'CmdOrCtrl+B', side: '' });
  assert.strictEqual(K.conflictOf({}, 'search', 'CmdOrCtrl+B', 'win32'), 'side');
  assert.strictEqual(K.conflictOf({}, 'side', 'CmdOrCtrl+B', 'win32'), null);
  assert.strictEqual(K.conflictOf({}, 'html', 'CmdOrCtrl+J', 'win32'), null);
  // 既定に戻す(null)。戻したキーと重なるほうはキーなしにする
  assert.deepStrictEqual(K.assign(ov, 'search', null, 'win32'), { side: '' });
  assert.deepStrictEqual(K.assign(ov, 'side', null, 'win32'), { search: '' });
  assert.deepStrictEqual(K.assign({}, 'new', 'CmdOrCtrl+N', 'win32'), {});
  assert.deepStrictEqual(K.assign({}, 'lines', '', 'win32'), { lines: '' });
  assert.deepStrictEqual(K.assign({}, 'html', '', 'win32'), {});
  assert.deepStrictEqual(K.assign({}, 'new', 'CmdOrCtrl+C', 'win32'), {});    // 割り当てられないキーは無視
  assert.deepStrictEqual(K.assign({}, 'nosuch', 'CmdOrCtrl+J', 'win32'), {});
  ov = K.assign({}, 'html', 'Ctrl+J', 'win32');
  assert.deepStrictEqual(K.resolve(ov, 'win32').html, 'CmdOrCtrl+J');
});

test('押したキーを読む(物理的なキーの位置で読むので、日本語キーボードの Shift+8 も 8)', () => {
  assert.deepStrictEqual(K.fromInput({ code: 'KeyB', key: 'B', control: true, shift: true }, 'win32').accel, 'CmdOrCtrl+Shift+B');
  assert.strictEqual(K.fromInput({ code: 'Digit8', key: '(', control: true, shift: true }, 'win32').accel, 'CmdOrCtrl+Shift+8');
  assert.strictEqual(K.fromInput({ code: 'KeyB', meta: true }, 'darwin').accel, 'CmdOrCtrl+B');
  assert.strictEqual(K.fromInput({ code: 'KeyB', control: true }, 'darwin').accel, 'Ctrl+B');
  assert.strictEqual(K.fromInput({ code: 'Numpad1', control: true }, 'win32').accel, 'CmdOrCtrl+num1');
  assert.strictEqual(K.fromInput({ code: 'F5' }, 'win32').accel, 'F5');
  assert.strictEqual(K.fromInput({ code: 'ArrowLeft', alt: true }, 'win32').accel, 'Alt+Left');
  assert.deepStrictEqual(K.fromInput({ code: 'ControlLeft', key: 'Control', control: true }, 'win32'), { mods: true, prefix: 'CmdOrCtrl' });
  assert.deepStrictEqual(K.fromInput({ code: 'ShiftLeft', key: 'Shift', control: true, shift: true }, 'win32'), { mods: true, prefix: 'CmdOrCtrl+Shift' });
  assert.ok(K.fromInput({ code: 'Semicolon', key: ';', control: true }, 'win32').bad);
  assert.ok(K.fromInput({ code: 'KeyE', meta: true }, 'win32').win);
});

test('キーの表示: Windows は Ctrl+Shift+B、Mac は ⇧⌘B', () => {
  assert.strictEqual(K.display('CmdOrCtrl+Shift+B', 'win32'), 'Ctrl+Shift+B');
  assert.strictEqual(K.display('CmdOrCtrl+Shift+B', 'darwin'), '⇧⌘B');
  assert.strictEqual(K.display('CmdOrCtrl+Ctrl+F', 'darwin'), '⌃⌘F');
  assert.strictEqual(K.display('CmdOrCtrl+Alt+F', 'darwin'), '⌥⌘F');
  assert.strictEqual(K.display('Alt+Left', 'win32'), 'Alt+Left');
  assert.strictEqual(K.display('CmdOrCtrl+Plus', 'win32'), 'Ctrl++');
  assert.strictEqual(K.display('CmdOrCtrl+num1', 'win32'), 'Ctrl+Num 1');
  assert.strictEqual(K.display('CmdOrCtrl+Click', 'win32'), 'Ctrl+click');
  assert.strictEqual(K.display('CmdOrCtrl+Click', 'darwin'), '⌘+click');
  assert.strictEqual(K.display('CmdOrCtrl+Shift+…', 'win32'), 'Ctrl+Shift+…');
  assert.strictEqual(K.display('CmdOrCtrl+Shift+…', 'darwin'), '⇧⌘…');
  assert.strictEqual(K.display('', 'win32'), '');
});

test('書式と右クリック: 変えたキーを使う(キーなしは表示しない)', () => {
  const noop = () => {};
  const keys = Object.assign(K.defaults('win32'), { 'fmt:quote': '', 'fmt:bold': 'CmdOrCtrl+J' });
  assert.strictEqual(formatItems(T, noop, 'win32', keys)[0].accelerator, undefined);
  assert.strictEqual(inlineItems(T, noop, 'win32', keys)[0].accelerator, 'CmdOrCtrl+J');
  const tpl = buildTemplate({ isEditable: true, formControlType: 'text-area', selectionText: 'a', editFlags: {} }, { onFormat: noop, platform: 'win32', keys: keys });
  assert.strictEqual(tpl.find(x => x.label === '太字').accelerator, 'CmdOrCtrl+J');
  assert.strictEqual(tpl.find(x => x.label === '引用').accelerator, undefined);
});

test('つなぎ込み: メニューのキーは keymap.js から付け、表示メニューは見ていないほうだけ押せる', () => {
  const main = read('main.js'), app = read('renderer/app.js'), preload = read('preload.js'), html = read('renderer/index.html');
  // メニューに決め打ちのキーは「すべて選択」だけ(画面側がメモの範囲を選ぶ。変えられないキー)
  const menu = main.slice(main.indexOf('function buildMenu()'), main.indexOf('/* ---------- 言語 ----------'));
  assert.deepStrictEqual(menu.match(/accelerator: '[^']*'/g), ["accelerator: 'CmdOrCtrl+A'"]);
  for (const c of K.COMMANDS.filter(x => !x.role)) {
    assert.ok(menu.includes("accelerator: A('" + c.id + "')") || c.id.startsWith('fmt:'), 'メニューに無い: ' + c.id);
  }
  for (const c of K.COMMANDS.filter(x => x.role)) assert.ok(menu.includes("roleItem(KM, '" + c.id + "'"), c.id);
  assert.match(menu, /T\('mKeys'\), click: \(\) => send\('keys'\)/);
  assert.match(menu, /T\('mModeEdit'\), accelerator: A\('mode:edit'\), enabled: ui\.base !== 'edit'/);
  assert.match(menu, /T\('mModePreview'\), accelerator: A\('mode:preview'\), enabled: ui\.base !== 'preview'/);
  assert.match(app, /api\.setUiState\(\{ edit: S\.mode === 'edit', lines: lines, back: back, hist: S\.mode === 'history', base: S\.hbase \}\)/);
  // 割り当て中は、押したキーを main.js が読む
  assert.match(main, /win\.webContents\.on\('before-input-event', onCaptureInput\)/);
  for (const ch of ['keys:list', 'keys:set', 'keys:resetAll']) assert.ok(preload.includes("ipcRenderer.invoke('" + ch + "'"), ch);
  assert.ok(preload.includes("ipcRenderer.send('keys:capture', id)"));
  // ボタンの説明のキー
  for (const id of ['side', 'mode:history', 'attach', 'lines']) assert.ok(html.includes('data-key="' + id + '"'), id);
  for (const k of ['toggleSide', 'historyTitle', 'attachTitle', 'lineNumbersTitle']) for (const l of ['ja', 'en']) {
    assert.ok(I18N.DICT[l][k].includes('{k}'), l + ':' + k);
    assert.ok(!/Ctrl\+/.test(I18N.DICT[l][k]), l + ':' + k);
  }
  assert.ok(read('package.json').includes('"keymap.js"'), '配布物に keymap.js が入っていない');
});
