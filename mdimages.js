'use strict';
/*
 * Markdown のファイルをインポートするとき、本文の画像の参照のうち、そのファイルの近くにある画像を添付にして取り込む
 * (GitHub の README のように、画像を相対パスで書いたファイルを、ブラウザで見たときに近い見た目にする)。
 *
 *   ![説明](docs/images/a.png)  →  ![説明](attach:<添付の名前>)
 *   <img src="docs/images/a.png" …>  →  <img src="attach:<添付の名前>" …>
 *
 * 取り込むのは、インポートしたファイルと同じフォルダかその下にある画像のファイル(png・jpg・gif・webp・bmp・avif)だけ。
 * ../ で上のフォルダを指すもの・絶対パス・インターネットの画像(https:)・data:・attach: は、そのまま残す
 * (手元のほかの場所のファイルを取り込まないため。インターネットには接続しない)。
 * コードブロックとコード表記(`…`)の中は書き換えない。1つ 50MB まで、合わせて 200 個・500MB まで。
 * ここでは本文を書き換えて、取り込むファイルの一覧を返すだけ(ファイルは、メモができてから main.js が添付にする)。
 */
const fs = require('fs');
const path = require('path');
const { attachmentId, MAX_ATTACH } = require('./store');

const IMG = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const MAX_FILES = 200;
const MAX_TOTAL = 500 * 1024 * 1024;

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* 本文の画像を探して書き換える。{ text, files: [{ path, name, id }] } を返す(取り込む画像が無ければ files は空で、本文はそのまま) */
function localImages(text, mdFile) {
  let base;
  try { base = fs.realpathSync(path.dirname(mdFile)); } catch (e) { return { text: text, files: [] }; }
  const files = [], byPath = new Map();
  let total = 0;
  // 参照 → 添付の名前(取り込めなければ null)
  const take = ref => {
    let r = String(ref || '').trim().replace(/^<|>$/g, '');
    if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//') || r.startsWith('/') || r.startsWith('\\') || path.isAbsolute(r)) return null;
    r = r.split(/[?#]/)[0];
    try { r = decodeURIComponent(r); } catch (e) { /* そのまま */ }
    if (!IMG.test(r)) return null;
    let p;
    try { p = fs.realpathSync(path.resolve(base, r)); } catch (e) { return null; }
    if (!inside(p, base)) return null;
    if (byPath.has(p)) return byPath.get(p);
    let id = null;
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.size <= MAX_ATTACH && files.length < MAX_FILES && total + st.size <= MAX_TOTAL) {
        const name = path.basename(p);
        id = attachmentId(name, fs.readFileSync(p));
        files.push({ path: p, name: name, id: id });
        total += st.size;
      }
    } catch (e) { id = null; }
    byPath.set(p, id);
    return id;
  };
  const rewrite = s => s
    // ![説明](パス "題") の画像(題は落とす。EverPad の添付の書き方には題が無い)
    .replace(/!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, (m, alt, ref) => { const id = take(ref); return id ? '![' + alt + '](attach:' + id + ')' : m; })
    // <img … src="パス" …>
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, (m, head, all, a, b, c) => { const id = take(a != null ? a : b != null ? b : c); return id ? head + '"attach:' + id + '"' : m; });
  // コードブロック(``` か ~~~ で囲んだ所)とコード表記(`…`)の外だけを書き換える
  const lines = text.split('\n'), out = [];
  let fence = null;
  for (const ln of lines) {
    const f = /^\s*(`{3,}|~{3,})/.exec(ln);
    if (fence) { out.push(ln); if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(ln)) fence = null; continue; }
    if (f) { fence = f[1]; out.push(ln); continue; }
    // 行の中のコード表記を除いて書き換える
    out.push(ln.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : rewrite(part))).join(''));
  }
  return files.length ? { text: out.join('\n'), files: files } : { text: text, files: [] };
}

module.exports = { localImages };
