'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme, session, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { Store, MAX_ATTACH } = require('./store');
const { buildTemplate } = require('./contextmenu');

const APP_NAME = 'EverPad';
const APP_ID = 'local.everpad.app';
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let win = null;
let store = null;
let closing = false;

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
    dialog.showErrorBox(APP_NAME, '保存先フォルダを使えませんでした。\n' + wanted + '\n\n代わりにここへ保存します。\n' + fallback);
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
    buttons: ['ゴミ箱に移動', 'キャンセル'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: APP_NAME,
    message: String(message || 'このメモをゴミ箱に移動しますか?').slice(0, 300)
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
  const nm = String(name || 'ファイル').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
  const r = store.saveAttachment(noteId, nm, bytes);
  return { fileId: r.fileId, name: nm, image: isImage(nm), size: r.size };
}
ipcMain.handle('attach:save', (e, noteId, name, bytes) => {
  if (!fromOurWindow(e)) return { items: [], errors: ['使えません'] };
  try { return { items: [saveAttachment(noteId, name, bytes)], errors: [] }; }
  catch (err) { return { items: [], errors: [String(err.message || err)] }; }
});
ipcMain.handle('attach:pick', async (e, noteId) => {
  if (!fromOurWindow(e)) return { items: [], errors: [] };
  const r = await dialog.showOpenDialog(win, { title: '画像・ファイルを選んでください', properties: ['openFile', 'multiSelections'] });
  const out = { items: [], errors: [] };
  if (r.canceled) return out;
  for (const f of r.filePaths) {
    try {
      if (fs.statSync(f).size > MAX_ATTACH) { out.errors.push(path.basename(f) + ': ファイルが大きすぎます(上限 ' + (MAX_ATTACH / 1024 / 1024) + 'MB)'); continue; }
      out.items.push(saveAttachment(noteId, path.basename(f), fs.readFileSync(f)));
    } catch (err) { out.errors.push(path.basename(f) + ': ' + String(err.message || err)); }
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
    title: '保存先フォルダを選んでください',
    defaultPath: store.dir,
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return;
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['変更して再起動', 'キャンセル'],
    defaultId: 0,
    cancelId: 1,
    title: APP_NAME,
    icon: ICON,
    message: '保存先を変更しますか?',
    detail: r.filePaths[0] + '\n\n今のメモは元のフォルダに残ります。新しい保存先には、そのフォルダにあるメモが表示されます。メモを移すには、元のフォルダの .jsonl と .md ファイルを新しい保存先にコピーしてください。'
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
      label: 'ファイル',
      submenu: [
        { label: '新しいメモ', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: '全メモから検索', accelerator: 'CmdOrCtrl+F', click: () => send('search') },
        { type: 'separator' },
        { label: '保存先フォルダを開く', click: () => shell.openPath(store.dir) },
        { label: '保存先フォルダを変更…', click: changeFolder },
        { type: 'separator' },
        { role: 'quit', label: '終了' }
      ]
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '元に戻す' },
        { role: 'redo', label: 'やり直し' },
        { type: 'separator' },
        { label: '画像・ファイルを添付…', accelerator: 'CmdOrCtrl+Shift+U', click: () => send('attach') },
        { label: '検索と置換…', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { type: 'separator' },
        { role: 'cut', label: '切り取り' },
        { role: 'copy', label: 'コピー' },
        { role: 'paste', label: '貼り付け' },
        { label: 'すべて選択', accelerator: 'CmdOrCtrl+A', click: () => send('selectall') }   // 画面側で、メモの範囲だけを選ぶ
      ]
    },
    {
      label: '表示',
      submenu: [
        { label: '編集', accelerator: 'CmdOrCtrl+1', click: () => send('mode:edit') },
        { label: 'プレビュー', accelerator: 'CmdOrCtrl+2', click: () => send('mode:preview') },
        { label: '履歴表示の切り替え', accelerator: 'CmdOrCtrl+3', click: () => send('mode:history') },
        { label: 'メモ一覧と検索の表示を切り替え', accelerator: 'CmdOrCtrl+B', click: () => send('side') },
        { label: '行番号の表示を切り替え', accelerator: 'CmdOrCtrl+L', click: () => send('lines') },
        { type: 'separator' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', label: '開発者ツール' }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- ウィンドウ ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
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
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 外部リンクは既定のブラウザで開き、アプリ内では他のページに移動させない
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  // 右クリック: Electronには標準のメニューが無いので、切り取り・コピー・貼り付けなどを自前で出す
  win.webContents.on('context-menu', (_e, params) => {
    const tpl = buildTemplate(params, { onSelectAll: () => send('selectall') });
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
  });

  // 閉じる前に、画面側の未保存の編集を書き出す
  win.on('close', e => {
    if (closing) return;
    e.preventDefault();
    closing = true;
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
    openStore();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { try { store.writeIndex(); } catch (e) { /* 索引は控え */ } });
}
