'use strict';
/* 設定の窓・カーソル行の強調・最後の行より下までのスクロール */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const keymap = require('../keymap');
const { macTemplate } = require('../macmenu');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
// CRLF で取り出したときも同じに読む(正規表現の \n が合うように)
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

test('設定: 「ファイル」→「設定…」の既定のキーは Ctrl+,(Mac は ⌘,)。変えることもできる', () => {
  for (const p of ['win32', 'darwin', 'linux']) assert.strictEqual(keymap.defaults(p).settings, 'CmdOrCtrl+,');
  assert.strictEqual(keymap.normalize('CmdOrCtrl+,', 'win32'), 'CmdOrCtrl+,');
  assert.strictEqual(keymap.display('CmdOrCtrl+,', 'win32'), 'Ctrl+,');
  assert.strictEqual(keymap.display('CmdOrCtrl+,', 'darwin'), '⌘,');
  const main = read('main.js');
  assert.match(main, /\{ id: 'settings', label: T\('mSettings'\), accelerator: A\('settings'\), click: \(\) => send\('settings'\) \}/);
  assert.match(read('renderer/app.js'), /else if \(name === 'settings'\) showSettings\(\);/);
});

test('設定: Mac では「設定…」をアプリ名のメニューの「EverPad について」の次に移す', () => {
  const T = key => I18N.t('ja', key, { app: 'EverPad' });
  const tpl = [
    { label: 'ファイル', submenu: [{ label: '新しいメモ' }, { type: 'separator' }, { id: 'settings', label: '設定…' }, { type: 'separator' }, { id: 'quit', role: 'quit', label: '終了' }] },
    { id: 'help', label: 'ヘルプ', submenu: [{ label: 'Markdown の書き方' }, { type: 'separator' }, { id: 'about', label: 'EverPad について' }] }
  ];
  const m = macTemplate(tpl, { T, appName: 'EverPad' });
  const app = m[0].submenu;
  assert.deepStrictEqual(app.slice(0, 4).map(x => x.id || x.type), ['about', 'separator', 'settings', 'separator']);
  const file = m[1].submenu;
  assert.deepStrictEqual(file.map(x => x.label), ['新しいメモ']);   // 残りに区切り線だけが残らない
});

test('設定: 編集の設定と更新の確認は、メニューから設定の窓へ移した(行番号と言語はメニューにも残す)', () => {
  const main = read('main.js');
  for (const k of ['mAutoIndent', 'mAutoList', 'mIndentWidth', 'mCheckOnStart']) assert.ok(!main.includes("T('" + k + "')"), k);
  assert.match(main, /label: T\('mLines'\)/);
  assert.match(main, /label: T\('mLanguage'\)/);
  assert.match(main, /label: T\('mKeys'\), click: \(\) => send\('keys'\)/);
});

