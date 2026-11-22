'use strict';
/* スライド: 区切り線で分けること(core.js の slidesHtml)、marp: true のメモ、スライドの HTML(pageexport.js の slidesHtml)、
   メニュー・キー・画面へのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../renderer/core');
const P = require('../pageexport');
const K = require('../keymap');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const slidesOf = html => (html.match(/<section class="slide"[^>]*><div class="slide-in">[\s\S]*?<\/div><\/section>/g) || []);

test('スライド: いちばん外側の区切り線(--- *** ___)で分ける。区切り線は出さない', () => {
  const t = '# A\n\nx\n\n---\n\n## B\n\n***\n\nC\n\n___\n\nD';
  const s = slidesOf(C.md(t, { slides: true }));
  assert.strictEqual(s.length, 4);
  assert.match(s[0], /<h1>A<\/h1>\n<p>x<\/p>/);
  assert.match(s[1], /<h2>B<\/h2>/);
  assert.match(s[3], /<p>D<\/p>/);
  assert.ok(!/<hr/.test(C.md(t, { slides: true })));
  // 分けないときは今までどおり区切り線
  assert.strictEqual((C.md(t).match(/<hr>/g) || []).length, 3);
});

test('スライド: 引用・リスト・コードの中の区切り線では分けない', () => {
  const t = 'a\n\n> q\n> ---\n> r\n\n```\n---\n```\n\n- i\n\n  ---\n\nb';
  const html = C.md(t, { slides: true });
  assert.strictEqual(slidesOf(html).length, 1);
  assert.match(html, /<blockquote><p>q<\/p>\n<hr>/);
  assert.match(html, /<pre><code>---/);
});

test('スライド: 中身の無いスライドは出さない。フロントマターは区切りに数えない', () => {
  const t = '---\nmarp: true\n---\n\n---\n\nA\n\n---\n\n---\n\nB\n\n---\n';
  const s = slidesOf(C.md(t, { slides: true }));
  assert.deepStrictEqual(s.map(x => x.replace(/<[^>]+>/g, '').trim()), ['A', 'B']);
  assert.strictEqual(C.md('', { slides: true }), '');
  assert.strictEqual(C.md('---\n\n---', { slides: true }), '');
});

test('スライド: 行の範囲(data-from・data-to)を付け、中のかたまりの data-line も付ける。フロントマターはプレビューだけ出す', () => {
  const t = '---\nmarp: true\n---\n# A\n\n---\n\nB\nC';
  const html = C.md(t, { slides: true, lines: true, fm: true });
  assert.match(html, /^<div class="fm" data-line="0" data-end="3">/);
  assert.match(html, /<section class="slide" data-from="3" data-to="5"><div class="slide-in"><h1 data-line="3" data-end="4">A<\/h1>/);
  assert.match(html, /<section class="slide" data-from="6" data-to="9"><div class="slide-in"><p data-line="7" data-end="9">B<br>C<\/p>/);
  // 書き出しでは行の範囲もフロントマターも出さない
  const out = C.md(t, { slides: true });
  assert.ok(!/data-(?:from|line)|class="fm"/.test(out));
});

test('スライド: HTML のコメント(Marp の指定・発表者のメモ)の行は出さない。スライドでないときと、コードの中は今までどおり', () => {
  const t = '<!-- paginate: true -->\n# A\n<!--\n発表者のメモ\n-->\n\n---\n\nB\n\n```\n<!-- x -->\n```';
  const html = C.md(t, { slides: true });
  assert.ok(!/paginate|発表者|&lt;!--\s*$/.test(html.replace(/<pre>[\s\S]*<\/pre>/, '')), html);
  assert.match(html, /<h1>A<\/h1>/);
  assert.match(html, /<pre><code>&lt;!-- x --&gt;/);
  assert.strictEqual(slidesOf(html).length, 2);
  assert.match(C.md(t), /&lt;!-- paginate: true --&gt;/);
  // 行の範囲は変わらない
  assert.match(C.md(t, { slides: true, lines: true }), /<p data-line="8" data-end="9">B<\/p>/);
});

test('スライド: 脚注は最後のスライドに入れる', () => {
  const s = slidesOf(C.md('A[^1]\n\n---\n\nB\n\n[^1]: n', { slides: true }));
  assert.strictEqual(s.length, 2);
  assert.ok(!/footnotes/.test(s[0]));
  assert.match(s[1], /<section class="footnotes">/);
});

test('slidesOn: フロントマターに marp: true(yes・on も)と書いたメモだけ', () => {
  assert.strictEqual(C.slidesOn('---\nmarp: true\n---\nx'), true);
  assert.strictEqual(C.slidesOn('---\ntitle: a\nMarp: Yes # コメント\n---\nx'), true);
  assert.strictEqual(C.slidesOn('---\nmarp: false\n---\nx'), false);
  assert.strictEqual(C.slidesOn('---\ntitle: a\n---\nmarp: true'), false);
  assert.strictEqual(C.slidesOn('marp: true'), false);
  assert.strictEqual(C.slidesOn(''), false);
});

test('スライドの HTML: スクリプトは CSP のハッシュで許したものだけ。言葉と本文を入れる', () => {
  const html = P.slidesHtml({ lang: 'ja', title: 'T<1>', author: ['A'], keywords: [], css: '.md{}\n', bodyHtml: '<section class="slide"><div class="slide-in"><p>x</p></div></section>', play: 'スライドショー', playTitle: 'F "キー"', generator: 'EverPad 1' });
  const hash = crypto.createHash('sha256').update(P.SLIDES_JS, 'utf8').digest('base64');
  assert.ok(html.includes("script-src 'sha256-" + hash + "'"));
  assert.ok(html.includes("default-src 'none'"));
  // ハッシュは <script> と </script> の間の文字そのもの
  assert.ok(html.includes('<script>' + P.SLIDES_JS + '</script>'));
  assert.strictEqual((html.match(/<script/g) || []).length, 1);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<title>T&lt;1&gt;<\/title>/);
  assert.match(html, /title="F &quot;キー&quot;">▶ スライドショー<\/button>/);
  assert.match(html, /<main class="md"><section class="slide">/);
  assert.match(html, /@page \{ size: 254mm 142\.875mm; margin: 0; \}/);
  // スクリプトは構文として正しい
  assert.doesNotThrow(() => new Function(P.SLIDES_JS));
});

test('スライドの CSS: .md で始まる1行の規則なので、HTML の書き出しにも入る', () => {
  const css = read('renderer/styles.css');
  const out = P.exportCss(css);
  for (const sel of ['.md .slide {', '.md .slide-in {', '.md .slide-in > * {', '.md .slide-in img.att-img {']) assert.ok(out.includes(sel), sel);
  assert.match(out, /\.md \.slide \{[^}]*aspect-ratio: 16 \/ 9;[^}]*container-type: inline-size|\.md \.slide \{[^}]*container-type: inline-size;[^}]*aspect-ratio: 16 \/ 9;/);
  assert.match(out, /\.md \.slide-in \{[^}]*font-size: calc\(2\.734cqw \* var\(--fit, 1\)\);/);
  // 画面だけの印(番号・入りきらない・変えたスライド)とスライドショーは、書き出しに入れない
  assert.ok(!/slide-chg|\.over|\.show/.test(out));
  // スライドの PDF とスライドショー
  assert.match(css, /\.print-area\.slides-print \.md \.slide \{ width: 100vw; height: 100vh;/);
  assert.match(css, /\.show > \.md \{ width: min\(100vw, 177\.78vh\); \}/);
});

test('キー: スライドショーは F5(Mac は ⌘⇧Return)。スライドの書き出しはキーなし', () => {
  const d = K.defaults('win32'), m = K.defaults('darwin');
  assert.strictEqual(d.show, 'F5');
  assert.strictEqual(m.show, 'CmdOrCtrl+Shift+Enter');
  assert.strictEqual(d.slides, '');
  assert.strictEqual(d.slidespdf, '');
  // 既定のキーが重ならない
  const used = Object.values(d).filter(x => x);
  assert.strictEqual(new Set(used).size, used.length);
});

test('言葉: スライドの言葉が日本語と英語にある', () => {
  for (const l of ['ja', 'en']) for (const k of ['mExportSlides', 'mExportSlidesPdf', 'mShow', 'slidesSaveTitle', 'slidesSaved', 'slidesFailed', 'slidesPlay', 'slidesPlayTitle', 'slideOver', 'showEmpty']) {
    assert.ok(I18N.DICT[l][k], l + ' ' + k);
  }
  assert.strictEqual(I18N.DICT.ja.mExportSlides, 'スライド (HTML)…');
  assert.strictEqual(I18N.DICT.en.mShow, 'Slideshow');
});

test('つなぎ込み: メニュー・画面・main.js・preload', () => {
  const main = read('main.js'), app = read('renderer/app.js'), preload = read('preload.js');
  // ファイルメニューと一覧の右クリックの「エクスポート」、「表示」の「スライドショー」
  assert.match(main, /T\('mExportSlides'\), accelerator: A\('slides'\), click: \(\) => send\('slides'\)/);
  assert.match(main, /T\('mExportSlidesPdf'\), accelerator: A\('slidespdf'\), click: \(\) => send\('slidespdf'\)/);
  assert.match(main, /T\('mExportSlides'\), click: pick\('exportSlides'\)/);
  assert.match(main, /T\('mExportSlidesPdf'\), click: pick\('exportSlidesPdf'\)/);
  assert.match(main, /T\('mShow'\), accelerator: A\('show'\), click: \(\) => send\('show'\)/);
  assert.match(app, /action === 'exportSlides'\) exportPage\('slides', n\)/);
  assert.match(app, /action === 'exportSlidesPdf'\) printNote\('slidespdf', n\)/);
  assert.match(app, /if \(name === 'show'\) startShow\(\);/);
  assert.match(app, /name === 'pdf' \|\| name === 'slidespdf'\) printNote\(name\)/);
  // main.js: スライドは HTML と同じく画像を埋め込み、slidesHtml で組み立てる。全画面は窓が自分のときだけ
  assert.match(main, /kind === 'slides' \? pageexport\.slidesHtml\(/);
  assert.match(main, /ipcMain\.handle\('win:show', \(e, on\) => \{\n\s+if \(!fromOurWindow\(e\)/);
  assert.match(preload, /showFullScreen: on => ipcRenderer\.invoke\('win:show', !!on\)/);
  // プレビューと履歴は marp: true のときスライドの形。スライドショーとスライドの PDF は、いつでも区切り線で分ける
  assert.match(app, /const slides = slidesOn\(cur\(\)\.text\);/);
  assert.match(app, /const slides = slidesOn\(text\);/);
  assert.match(app, /const html = md\(text, \{ slides: true, lines: true \}\);/);
  assert.match(app, /'@page \{ size: 254mm 142\.875mm; margin: 0; background: #fff; \}'/);
  // スライドの中で編集するときも、書き足す場所はスライドの中のいちばん外側のかたまりの次
  assert.match(app, /x === \$\('preview'\) \|\| x\.classList\.contains\('slide-in'\)/);
  // 入りきらないスライドは文字を縮める(半分まで)。PDF・HTML は書き出す前に測り、スライドショーは見せたスライドを測る
  assert.match(app, /const FIT_MIN = 0\.5;/);
  assert.match(app, /if \(slides\) fitForExport\(area\.firstChild\);/);
  assert.match(app, /if \(slides\) fitForExport\(box, pptx \? pptxLayout : null\);/);
  assert.match(app, /fitSlide\(slideShow\.slides\[i\], false\);/);
});
