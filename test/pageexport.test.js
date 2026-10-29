'use strict';
/* HTML・MHTML の書き出し: 紙面の CSS、数式のフォント、画像の参照、ファイルの組み立て、メニューなどへのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../pageexport');

const root = path.join(__dirname, '..');
// Windows の CI では git が改行を CRLF にして取り出すので、ソースを調べるときは LF にそろえる
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

test('MHTML: 画像の種類は添付のファイル ID の拡張子で決まる(画像以外は入れない)', () => {
  assert.strictEqual(M.imageType('0123456789abcdef.png'), 'image/png');
  assert.strictEqual(M.imageType('0123456789abcdef.jpg'), 'image/jpeg');
  assert.strictEqual(M.imageType('0123456789abcdef.avif'), 'image/avif');
  assert.strictEqual(M.imageType('0123456789abcdef.pdf'), null);
  assert.strictEqual(M.imageType('0123456789abcdef.svg'), null);
  assert.strictEqual(M.imageType('../x.png'), null);
  assert.strictEqual(M.imageType('0123456789ABCDEF.png'), null);
});

test('MHTML: 紙面の CSS は明るい配色と本文の規則だけ(画面の部品・ダークモードは入れない)', () => {
  const css = M.exportCss(read('renderer/styles.css'));
  assert.match(css, /--fg: #141B33/);
  assert.match(css, /color-scheme: light/);
  for (const sel of ['.md h1', '.md table', '.md pre', '.md img.att-img', '.md .math-display']) assert.ok(css.includes(sel), sel);
  assert.ok(!/prefers-color-scheme|data-theme|#E3E9F8|\.app|\.pane|#noteList/.test(css));
  // 使っている変数は、どれも定義されている
  const defined = new Set([...css.matchAll(/(--[\w-]+):/g)].map(m => m[1]));
  for (const m of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(defined.has(m[1]), m[1] + ' が定義されていない');
  // Windows でビルドしたアプリでは styles.css の改行が CRLF のことがある。それでも同じ CSS になる
  assert.strictEqual(M.exportCss(read('renderer/styles.css').replace(/\n/g, '\r\n')).replace(/\r/g, ''), css.replace(/\r/g, ''));
});

test('等幅フォント: 日本語は BIZ UDゴシックが先、英語は \\ を ¥ の形にしないフォントが先(画面と書き出しの両方)', () => {
  const styles = read('renderer/styles.css');
  const mono = src => { const m = /--mono: ([^;]+);/.exec(src); return m && m[1].split(',').map(s => s.trim().replace(/'/g, '')); };
  assert.strictEqual(mono(/^:root \{[\s\S]*?^\}/m.exec(styles)[0])[0], 'BIZ UDGothic');
  const en = /^:root:lang\(en\) \{[^}]*\}/m.exec(styles);
  assert.ok(en, ':root:lang(en) の規則がある');
  assert.deepStrictEqual(mono(en[0]).slice(0, 2), ['Cascadia Mono', 'Consolas']);
  assert.ok(mono(en[0]).includes('BIZ UDGothic'), '日本語の文字は日本語のフォントで出る');
  assert.ok(M.exportCss(styles).includes(en[0]), 'HTML・MHTML の書き出しにも入る');
});

test('MHTML: KaTeX のフォントは cid: で参照し、使うフォントのファイルはすべてある', () => {
  // renderer/vendor/katex は git に入れず、起動・ビルドの前に tools/vendor-katex.js が node_modules/katex/dist から写す(woff2 だけ)。
  // テストは写す元を読む(CI ではビルドより先にテストする)
  const dist = path.join(path.dirname(require.resolve('katex/package.json')), 'dist');
  const k = M.katexCss(fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8'));
  assert.ok(k.fonts.length >= 10);
  assert.ok(!/url\(fonts\//.test(k.css), '元の場所を参照したまま');
  for (const f of k.fonts) {
    assert.ok(fs.existsSync(path.join(dist, 'fonts', f)), f);
    assert.ok(k.css.includes('url(cid:' + f + '@everpad)'), f);
  }
  // 書き出しで読む CSS とフォント(woff2)は、どちらも写される
  const tool = read('tools/vendor-katex.js');
  assert.match(tool, /\['katex\.min\.js', 'katex\.min\.css'\]/);
  assert.match(tool, /f\.endsWith\('\.woff2'\)/);
});

test('MHTML: 本文が参照している画像を、重ならずに拾う(alt に > があっても)', () => {
  const a = '0123456789abcdef.png', b = 'fedcba9876543210.jpg';
  const html = '<p><img class="att-img" alt="a > b" src="cid:' + a + '@everpad"> <img src="cid:' + b + '@everpad" alt="">'
    + '<img src="cid:' + a + '@everpad"><img src="cid:0000000000000000.pdf@everpad"><img src="everpad-file://f/x/' + b + '"></p>';
  assert.deepStrictEqual(M.referencedImages(html), [a, b]);
});

test('MHTML: 紙面の HTML は題名などを文字として入れ、スクリプトを持たない', () => {
  const html = M.pageHtml({ lang: 'ja', title: '<b>題名</b> & "x"', head: '最終編集: 2026/10/28', foot: '作成: 2026/10/28', bodyHtml: '<p>本文</p>', css: '.md{}', generator: 'EverPad 0.23.0' });
  assert.match(html, /<title>&lt;b&gt;題名&lt;\/b&gt; &amp; &quot;x&quot;<\/title>/);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src cid: data:;/);
  assert.match(html, /<main class="md"><p>本文<\/p><\/main>/);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/katex/i.test(html), '数式が無ければ KaTeX の CSS は入れない');
});

/* 組み立てた MHTML を読み戻す(テスト用の簡単な解析) */
function parse(buf) {
  const s = buf.toString('ascii');
  const boundary = /boundary="([^"]+)"/.exec(s)[1];
  const [head, ...rest] = s.split('--' + boundary);
  const parts = rest.filter(p => !p.startsWith('--')).map(p => {
    const [h, body] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    const headers = {};
    for (const line of h.split('\r\n')) { const i = line.indexOf(':'); headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
    return { headers, data: Buffer.from(body.replace(/\r\n/g, ''), 'base64') };
  });
  return { head, boundary, parts, tail: rest[rest.length - 1] };
}

