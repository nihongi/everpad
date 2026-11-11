'use strict';
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeTheme, session, protocol, net, screen, clipboard, ClipboardItem, nativeImage } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const { Store, MAX_ATTACH, validId, validFileId } = require('./store');
const { decodeText, MAX_IMPORT } = require('./textcodec');
const { sendToPath, shortcutTarget, filesFromArgv } = require('./sendto');
const { buildArchive, readArchive, looksLikeArchive } = require('./archive');
const { titleOf } = require('./renderer/core');
const { buildTemplate, buildAttachTemplate, formatItems, inlineItems, tableItems } = require('./contextmenu');
const { restoreBounds, captureBounds } = require('./windowstate');
const I18N = require('./renderer/i18n');
const { portableLayout, dataDirToConfig, dataDirFromConfig, portableDirFromEnv } = require('./portable');
const datalock = require('./datalock');
const { macTemplate } = require('./macmenu');
const keymap = require('./keymap');
const updater = require('./updatecheck');
const pageexport = require('./pageexport');
const docexport = require('./docexport');
const isMac = process.platform === 'darwin';

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

/* ---------- portable 版 ----------
   portable 版は、実行ファイルと同じフォルダの「EverPad Data」に設定とメモを置く(インストール版とは設定を共有しない)。
   設定の場所が別になるので、インストール版と portable 版は同時に起動できる。書き込めない場所なら %APPDATA% の別のフォルダを使う。
   Linux の AppImage も、AppImage ファイルと同じフォルダを使って同じように動く */
