'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme, session, protocol, net, screen } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { Store, MAX_ATTACH } = require('./store');
const { buildTemplate } = require('./contextmenu');
const { restoreBounds, captureBounds } = require('./windowstate');
const I18N = require('./renderer/i18n');

/* 配布版では、外からデバッグ用に接続する起動オプションを受け付けない。
   Node.js 側(--inspect、NODE_OPTIONS、ELECTRON_RUN_AS_NODE)は package.json の electronFuses で実行ファイルごと無効にしてある。
   画面(Chromium)側の --remote-debugging-* は fuses の対象外なので、ここで取り除き、残っていれば起動しない。 */
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins'];
if (app.isPackaged) {
  for (const sw of DEBUG_SWITCHES) app.commandLine.removeSwitch(sw);
  if (DEBUG_SWITCHES.some(sw => app.commandLine.hasSwitch(sw))) app.exit(1);
}

const APP_NAME = 'EverPad';
const APP_ID = 'local.everpad.app';
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let win = null;
let store = null;
let closing = false;
let lang = 'ja';
const T = (key, params) => I18N.t(lang, key, Object.assign({ app: APP_NAME }, params));
/* 保存先などのエラー(store.js が code を付ける)を、いまの言語の文に直す */
const errText = err => (err && err.code ? T('err' + err.code[0].toUpperCase() + err.code.slice(1), { mb: MAX_ATTACH / 1024 / 1024 }) : String((err && err.message) || err));

/* ---------- 保存先 ---------- */
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch (e) { return {}; }
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
}
const defaultDir = () => path.join(app.getPath('documents'), APP_NAME);

function openStore() {
  const wanted = readConfig().dataDir || defaultDir();
  try {
    store = new Store(wanted);
    store.init();
  } catch (e) {
    const fallback = path.join(app.getPath('userData'), 'notes');
    dialog.showErrorBox(APP_NAME, T('dirFallback', { wanted: wanted, fallback: fallback }));
    store = new Store(fallback);
    store.init();
  }
}

/* ---------- 画面との通信 ---------- */
function fromOurWindow(e) { return win && !win.isDestroyed() && e.sender === win.webContents; }

ipcMain.handle('memo:load', e => {
  if (!fromOurWindow(e)) return null;
  return { dir: store.dir, notes: store.listMeta() };   // 一覧用の軽い情報だけ(履歴は開くときに読む)
});
ipcMain.handle('memo:loadNote', (e, id) => {
  if (!fromOurWindow(e)) return null;
  try { return store.loadOne(id); } catch (err) { return null; }
});
// 検索用: 最新の本文だけをまとめて返す(履歴は読まない)
ipcMain.handle('memo:readTexts', (e, ids) => {
  if (!fromOurWindow(e) || !Array.isArray(ids)) return null;
  const out = {};
  for (const id of ids.slice(0, 200)) { try { const t = store.readLatest(id); if (t != null) out[id] = t; } catch (err) { /* 読めないものは飛ばす */ } }
  return out;
});
// 履歴検索用: 複数メモの履歴をまとめて返す
ipcMain.handle('memo:loadNotes', (e, ids) => {
  if (!fromOurWindow(e) || !Array.isArray(ids)) return null;
  const out = [];
  for (const id of ids.slice(0, 50)) { try { const n = store.loadOne(id); if (n) out.push(n); } catch (err) { /* 飛ばす */ } }
  return out;
});
ipcMain.handle('memo:create', (e, id, c) => {
  if (!fromOurWindow(e)) return false;
  try { return store.create(id, c); } catch (err) { return false; }
});
ipcMain.handle('memo:append', (e, id, ops) => {
  if (!fromOurWindow(e)) return false;
  try { return store.append(id, ops); } catch (err) { return false; }
});
ipcMain.handle('memo:saveText', (e, id, text) => {
  if (!fromOurWindow(e)) return false;
  try { return store.saveText(id, text); } catch (err) { return false; }
});
ipcMain.on('memo:appendSync', (e, id, ops) => {
  try { e.returnValue = fromOurWindow(e) && store.append(id, ops); } catch (err) { e.returnValue = false; }
});
ipcMain.on('memo:saveTextSync', (e, id, text) => {
  try { e.returnValue = fromOurWindow(e) && store.saveText(id, text); } catch (err) { e.returnValue = false; }
});
ipcMain.handle('memo:confirmTrash', async (e, message) => {
  if (!fromOurWindow(e)) return false;
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [T('trashButton'), T('cancel')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: APP_NAME,
    message: String(message || T('trashDefault')).slice(0, 300)
  });
  return r.response === 0;
});
ipcMain.handle('memo:remove', async (e, id) => {
  if (!fromOurWindow(e)) return false;
  try {
    for (const p of store.paths(id)) {
      try { await shell.trashItem(p); } catch (err) { fs.rmSync(p, { recursive: true, force: true }); } // ゴミ箱が使えないときだけ直接削除
    }
    store.forget(id);
    return true;
  } catch (err) { return false; }
});
ipcMain.handle('memo:openFolder', e => {
  if (!fromOurWindow(e)) return false;
  shell.openPath(store.dir);
  return true;
});

