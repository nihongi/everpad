'use strict';
/* フロントマターの toc・toc-depth・lang・papersize・orientation: メモごとの表示・印刷の設定と、印刷・書き出しでの使われ方 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const D = require('../docexport');
const P = require('../pageexport');
const I18N = require('../renderer/i18n');
const { readZip } = require('../ziplite');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const fm = s => '---\n' + s + '\n---\n本文\n';
const DEF = { toc: false, tocDepth: 3, lang: '', paper: '', landscape: false };

test('設定の読み方: 既定の値・目次・深さ・言語・用紙・向き', () => {
  assert.deepStrictEqual(core.docOpts('# 見出し\n本文'), DEF);
  assert.deepStrictEqual(core.docOpts(fm('title: x')), DEF);
  assert.deepStrictEqual(core.docOpts(fm('toc: true\ntoc-depth: 2\nlang: en-US\npapersize: a5\norientation: landscape')),
    { toc: true, tocDepth: 2, lang: 'en-US', paper: 'A5', landscape: true });
  // 目次: true・yes・on(大文字も)。false・引用符の無い値・空は出さない
  for (const v of ['true', 'True', 'yes', 'ON', '"true"', 'true # 目次']) assert.strictEqual(core.docOpts(fm('toc: ' + v)).toc, true, v);
  for (const v of ['false', 'no', 'off', '1', '', 'true false']) assert.strictEqual(core.docOpts(fm('toc: ' + v)).toc, false, v);
  // 深さ: 1〜6 だけ。ほかは既定の 3
  assert.strictEqual(core.docOpts(fm('toc-depth: 6')).tocDepth, 6);
  for (const v of ['0', '7', '2.5', 'two', '-1']) assert.strictEqual(core.docOpts(fm('toc-depth: ' + v)).tocDepth, 3, v);
  // キーの大文字・小文字は区別しない
  assert.strictEqual(core.docOpts(fm('TOC-Depth: 1')).tocDepth, 1);
  // 言語: 言語のタグの形だけ(_ は - にする)
  assert.strictEqual(core.docOpts(fm('lang: ja')).lang, 'ja');
  assert.strictEqual(core.docOpts(fm('lang: en_GB')).lang, 'en-GB');
  assert.strictEqual(core.docOpts(fm('lang: zh-Hant-TW')).lang, 'zh-Hant-TW');
  for (const v of ['日本語', 'english language', 'e', 'en-', '"en;x"']) assert.strictEqual(core.docOpts(fm('lang: ' + v)).lang, '', v);
  // 用紙: a4・a5・b5・letter・legal(a4paper の形と大文字も)。ほかは決めない
  const paper = v => core.docOpts(fm('papersize: ' + v)).paper;
  assert.deepStrictEqual(['a4', 'A5', 'b5', 'Letter', 'LEGAL', 'a4paper', 'letterpaper'].map(paper), ['A4', 'A5', 'B5', 'Letter', 'Legal', 'A4', 'Letter']);
  for (const v of ['b4', 'a3', 'tabloid', 'A4 横']) assert.strictEqual(paper(v), '', v);
  // 向き: landscape だけ
  assert.strictEqual(core.docOpts(fm('orientation: Landscape')).landscape, true);
  assert.strictEqual(core.docOpts(fm('orientation: portrait')).landscape, false);
});

test('用紙の @page の size: mm で書き、横向きなら入れ替える(B5 は JIS)', () => {
  assert.strictEqual(core.pageSizeCss(DEF), '');
  assert.strictEqual(core.pageSizeCss(null), '');
  assert.strictEqual(core.pageSizeCss({ paper: 'A4' }), '210mm 297mm');
  assert.strictEqual(core.pageSizeCss({ paper: 'A5', landscape: true }), '210mm 148mm');
  assert.strictEqual(core.pageSizeCss({ paper: 'B5' }), '182mm 257mm');
  assert.strictEqual(core.pageSizeCss({ paper: 'Letter' }), '215.9mm 279.4mm');
  assert.strictEqual(core.pageSizeCss({ paper: 'Legal', landscape: true }), '355.6mm 215.9mm');
  // 向きだけなら、用紙は印刷・PDF の既定のまま横向き
  assert.strictEqual(core.pageSizeCss({ paper: '', landscape: true }), 'landscape');
  assert.strictEqual(core.pageSizeCss({ paper: 'B4' }), '');
});

test('目次の HTML: いちばん浅い見出しからの深さで字下げし、見出しへのリンクにする', () => {
  assert.strictEqual(core.tocHtml([], '目次'), '');
  const h = core.tocHtml([{ level: 2, id: 'ep-h-1', html: '<strong>始め</strong>' }, { level: 3, id: 'ep-h-2', html: '細かく' }, { level: 2, id: 'ep-h-3', html: '終わり' }], '<目次>');
  assert.strictEqual(h, '<nav class="toc"><p class="toc-title">&lt;目次&gt;</p><ul>'
    + '<li class="toc-1"><a href="#ep-h-1"><strong>始め</strong></a></li><li class="toc-2"><a href="#ep-h-2">細かく</a></li><li class="toc-1"><a href="#ep-h-3">終わり</a></li></ul></nav>');
  // 目次の見出しの言葉
  assert.strictEqual(I18N.t('ja', 'tocTitle'), '目次');
  assert.strictEqual(I18N.t('en', 'tocTitle'), 'Contents');
});

test('HTML・MHTML: 用紙は @page、言語は <html lang>', () => {
  const base = { lang: 'ja', title: 't', head: '', foot: '', bodyHtml: '<p>x</p>', css: 'body{}' };
  assert.ok(!/@page/.test(P.pageHtml(base)));
  assert.match(P.pageHtml(Object.assign({}, base, { pageSize: '210mm 148mm' })), /@page \{ size: 210mm 148mm; \}\n<\/style>/);
  assert.match(P.pageHtml(Object.assign({}, base, { pageSize: 'landscape' })), /@page \{ size: landscape; \}/);
  // 決まった形でなければ入れない
  assert.ok(!/@page/.test(P.pageHtml(Object.assign({}, base, { pageSize: 'A4; } body { color: red' }))));
  assert.match(P.pageHtml(Object.assign({}, base, { lang: 'en-US' })), /<html lang="en-US">/);
});

const SRC = '# 大見出し\n\n本文\n\n## 中見出し\n\n### 小見出し\n\n#### もっと小さい\n';
const tree = s => D.bodyTree(core.md(s || SRC));
const OPTS = o => Object.assign({ toc: false, tocDepth: 3, tocTitle: '', lang: '', paper: '', landscape: false }, o);

test('AsciiDoc: 目次(:toc: と節の深さ)・言語・用紙と向き(Asciidoctor PDF)', () => {
  const a = D.toAsciiDoc(tree(), { title: 'x', opts: OPTS({ toc: true, tocDepth: 3, tocTitle: '目次', lang: 'ja', paper: 'A5', landscape: true }) });
  // # が文書の題名になると、## が == (節の深さ 1)。toc-depth 3(### まで)は toclevels 2
  assert.match(a, /^= 大見出し\n:toc:\n:toclevels: 2\n:toc-title: 目次\n:lang: ja\n:pdf-page-size: A5\n:pdf-page-layout: landscape\n/);
  // フロントマターに title があれば、# も節(== )なので、深さはそのまま
  const b = D.toAsciiDoc(tree(), { title: 'x', meta: { title: '題' }, opts: OPTS({ toc: true, tocDepth: 2 }) });
  assert.match(b, /^= 題\n:toc:\n:toclevels: 2\n/);
  assert.match(D.toAsciiDoc(tree(), { title: 'x', opts: OPTS({ paper: 'B5' }) }), /\n:pdf-page-size: \[182mm, 257mm\]\n/);
  // 設定が無ければ今までどおり
  assert.strictEqual(D.toAsciiDoc(tree(), { title: 'x' }), D.toAsciiDoc(tree(), { title: 'x', opts: OPTS({}) }));
  assert.ok(!/:toc:|:lang:|:pdf-page/.test(D.toAsciiDoc(tree(), { title: 'x' })));
});

test('LaTeX: 用紙と向き(文書クラスのオプション。article の JIS B5 は geometry)・言語・目次', () => {
  const en = '# Title\n\nText\n\n## Part\n';
  let t = D.toLatex(tree(en), { title: 'x', paper: 'A5', opts: OPTS({ paper: 'A5', landscape: true, lang: 'en-US' }) });
  assert.match(t, /\\documentclass\[a5paper,landscape\]\{article\}/);
  assert.match(t, /\\usepackage\[colorlinks,linkcolor=black,urlcolor=blue,pdflang=en-US\]\{hyperref\}/);
  t = D.toLatex(tree(en), { title: 'x', paper: 'B5', opts: OPTS({ paper: 'B5' }) });
  assert.match(t, /\\documentclass\{article\}\n\\usepackage\[paperwidth=182mm,paperheight=257mm\]\{geometry\}/);
  t = D.toLatex(tree(en), { title: 'x', paper: 'B5', opts: OPTS({ paper: 'B5', landscape: true }) });
  assert.match(t, /\\usepackage\[paperwidth=182mm,paperheight=257mm,landscape\]\{geometry\}/);
  // 日本語の文書クラス(ltjsarticle)の b5paper は JIS の B5
  assert.match(D.toLatex(tree(), { title: 'x', paper: 'B5', opts: OPTS({ paper: 'B5' }) }), /\\documentclass\[b5paper\]\{ltjsarticle\}/);
  assert.match(D.toLatex(tree(), { title: 'x', paper: 'Legal' }), /\\documentclass\[legalpaper\]\{ltjsarticle\}/);
  // lang が ja なら、日本語の文字が無くても ltjsarticle
  assert.match(D.toLatex(tree(en), { title: 'x', paper: 'A4', opts: OPTS({ lang: 'ja' }) }), /\\documentclass\[a4paper\]\{ltjsarticle\}/);
  assert.match(D.toLatex(tree(en), { title: 'x', paper: 'A4', opts: OPTS({ lang: 'ja-JP' }) }), /\{ltjsarticle\}/);
  assert.match(D.toLatex(tree(en), { title: 'x', paper: 'A4', opts: OPTS({ lang: 'jav' }) }), /\{article\}/);
  // 目次: # が題名なら ## が \section(深さ 1)なので、toc-depth 3 は tocdepth 2
  t = D.toLatex(tree(), { title: 'x', paper: 'A4', opts: OPTS({ toc: true, tocDepth: 3, tocTitle: '目次' }) });
  assert.match(t, /\\setcounter\{secnumdepth\}\{0\}\n\\setcounter\{tocdepth\}\{2\}\n\\renewcommand\{\\contentsname\}\{目次\}\n\\title\{大見出し\}/);
  assert.match(t, /\\begin\{document\}\n\\maketitle\n\\tableofcontents\n/);
  // フロントマターに title があれば # が \section なので、深さはそのまま
  t = D.toLatex(tree(), { title: 'x', paper: 'A4', meta: { title: '題' }, opts: OPTS({ toc: true, tocDepth: 1, tocTitle: 'Contents' }) });
  assert.match(t, /\\setcounter\{tocdepth\}\{1\}\n\\renewcommand\{\\contentsname\}\{Contents\}/);
  // 題名が無ければ \maketitle なしで目次
  t = D.toLatex(D.bodyTree(core.md('本文\n\n## a\n')), { title: '', paper: 'A4', opts: OPTS({ toc: true, tocTitle: '目次' }) });
  assert.match(t, /\\begin\{document\}\n\\tableofcontents\n/);
  // 設定が無ければ今までどおり
  assert.strictEqual(D.toLatex(tree(en), { title: 'x', paper: 'Letter' }), D.toLatex(tree(en), { title: 'x', paper: 'Letter', opts: OPTS({}) }));
  assert.match(D.toLatex(tree(en), { title: 'x', paper: 'Letter' }), /\\documentclass\[letterpaper\]\{article\}[\s\S]*\\usepackage\[colorlinks,linkcolor=black,urlcolor=blue\]\{hyperref\}/);
});

test('Word: 用紙と向き・言語・目次のフィールド(開くときに更新する)', () => {
  const docx = o => { const z = readZip(D.toDocx(tree(), Object.assign({ title: 'x', lang: 'ja' }, o))); return n => { const e = z.find(x => x.name === n); return e ? e.data.toString('utf8') : null; }; };
  let g = docx({ paper: 'A5', opts: OPTS({ paper: 'A5', landscape: true }) });
  assert.match(g('word/document.xml'), /<w:pgSz w:w="11906" w:h="8391" w:orient="landscape"\/>/);
  g = docx({ paper: 'B5', opts: OPTS({ paper: 'B5' }) });
  assert.match(g('word/document.xml'), /<w:pgSz w:w="10318" w:h="14570"\/>/);
  g = docx({ paper: 'Legal' });
  assert.match(g('word/document.xml'), /<w:pgSz w:w="12240" w:h="20160"\/>/);
  // 言語: 英語などは w:val、日本語・中国語・韓国語は w:eastAsia。地域が無ければ付ける
  const langOf = l => docx({ opts: OPTS({ lang: l }) })('word/styles.xml').match(/<w:lang [^>]*\/>/)[0];
  assert.strictEqual(langOf(''), '<w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/>');
  assert.strictEqual(langOf('en'), '<w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/>');
  assert.strictEqual(langOf('en-GB'), '<w:lang w:val="en-GB" w:eastAsia="ja-JP" w:bidi="ar-SA"/>');
  assert.strictEqual(langOf('fr'), '<w:lang w:val="fr-FR" w:eastAsia="ja-JP" w:bidi="ar-SA"/>');
  assert.strictEqual(langOf('zh-TW'), '<w:lang w:val="en-US" w:eastAsia="zh-TW" w:bidi="ar-SA"/>');
  assert.strictEqual(langOf('ko'), '<w:lang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/>');
  assert.match(docx({ opts: OPTS({ lang: 'en' }) })('docProps/core.xml'), /<dc:language>en<\/dc:language>/);
  // 目次: 題名の部分の次に、目次の見出し(見出しのスタイルにしない)と TOC のフィールド。更新する前の中身は見出しの文字
  g = docx({ meta: { title: '題' }, opts: OPTS({ toc: true, tocDepth: 2, tocTitle: '目次' }) });
  const doc = g('word/document.xml');
  assert.match(doc, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">題<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="TOCHeading"\/><\/w:pPr><w:r><w:t xml:space="preserve">目次<\/w:t>/);
  assert.match(doc, /<w:p><w:pPr><w:pStyle w:val="TOC1"\/><\/w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"\/><\/w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u <\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="separate"\/><\/w:r><w:r><w:t xml:space="preserve">大見出し<\/w:t><\/w:r><\/w:p>/);
  assert.match(doc, /<w:pStyle w:val="TOC2"\/><\/w:pPr><w:r><w:t xml:space="preserve">中見出し<\/w:t><\/w:r><w:r><w:fldChar w:fldCharType="end"\/><\/w:r><\/w:p>/);
  assert.ok(!/小見出し<\/w:t><\/w:r><w:r><w:fldChar/.test(doc), 'toc-depth より深い見出しは入れない');
  assert.match(g('word/settings.xml'), /<w:defaultTabStop w:val="840"\/><w:updateFields w:val="true"\/>/);
  const st = g('word/styles.xml');
  assert.match(st, /w:styleId="TOCHeading"><w:name w:val="TOC Heading"\/>/);
  for (let lv = 1; lv <= 6; lv++) assert.match(st, new RegExp('w:styleId="TOC' + lv + '"><w:name w:val="toc ' + lv + '"/>'));
  assert.ok(!/w:styleId="TOCHeading">[^]*?outlineLvl[^]*?<\/w:style>/.test(st.slice(st.indexOf('w:styleId="TOCHeading"'), st.indexOf('</w:style>', st.indexOf('w:styleId="TOCHeading"')) + 10)), '目次の見出しは目次に入れない');
  // 見出しが無くても、フィールドは入れる(空の項目)
  const empty = readZip(D.toDocx(D.bodyTree(core.md('本文だけ')), { title: 'x', opts: OPTS({ toc: true, tocTitle: 'Contents' }) })).find(e => e.name === 'word/document.xml').data.toString('utf8');
  assert.match(empty, /<w:pStyle w:val="TOC1"\/><\/w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"\/><\/w:r>[^]*?<w:fldChar w:fldCharType="separate"\/><\/w:r><w:r><w:fldChar w:fldCharType="end"\/><\/w:r><\/w:p>/);
  // 設定が無ければ今までどおり
  g = docx({});
  assert.ok(!/TOC|w:orient/.test(g('word/document.xml')) && !/updateFields/.test(g('word/settings.xml')) && !/dc:language/.test(g('docProps/core.xml')));
});

test('つなぎ込み: プレビュー・履歴・印刷・書き出しで設定を使い、main.js は値をそろえる', () => {
  const app = read('renderer/app.js'), main = read('main.js'), preload = read('preload.js'), css = read('renderer/styles.css');
  assert.match(app, /pv\.innerHTML = md\(cur\(\)\.text, \{ lines: true, fm: true \}\) [^\n]*\n\s+applyDocOpts\(pv, docOpts\(cur\(\)\.text\), 'pv-h-'\);/);
  assert.match(app, /body\.innerHTML = '<div class="md">' \+ md\(text, \{ lines: true, fm: true \}\) \+ '<\/div>';\n\s+applyDocOpts\(body\.firstChild, docOpts\(text\), 'hv-h-'\);/);
  assert.match(app, /applyDocOpts\(area\.firstChild, opts, 'ep-h-'\);/);
  assert.match(app, /if \(web\) applyDocOpts\(box, opts, 'ep-h-'\);/);
  assert.match(app, /'@page \{ margin: 18mm 16mm; background: #fff;' \+ \(size \? ' size: ' \+ size \+ ';' : ''\)/);
  assert.match(app, /api\.savePdf\(title, \{ paper: opts\.paper, landscape: opts\.landscape \}\)/);
  assert.match(app, /api\.print\(\{ paper: opts\.paper, landscape: opts\.landscape \}\)/);
  // 目次はプレビューで編集欄を開かない。項目を押すと見出しへ
  assert.match(app, /const PE_SKIP = '[^']*, \.toc';/);
  assert.match(app, /e\.target\.closest\('#preview \.toc a, #hvBody \.toc a'\)/);
  // 目次の見出しの言葉: 文書の言語が日本語か英語ならその言葉
  const tl = app.slice(app.indexOf('function tocLabel('), app.indexOf('function applyDocOpts('));
  const tocLabel = new Function('I18N', 'LANG', tl + '; return tocLabel;')(I18N, 'ja');
  assert.deepStrictEqual(['', 'en', 'en-GB', 'ja-JP', 'fr', 'english'].map(tocLabel), ['目次', 'Contents', 'Contents', '目次', '目次', '目次']);
  assert.match(preload, /print: page => ipcRenderer\.invoke\('print:print', page\),\n\s+savePdf: \(title, page\) => ipcRenderer\.invoke\('print:pdf', title, page\),/);
  // main.js: cleanOpts でそろえる。印刷は用紙を決めたときだけ渡す
  const src = main.slice(main.indexOf('const PAPER_NAMES'), main.indexOf("ipcMain.handle('print:print'"));
  const M = new Function(src + '; return { cleanOpts, printPage };')();
  assert.deepStrictEqual(M.cleanOpts(null), { toc: false, tocDepth: 3, tocTitle: '', lang: '', paper: '', landscape: false });
  assert.deepStrictEqual(M.cleanOpts({ toc: 'true', tocDepth: 9, tocTitle: 'a\nb', lang: 'en;x', paper: 'B4', landscape: 1 }), { toc: false, tocDepth: 3, tocTitle: 'a b', lang: '', paper: '', landscape: false });
  assert.deepStrictEqual(M.cleanOpts({ toc: true, tocDepth: 2, tocTitle: '目次', lang: 'en-US', paper: 'A5', landscape: true }), { toc: true, tocDepth: 2, tocTitle: '目次', lang: 'en-US', paper: 'A5', landscape: true });
  assert.deepStrictEqual(M.printPage(null), {});
  assert.deepStrictEqual(M.printPage({ paper: 'A5', landscape: true }), { pageSize: 'A5', landscape: true });
  assert.deepStrictEqual(M.printPage({ paper: 'B5' }), { pageSize: { width: 182000, height: 257000 } });
  assert.match(main, /win\.webContents\.print\(Object\.assign\(\{ printBackground: true \}, printPage\(page\)\)/);
  assert.match(main, /printToPDF\(Object\.assign\(\{ printBackground: true, preferCSSPageSize: true, pageSize: paperSize\(\) \}, cleanOpts\(page\)\.landscape \? \{ landscape: true \} : \{\}\)\)/);
  assert.match(main, /lang: opts\.lang \|\| lang, title: meta\.title \|\| title, author: meta\.author, keywords: meta\.keywords, pageSize: pageSizeCss\(opts\),/);
  // 目次の見た目は .md の規則(HTML・MHTML にも入る)
  assert.match(css, /^\.md \.toc \{/m);
  assert.match(P.exportCss(read('renderer/styles.css')), /\.md \.toc \.toc-2 \{ padding-left: 1\.25em; \}/);
});
