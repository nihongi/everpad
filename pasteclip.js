'use strict';
/* 貼り付けた Word・Excel の画像の一時ファイル。
   Word・Excel は、文字といっしょにコピーした画像を一時フォルダの msohtmlclip1\01\clip_image001.png などに置き、
   クリップボードの HTML から file:/// で指す(画面からは読めないので、main.js が読んで添付にする)。
   読むのは、一時フォルダの中の msohtmlclip… のフォルダにある clip_image… の画像だけ。
   Web ページの HTML に書かれた file:///C:/… で、手元のほかのファイルが取り込まれないようにする(リンクを辿った先で確かめる) */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const CLIP_NAME_RE = /^clip_image\d+\.(png|jpe?g|gif|bmp)$/i;
const CLIP_DIR_RE = /^msohtmlclip\d*$/i;

// 読んでよい一時ファイルの場所(実際の場所)。だめなら null
function officeClipPath(url, tmpDir) {
  if (typeof url !== 'string' || url.length > 2048 || !/^file:\/\/\//i.test(url) || !tmpDir) return null;
  let p, tmp;
  try { p = fs.realpathSync(fileURLToPath(url)); tmp = fs.realpathSync(tmpDir); } catch (e) { return null; }
  const rel = path.relative(tmp, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  const n = parts.length;
  if (n < 3 || !CLIP_NAME_RE.test(parts[n - 1]) || !/^\d+$/.test(parts[n - 2]) || !CLIP_DIR_RE.test(parts[n - 3])) return null;
  try { return fs.statSync(p).isFile() ? p : null; } catch (e) { return null; }
}

module.exports = { officeClipPath };