const portableDir = portableDirFromEnv(process.env, process.platform, process.execPath);
function canWriteDir(dir) {
  try {
    fs.mkdirSync(path.join(dir, 'settings'), { recursive: true });
    const probe = path.join(dir, 'settings', '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (e) { return false; }
}
const layout = portableLayout({ portableDir: portableDir, appData: app.getPath('appData'), documents: app.getPath('documents'), canWrite: canWriteDir });
if (layout.userData) app.setPath('userData', layout.userData);
const isPortable = layout.mode !== 'installed';
/* Microsoft Store 版(MSIX)。更新は Store が配るので、アプリの更新確認は使わない。
   アプリのファイルは Windows が管理する場所にあり、そこを指すショートカットは使えないので、「送る」メニューへの登録も出さない。
   設定とメモの場所はインストール版と同じ(%APPDATA% への新しい書き込みは、Windows がアプリ専用の場所に振り分ける) */
const isStore = process.windowsStore === true;
const ICON = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
let win = null;
let store = null;
let closing = false;
let quitting = false;   // アプリを終えようとしている(Mac で、ウィンドウを閉じただけのときと区別する)
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
const defaultDir = () => layout.notes || path.join(app.getPath('documents'), APP_NAME);

/* ---------- ファイルを選ぶ窓で最初に開くフォルダ ----------
   インポートとエクスポートで別々に、前回ファイルを選んだフォルダを config.json に覚える(終了しても引き継ぐ)。
   エクスポートはテキスト・PDF・アーカイブ・添付の保存で共有する。
   前回の情報が無いとき(または、そのフォルダが無くなったとき)は、インポートは保存先フォルダ、エクスポートはドキュメント */
function lastDir(kind) {
  const d = (readConfig().lastDirs || {})[kind];
  try { if (typeof d === 'string' && d && fs.statSync(d).isDirectory()) return d; } catch (e) { /* 無くなった */ }
  return null;
}
function rememberDir(kind, file) {
  try { const c = readConfig(); c.lastDirs = Object.assign({}, c.lastDirs, { [kind]: path.dirname(file) }); writeConfig(c); } catch (e) { /* 覚えられなくても動く */ }
}
const importStartDir = () => lastDir('import') || store.dir;
const exportStartDir = () => lastDir('export') || app.getPath('documents');

let lockTimer = null;
function openStore() {
  for (;;) {
    const wanted = dataDirFromConfig(readConfig().dataDir, layout) || defaultDir();
    const st = datalock.checkLock(wanted, Date.now(), null, process.pid);
    if (st.busy) {
      const by = st.info.kind === 'portable' ? T('lockByPortable', { dir: st.info.dir || '' }) : T('lockByInstalled');
      const r = dialog.showMessageBoxSync({ type: 'warning', title: APP_NAME, noLink: true, defaultId: 0, cancelId: 1,
        buttons: [T('lockChoose'), T('mQuit')], message: T('lockBusy'), detail: T('lockBusyDetail', { dir: wanted, by: by }) });
      const pick = r === 0 ? dialog.showOpenDialogSync({ title: T('dirPickTitle'), properties: ['openDirectory', 'createDirectory'] }) : null;
      if (!pick || !pick[0]) return false;
      writeConfig(Object.assign(readConfig(), { dataDir: dataDirToConfig(pick[0], layout) }));
      continue;
    }
    try {
      store = new Store(wanted);
      store.init();
    } catch (e) {
      const fallback = path.join(app.getPath('userData'), 'notes');
      dialog.showErrorBox(APP_NAME, T('dirFallback', { wanted: wanted, fallback: fallback }));
      store = new Store(fallback);
      store.init();
    }
    // 使用中の印を置き、開いている間は30秒ごとに新しくする(異常終了したときは、古い印として無視される)
    try { datalock.writeLock(store.dir, { pid: process.pid, kind: isPortable ? 'portable' : 'installed', dir: portableDir, started: Date.now() }); } catch (e) { /* 書けなくても動く */ }
    lockTimer = setInterval(() => datalock.touchLock(store.dir), 30 * 1000);
    if (lockTimer.unref) lockTimer.unref();
    return true;
  }
}

/* ---------- ごみ箱 ----------
   ごみ箱の無い場所(USB メモリなどのリムーバブルドライブ、ネットワークのフォルダ)では、Windows は「ごみ箱へ」の操作でも
   元に戻せない形で消してしまう。ドライブの最上位に $Recycle.Bin が無ければ、保存先の .trash フォルダに移す。
   Mac と Linux は OS のごみ箱に入れ、入れられなかったときだけ .trash に移す。 */
const hasRecycleBin = p => { try { return fs.existsSync(path.join(path.parse(path.resolve(p)).root, '$Recycle.Bin')); } catch (e) { return false; } };
async function moveToTrash(p) {
  if (process.platform !== 'win32' || hasRecycleBin(p)) { try { await shell.trashItem(p); return 'recycle'; } catch (e) { /* .trash に移す */ } }
  const dir = path.join(store.dir, '.trash');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  fs.renameSync(p, path.join(dir, stamp + '-' + path.basename(p)));
  return 'folder';
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
  if (store.isReadOnly(id)) return false;   // 読み取り専用のメモは消さない(画面側でも止める)
  try {
    let where = 'recycle';
    for (const p of store.paths(id)) { if ((await moveToTrash(p)) === 'folder') where = 'folder'; }
    store.forget(id);
    return where;   // 'recycle'(ごみ箱)か 'folder'(保存先の .trash)
  } catch (err) { return false; }
});
/* 読み取り専用の付け外し。書き込み待ちの編集は、画面側が先に書き出しておく */
ipcMain.handle('memo:setReadOnly', (e, id, on) => {
  if (!fromOurWindow(e)) return false;
  try { return store.setReadOnly(id, !!on); } catch (err) { return false; }
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
  if (store.isReadOnly(noteId)) return { items: [], errors: [T('roNote')] };
  try { return { items: [saveAttachment(noteId, name, bytes)], errors: [] }; }
  catch (err) { return { items: [], errors: [errText(err)] }; }
});
ipcMain.handle('attach:pick', async (e, noteId) => {
  if (!fromOurWindow(e)) return { items: [], errors: [] };
  if (store.isReadOnly(noteId)) return { items: [], errors: [T('roNote')] };
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

/* 添付を右クリックしたときのメニュー(画像: コピー・開く・場所を開く・名前をつけて保存、ファイル: 開く・場所を開く)。
   選んだ操作の結果を返す(画面側で知らせる)。x, y は右クリックした位置(画像をコピーできない形式のときに使う) */
// 左の一覧(と検索結果)でメモを右クリックしたときのメニュー。先頭に対象の題名を出し、選んだ操作の名前を返す(操作は画面側で行う)
ipcMain.handle('note:menu', (e, title, ro) => {
  if (!fromOurWindow(e)) return null;
  return new Promise(resolve => {
    let chosen = false;
    const pick = key => () => { chosen = true; resolve(key); };
    const menu = Menu.buildFromTemplate([
      { label: menuLabel('「' + String(title || '').slice(0, 40) + '」'), enabled: false },
      { type: 'separator' },
      { label: T('nmOpen'), click: pick('open') },
      { label: T('nmCopyLink'), click: pick('copyLink') },
      { label: T('mExportMenu'), submenu: [
        { label: T('mExportText'), click: pick('exportText') },
        { label: T('mExportPdf'), click: pick('exportPdf') },
        { label: T('mExportHtml'), click: pick('exportHtml') },
        { label: T('mExportMhtml'), click: pick('exportMhtml') },
        { label: T('mExportAdoc'), click: pick('exportAdoc') },
        { label: T('mExportDocx'), click: pick('exportDocx') },
        { label: T('mExportTex'), click: pick('exportTex') },
        { label: T('mExportArchive'), click: pick('exportArchive') }
      ] },
      { type: 'separator' },
      { label: T('mReadOnly'), type: 'checkbox', checked: !!ro, click: pick('readonly') },
      { label: T('nmProps'), click: pick('props') },
      { label: T('nmDelete'), enabled: !ro, click: pick('delete') }
    ]);
    menu.popup({ window: win, callback: () => setTimeout(() => { if (!chosen) resolve(null); }, 300) });
  });
});

// 数式・図を右クリックしたときのメニュー: 元の LaTeX・図の元の文をコピーする(kind: 'math' か 'diagram')。canEdit なら「数式を編集…」も
ipcMain.handle('math:menu', (e, tex, kind, canEdit) => {
  if (!fromOurWindow(e)) return null;
  return new Promise(resolve => {
    let chosen = false;
    const items = [{ label: T(kind === 'diagram' ? 'mCopyDiagram' : 'mCopyTex'), click: async () => {
      chosen = true;
      try { await clipboard.writeText(String(tex || '').slice(0, 100000)); resolve({ status: 'copied' }); } catch (err) { resolve({ status: 'none' }); }
    } }];
    // プレビューの数式(編集できるメモ)は、数式エディタで編集できる
    if (kind === 'math' && canEdit) items.unshift({ label: T('mEditMath'), click: () => { chosen = true; resolve({ status: 'edit' }); } }, { type: 'separator' });
    const menu = Menu.buildFromTemplate(items);
    menu.popup({ window: win, callback: () => setTimeout(() => { if (!chosen) resolve({ status: 'none' }); }, 300) });
  });
});

/* 表の操作のメニュー(プレビューのセルを右クリックしたとき。表の外なら「表を挿入」だけ)。選んだ操作の名前を返す(選ばなければ null) */
const cleanTableState = st => (st && typeof st === 'object' ? { inTable: st.inTable !== false, head: !!st.head, cols: Math.max(1, Math.min(1000, st.cols | 0)), align: ['l', 'c', 'r'].indexOf(st.align) >= 0 ? st.align : '' } : null);
ipcMain.handle('table:menu', (e, st) => {
  if (!fromOurWindow(e)) return null;
  return new Promise(resolve => {
    let chosen = false;
    const menu = Menu.buildFromTemplate(tableItems(T, id => { chosen = true; resolve(id); }, cleanTableState(st) || { head: false, cols: 2, align: '' }, curKeys()));
    menu.popup({ window: win, callback: () => setTimeout(() => { if (!chosen) resolve(null); }, 300) });
  });
});
/* 「テキスト」表示の右クリックの直前に、カーソルの場所(表のセル・数式の中か)を知らせてもらう
   (本文の右クリックのメニューに「数式を挿入…」「数式を編集…」と「表」を足す) */
let editCtx = null;
ipcMain.on('edit:ctx', (e, st) => {
  editCtx = fromOurWindow(e) && st && st.editable ? { table: cleanTableState(st.table), math: !!st.math, t: Date.now() } : null;
  e.returnValue = true;
});

ipcMain.handle('attach:menu', (e, noteId, fileId, name, image, x, y, canTrash) => {
  if (!fromOurWindow(e)) return null;
  const p = store.attachmentPath(noteId, fileId);
  if (!p) return { status: 'missing' };
  const actions = {
    copy: async () => {
      // PNG にしてクリップボードへ(この Electron のクリップボードは ClipboardItem で書き込む)
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]); return { status: 'copied' }; }
      // nativeImage で読めない形式(GIF・WebP など)は、画面に出ている画像をコピーする
      const z = win.webContents.getZoomFactor();
      win.webContents.copyImageAt(Math.round(x * z), Math.round(y * z));
      return { status: 'copied' };
    },
    open: () => {
      if (SAFE_OPEN.test(p)) { shell.openPath(p); return { status: 'opened' }; }
      shell.showItemInFolder(p);
      return { status: 'shown' };
    },
    show: () => { shell.showItemInFolder(p); return { status: 'none' }; },
    trash: () => ({ status: 'trash' }),
    save: async () => {
      const ext = path.extname(p);
      let nm = String(name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 120) || T('file');
      if (ext && path.extname(nm).toLowerCase() !== ext.toLowerCase()) nm += ext;
      const r = await dialog.showSaveDialog(win, { title: T('saveAsTitle'), defaultPath: path.join(exportStartDir(), nm) });
      if (r.canceled || !r.filePath) return { status: 'none' };
      try { fs.copyFileSync(p, r.filePath); rememberDir('export', r.filePath); return { status: 'saved', path: r.filePath }; }
      catch (err) { return { status: 'saveFailed' }; }
    }
  };
  return new Promise(resolve => {
    let chosen = false;
    const wrap = (key, fail) => async () => {
      chosen = true;
      try { resolve((await actions[key]()) || { status: 'none' }); } catch (err) { resolve({ status: fail }); }
    };
    // 「ごみ箱に入れる…」は、選んだことだけを返す(本文のリンクを消すのは画面側なので、確認と削除は attach:trash で行う)
    const tpl = buildAttachTemplate(!!image, { copy: wrap('copy', 'copyFailed'), open: wrap('open', 'none'), show: wrap('show', 'none'), save: wrap('save', 'saveFailed'), trash: canTrash ? wrap('trash', 'none') : null }, lang);
    // 何も選ばずに閉じたとき(クリックの処理より後に呼ばれることがあるので少し待つ)
    Menu.buildFromTemplate(tpl).popup({ window: win, callback: () => setTimeout(() => { if (!chosen) resolve({ status: 'none' }); }, 300) });
  });
});

/* 添付をごみ箱に入れる(編集画面で選んだとき)。確認してから、ファイルをごみ箱へ。refs = 本文の中のこの添付へのリンクの数
   (リンクを消すのは画面側で、「元に戻す」で戻せる)。ファイルは中身から名前が決まるので、ごみ箱から戻せばそのまま表示される */
ipcMain.handle('attach:trash', async (e, noteId, fileId, name, refs) => {
  if (!fromOurWindow(e) || store.isReadOnly(noteId)) return { status: 'failed' };
  const p = store.attachmentPath(noteId, fileId);
  if (!p) return { status: 'missing' };
  const n = Math.max(0, Math.floor(Number(refs) || 0));
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [T('attTrashButton'), T('cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: APP_NAME,
    message: T('attTrashQ', { name: String(name || fileId).slice(0, 120) }),
    detail: T('attTrashDetail', { n: n })
  });
  if (r.response !== 0) return { status: 'cancelled' };
  try { return { status: 'trashed', where: await moveToTrash(p) }; } catch (err) { return { status: 'failed' }; }
});

