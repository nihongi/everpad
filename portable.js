'use strict';
/* portable 版の保存場所(Electron に依存しないので、テストできる)。
   portable 版は、実行ファイルと同じフォルダの「EverPad Data」に、設定(settings)とメモ(notes)を置く。
   そこに書き込めないとき(Program Files の中など)は、%APPDATA%\EverPad Portable と ドキュメント\EverPad Portable を使う。
   インストール版は今までどおり(%APPDATA%\EverPad と ドキュメント\EverPad)。 */
const path = require('path');

const DATA_DIR_NAME = 'EverPad Data';

/* o: { portableDir(PORTABLE_EXECUTABLE_DIR。インストール版や開発中は空), appData, documents, canWrite(dir) } */
function portableLayout(o) {
  if (!o.portableDir) return { mode: 'installed', base: null };
  const base = path.join(o.portableDir, DATA_DIR_NAME);
  if (o.canWrite(base)) return { mode: 'portable', base: base, userData: path.join(base, 'settings'), notes: path.join(base, 'notes') };
  return { mode: 'portableFallback', base: null, userData: path.join(o.appData, 'EverPad Portable'), notes: path.join(o.documents, 'EverPad Portable') };
}

/* 保存先の場所を config.json に書くときの値: portable 版で「EverPad Data」の中なら相対(ドライブ文字が変わっても動く) */
function dataDirToConfig(dir, layout) {
  if (layout && layout.base) {
    const rel = path.relative(layout.base, dir);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
    if (!rel) return '.';
  }
  return dir;
}
/* config.json の値から保存先の場所に戻す */
function dataDirFromConfig(value, layout) {
  if (typeof value !== 'string' || !value) return null;
  if (!path.isAbsolute(value)) return layout && layout.base ? path.resolve(layout.base, value) : null;
  return value;
}

module.exports = { portableLayout, dataDirToConfig, dataDirFromConfig, DATA_DIR_NAME };