test('設定: main.js が読み書きする設定(既定・受け付ける値)', () => {
  const main = read('main.js');
  // カーソル行の強調・最後の行より下までのスクロールは、既定でオン。画面には hl・sp で渡す
  assert.match(main, /lineHl: c\.lineHl !== false, scrollPast: c\.scrollPast !== false/);
  assert.match(main, /hl: p\.lineHl \? '1' : '0', sp: p\.scrollPast \? '1' : '0'/);
  // 受け付けるのは決まった名前と値だけ。ほかのウィンドウからは受け付けない
  assert.match(main, /const EDIT_BOOL = \['autoIndent', 'autoList', 'lineHl', 'scrollPast'\];/);
  assert.match(main, /ipcMain\.handle\('prefs:set', async \(e, key, value\) => \{\n  if \(!fromOurWindow\(e\)\) return null;/);
  assert.match(main, /key === 'indentWidth' && \(value === 2 \|\| value === 4\)/);
  assert.match(main, /key === 'checkOnStart' && typeof value === 'boolean' && !isStore/);
  assert.match(main, /key === 'lang' && I18N\.LANGS\.includes\(value\)/);
  assert.match(main, /update: isStore \? null :/);   // Store 版には起動時の確認が無い
  const pre = read('preload.js');
  assert.match(pre, /prefsGet: \(\) => ipcRenderer\.invoke\('prefs:get'\)/);
  assert.match(pre, /prefsSet: \(key, value\) => ipcRenderer\.invoke\('prefs:set', key, value\)/);
});

test('設定の窓: 項目と、言語を変えて読み直したあとに開き直すこと', () => {
  const app = read('renderer/app.js');
  const body = app.slice(app.indexOf('async function showSettings'), app.indexOf('/* ---------- テキストの取り込み'));
  for (const k of ['setAutoIndent', 'setAutoList', 'setIndentWidth', 'setLineHl', 'setScrollPast', 'setLines', 'mLanguage', 'setCheckOnStart', 'mKeys']) assert.ok(body.includes("T('" + k + "'"), k);
  assert.match(body, /check\(vw, T\('setLines'\), T\('setLinesHint'\), S\.lines, v => setLines\(v, true\)\);/);
  assert.match(body, /if \(P\.update\) check\(ot, T\('setCheckOnStart'\)/);
  assert.match(app, /settings: settingsOpen/);
  assert.match(app, /if \(v\.settings\) showSettings\(\)/);
  for (const l of ['ja', 'en']) for (const k of ['setTitle', 'setEdit', 'setView', 'setOther', 'setLineHlHint', 'setScrollPastHint', 'mSettings']) assert.notStrictEqual(I18N.t(l, k), k, l + ':' + k);
});

test('カーソル行の強調: 本文の欄とプレビューの編集欄だけ、フォーカスがあるときだけ。帯は欄の背景(中身と一緒にスクロール)', () => {
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  assert.match(app, /lineHl: query\.get\('hl'\) !== '0', scrollPast: query\.get\('sp'\) !== '0'/);
  assert.match(app, /const ta = EDIT\.lineHl && a && a\.tagName === 'TEXTAREA' && \(a\.id === 'editor' \|\| a\.classList\.contains\('pe-edit'\)\) && a\.clientWidth \? a : null;/);
  // 選んでいるときは、カーソルのある側の行
  assert.match(app, /function lineHlBox\(ta\) \{\n    const v = ta\.value, p = ta\.selectionDirection === 'backward' \? ta\.selectionStart : ta\.selectionEnd;/);
  // 行番号と同じく、行が多すぎるときは折り返しを無視する
  assert.match(app, /if \(total >= 20000\) return \{ top: pt \+ idx \* lh, h: lh, idx: idx \};/);
  for (const ev of ['selectionchange', 'focusin', 'focusout']) assert.ok(app.includes("document.addEventListener('" + ev + "', queueLineHl);"), ev);
  assert.match(app, /queueLineHl\(\);   \/\/ 番号を作り直したので/);
  assert.match(css, /#editor\.hl-on, \.pe-edit\.hl-on \{ background-image: linear-gradient\(var\(--line-hl\), var\(--line-hl\)\); background-repeat: no-repeat;\n  background-size: 100% var\(--hl-h, 0px\); background-position: 0 var\(--hl-top, 0px\); background-attachment: local; \}/);
  assert.match(css, /\.gutter \.cur \{ color: var\(--fg\); font-weight: 700; \}/);
});

test('最後の行より下までのスクロール: 余白は「欄の高さ − 上の余白 − 1行」。切ったときは今までの余白', () => {
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  assert.match(app, /document\.body\.classList\.toggle\('sp-on', !!EDIT\.scrollPast\);/);
  assert.match(app, /Math\.max\(22, Math\.round\(ta\.clientHeight - \(parseFloat\(cs\.paddingTop\) \|\| 0\) - \(parseFloat\(cs\.lineHeight\) \|\| 21\)\)\)/);
  assert.match(app, /function syncApply\(a, quiet\) \{\n    fitTail\(\);/);   // 切り替えたときの位置合わせの前に測る
  assert.match(css, /body\.sp-on #editor \{ padding-bottom: var\(--ed-tail, 22px\); \}/);
  assert.match(css, /body\.sp-on #preview > \.pe-tail \{ min-height: max\(4\.5em, var\(--pv-tail, 0px\)\); \}/);
  assert.match(css, /body\.sp-on #preview:not\(:has\(> \.pe-tail\)\)::after \{ content: ''; display: block; height: var\(--pv-tail, 0px\); \}/);
  assert.match(css, /#editor \{ flex: 1 1 0;[^}]*padding: 10px 24px 22px;/);   // 切ったときの余白
});

test('最後の行より下までのスクロール: 履歴の表示にも付ける。履歴を出す・閉じるときは、見ていた場所を同じ高さに出す', () => {
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  assert.match(css, /body\.sp-on #hvBody::after \{ content: ''; display: block; height: var\(--hv-tail, 0px\); \}/);
  assert.match(app, /ro\.observe\(\$\('editor'\)\); ro\.observe\(\$\('preview'\)\); ro\.observe\(\$\('hvBody'\)\);/);
  assert.match(app, /fitTail\(\);   \/\/ 文字の表示とプレビューの表示で、残す1行の高さが違う\n  \}/);   // renderHist の最後
  const t = app.slice(app.indexOf('function toggleHistory()'), app.indexOf("$('histBtn').addEventListener('click', toggleHistory);"));
  assert.match(t, /a = syncCapture\(\);/);
  assert.match(t, /a\.caretLine = -1; try \{ syncApply\(a, true\); \}/);   // カーソルは動かさず、光らせない
  assert.match(app, /if \(!a\.edge && !quiet\) flashEditorLine/);
  assert.match(app, /const an = a\.edge \|\| quiet \? null : anchorAt\(anchors, a\.line\);/);
});

test('カーソル行の強調: 右下の「読み取り専用」「行番号」をマウスで押しても、本文のフォーカス(と帯)はそのまま', () => {
  const app = read('renderer/app.js');
  assert.match(app, /for \(const id of \['roBtn', 'lnBtn'\]\) \$\(id\)\.addEventListener\('mousedown', e => \{ if \(e\.button === 0\) e\.preventDefault\(\); \}\);/);
  // 帯は読み取り専用かどうかでは変えない(フォーカスだけで決める)
  const p = app.slice(app.indexOf('function paintLineHl()'), app.indexOf('function paintLineHl()') + 400);
  assert.ok(!/readOnly|isRO/.test(p));
});