test('MHTML: ファイルの組み立て(最初が紙面、続いて画像とフォント。見出しは ASCII だけ)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const html = '<!DOCTYPE html><html><body>日本語の本文 ' + 'x'.repeat(300) + '</body></html>';
  const buf = M.buildMhtml({ title: '日本語の題名\r\n2行目', html, date: new Date(Date.UTC(2026, 9, 28, 1, 2, 3)), parts: [
    { cid: M.cidOf('0123456789abcdef.png'), type: 'image/png', data: png },
    { cid: M.cidOf('KaTeX_Main-Regular.woff2'), type: 'font/woff2', data: Buffer.from('font') }
  ] });
  assert.ok(/^[\x00-\x7f]*$/.test(buf.toString('latin1')), 'ASCII だけ');
  const m = parse(buf);
  assert.match(m.head, /^From: <Saved by EverPad>\r\n/);
  assert.match(m.head, /\r\nSubject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.strictEqual(Buffer.from(/\?B\?([^?]+)\?=/.exec(m.head)[1], 'base64').toString('utf8'), '日本語の題名 2行目');
  assert.match(m.head, /\r\nDate: Wed, 28 Oct 2026 01:02:03 \+0000\r\n/);
  assert.match(m.head, /Content-Type: multipart\/related;\r\n\ttype="text\/html";\r\n\tboundary="/);
  assert.match(m.tail, /^--\r\n$/, '終わりの区切りがある');
  assert.strictEqual(m.parts.length, 3);
  assert.strictEqual(m.parts[0].headers['content-type'], 'text/html; charset=utf-8');
  assert.ok(m.parts[0].headers['content-location']);
  assert.strictEqual(m.parts[0].data.toString('utf8'), html);
  assert.strictEqual(m.parts[1].headers['content-id'], '<0123456789abcdef.png@everpad>');
  assert.strictEqual(m.parts[1].headers['content-type'], 'image/png');
  assert.ok(m.parts[1].data.equals(png));
  assert.strictEqual(m.parts[2].headers['content-type'], 'font/woff2');
  // base64 の行は 76 文字まで
  for (const line of buf.toString('ascii').split('\r\n')) assert.ok(line.length <= 998);
  assert.ok(buf.toString('ascii').split('\r\n').filter(l => /^[A-Za-z0-9+/=]{77,}$/.test(l)).length === 0);
  // ASCII だけの題名はそのまま
  assert.match(M.buildMhtml({ title: 'Plain', html: '' }).toString('ascii'), /\r\nSubject: Plain\r\n/);
});

test('HTML: 画像とフォントを data: で埋め込んだ1つのファイル(cid: は残らない)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const page = M.pageHtml({ title: '題名', bodyHtml: '<p><img class="att-img" alt="" src="cid:0123456789abcdef.png@everpad"></p>', css: '.md{}',
    katexCss: '@font-face{font-family:KaTeX_Main;src:url(cid:KaTeX_Main-Regular.woff2@everpad) format("woff2")}' });
  const out = M.buildHtml({ html: page, parts: [
    { cid: M.cidOf('0123456789abcdef.png'), type: 'image/png', data: png },
    { cid: M.cidOf('KaTeX_Main-Regular.woff2'), type: 'font/woff2', data: Buffer.from('font') }
  ] }).toString('utf8');
  assert.ok(!/cid:/.test(out.replace(/img-src cid: data:; style-src 'unsafe-inline'; font-src cid: data:/, '')), 'cid: の参照が残っている');
  assert.ok(out.includes('src="data:image/png;base64,' + png.toString('base64') + '"'));
  assert.ok(out.includes('url(data:font/woff2;base64,' + Buffer.from('font').toString('base64') + ')'));
  assert.match(out, /^<!DOCTYPE html>\n/);
  assert.match(out, /<meta charset="utf-8">/);
  assert.match(out, /<title>題名<\/title>/);
  assert.ok(!/<script/i.test(out));
});