/* ---------- 古い履歴の削除 ----------
   k = 残す最も古い版(編集の個数で数えた位置)、n = 画面が持っている編集の個数(ファイルと食い違えば中止)。
   確認のダイアログ(初めは「キャンセル」。元に戻せないことを書く)→ 求められればアーカイブに書き出す → 書き換える
   → 残る版で使っていない添付をごみ箱へ。アーカイブを書き出せなかった・やめたときは、何も削除しない */
const fmtBytes = b => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
ipcMain.handle('history:prune', async (e, id, k, n, title) => {
  if (!fromOurWindow(e) || !validId(id) || store.isReadOnly(id)) return { status: 'failed' };
  let plan;
  try { plan = store.prunePlan(id, k, n); } catch (err) { return { status: 'failed' }; }
  const from = plan.base + 1, to = plan.base + plan.removed;
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [T('pruneButton'), T('cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: APP_NAME,
    message: T('pruneQ', { from: from, to: to, n: plan.removed }),
    detail: T('pruneDetail', { keep: to + 1, total: plan.base + n }) + (plan.orphans.length ? T('pruneFiles', { n: plan.orphans.length, size: fmtBytes(plan.bytes) }) : ''),
    checkboxLabel: T('pruneArchive'),
    checkboxChecked: true
  });
  if (r.response !== 0) return { status: 'cancelled' };
  let archive = null;
  if (r.checkboxChecked) {
    const x = await exportArchiveFile(id, title, T('pruneArcSuffix'));
    if (x.status === 'cancelled') return { status: 'cancelled' };
    if (x.status !== 'saved') return { status: 'archiveFailed' };
    archive = x.path;
  }
  let res;
  try { res = store.prune(id, k, n, Date.now()); } catch (err) { return { status: 'failed', archive: archive }; }
  let trashed = 0, where = 'recycle';
  for (const o of res.orphans) { try { if ((await moveToTrash(o.path)) === 'folder') where = 'folder'; trashed++; } catch (err) { /* 残しておく */ } }
  return { status: 'pruned', from: from, to: to, trashed: trashed, where: where, archive: archive };
});

/* ---------- 画面の状態に合わせて、実行できないメニューを押せなくする ----------
   edit: 「テキスト」表示か(リンクの挿入・添付は「テキスト」表示だけ。「検索と置換…」はどの表示でも使え、
   プレビュー・履歴の表示・読み取り専用のメモでは検索だけのバーになる)、fmt: 書式を使えるか(「テキスト」表示と、プレビューでかたまりを編集している間)、lines: 行番号が出る表示か(プレビューでは出ない)、
   back: 「前に見たメモに戻る」で戻れるメモがあるか、hist: 履歴の表示か(古い履歴の削除は履歴の表示だけ)、
   base: いま見ている表示(edit / preview。履歴の表示の中ではその元の表示。「表示」→「編集」「プレビュー」は、いま見ていないほうだけ押せる)、
   ro: 今のメモが読み取り専用か(書式・リンクの挿入・添付・古い履歴の削除を押せなくする)。押せない項目はキー操作も効かない */
let ui = { edit: true, fmt: true, lines: true, back: false, hist: false, base: 'edit', ro: false };
ipcMain.on('ui:state', (e, st) => {
  if (!fromOurWindow(e) || !st) return;
  const next = { edit: !!st.edit, fmt: !!st.fmt, lines: !!st.lines, back: !!st.back, hist: !!st.hist, base: st.base === 'preview' ? 'preview' : 'edit', ro: !!st.ro };
  if (Object.keys(next).every(k => next[k] === ui[k])) return;
  ui = next;
  buildMenu();
});

/* ---------- 最近見たメモ ----------
   一覧は画面側が持ち(保存先ごと)、メモを開くたびに、今のメモを除いた最大10件を送ってくる。ここではメニューを作り直すだけ */
let recentItems = [];
ipcMain.on('recent:set', (e, items) => {
  if (!fromOurWindow(e) || !Array.isArray(items)) return;
  recentItems = items.slice(0, 10).filter(x => x && typeof x.id === 'string').map(x => ({ id: x.id, title: String(x.title || '').slice(0, 60), deleted: !!x.deleted }));
  buildMenu();
});
// メニューの & はアクセスキーの印になるので、文字として出すときは && にする
const menuLabel = t => String(t).replace(/&/g, '&&');
function recentMenu() {
  const items = recentItems.length
    ? recentItems.map(r => ({ label: menuLabel(r.title + (r.deleted ? ' ' + T('recentDeleted') : '')), click: () => send('open:' + r.id) }))
    : [{ label: T('mRecentNone'), enabled: false }];
  return items.concat([{ type: 'separator' }, { label: T('mRecentClear'), enabled: recentItems.length > 0, click: () => send('recent:clear') }]);
}

/* ---------- プロパティ: メモの実体のファイル ---------- */
ipcMain.handle('note:info', (e, id) => {
  if (!fromOurWindow(e) || !validId(id)) return null;
  const st = p => { try { return { path: p, size: fs.statSync(p).size }; } catch (err) { return { path: p, size: null }; } };
  const dir = store.filesDir(id);
  let count = 0, total = 0;
  try { for (const f of fs.readdirSync(dir)) { const s2 = fs.statSync(path.join(dir, f)); if (s2.isFile() && !f.endsWith('.tmp')) { count++; total += s2.size; } } } catch (err) { /* 添付が無い */ }
  return { jsonl: st(store.file(id, '.jsonl')), md: st(store.file(id, '.md')), files: { path: dir, exists: fs.existsSync(dir), count: count, total: total } };
});
ipcMain.handle('note:reveal', (e, id, kind) => {
  if (!fromOurWindow(e) || !validId(id)) return false;
  const p = kind === 'jsonl' ? store.file(id, '.jsonl') : kind === 'md' ? store.file(id, '.md') : kind === 'files' ? store.filesDir(id) : null;
  if (!p || !fs.existsSync(p)) return false;
  shell.showItemInFolder(p);
  return true;
});
ipcMain.handle('app:copyText', async (e, text) => {
  if (!fromOurWindow(e)) return false;
  await clipboard.writeText(String(text || '').slice(0, 4096));
  return true;
});

/* ---------- テキストの取り込み・書き出し ----------
   取り込み: 「送る」メニュー、起動時の引数、メニューから選んだファイルを読み、文字コードを見分けて画面に渡す(メモを作るのは画面側)。
   取り込んだメモは EverPad のメモで、元のファイルとは関係を持たない(どこから取り込んだかも記録しない)。 */
let rendererReady = false;
const pendingImports = [];
function importMessage(r) {
  if (r.reason === 'binary') return T('impBinary');
  if (r.reason === 'tooLarge') return T('impTooLarge', { mb: MAX_IMPORT / 1024 / 1024 });
  return T('impUndecodable', { enc: r.encoding, line: r.line, col: r.col, context: r.context, bytes: r.bytes.join(' ') });
}
function readTextFile(file) {
  const name = path.basename(file);
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { name: name, ok: false, message: T('impNotFile') };
    if (st.size > MAX_IMPORT) return { name: name, ok: false, message: T('impTooLarge', { mb: MAX_IMPORT / 1024 / 1024 }) };
    const r = decodeText(fs.readFileSync(file));
    return r.ok ? { name: name, ok: true, text: r.text, encoding: r.encoding } : { name: name, ok: false, message: importMessage(r) };
  } catch (err) { return { name: name, ok: false, message: T('impReadFailed') }; }
}
/* ---------- アーカイブ(.everpad)のインポート ----------
   同じ ID のメモがあれば「上書き / 新しい ID で取り込む / 中止」を選んでもらう。
   上書きは、いまあるメモのファイルをごみ箱に移してから書く(EverPad からは元に戻せない)。
   インポートしたメモは、取り込んだ時刻を記録して、一覧のいちばん上に出す */
