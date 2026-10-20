'use strict';
/* Windows の「送る」メニューへの登録と、起動時に渡されたファイルの取り出し(Electron に依存しないので、テストできる) */
const path = require('path');

/* 「送る」メニューのショートカットの場所(%APPDATA%\Microsoft\Windows\SendTo\EverPad.lnk) */
function sendToPath(appData, appName) {
  return path.join(appData, 'Microsoft', 'Windows', 'SendTo', (appName || 'EverPad') + '.lnk');
}

/* ショートカットが起動するもの。
   portable 版は実行のたびに一時フォルダへ展開されて動くので、展開前の実行ファイル(PORTABLE_EXECUTABLE_FILE)を指す。
   開発中(npm start)は electron.exe にアプリのフォルダを渡す */
function shortcutTarget(o) {
  if (o.portableExe) return { target: o.portableExe, args: '' };
  if (o.isPackaged) return { target: o.execPath, args: '' };
  return { target: o.execPath, args: '"' + o.appPath + '"' };
}

/* 起動時の引数から、取り込むファイルを取り出す。
   先頭は実行ファイル(開発中は electron.exe とアプリのフォルダ)。- で始まるのは Electron・Chromium の起動オプション */
function filesFromArgv(argv, o) {
  const rest = (argv || []).slice(1).filter(a => typeof a === 'string' && a && !a.startsWith('-'));
  if (o && !o.isPackaged) {
    const app = path.resolve(o.appPath || '.');
    return rest.filter(a => path.resolve(o.cwd || '.', a) !== app);
  }
  return rest;
}

module.exports = { sendToPath, shortcutTarget, filesFromArgv };
