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
    + (o.author && o.author.length ? '<meta name="author" content="' + esc(o.author.join(', ')) + '">\n' : '')
    + (o.keywords && o.keywords.length ? '<meta name="keywords" content="' + esc(o.keywords.join(', ')) + '">\n' : '')
    + '<title>' + esc(o.title || '') + '</title>\n'
    + '<style>\n' + (o.katexCss ? o.katexCss + '\n' : '') + o.css
    // フロントマターの用紙の大きさと向き(ブラウザで印刷するとき)。値は main.js が core の pageSizeCss で作ったもの
    + (/^(?:landscape|[\d.]+mm [\d.]+mm)$/.test(o.pageSize || '') ? '@page { size: ' + o.pageSize + '; }\n' : '')
    + '</style>\n</head>\n<body>\n'
    + '<header class="ep-head">' + cell(o.title) + cell(o.head) + '</header>\n'
    + '<main class="md">' + o.bodyHtml + '</main>\n'
    + '<footer class="ep-foot">' + cell(o.foot) + '</footer>\n'
    + '</body>\n</html>\n';
}

/* スライドの HTML(「エクスポート」→「スライド (HTML)」)。本文は core.js の slidesHtml で分けたスライド(<section class="slide">)。
   ふだんはスライドを縦に並べて見せ、「スライドショー」のボタン(か F キー・F5)で、画面いっぱいに1枚ずつ見せる
   (→ ↓ PageDown Space Enter・クリックで次、← ↑ PageUp Backspace で前、Home・End で最初・最後、Esc で終わる)。
   印刷すると、1枚を1ページ(16:9。余白なし)にする。スクリプトはこのファイルの中のものだけを、CSP のハッシュで許す。
   o は pageHtml と同じ(head・foot は使わない)に、play(ボタンの言葉)・playTitle(ボタンの説明)を足したもの */
const SLIDES_JS = [
  '(function () {',
  '  var d = document.querySelector("main.md"), btn = document.getElementById("play"), no = document.getElementById("no");',
  '  var s = Array.prototype.filter.call(d.children, function (x) { return x.classList.contains("slide"); }), i = 0, on = false;',
  '  if (!s.length) { btn.hidden = true; return; }',
  '  function go(k) { i = Math.max(0, Math.min(s.length - 1, k)); s.forEach(function (x, j) { x.classList.toggle("cur", j === i); }); no.textContent = (i + 1) + " / " + s.length; }',
  '  function near() { var c = innerHeight / 2, best = 0, bd = Infinity; s.forEach(function (x, j) { var r = x.getBoundingClientRect(), v = Math.abs((r.top + r.bottom) / 2 - c); if (v < bd) { bd = v; best = j; } }); return best; }',
  '  function start(k) { on = true; document.body.classList.add("present"); go(k); var el = document.documentElement; if (el.requestFullscreen) { var p = el.requestFullscreen(); if (p && p.catch) p.catch(function () {}); } }',
  '  function stop() { if (!on) return; on = false; document.body.classList.remove("present"); s.forEach(function (x) { x.classList.remove("cur"); }); if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); s[i].scrollIntoView({ block: "center" }); }',
  '  btn.addEventListener("click", function () { start(near()); });',
  '  document.addEventListener("keydown", function (e) {',
  '    var k = e.key;',
  '    if (e.ctrlKey || e.metaKey || e.altKey) return;',
  '    if (!on) { if (k === "F5" || k === "f" || k === "F") { e.preventDefault(); start(near()); } return; }',
  '    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") go(i + 1);',
  '    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") go(i - 1);',
  '    else if (k === "Home") go(0);',
  '    else if (k === "End") go(s.length - 1);',
  '    else if (k === "Escape") stop();',
  '    else return;',
  '    e.preventDefault();',
  '  });',
  '  d.addEventListener("click", function (e) { if (on && !(e.target.closest && e.target.closest("a"))) go(i + 1); });',
  '  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement) stop(); });',
  '})();'
].join('\n');
const SLIDES_CSS = [
  'html, body.deck { background: #E6E9EF; }',
  'body.deck { max-width: 1000px; padding: 56px 16px 40px; }',
  '.play { position: fixed; top: 12px; right: 16px; z-index: 2; font: 600 14px/1 var(--ui); color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 9px 14px; cursor: pointer; box-shadow: 0 1px 4px rgba(0, 0, 0, .2); }',
  '.play:hover { filter: brightness(1.1); }',
  '.no { display: none; }',
  'body.present { overflow: hidden; }',
  'body.present .play { display: none; }',
  'body.present main.md { position: fixed; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; background: #000; cursor: default; }',
  'body.present main.md > .slide { display: none; flex: none; width: min(100vw, 177.78vh); margin: 0; border: 0; border-radius: 0; box-shadow: none; }',
  'body.present main.md > .slide.cur { display: block; }',
  'body.present .no { display: block; position: fixed; right: 14px; bottom: 10px; z-index: 4; font: 13px/1 var(--ui); color: #9AA3B5; }',
  '@page { size: 254mm 142.875mm; margin: 0; }',
  '@media print {',
  '  html, body.deck { background: #fff; }',
  '  body.deck { max-width: none; padding: 0; }',
  '  .play, .no { display: none; }',
  '  main.md > .slide { width: 100vw; height: 100vh; aspect-ratio: auto; margin: 0; border: 0; border-radius: 0; box-shadow: none; break-after: page; }',
  '  main.md > .slide:last-child { break-after: auto; }',
  '}'
].join('\n');
function slidesHtml(o) {
  const hash = require('crypto').createHash('sha256').update(SLIDES_JS, 'utf8').digest('base64');
  const csp = "default-src 'none'; img-src cid: data:; style-src 'unsafe-inline'; font-src cid: data:; script-src 'sha256-" + hash + "'; base-uri 'none'; form-action 'none'";
  return '<!DOCTYPE html>\n<html lang="' + esc(o.lang || 'en') + '">\n<head>\n<meta charset="utf-8">\n'
    + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="generator" content="' + esc(o.generator || 'EverPad') + '">\n'
    + (o.author && o.author.length ? '<meta name="author" content="' + esc(o.author.join(', ')) + '">\n' : '')
    + (o.keywords && o.keywords.length ? '<meta name="keywords" content="' + esc(o.keywords.join(', ')) + '">\n' : '')
    + '<title>' + esc(o.title || '') + '</title>\n'
    + '<style>\n' + (o.katexCss ? o.katexCss + '\n' : '') + o.css + SLIDES_CSS + '\n</style>\n</head>\n<body class="deck">\n'
    + '<button type="button" class="play" id="play" title="' + esc(o.playTitle || '') + '">▶ ' + esc(o.play || 'Slideshow') + '</button>\n'
    + '<main class="md">' + o.bodyHtml + '</main>\n'
    + '<div class="no" id="no" aria-live="polite"></div>\n'
    // CSP のハッシュは <script> と </script> の間の文字そのもの(改行も含む)で計るので、間に何も足さない
    + '<script>' + SLIDES_JS + '</script>\n'
    + '</body>\n</html>\n';
}

const b64lines = buf =>Buffer.from(buf).toString('base64').replace(/.{1,76}/g, '$&\r\n');
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

module.exports = { IMAGE_TYPES, imageType, cidOf, exportCss, katexCss, referencedImages, pageHtml, slidesHtml, SLIDES_JS, buildMhtml, buildHtml };
