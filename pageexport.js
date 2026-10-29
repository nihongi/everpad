'use strict';
/* Web ページとして書き出す(1つのファイルに、整形した本文・画像・数式のフォントをまとめる)。2つの形式がある:
   - HTML: 画像とフォントを data: URI で HTML の中に埋め込む。どのブラウザでも開ける
   - MHTML: RFC 2557(multipart/related)。画像とフォントを同じファイルの別の部分として入れる。Edge・Chrome・Word で開ける
   本文は画面側(renderer)で整形した HTML を受け取る。紙面では画像とフォントを cid: で参照し、HTML では data: に置き換える。
   スクリプトは入れず、CSP でも読み込み先を cid:・data: に限る。 */

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' };
/* 添付のファイル ID(16桁の16進数 + 拡張子)から画像の種類を返す。画像でなければ null */
function imageType(fileId) {
  const m = /^[0-9a-f]{16}\.([a-z0-9]{1,8})$/.exec(String(fileId || ''));
  return m && IMAGE_TYPES[m[1]] || null;
}
const cidOf = name => name + '@everpad';

/* 書き出す紙面の CSS: styles.css の明るい配色(最初の :root)、言語ごとのフォント(:root:lang(…))、本文(.md …)の規則を使い、ページの見た目を足す */
function exportCss(stylesCss) {
  const src = String(stylesCss);
  const root = (/^:root \{[\s\S]*?^\}/m.exec(src) || [''])[0];
  const md = src.split(/\r?\n/).filter(l => /^\.md[ .:>[,{]/.test(l)).join('\n');
  const langs = src.split(/\r?\n/).filter(l => /^:root:lang\(/.test(l)).join('\n');
  return root + '\n'
    + (langs ? langs + '\n' : '')
    + 'html { background: #fff; }\n'
    + 'body { margin: 0 auto; max-width: 52rem; padding: 24px 24px 40px; background: #fff; color: var(--fg); font-family: var(--ui); line-height: 1.6; }\n'
    + '.ep-head, .ep-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 16px; font-size: 12px; color: var(--fg-2); }\n'
    + '.ep-head { border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 20px; }\n'
    + '.ep-foot { border-top: 1px solid var(--line); padding-top: 6px; margin-top: 28px; }\n'
    + md + '\n'
    + '.md img.att-img { cursor: auto; }\n'
    + '.md .att-file { color: var(--fg-2); }\n'
    + '.att-missing { color: var(--del-fg); font-size: 13px; }\n'
    + '@media print { body { max-width: none; padding: 0; } .md pre { white-space: pre-wrap; } .md img { break-inside: avoid; } }\n';
}

/* KaTeX の CSS: フォントのファイル(woff2)を cid: で参照するよう書き換える。使うフォントの名前の一覧も返す */
function katexCss(css) {
  const fonts = [];
  const out = String(css).replace(/src:url\(fonts\/([A-Za-z0-9_-]+\.woff2)\) format\("woff2"\)[^;}]*/g, (m, f) => {
    if (fonts.indexOf(f) < 0) fonts.push(f);
    return 'src:url(cid:' + cidOf(f) + ') format("woff2")';
  });
  return { css: out, fonts: fonts };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 本文中の画像の参照(画面側で cid:<ファイルID>@everpad にしたもの)
const IMG_CID_RE = /\ssrc="cid:([0-9a-f]{16}\.[a-z0-9]{1,8})@everpad"/g;
/* 本文の HTML が参照している画像のファイル ID の一覧 */
function referencedImages(bodyHtml) {
  const ids = [];
  for (const m of String(bodyHtml).matchAll(IMG_CID_RE)) if (imageType(m[1]) && ids.indexOf(m[1]) < 0) ids.push(m[1]);
  return ids;
}

/* 紙面の HTML。title・head(上の行)・foot(下の行)はただの文字列、bodyHtml は整形済みの本文 */
function pageHtml(o) {
  const csp = "default-src 'none'; img-src cid: data:; style-src 'unsafe-inline'; font-src cid: data:; base-uri 'none'; form-action 'none'";
  const cell = s => '<span>' + esc(s || '') + '</span>';
  return '<!DOCTYPE html>\n<html lang="' + esc(o.lang || 'en') + '">\n<head>\n<meta charset="utf-8">\n'
    + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="generator" content="' + esc(o.generator || 'EverPad') + '">\n'
    + '<title>' + esc(o.title || '') + '</title>\n'
    + '<style>\n' + (o.katexCss ? o.katexCss + '\n' : '') + o.css + '</style>\n</head>\n<body>\n'
    + '<header class="ep-head">' + cell(o.title) + cell(o.head) + '</header>\n'
    + '<main class="md">' + o.bodyHtml + '</main>\n'
    + '<footer class="ep-foot">' + cell(o.foot) + '</footer>\n'
    + '</body>\n</html>\n';
}

const b64lines = buf => Buffer.from(buf).toString('base64').replace(/.{1,76}/g, '$&\r\n');
// メールの見出しに使う題名(ASCII 以外は RFC 2047 の形にする)
const encodedWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : '=?utf-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');

/* MHTML を組み立てる。
   o: { title, html(紙面の HTML), parts: [{ cid, type, data(Buffer) }], date(Date), boundary? }
   最初の部分が紙面で、残りが画像とフォント */
function buildMhtml(o) {
  const boundary = o.boundary || '----=_EverPad_' + require('crypto').randomBytes(12).toString('hex');
  const title = String(o.title || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  const head = [
    'From: <Saved by EverPad>',
    'Subject: ' + encodedWord(title),
    'Date: ' + (o.date || new Date()).toUTCString().replace('GMT', '+0000'),
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    '\ttype="text/html";',
    '\tboundary="' + boundary + '"',
    '', ''
  ].join('\r\n');
  const part = (headers, data) => '--' + boundary + '\r\n' + headers.join('\r\n') + '\r\n\r\n' + b64lines(data) + '\r\n';
  let out = head + part([
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Content-Location: https://everpad.invalid/note.html'
  ], Buffer.from(o.html, 'utf8'));
  for (const p of o.parts || []) {
    out += part([
      'Content-Type: ' + p.type,
      'Content-Transfer-Encoding: base64',
      'Content-ID: <' + p.cid + '>'
    ], p.data);
  }
  return Buffer.from(out + '--' + boundary + '--\r\n', 'ascii');
}

/* HTML 1つにまとめる: 紙面の cid: の参照を、その部分の data: URI に置き換える */
function buildHtml(o) {
  let html = String(o.html);
  for (const p of o.parts || []) html = html.split('cid:' + p.cid).join('data:' + p.type + ';base64,' + Buffer.from(p.data).toString('base64'));
  return Buffer.from(html, 'utf8');
}

module.exports = { IMAGE_TYPES, imageType, cidOf, exportCss, katexCss, referencedImages, pageHtml, buildMhtml, buildHtml };