const MAX_ARCHIVE = 1024 * 1024 * 1024;   // 1GB
const pad2 = n => String(n).padStart(2, '0');
function newNoteId() {
  for (;;) {
    const d = new Date();
    const id = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    if (!fs.existsSync(store.file(id, '.jsonl'))) return id;
  }
}
function archiveMessage(e) {
  if (e.code === 'notArchive') return T('arcNotArchive');
  if (e.code === 'newerFormat') return T('arcNewer');
  if (e.code === 'tooLarge') return T('arcTooLarge', { mb: MAX_ARCHIVE / 1024 / 1024 });
  return T('arcBroken');
}
function startsWithZip(file) {
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return b.readUInt32LE(0) === 0x04034b50; } catch (e) { return false; }
}
async function importArchive(file, flushOnce) {
  const name = path.basename(file);
  let arc;
  try {
    if (fs.statSync(file).size > MAX_ARCHIVE) return { name: name, ok: false, message: T('arcTooLarge', { mb: MAX_ARCHIVE / 1024 / 1024 }) };
    const buf = fs.readFileSync(file);
    if (!looksLikeArchive(buf)) return { name: name, ok: false, message: T('arcNotArchive') };
    arc = readArchive(buf);
  } catch (e) { return { name: name, ok: false, message: e.code ? archiveMessage(e) : T('impReadFailed') }; }
  let id = arc.manifest.id, replaced = false;
  if (fs.existsSync(store.file(id, '.jsonl'))) {
    await flushOnce();   // 開いているメモの書き込み待ちの編集を、先に書き出しておく
    const title = titleOf(store.readLatest(id) || '') || T('untitled');
    const r = await dialog.showMessageBox(win, {
      type: 'warning', title: APP_NAME, noLink: true, defaultId: 1, cancelId: 2,
      buttons: [T('arcOverwrite'), T('arcNewId'), T('arcCancel')],
      message: T('arcExistsQ', { title: title }),
      detail: (store.isReadOnly(id) ? T('arcExistsRo') + '\n\n' : '') + T('arcExistsDetail')
    });
    if (r.response === 2) return null;   // 中止(知らせない)
    if (r.response === 0) {
      for (const p of store.paths(id)) {
        try { await moveToTrash(p); } catch (err) { return { name: name, ok: false, message: T('arcWriteFailed') }; }
      }
      store.forget(id);
      replaced = true;
    } else id = newNoteId();
  }
  try { store.importNote(id, arc, Date.now()); } catch (e) { return { name: name, ok: false, message: T('arcWriteFailed') }; }
  return { name: name, ok: true, kind: 'archive', id: id, replaced: replaced };
}
// インポートは順番に1つずつ行う(確認の窓が重ならないように)
let importChain = Promise.resolve();
function importFiles(files) {
  if (!files.length) return;
  if (!rendererReady || !win || win.isDestroyed()) { pendingImports.push(...files); ensureWindow(); return; }
  importChain = importChain.then(() => runImport(files.slice(0, 200))).catch(() => {});
}
async function runImport(files) {
  let flushed = null;
  const flushOnce = () => flushed || (flushed = flushRenderer());
  const items = [];
  for (const file of files) {
    if (startsWithZip(file)) { const r = await importArchive(file, flushOnce); if (r) items.push(r); }
    else items.push(readTextFile(file));
  }
  if (!items.length || !win || win.isDestroyed()) return;
  win.webContents.send('import:texts', items);
  if (win.isMinimized()) win.restore();
  win.focus();
}
ipcMain.on('app:ready', e => {
  if (!fromOurWindow(e)) return;
  rendererReady = true;
  if (!isStore) scheduleStartupCheck();
  for (const name of pendingSends.splice(0)) win.webContents.send('menu', name);
  if (pendingImports.length) importFiles(pendingImports.splice(0));
});
const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'ini', 'json', 'xml', 'html', 'htm'];
async function pickImport() {
  const r = await dialog.showOpenDialog(win, {
    title: T('impPickTitle'),
    defaultPath: importStartDir(),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: T('impFilterSupported'), extensions: ['everpad'].concat(TEXT_EXTS) },
      { name: T('arcFilter'), extensions: ['everpad'] },
      { name: T('impFilterText'), extensions: TEXT_EXTS },
      { name: T('impFilterAll'), extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return;
  rememberDir('import', r.filePaths[0]);
  importFiles(r.filePaths);
}
// 書き出し: UTF-8(BOM なし)、改行は CRLF
ipcMain.handle('export:text', async (e, title, text) => {
  if (!fromOurWindow(e)) return { status: 'failed' };
  const name = (String(title || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || APP_NAME) + '.txt';
  const r = await dialog.showSaveDialog(win, {
    title: T('expTitle'),
    defaultPath: path.join(exportStartDir(), name),
    filters: [{ name: T('expFilterText'), extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }]
  });
  if (r.canceled || !r.filePath) return { status: 'cancelled' };
  try {
    fs.writeFileSync(r.filePath, String(text).replace(/\n/g, '\r\n'), 'utf8');
    rememberDir('export', r.filePath);
    return { status: 'saved', path: r.filePath };
  } catch (err) { return { status: 'failed' }; }
});

// EverPad アーカイブとしてエクスポート(本文・全履歴・添付を1つのファイルに)
ipcMain.handle('export:archive', (e, id, title) => {
  if (!fromOurWindow(e) || !validId(id)) return { status: 'failed' };
  return exportArchiveFile(id, title);
});
/* 保存先を尋ねて、アーカイブを書く。{ status: 'saved' | 'cancelled' | 'failed', path } (古い履歴を削除する前にも使う) */
async function exportArchiveFile(id, title, suffix) {
  let data;
  try {
    const jsonl = fs.readFileSync(store.file(id, '.jsonl'));
    const head = JSON.parse(jsonl.toString('utf8').split('\n')[0]);
    const dir = store.filesDir(id), files = [];
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { if (validFileId(f)) files.push({ fileId: f, data: fs.readFileSync(path.join(dir, f)) }); }
    data = buildArchive({ id: id, title: String(title || ''), created: head.c, jsonl: jsonl, md: store.readLatest(id) || '', files: files }, app.getVersion());
  } catch (err) { return { status: 'failed' }; }
  const name = (String(title || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || APP_NAME) + (suffix || '') + '.everpad';
  const r = await dialog.showSaveDialog(win, {
    title: T('arcExportTitle'),
    defaultPath: path.join(exportStartDir(), name),
    filters: [{ name: T('arcFilter'), extensions: ['everpad'] }]
  });
  if (r.canceled || !r.filePath) return { status: 'cancelled' };
  try { fs.writeFileSync(r.filePath, data); rememberDir('export', r.filePath); return { status: 'saved', path: r.filePath }; }
  catch (err) { return { status: 'failed' }; }
}

/* ---------- 「送る」メニュー ---------- */
const sendToLink = () => sendToPath(app.getPath('appData'), isPortable ? APP_NAME + ' (Portable)' : APP_NAME);
function setSendTo(on) {
  const link = sendToLink();
  try {
    if (on) {
      const t = shortcutTarget({ isPackaged: app.isPackaged, execPath: process.execPath, portableExe: process.env.PORTABLE_EXECUTABLE_FILE, appPath: app.getAppPath() });
      fs.mkdirSync(path.dirname(link), { recursive: true });
      if (!shell.writeShortcutLink(link, 'create', { target: t.target, args: t.args, description: APP_NAME, icon: t.target, iconIndex: 0 })) throw new Error('shortcut');
    } else if (fs.existsSync(link)) fs.unlinkSync(link);
  } catch (err) { dialog.showErrorBox(APP_NAME, T('sendToFailed')); }
  buildMenu();
}

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
ipcMain.handle('print:pdf', async (e, title) => {
  if (!fromOurWindow(e)) return { status: 'failed' };
  const name = (String(title || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || APP_NAME) + '.pdf';
  const r = await dialog.showSaveDialog(win, {
    title: T('pdfSaveTitle'),
    defaultPath: path.join(exportStartDir(), name),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { status: 'cancelled' };
  try {
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: paperSize() });
    fs.writeFileSync(r.filePath, data);
    rememberDir('export', r.filePath);
    return { status: 'saved', path: r.filePath };
  } catch (err) { return { status: 'failed' }; }
});

/* Web ページ(HTML か MHTML)として書き出す。本文は画面側で整形した HTML(画像は cid:<ファイルID>@everpad で参照)。
   画像はこのメモの添付から読み、数式があれば KaTeX の CSS とフォントも入れる。
   HTML は画像とフォントを data: で埋め込んだ1つのファイル、MHTML は別の部分として入れた1つのファイル */
const PAGE_KINDS = {
  html: { ext: 'html', title: 'htmlSaveTitle', filter: { name: 'HTML', extensions: ['html', 'htm'] } },
  mhtml: { ext: 'mhtml', title: 'mhtmlSaveTitle', filter: { name: 'MHTML', extensions: ['mhtml', 'mht'] } },
  adoc: { ext: 'adoc', title: 'adocSaveTitle', filter: { name: 'AsciiDoc', extensions: ['adoc', 'asciidoc'] } },
  docx: { ext: 'docx', title: 'docxSaveTitle', filter: { name: 'Word', extensions: ['docx'] } },
  tex: { ext: 'tex', title: 'texSaveTitle', filter: { name: 'LaTeX', extensions: ['tex'] } }
};
ipcMain.handle('export:page', async (e, id, p, kind) => {
  const k = Object.prototype.hasOwnProperty.call(PAGE_KINDS, kind) ? PAGE_KINDS[kind] : null;
  if (!fromOurWindow(e) || !k || !validId(id) || !p || typeof p.bodyHtml !== 'string' || p.bodyHtml.length > 50 * 1024 * 1024) return { status: 'failed' };
  const title = String(p.title || '');
  const name = (title.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80) || APP_NAME) + '.' + k.ext;
  const r = await dialog.showSaveDialog(win, {
    title: T(k.title),
    defaultPath: path.join(exportStartDir(), name),
    filters: [k.filter]
  });
  if (r.canceled || !r.filePath) return { status: 'cancelled' };
  if (kind === 'adoc' || kind === 'docx' || kind === 'tex') {
    try {
      await writeDocFile(id, title, p.bodyHtml, kind, r.filePath);
      rememberDir('export', r.filePath);
      return { status: 'saved', path: r.filePath };
    } catch (err) { return { status: 'failed' }; }
  }
  try {
    const parts = [];
    for (const f of pageexport.referencedImages(p.bodyHtml)) {
      const fp = store.attachmentPath(id, f);
      if (fp) parts.push({ cid: pageexport.cidOf(f), type: pageexport.imageType(f), data: fs.readFileSync(fp) });
    }
    let kx = null;
    if (/class="katex/.test(p.bodyHtml)) {
      const dir = path.join(__dirname, 'renderer', 'vendor', 'katex');
      kx = pageexport.katexCss(fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8'));
      for (const f of kx.fonts) parts.push({ cid: pageexport.cidOf(f), type: 'font/woff2', data: fs.readFileSync(path.join(dir, 'fonts', f)) });
    }
    const html = pageexport.pageHtml({
      lang: lang, title: title, head: String(p.head || ''), foot: String(p.foot || ''), bodyHtml: p.bodyHtml,
      generator: APP_NAME + ' ' + app.getVersion(),
      css: pageexport.exportCss(fs.readFileSync(path.join(__dirname, 'renderer', 'styles.css'), 'utf8')),
      katexCss: kx && kx.css
    });
    const data = kind === 'html' ? pageexport.buildHtml({ html: html, parts: parts }) : pageexport.buildMhtml({ title: title, html: html, parts: parts });
    fs.writeFileSync(r.filePath, data);
    rememberDir('export', r.filePath);
    return { status: 'saved', path: r.filePath };
  } catch (err) { return { status: 'failed' }; }
});

/* AsciiDoc・Word・LaTeX として書き出す(本文の HTML の決まりは docexport.js を参照)。
   AsciiDoc: 画像は「(ファイル名)_images」フォルダーに写して、.adoc から参照する。
   Word: 画像はファイルの中に入れる。Word が読めない WebP・AVIF は PNG にして入れる。
   LaTeX: 画像と図の PNG は「(ファイル名)_images」フォルダーに置く(LaTeX で困る文字は _ にする)。LuaLaTeX が読めない形式の画像は PNG にする。
   PNG にできなかった画像は、.tex では [画像の説明] の文字になる */
async function writeDocFile(id, title, bodyHtml, kind, filePath) {
  const tree = docexport.bodyTree(bodyHtml);
  const files = docexport.treeImages(tree).filter(f => store.attachmentPath(id, f));
  if (kind === 'adoc') {
    const dirName = path.basename(filePath, path.extname(filePath)).replace(/[{}[\]]/g, '_') + '_images';
    const text = docexport.toAsciiDoc(tree, { title: title, imagesDir: files.length ? dirName : '' });
    if (files.length) {
      const dir = path.join(path.dirname(filePath), dirName);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) fs.copyFileSync(store.attachmentPath(id, f), path.join(dir, f));
    }
    fs.writeFileSync(filePath, text);
    return;
  }
  if (kind === 'tex') {
    const dirName = docexport.texImagesDir(path.basename(filePath, path.extname(filePath)));
    const out = [], names = {}, convert = [];
    for (const f of files) {
      if (docexport.texImageOk(f)) { names[f] = f; out.push({ name: f, from: store.attachmentPath(id, f) }); }
      else convert.push({ f: f, data: fs.readFileSync(store.attachmentPath(id, f)), type: pageexport.imageType(f) });
    }
    if (convert.length) {
      const pngs = await imagesToPng(convert);
      convert.forEach((c, k) => { if (pngs[k]) { const name = c.f.replace('.', '-') + '.png'; names[c.f] = name; out.push({ name: name, data: pngs[k] }); } });
    }
    for (const d of docexport.texDiagrams(tree)) out.push({ name: d.file, data: Buffer.from(d.png, 'base64') });
    const text = docexport.toLatex(tree, { title: title, imagesDir: out.length ? dirName : '', images: names, paper: paperSize(), lang: lang, generator: APP_NAME + ' ' + app.getVersion() });
    if (out.length) {
      const dir = path.join(path.dirname(filePath), dirName);
      fs.mkdirSync(dir, { recursive: true });
      for (const o of out) { if (o.from) fs.copyFileSync(o.from, path.join(dir, o.name)); else fs.writeFileSync(path.join(dir, o.name), o.data); }
    }
    fs.writeFileSync(filePath, text);
    return;
  }
  const images = {}, convert = [];
  for (const f of files) {
    const ext = docexport.docxImageExt(f);
    const data = fs.readFileSync(store.attachmentPath(id, f));
    if (ext) images[f] = { data: data, ext: ext };
    else convert.push({ f: f, data: data, type: pageexport.imageType(f) });
  }
  if (convert.length) {
    const pngs = await imagesToPng(convert);
    convert.forEach((c, k) => { if (pngs[k]) images[c.f] = { data: pngs[k], ext: 'png' }; });
  }
  fs.writeFileSync(filePath, docexport.toDocx(tree, { title: title, lang: lang, paper: paperSize(), generator: APP_NAME + ' ' + app.getVersion(), images: images }));
}
/* 画像(WebP・AVIF など)を PNG にする。表示しない窓で、data: の画像を canvas に描いて PNG にする。
   読めなかったものは null */
async function imagesToPng(list) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await w.loadURL('about:blank');
    const out = [];
    for (const it of list) {
      const src = 'data:' + (it.type || 'image/png') + ';base64,' + it.data.toString('base64');
      const url = await w.webContents.executeJavaScript('new Promise(r => { const i = new Image(); i.onload = () => { try { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext("2d").drawImage(i, 0, 0); r(c.toDataURL("image/png")); } catch (e) { r(""); } }; i.onerror = () => r(""); i.src = ' + JSON.stringify(src) + '; })');
      out.push(/^data:image\/png;base64,/.test(url) ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : null);
    }
    return out;
  } catch (err) {
    return list.map(() => null);
  } finally { w.destroy(); }
}

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
/* Mac ではウィンドウを閉じてもアプリが残るので、ウィンドウが無いときにメニューやファイルが来たら、ウィンドウを開いてから渡す */
let pendingSends = [];
function ensureWindow() {
  if (!isMac || quitting || !store || !app.isReady() || (win && !win.isDestroyed())) return;
  createWindow();
}
const send = name => {
  if (win && !win.isDestroyed()) win.webContents.send('menu', name);
  else if (isMac && !quitting) { pendingSends.push(name); ensureWindow(); }
};

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
  writeConfig(Object.assign(readConfig(), { dataDir: dataDirToConfig(r.filePaths[0], layout) }));
  closing = true;
  app.relaunch();
  app.quit();
}

/* ---------- 改行と字下げの設定(「編集」メニュー) ----------
   自動インデント・箇条書きを自動で続ける(どちらも既定はオン)、Tab での字下げの幅(2 か 4、既定は 4)。config.json に覚える */
function editPrefs() {
  const c = readConfig().editor || {};
  return { autoIndent: c.autoIndent !== false, autoList: c.autoList !== false, indentWidth: c.indentWidth === 2 ? 2 : 4 };
}
function setEditPref(key, value) {
  const p = Object.assign(editPrefs(), { [key]: value });
  try { writeConfig(Object.assign(readConfig(), { editor: p })); } catch (e) { /* 覚えられなくても、今回は使う */ }
  buildMenu();
  if (win && !win.isDestroyed()) win.webContents.send('menu', 'prefs:' + JSON.stringify(p));
}

/* ---------- キーボードショートカット(「編集」→「キーボードショートカット…」) ----------
   キーの一覧と判定は keymap.js。変えたキーは config.json の keys に覚える(パソコンごと。メモのフォルダには入れない)。
   キーを割り当てている間は、押したキーをメニューにも画面にも渡さずに main.js が読み(before-input-event)、画面に知らせる */
let keyMap = null;
const curKeys = () => keyMap || (keyMap = keymap.resolve(readConfig().keys, process.platform));
const keyDefaults = keymap.defaults(process.platform);
const keyShown = () => { const KM = curKeys(), o = {}; for (const c of keymap.COMMANDS) o[c.id] = keymap.display(KM[c.id], process.platform); return o; };
/* 拡大・縮小・全画面: キーが既定のままなら Electron の役割に任せ、変えたら自分で動かす(役割の既定のキーを使わないため) */
const ROLE_RUN = {
  zoomIn: wc => wc.setZoomLevel(wc.getZoomLevel() + 0.5),
  zoomOut: wc => wc.setZoomLevel(wc.getZoomLevel() - 0.5),
  resetZoom: wc => wc.setZoomLevel(0)
};
function roleItem(KM, id, label) {
  const c = keymap.COMMANDS.find(x => x.id === id);
  if (KM[id] === keyDefaults[id]) return { role: c.role, label: label };
  return {
    label: label,
    accelerator: KM[id] || undefined,
    click: () => {
      const w = BrowserWindow.getFocusedWindow() || win;
      if (!w || w.isDestroyed()) return;
      if (id === 'fullscreen') w.setFullScreen(!w.isFullScreen());
      else ROLE_RUN[id](w.webContents);
    }
  };
}
const keyGroup = c => c.group.split('>').map(g => T(g)).join(' › ');
function keysList() {
  const KM = curKeys(), P = process.platform;
  return {
    items: keymap.COMMANDS.map(c => ({
      id: c.id, group: keyGroup(c), label: T(c.label),
      shown: keymap.display(KM[c.id], P), def: keymap.display(keyDefaults[c.id], P), changed: KM[c.id] !== keyDefaults[c.id], has: !!KM[c.id]
    })),
    fixed: keymap.fixedKeys(P).map(f => ({ label: T(f.label), shown: f.keys.map(k => keymap.display(k, P)).join(' / ') }))
  };
}
function saveKeys(next) {
  try { writeConfig(Object.assign(readConfig(), { keys: next })); } catch (e) { /* 覚えられなくても、今回は使う */ }
  keyMap = keymap.resolve(next, process.platform);
  buildMenu();
  if (win && !win.isDestroyed()) win.webContents.send('menu', 'keys:' + JSON.stringify(keyShown()));
  if (helpWin && !helpWin.isDestroyed()) loadHelp();
}
let keyCapture = null;   // キーを割り当て中の操作の id
ipcMain.on('keys:capture', (e, id) => {
  if (!fromOurWindow(e)) return;
  keyCapture = typeof id === 'string' && keymap.COMMANDS.some(c => c.id === id) ? id : null;
});
ipcMain.handle('keys:list', e => (fromOurWindow(e) ? keysList() : null));
// accel: 新しいキー('' はキーなし、null は既定に戻す)。重なる操作はキーなしにする
ipcMain.handle('keys:set', (e, id, accel) => {
  if (!fromOurWindow(e) || typeof id !== 'string' || !(accel === null || typeof accel === 'string')) return null;
  if (accel && keymap.check(accel, process.platform)) return keysList();
  saveKeys(keymap.assign(readConfig().keys, id, accel, process.platform));
  return keysList();
});
ipcMain.handle('keys:resetAll', async e => {
  if (!fromOurWindow(e)) return null;
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: [T('keysResetAllButton'), T('cancel')], defaultId: 0, cancelId: 1,
    title: APP_NAME, icon: ICON, message: T('keysResetAllQ')
  });
  if (r.response !== 0) return null;
  saveKeys({});
  return keysList();
});
/* 割り当て中に押したキーを読んで、画面に知らせる。Esc はやめる、Enter は決める(どちらも修飾キーなし) */
function onCaptureInput(e, input) {
  if (!keyCapture || (input.type !== 'keyDown' && input.type !== 'keyUp')) return;
  e.preventDefault();
  if (input.type !== 'keyDown') return;
  const P = process.platform;
  const plain = !input.control && !input.alt && !input.meta && !input.shift;
  let r;
  if (plain && input.code === 'Escape') r = { cancel: true };
  else if (plain && (input.code === 'Enter' || input.code === 'NumpadEnter')) r = { enter: true };
  else {
    const f = keymap.fromInput(input, P);
    const pre = f.prefix ? keymap.display(f.prefix + '+…', P) : '';
    if (f.mods) r = { partial: pre };
    else if (f.bad) r = { shown: pre, error: f.win ? 'winKey' : 'badKey' };
    else {
      const err = keymap.check(f.accel, P);
      const other = err ? null : keymap.conflictOf(readConfig().keys, keyCapture, f.accel, P);
      const oc = other && keymap.COMMANDS.find(c => c.id === other);
      r = { accel: f.accel, shown: keymap.display(f.accel, P), error: err, conflict: oc ? T(oc.label) : null };
    }
  }
  if (win && !win.isDestroyed()) win.webContents.send('keys:captured', r);
}