test('HTML・MHTML: メニュー・画面・main.js へのつなぎ込み', () => {
  const main = read('main.js'), app = read('renderer/app.js'), preload = read('preload.js');
  assert.match(main, /require\('\.\/pageexport'\)/);
  // ファイルメニューと、一覧の右クリックの「エクスポート」の両方
  for (const [label, kind] of [['mExportHtml', 'html'], ['mExportMhtml', 'mhtml']]) {
    assert.match(main, new RegExp("T\\('" + label + "'\\), click: \\(\\) => send\\('" + kind + "'\\)"));
    assert.match(main, new RegExp("T\\('" + label + "'\\), click: pick\\('export" + kind[0].toUpperCase() + kind.slice(1) + "'\\)"));
  }
  assert.match(app, /name === 'html' \|\| name === 'mhtml' \|\| name === 'adoc' \|\| name === 'docx'\) exportPage\(name\)/);
  assert.match(app, /action === 'exportHtml'\) exportPage\('html', n\)/);
  assert.match(app, /action === 'exportMhtml'\) exportPage\('mhtml', n\)/);
  assert.match(preload, /exportPage: \(id, p, kind\) => ipcRenderer\.invoke\('export:page', id, p, kind\)/);
  // 形式は決まった4つだけ(AsciiDoc・Word は docexport.test.js で調べる)。画像は、そのメモの添付からだけ読む(ID を確かめる store.attachmentPath を通す)
  assert.match(main, /const PAGE_KINDS = \{\n  html: \{ ext: 'html'[^\n]*\n  mhtml: \{ ext: 'mhtml'[^\n]*\n  adoc: \{ ext: 'adoc'[^\n]*\n  docx: \{ ext: 'docx'[^\n]*\n\};/);
  const h = main.slice(main.indexOf("ipcMain.handle('export:page'"));
  const body = h.slice(0, h.indexOf('\n});'));
  assert.match(body, /hasOwnProperty\.call\(PAGE_KINDS, kind\)/);
  assert.match(body, /fromOurWindow\(e\) \|\| !k \|\| !validId\(id\)/);
  assert.match(body, /store\.attachmentPath\(id, f\)/);
  assert.match(body, /kind === 'html' \? pageexport\.buildHtml/);
  assert.ok(!/readFileSync\(p\./.test(body), '画面から来たパスは読まない');
  // EverPad の外では開けないリンクは文字にし、画像は cid: で参照する
  const fn = app.slice(app.indexOf('async function exportPage'), app.indexOf('/* ---------- 画面の上に出す小さな窓'));
  assert.match(fn, /a\.note-link, \.link-other/);
  assert.match(fn, /a\.att-file/);
  assert.match(fn, /'cid:' \+ img\.dataset\.att \+ '@everpad'/);
  assert.match(fn, /toast\(T\(kind \+ 'Saved'/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('pageexport.js'));
});

test('HTML・MHTML: 表示の言葉(日本語・英語)', () => {
  const I = require('../renderer/i18n');
  for (const l of ['ja', 'en']) for (const k of ['mExportHtml', 'htmlSaveTitle', 'htmlSaved', 'htmlFailed', 'mExportMhtml', 'mhtmlSaveTitle', 'mhtmlSaved', 'mhtmlFailed']) {
    const v = I.t(l, k, { path: 'X' });
    assert.ok(v && v !== k, l + ':' + k);
  }
});