/* ---------- 画像・添付ファイル ----------
   画面からは everpad-file://f/<メモID>/<ファイルID> で画像を読む(保存先のフォルダの外は読めない)。 */
protocol.registerSchemesAsPrivileged([{ scheme: 'everpad-file', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const isImage = n => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(n || '');
// 開いてよい種類(実行ファイルやスクリプトは開かず、保存先のフォルダで場所を示すだけにする)
const SAFE_OPEN = /\.(png|jpe?g|gif|webp|bmp|avif|pdf|txt|md|csv|tsv|docx?|xlsx?|pptx?|odt|ods|odp|mp3|wav|mp4|mov|webm)$/i;

function saveAttachment(noteId, name, bytes) {
  const nm = String(name || T('file')).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
  const r = store.saveAttachment(noteId, nm, bytes);
  return { fileId: r.fileId, name: nm, image: isImage(nm), size: r.size };
}
ipcMain.handle('attach:save', (e, noteId, name, bytes) => {
  if (!fromOurWindow(e)) return { items: [], errors: [T('unavailable')] };
  try { return { items: [saveAttachment(noteId, name, bytes)], errors: [] }; }
  catch (err) { return { items: [], errors: [errText(err)] }; }
});
ipcMain.handle('attach:pick', async (e, noteId) => {
  if (!fromOurWindow(e)) return { items: [], errors: [] };
  const r = await dialog.showOpenDialog(win, { title: T('pickTitle'), properties: ['openFile', 'multiSelections'] });
  const out = { items: [], errors: [] };
  if (r.canceled) return out;
  for (const f of r.filePaths) {
    try {
      if (fs.statSync(f).size > MAX_ATTACH) { out.errors.push(path.basename(f) + ': ' + T('errTooLarge', { mb: MAX_ATTACH / 1024 / 1024 })); continue; }
      out.items.push(saveAttachment(noteId, path.basename(f), fs.readFileSync(f)));
    } catch (err) { out.errors.push(path.basename(f) + ': ' + errText(err)); }
  }
  return out;
});
ipcMain.handle('attach:open', (e, noteId, fileId) => {
  if (!fromOurWindow(e)) return 'none';
  const p = store.attachmentPath(noteId, fileId);
  if (!p) return 'missing';
  if (SAFE_OPEN.test(p)) { shell.openPath(p); return 'opened'; }
  shell.showItemInFolder(p);
  return 'shown';
});

/* ---------- 印刷・PDF ----------
   紙面は画面側が用意する(印刷するときだけ本文を出すスタイル)。ここでは印刷ダイアログと PDF の書き出しをする。 */
ipcMain.handle('print:print', e => {
  if (!fromOurWindow(e)) return 'failed';
  return new Promise(resolve => {
    win.webContents.print({ printBackground: true }, (ok, reason) => resolve(ok ? 'ok' : /cancel/i.test(String(reason)) ? 'cancelled' : 'failed'));
  });
});
// 用紙: 米国・カナダは Letter、それ以外は A4
const paperSize = () => (/[-_](US|CA)\b/i.test(app.getLocale() + ' ' + (app.getPreferredSystemLanguages()[0] || '')) ? 'Letter' : 'A4');
let lastPdfDir = null;
ipcMain.handle('print:pdf', async (e, title) => {
  if (!fromOurWindow(e)) return { status: 'failed' };
  const name = (String(title || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || APP_NAME) + '.pdf';
  const r = await dialog.showSaveDialog(win, {
    title: T('pdfSaveTitle'),
    defaultPath: path.join(lastPdfDir || app.getPath('documents'), name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { status: 'cancelled' };
  try {
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: paperSize() });
    fs.writeFileSync(r.filePath, data);
    lastPdfDir = path.dirname(r.filePath);
    return { status: 'saved', path: r.filePath };
  } catch (err) { return { status: 'failed' }; }
});

/* 画面にまだ書き出していない編集を書き出させて、終わりを待つ(最長2秒) */
function flushRenderer() {
  return new Promise(resolve => {
    if (!win || win.isDestroyed()) return resolve();
    const done = () => { clearTimeout(t); ipcMain.removeListener('app:flushed', done); resolve(); };
    const t = setTimeout(done, 2000);
    ipcMain.once('app:flushed', done);
    win.webContents.send('app:flush');
  });
}

/* ---------- メニュー ---------- */
const send = name => { if (win && !win.isDestroyed()) win.webContents.send('menu', name); };

async function changeFolder() {
  const r = await dialog.showOpenDialog(win, {
    title: T('dirPickTitle'),
    defaultPath: store.dir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return;
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: [T('dirChangeButton'), T('cancel')],
    defaultId: 0,
    cancelId: 1,
    title: APP_NAME,
    icon: ICON,
    message: T('dirChangeQ'),
    detail: T('dirChangeDetail', { dir: r.filePaths[0] })
  });
  if (choice.response !== 0) return;
  await flushRenderer();
  writeConfig(Object.assign(readConfig(), { dataDir: r.filePaths[0] }));
  closing = true;
  app.relaunch();
  app.quit();
}

function buildMenu() {
  const template = [
    {
      label: T('mFile'),
      submenu: [
        { label: T('mNewNote'), accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: T('mSearchAll'), accelerator: 'CmdOrCtrl+F', click: () => send('search') },
        { type: 'separator' },
        { label: T('mPrint'), accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { label: T('mSavePdf'), accelerator: 'CmdOrCtrl+Shift+P', click: () => send('pdf') },
        { type: 'separator' },
        { label: T('mOpenDir'), click: () => shell.openPath(store.dir) },
        { label: T('mChangeDir'), click: changeFolder },
        { type: 'separator' },
        { role: 'quit', label: T('mQuit') }
      ]
    },
    {
      label: T('mEdit'),
      submenu: [
        { role: 'undo', label: T('mUndo') },
        { role: 'redo', label: T('mRedo') },
        { type: 'separator' },
        { label: T('mAttach'), accelerator: 'CmdOrCtrl+Shift+U', click: () => send('attach') },
        { label: T('mReplace'), accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { type: 'separator' },
        { role: 'cut', label: T('mCut') },
        { role: 'copy', label: T('mCopy') },
        { role: 'paste', label: T('mPaste') },
        { label: T('mSelectAll'), accelerator: 'CmdOrCtrl+A', click: () => send('selectall') }   // 画面側で、メモの範囲だけを選ぶ
      ]
    },
    {
      label: T('mView'),
      submenu: [
        { label: T('mModeEdit'), accelerator: 'CmdOrCtrl+1', click: () => send('mode:edit') },
        { label: T('mModePreview'), accelerator: 'CmdOrCtrl+2', click: () => send('mode:preview') },
        { label: T('mModeHistory'), accelerator: 'CmdOrCtrl+3', click: () => send('mode:history') },
        { label: T('mSide'), accelerator: 'CmdOrCtrl+B', click: () => send('side') },
        { label: T('mLines'), accelerator: 'CmdOrCtrl+L', click: () => send('lines') },
        { type: 'separator' },
        { role: 'zoomIn', label: T('mZoomIn') },
        { role: 'zoomOut', label: T('mZoomOut') },
        { role: 'resetZoom', label: T('mZoomReset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: T('mFullscreen') },
        { type: 'separator' },
        { label: T('mLanguage'), submenu: [
          { label: '日本語', type: 'radio', checked: lang === 'ja', click: () => setLang('ja') },
          { label: 'English', type: 'radio', checked: lang === 'en', click: () => setLang('en') }
        ] },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', label: T('mDevTools') }])
      ]
    },
    {
      label: T('mHelp'),
      submenu: [
        { label: T('mAbout'), click: showAbout }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- 言語 ---------- */
function initLang() {
  const saved = readConfig().lang;
  lang = I18N.LANGS.includes(saved) ? saved : I18N.pick(app.getPreferredSystemLanguages()[0] || app.getLocale());
}
async function setLang(l) {
  if (l === lang) return;
  lang = l;
  writeConfig(Object.assign(readConfig(), { lang: l }));
  buildMenu();
  if (win && !win.isDestroyed()) { await flushRenderer(); loadPage(); }
}
const loadPage = () => win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { lang: lang } });

/* ---------- バージョン情報 ---------- */
function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: T('aboutTitle'),
    message: T('aboutVersion', { v: app.getVersion() }),
    detail: 'Electron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / Node.js ' + process.versions.node + '\n'
      + T('aboutDataDir', { dir: store.dir }) + '\n\n'
      + 'Copyright (c) 2026 Nobuyoshi NIHONGI\nMIT License',
    buttons: ['OK'],
    noLink: true
  });
}

/* ---------- ウィンドウ ---------- */
function createWindow() {
  // 前回閉じたときの位置と大きさに戻す(画面の外になる位置は使わない)
  const bounds = restoreBounds(readConfig().window, screen.getAllDisplays().map(d => d.workArea), { width: 1120, height: 780, minWidth: 560, minHeight: 420 });
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 560,
    minHeight: 420,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D1224' : '#EEF2FA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => { if (bounds.maximized) win.maximize(); win.show(); });
  loadPage();

  // 外部リンクは既定のブラウザで開き、アプリ内では他のページに移動させない
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  // 右クリック: Electronには標準のメニューが無いので、切り取り・コピー・貼り付けなどを自前で出す
  win.webContents.on('context-menu', (_e, params) => {
    const tpl = buildTemplate(params, { onSelectAll: () => send('selectall'), lang: lang });
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
  });

  // 閉じる前に、画面側の未保存の編集を書き出す
  win.on('close', e => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    // 次の起動のために、ウィンドウの位置と大きさを覚えておく
    try { writeConfig(Object.assign(readConfig(), { window: captureBounds(win.getNormalBounds(), win.isMaximized()) })); } catch (err) { /* 覚えられなくても閉じる */ }
    flushRenderer().then(() => { if (win && !win.isDestroyed()) win.close(); });
  });
  win.on('closed', () => { win = null; });
}

/* ---------- 起動 ---------- */
// 同じ保存先を2つのウィンドウで同時に書かないよう、起動は1つだけにする
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);   // タスクバーでアイコンと名前が正しく出るように
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    protocol.handle('everpad-file', req => {
      try {
        const [, noteId, fileId] = new URL(req.url).pathname.split('/');
        const p = store.attachmentPath(decodeURIComponent(noteId || ''), fileId);
        if (!p) return new Response('not found', { status: 404 });
        return net.fetch(pathToFileURL(p).toString());
      } catch (err) { return new Response('bad request', { status: 400 }); }
    });
    initLang();
    openStore();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { try { store.writeIndex(); } catch (e) { /* 索引は控え */ } });
}