function buildMenu() {
  const ep = editPrefs();
  const KM = curKeys();
  const A = id => KM[id] || undefined;   // メニューのキー(キーなしは undefined)
  const template = [
    {
      label: T('mFile'),
      submenu: [
        { label: T('mNewNote'), accelerator: A('new'), click: () => send('new') },
        { label: T('mSearchAll'), accelerator: A('search'), click: () => send('search') },
        { type: 'separator' },
        { label: T('mRecent'), submenu: recentMenu() },
        { id: 'back', label: T('mBack'), accelerator: A('back'), enabled: ui.back, click: () => send('back') },
        { type: 'separator' },
        { label: T('mImport'), accelerator: A('import'), click: pickImport },
        { label: T('mExportMenu'), submenu: [
          { label: T('mExportText'), accelerator: A('export'), click: () => send('export') },
          { label: T('mExportPdf'), accelerator: A('pdf'), click: () => send('pdf') },
          { label: T('mExportHtml'), accelerator: A('html'), click: () => send('html') },
          { label: T('mExportMhtml'), accelerator: A('mhtml'), click: () => send('mhtml') },
          { label: T('mExportAdoc'), accelerator: A('adoc'), click: () => send('adoc') },
          { label: T('mExportDocx'), accelerator: A('docx'), click: () => send('docx') },
          { label: T('mExportTex'), accelerator: A('tex'), click: () => send('tex') },
          { label: T('mExportArchive'), accelerator: A('archive'), click: () => send('archive') }
        ] },
        { label: T('mPrint'), accelerator: A('print'), click: () => send('print') },
        { type: 'separator' },
        { id: 'readonly', label: T('mReadOnly'), type: 'checkbox', checked: ui.ro, accelerator: A('readonly'), click: () => send('readonly') },
        { id: 'props', label: T('mProps'), accelerator: A('props'), click: () => send('props') },
        { type: 'separator' },
        { label: T('mOpenDir'), accelerator: A('openDir'), click: () => shell.openPath(store.dir) },
        { label: T('mChangeDir'), click: changeFolder },
        ...(process.platform === 'win32' && !isStore ? [{ label: T('mSendTo'), type: 'checkbox', checked: fs.existsSync(sendToLink()), click: item => setSendTo(item.checked) }] : []),
        { type: 'separator' },
        { id: 'quit', role: 'quit', label: T('mQuit') }
      ]
    },
    {
      label: T('mEdit'),
      submenu: [
        { role: 'undo', label: T('mUndo') },
        { role: 'redo', label: T('mRedo') },
        { type: 'separator' },
        { label: T('mAttach'), accelerator: A('attach'), enabled: ui.edit && !ui.ro, click: () => send('attach') },
        { id: 'replace', label: T('mReplace'), accelerator: A('replace'), click: () => send('replace') },
        { label: T('mFormat'), enabled: ui.fmt && !ui.ro, submenu: inlineItems(T, kind => send('fmt:' + kind), process.platform, KM).concat([{ type: 'separator' }], formatItems(T, kind => send('fmt:' + kind), process.platform, KM)).map(x => Object.assign(x, { enabled: ui.fmt && !ui.ro })) },
        { label: T('mInsertLink'), accelerator: A('link'), enabled: ui.edit && !ui.ro, click: () => send('link') },
        { label: T('mInsertMath'), accelerator: A('math'), enabled: !ui.hist && !ui.ro, click: () => send('math') },
        { label: T('mTable'), enabled: !ui.hist && !ui.ro, submenu: tableItems(T, id => send('tbl:' + id), null, KM).map(x => (x.type === 'separator' || x.submenu ? x : Object.assign(x, { enabled: !ui.hist && !ui.ro }))) },
        { type: 'separator' },
        { label: T('mAutoIndent'), type: 'checkbox', checked: ep.autoIndent, click: item => setEditPref('autoIndent', item.checked) },
        { label: T('mAutoList'), type: 'checkbox', checked: ep.autoList, click: item => setEditPref('autoList', item.checked) },
        { label: T('mIndentWidth'), submenu: [
          { label: T('mIndent2'), type: 'radio', checked: ep.indentWidth === 2, click: () => setEditPref('indentWidth', 2) },
          { label: T('mIndent4'), type: 'radio', checked: ep.indentWidth === 4, click: () => setEditPref('indentWidth', 4) }
        ] },
        { label: T('mKeys'), click: () => send('keys') },
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
        { label: T('mModeEdit'), accelerator: A('mode:edit'), enabled: ui.base !== 'edit', click: () => send('mode:edit') },
        { label: T('mModePreview'), accelerator: A('mode:preview'), enabled: ui.base !== 'preview', click: () => send('mode:preview') },
        { label: T('mModeHistory'), accelerator: A('mode:history'), click: () => send('mode:history') },
        { label: T('mPrune'), accelerator: A('prune'), enabled: ui.hist && !ui.ro, click: () => send('prune') },
        { label: T('mSide'), accelerator: A('side'), click: () => send('side') },
        { label: T('mLines'), accelerator: A('lines'), enabled: ui.lines, click: () => send('lines') },
        { type: 'separator' },
        roleItem(KM, 'zoomIn', T('mZoomIn')),
        roleItem(KM, 'zoomOut', T('mZoomOut')),
        roleItem(KM, 'resetZoom', T('mZoomReset')),
        { type: 'separator' },
        roleItem(KM, 'fullscreen', T('mFullscreen')),
        { type: 'separator' },
        { label: T('mLanguage'), submenu: [
          { label: '日本語', type: 'radio', checked: lang === 'ja', click: () => setLang('ja') },
          { label: 'English', type: 'radio', checked: lang === 'en', click: () => setLang('en') }
        ] },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', label: T('mDevTools') }])
      ]
    },
    {
      id: 'help',
      label: T('mHelp'),
      submenu: [
        { label: T('mMdHelp'), accelerator: A('mdHelp'), click: showMdHelp },
        { type: 'separator' },
        ...(isStore ? [] : [
          { label: T('mCheckUpdate'), click: () => checkForUpdates(true) },
          { label: T('mCheckOnStart'), type: 'checkbox', checked: updater.updatePrefs(readConfig()).checkOnStart, click: item => setUpdatePref({ checkOnStart: item.checked }) },
          { type: 'separator' }
        ]),
        { id: 'about', label: T('mAbout'), click: showAbout }
      ]
    }
  ];
  // Mac は、アプリ名のメニューとウインドウのメニューを足した Mac の形にする(macmenu.js)
  Menu.setApplicationMenu(Menu.buildFromTemplate(isMac ? macTemplate(template, { T: T, appName: APP_NAME }) : template));
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
  if (helpWin && !helpWin.isDestroyed()) { helpWin.setTitle(T('mdHelpTitle')); loadHelp(); }
  if (win && !win.isDestroyed()) { await flushRenderer(); loadPage(); }
}
// os: 画面で、ショートカットキーの書き方(Mac は ⌘)と、リンクを開く Ctrl/⌘+クリックを切り替える
const loadPage = () => { rendererReady = false; return win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: Object.assign({ lang: lang, os: process.platform, kd: JSON.stringify(keyShown()) }, editQuery()) }); };
// 画面に渡す改行と字下げの設定(ai: 自動インデント、al: 箇条書きを続ける、iw: 字下げの幅)
const editQuery = () => { const p = editPrefs(); return { ai: p.autoIndent ? '1' : '0', al: p.autoList ? '1' : '0', iw: String(p.indentWidth) }; };

/* ---------- Markdown の書き方(別ウィンドウ) ---------- */
let helpWin = null;
// kl: 「メモへのリンクを挿入…」のキー(説明文の Ctrl+K を、いまのキーにする)
const loadHelp = () => helpWin.loadFile(path.join(__dirname, 'renderer', 'help.html'), { query: { lang: lang, os: process.platform, kl: keyShown().link } });
function showMdHelp() {
  if (helpWin && !helpWin.isDestroyed()) { if (helpWin.isMinimized()) helpWin.restore(); helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 1000, height: 780, minWidth: 480, minHeight: 360,
    title: T('mdHelpTitle'),
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D1224' : '#EEF2FA',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  helpWin.removeMenu();
  loadHelp();
  helpWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  helpWin.webContents.on('will-navigate', e => e.preventDefault());
  helpWin.webContents.on('context-menu', (_e, params) => {
    const tpl = buildTemplate(params, { lang: lang });
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: helpWin });
  });
  helpWin.on('closed', () => { helpWin = null; });
}

/* ---------- バージョン情報 ---------- */
const HOMEPAGE = 'https://github.com/nihongi/everpad/';   // 公開場所
async function showAbout() {
  const r = await dialog.showMessageBox(win, {
    type: 'info',
    title: T('aboutTitle'),
    message: T('aboutVersion', { v: app.getVersion() }),
    detail: 'Electron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome + ' / Node.js ' + process.versions.node + '\n'
      + T('aboutDataDir', { dir: store.dir }) + '\n\n'
      + HOMEPAGE + '\n\n'
      + 'Copyright (c) 2026 Nobuyoshi NIHONGI\nMIT License',
    buttons: [T('aboutOpenSite'), 'OK'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (r.response === 0) shell.openExternal(HOMEPAGE);
}

/* ---------- 更新の確認(updatecheck.js) ----------
   起動時(「ヘルプ」→「起動時に更新を確認する」がオンのとき)と、「ヘルプ」→「更新を確認…」で、GitHub の最新の release を調べる。
   net.fetch は Chromium の通信を使うので、Windows のシステムのプロキシ設定(PAC や自動検出を含む)がそのまま使われる。
   起動時は、新しい版があるときだけ知らせる(つながらないときは何も出さない)。手動のときは、結果をいつも出す */
let startupCheckScheduled = false;
let updateChecking = false;
// 開発中(npm start)だけ、確かめるための別の URL を使える。配布版では使わない
const updateUrl = () => (!app.isPackaged && process.env.EVERPAD_UPDATE_URL) || updater.LATEST_API;
function setUpdatePref(change) {
  try { const c = readConfig(); c.update = Object.assign(updater.updatePrefs(c), change); writeConfig(c); } catch (e) { /* 覚えられなくても動く */ }
  buildMenu();
}
function scheduleStartupCheck() {
  if (startupCheckScheduled) return;
  startupCheckScheduled = true;
  if (!updater.updatePrefs(readConfig()).checkOnStart) return;
  setTimeout(() => checkForUpdates(false), 5000);   // 起動の邪魔をしないよう、少し待つ
}
async function checkForUpdates(manual) {
  if (updateChecking) return;
  updateChecking = true;
  let r;
  try {
    r = await updater.checkLatest({ fetch: (url, init) => net.fetch(url, init), current: app.getVersion(), url: updateUrl(), userAgent: APP_NAME + '/' + app.getVersion() });
  } catch (e) {
    r = { status: 'error', code: 'bad', message: String((e && e.message) || e) };
  } finally {
    updateChecking = false;
  }
  const parent = win && !win.isDestroyed() ? win : null;
  const box = opts => (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
  const base = { title: T('updTitle'), icon: ICON, noLink: true };
  if (r.status === 'newer') {
    const prefs = updater.updatePrefs(readConfig());
    if (!manual && !updater.shouldNotifyAtStart(r, prefs)) return;
    const isWin = process.platform === 'win32';
    const res = await box(Object.assign({}, base, {
      type: 'info',
      message: T('updNewer', { latest: r.latest }),
      detail: T('updCurrent', { current: r.current }) + '\n' + T(isWin ? 'updDetailWin' : 'updDetailOther'),
      buttons: [T(isWin ? 'updOpen' : 'aboutOpenSite'), T('updLater')],
      defaultId: 0,
      cancelId: 1,
      // 起動時だけ「この版は今後知らせない」を出す(手動で確かめたときは、いつも結果を出す)
      ...(manual ? {} : { checkboxLabel: T('updSkip', { latest: r.latest }), checkboxChecked: false })
    }));
    if (!manual && res.checkboxChecked) setUpdatePref({ skip: r.latest });
    if (res.response === 0) shell.openExternal(updater.downloadUrl(process.platform));
    return;
  }
  if (!manual) return;
  if (r.status === 'latest') {
    await box(Object.assign({}, base, { type: 'info', message: T('updLatest'), detail: T('updLatestDetail', { current: r.current }), buttons: ['OK'] }));
    return;
  }
  const why = r.code === 'rate' ? T('updErrRate') : r.code === 'http' ? T('updErrHttp', { status: r.httpStatus }) : r.code === 'bad' ? T('updErrBad') : r.code === 'timeout' ? T('updErrTimeout') : T('updErrNet');
  const res = await box(Object.assign({}, base, {
    type: 'warning',
    message: T('updError'),
    // 接続できなかったときだけ、Chromium のエラー名(net::ERR_PROXY_CONNECTION_FAILED など)を添える
    detail: why + (r.code === 'net' && r.message ? '\n\n' + r.message : ''),
    buttons: [T('aboutOpenSite'), 'OK'],
    defaultId: 1,
    cancelId: 1
  }));
  if (res.response === 0) shell.openExternal(updater.downloadUrl(process.platform));
}

/* ---------- ウィンドウ ---------- */
function createWindow() {
  closing = false;   // Mac で、閉じたあとに開き直したとき
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
  // キーボードショートカットの割り当て中は、押したキーを main.js が読む(画面を読み込み直したらやめる)
  win.webContents.on('before-input-event', onCaptureInput);
  win.webContents.on('did-start-loading', () => { keyCapture = null; });

  // 右クリック: Electronには標準のメニューが無いので、切り取り・コピー・貼り付けなどを自前で出す
  win.webContents.on('context-menu', (_e, params) => {
    const ctx = editCtx && Date.now() - editCtx.t < 3000 ? editCtx : null;
    editCtx = null;
    const tpl = buildTemplate(params, { onSelectAll: () => send('selectall'), onFormat: kind => send('fmt:' + kind), onTable: id => send('tbl:' + id), table: ctx && ctx.table, onMath: ctx ? () => send('math') : null, inMath: !!(ctx && ctx.math), lang: lang, keys: curKeys() });
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
  win.on('closed', () => { win = null; if (helpWin && !helpWin.isDestroyed()) helpWin.close(); });
}

/* ---------- 起動 ---------- */
// 同じ保存先を2つのウィンドウで同時に書かないよう、起動は1つだけにする
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    importFiles(filesFromArgv(argv, { isPackaged: app.isPackaged, appPath: app.getAppPath(), cwd: cwd }).map(f => path.resolve(cwd || '.', f)));
  });
  // Mac: Finder でダブルクリック、「このアプリケーションで開く」、Dock のアイコンへのドラッグで来たファイル。
  // 起動の途中でも来るので、ここで登録する(画面の準備ができてから取り込む)
  app.on('open-file', (e, file) => { e.preventDefault(); importFiles([path.resolve(file)]); });
  // タスクバーでアイコンと名前が正しく出るように。Store 版は Windows がパッケージの ID を付けるので変えない(変えると、ピン留めやアイコンがパッケージと結び付かない)
  if (process.platform === 'win32' && !isStore) app.setAppUserModelId(isPortable ? APP_ID + '.portable' : APP_ID);
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
    if (!openStore()) { app.exit(0); return; }
    // portable 版を書き込めない場所に置いたときは、設定とメモの場所を一度だけ知らせる
    if (layout.mode === 'portableFallback' && !readConfig().portableFallbackNotified) {
      dialog.showMessageBoxSync({ type: 'info', title: APP_NAME, noLink: true, buttons: ['OK'], message: T('portableFallback'), detail: T('portableFallbackDetail', { dir: portableDir, settings: app.getPath('userData'), notes: store.dir }) });
      writeConfig(Object.assign(readConfig(), { portableFallbackNotified: true }));
    }
    buildMenu();
    createWindow();
    // 「送る」やアイコンへのドラッグ&ドロップで起動されたときのファイル(画面の準備ができてから取り込む)
    importFiles(filesFromArgv(process.argv, { isPackaged: app.isPackaged, appPath: app.getAppPath(), cwd: process.cwd() }).map(f => path.resolve(f)));
  });
  // Windows と Linux は、ウィンドウを閉じたら終わる。Mac はアプリを残し(Dock とメニューバー)、⌘Q で終わる
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!isMac || quitting) app.quit(); });
  // Mac: Dock のアイコンを押したとき、ウィンドウが無ければ開く
  app.on('activate', () => ensureWindow());
  app.on('will-quit', () => {
    try { store.writeIndex(); } catch (e) { /* 索引は控え */ }
    if (store) datalock.releaseLock(store.dir, process.pid);
  });
}
