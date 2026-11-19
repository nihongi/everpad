'use strict';
/* フロントマターの title・author・date: 値の読み方、メモの題名、書き出しの文書の情報 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const D = require('../docexport');
const P = require('../pageexport');
const { readZip } = require('../ziplite');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fm = s => '---\n' + s + '\n---\n本文の1行目\n';

test('値の読み方: 引用符・コメント・並び・ブロック', () => {
  assert.strictEqual(core.fmScalar('設計メモ'), '設計メモ');
  assert.strictEqual(core.fmScalar('"設計: 第2版"'), '設計: 第2版');
  assert.strictEqual(core.fmScalar('"a \\"b\\" \\\\ c"'), 'a "b" \\ c');
  assert.strictEqual(core.fmScalar("'It''s'"), "It's");
  assert.strictEqual(core.fmScalar('値 # コメント'), '値');
  assert.strictEqual(core.fmScalar('a#b'), 'a#b', '空白の後でない # はコメントではない');
  assert.strictEqual(core.fmScalar('#3 の件'), '', '# で始まる値は全体がコメント');
  assert.strictEqual(core.fmScalar('"閉じていない'), '"閉じていない');
  const en = t => core.frontMatter(fm(t)).entries[0];
  assert.deepStrictEqual(core.fmItems(en('author: [山田, "佐藤, 花子"]')), ['山田', '佐藤, 花子']);
  assert.deepStrictEqual(core.fmItems(en('author:\n  - 山田\n  - \'佐藤\'')), ['山田', '佐藤']);
  assert.deepStrictEqual(core.fmItems(en('author: 山田, 佐藤')), ['山田, 佐藤'], '[ ] の無いコンマでは分けない(YAML と同じ)');
  assert.strictEqual(core.fmText(en('title: 長い題名\n  の続き')), '長い題名 の続き');
  assert.strictEqual(core.fmText(en('title: |\n  一行目\n  二行目')), '一行目\n二行目');
  assert.strictEqual(core.fmText(en('title: >-\n  一行目\n  二行目')), '一行目 二行目');
});

test('YAML として正しく書いた値は、YAML のライブラリと同じに読む', t => {
  let yaml;
  try { yaml = require('js-yaml'); } catch (e) { t.skip('js-yaml がない'); return; }
  for (const s of ['title: 設計メモ', 'title: "設計: 第2版"', "title: 'It''s'", 'title: "#3 の件"', 'title: 値 # コメント',
    'title: "[下書き] 設計"', "title: '@山田さん'", 'title: 長い題名\n  の続き', 'author: [山田, "佐藤, 花子"]', 'author:\n  - 山田\n  - 佐藤',
    'author: 山田, 佐藤', 'date: "2026-11-19"']) {
    const y = yaml.load(s), f = core.frontMatter(fm(s)), e = f.entries[0], want = y[e.key];
    if (Array.isArray(want)) assert.deepStrictEqual(core.fmItems(e), want, s);
    else assert.strictEqual(core.fmText(e), want, s);
  }
});

test('題名: title があればそれ。無い・空・コメントだけなら、今までどおりフロントマターの後ろの最初の行', () => {
  assert.strictEqual(core.titleOf(fm('title: 設計メモ')), '設計メモ');
  assert.strictEqual(core.titleOf(fm('Title: "設計: 第2版"\ntags: [a]')), '設計: 第2版', 'キーの大文字・小文字は区別しない');
  assert.strictEqual(core.titleOf(fm('title: "#3 の件"')), '#3 の件', '先頭の # は題名の文字のまま');
  assert.strictEqual(core.titleOf(fm('title: "- 下書き"')), '- 下書き');
  assert.strictEqual(core.titleOf(fm('title: "**太字** :sunny:"')), '太字 ☀️', '装飾の記号は外し、絵文字にする');
  assert.strictEqual(core.titleOf(fm('title: ' + 'あ'.repeat(80))), 'あ'.repeat(60));
  for (const s of ['tags: a', 'title: ""', 'title: #3 の件', 'title:']) assert.strictEqual(core.titleOf(fm(s)), '本文の1行目', s);
  assert.strictEqual(core.titleOf('title: これは本文\n'), 'title: これは本文', 'フロントマターでなければ本文の1行目');
});

test('文書の情報(docMeta)と、本文の先頭の題名・著者・日付(titleBlockHtml)', () => {
  const m = core.docMeta(fm('title: T\nauthor: [山田, 佐藤]\ndate: 2026-11-19 # 作成日\ntags: [x, y]'));
  assert.deepStrictEqual(m, { title: 'T', author: ['山田', '佐藤'], date: '2026-11-19', keywords: ['x', 'y'] });
  assert.deepStrictEqual(core.docMeta('本文'), { title: '', author: [], date: '', keywords: [] });
  assert.strictEqual(core.docMeta(fm('title: ' + 'あ'.repeat(600))).title.length, 500, '書き出しの題名は 60 文字で切らない(500 まで)');
  assert.strictEqual(core.titleBlockHtml(m, '、'), '<header class="doc-head"><h1 class="doc-title">T</h1><p class="doc-author">山田、佐藤</p><p class="doc-date">2026-11-19</p></header>');
  assert.strictEqual(core.titleBlockHtml({ title: 'a<b', author: [], date: '' }), '<header class="doc-head"><h1 class="doc-title">a&lt;b</h1></header>');
  assert.strictEqual(core.titleBlockHtml(core.docMeta(fm('tags: [x]'))), '', 'タグだけなら出さない');
});

test('プレビューのフロントマターの枠: 値は引用符を外して出す。入れ子は今までどおり', () => {
  const h = core.md(fm('title: "設計: 第2版"\nauthor: [A, "B, C"]\ngeometry:\n  margin: 1in'), { fm: true });
  assert.match(h, /<span class="fm-k">title<\/span><span class="fm-v">設計: 第2版<\/span>/);
  assert.match(h, /<span class="fm-k">author<\/span><span class="fm-v">A, B, C<\/span>/);
  assert.match(h, /<span class="fm-k">geometry<\/span><span class="fm-v">margin: 1in<\/span>/);
});

const SRC = fm('title: "設計: 第2版"\nauthor: [山田, 佐藤]\ndate: 2026-11-19\ntags: [a, b]').replace('本文の1行目\n', '# 見出し\n\n本文\n');
const META = core.docMeta(SRC);
const TREE = () => D.bodyTree(core.md(SRC));

test('AsciiDoc: title を文書の題名にし(# は見出しのまま)、著者の行と revdate を書く', () => {
  const a = D.toAsciiDoc(TREE(), { title: 'x', meta: META });
  assert.match(a, /^= 設計: 第2版\n山田; 佐藤\n:revdate: 2026-11-19\n/);
  assert.match(a, /\n== 見出し\n/);
  // フロントマターが無ければ今までどおり(先頭の # が題名)
  assert.match(D.toAsciiDoc(D.bodyTree(core.md('# 見出し\n\n本文\n')), { title: 'x' }), /^= 見出し\n\n本文/);
  // 著者の名前の ; < > { } と、先頭の : は書かない。空になる名前は書かない(空の行は見出しの終わりになるため)
  assert.match(D.toAsciiDoc(TREE(), { meta: { title: 'T', author: [':: x  y', ';;'] } }), /^= T\nx y\n\n/);
});

test('LaTeX: \\title・\\author(複数は \\and)・\\date。title があれば # は \\section のまま', () => {
  const t = D.toLatex(TREE(), { title: 'x', meta: META, lang: 'ja' });
  assert.match(t, /\\title\{設計: 第2版\}\n\\author\{山田 \\and 佐藤\}\n\\date\{2026-11-19\}/);
  assert.match(t, /\\maketitle\n\n\\section\{見出し\}/);
  assert.match(t, /\{ltjsarticle\}/);
  assert.match(D.toLatex(TREE(), { meta: { title: 'A & B', author: ['C_D'], date: '' } }), /\\title\{A \\& B\}\n\\author\{C\\_D\}\n\\date\{\}/);
  const old = D.toLatex(D.bodyTree(core.md('# 見出し\n\n本文\n')), { title: 'x' });
  assert.match(old, /\\title\{見出し\}\n\\author\{\}\n\\date\{\}/);
});

test('Word: 本文の先頭に Title・Author・Date の段落、文書のプロパティにタイトル・作成者・キーワード', () => {
  const z = readZip(D.toDocx(TREE(), { title: 'x', meta: META, lang: 'ja' }));
  const get = n => z.find(e => e.name === n).data.toString('utf8');
  const doc = get('word/document.xml');
  assert.match(doc, /<w:body><w:p><w:pPr><w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">設計: 第2版<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="Author"\/><\/w:pPr><w:r><w:t xml:space="preserve">山田、佐藤<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="Date"\/>/);
  const props = get('docProps/core.xml');
  assert.match(props, /<dc:title>設計: 第2版<\/dc:title><dc:creator>山田; 佐藤<\/dc:creator><cp:keywords>a, b<\/cp:keywords>/);
  const st = get('word/styles.xml');
  for (const id of ['Title', 'Author', 'Date']) assert.match(st, new RegExp('w:styleId="' + id + '"'));
  // フロントマターが無ければ、題名の段落は入れず、タイトルは今までどおり
  const z2 = readZip(D.toDocx(D.bodyTree(core.md('本文')), { title: 'メモ' }));
  const g2 = n => z2.find(e => e.name === n).data.toString('utf8');
  assert.doesNotMatch(g2('word/document.xml'), /w:val="Title"/);
  assert.match(g2('docProps/core.xml'), /<dc:title>メモ<\/dc:title><dcterms:created/);
});

test('HTML・MHTML: <title> と author・keywords の meta', () => {
  const h = P.pageHtml({ lang: 'ja', title: 'T', author: ['山田', '佐藤'], keywords: ['a', 'b"'], head: '', foot: '', bodyHtml: '', css: '' });
  assert.match(h, /<meta name="author" content="山田, 佐藤">\n<meta name="keywords" content="a, b&quot;">\n<title>T<\/title>/);
  assert.doesNotMatch(P.pageHtml({ title: 'T', bodyHtml: '', css: '' }), /name="author"|name="keywords"/);
});

test('つなぎ込み: 画面は文書の情報を渡し、main.js はそろえてから書き出しに使う', () => {
  const app = read('renderer/app.js'), main = read('main.js');
  assert.match(app, /bodyHtml: box\.innerHTML, meta: meta, opts: Object\.assign\(\{ tocTitle: tocLabel\(opts\.lang\) \}, opts\) \}, kind\);/);
  // 印刷・PDF: 先頭に題名などを出し、PDF のタイトルになる窓の題名を、その間だけ文書の題名にする
  assert.match(app, /document\.title = meta\.title \|\| title;/);
  assert.match(app, /document\.title = winTitle;/);
  assert.match(main, /const meta = cleanMeta\(p\.meta\), opts = cleanOpts\(p\.opts\);/);
  assert.match(main, /title: meta\.title \|\| title, author: meta\.author, keywords: meta\.keywords/);
  for (const f of ['toAsciiDoc', 'toLatex', 'toDocx']) assert.match(main, new RegExp('docexport\\.' + f + '\\(tree, \\{ title: title, meta: meta,'));
  // cleanMeta: 形の違うものは捨て、長さをそろえる
  const src = main.slice(main.indexOf('function cleanMeta('), main.indexOf("ipcMain.handle('export:page'"));
  const cleanMeta = new Function(src + '; return cleanMeta;')();
  assert.deepStrictEqual(cleanMeta(null), { title: '', author: [], date: '', keywords: [] });
  assert.deepStrictEqual(cleanMeta({ title: 5, author: 'x', date: 'a\nb', keywords: ['k', 3, ''] }), { title: '', author: [], date: 'a b', keywords: ['k'] });
  assert.strictEqual(cleanMeta({ title: 'あ'.repeat(900) }).title.length, 500);
  assert.strictEqual(cleanMeta({ author: Array(30).fill('a') }).author.length, 20);
  // 文言と見た目
  assert.match(read('renderer/i18n.js'), /authorSep: '、'/);
  assert.match(read('renderer/styles.css'), /^\.md \.doc-head \{/m);
});

test('Markdown の書き方: フロントマターの例(枠にして出す)と、キーの表(日本語と英語でそろう)', () => {
  const H = require('../renderer/help-content');
  for (const l of ['ja', 'en']) {
    const ex = H[l].sections.find(s => s.fm), keys = H[l].sections.find(s => s.rows);
    assert.ok(ex && keys, l);
    const html = core.md(ex.src, { fm: true });
    assert.match(html, /<div class="fm">/, l);
    assert.match(html, /<span class="fm-k">title<\/span>/, l);
    assert.strictEqual(core.docMeta(ex.src).author.length, 2, l);
    assert.deepStrictEqual(keys.rows.map(r => r[0]), ['tags', 'title', 'author', 'date', 'toc', 'toc-depth', 'lang', 'papersize', 'orientation'], l);
    assert.strictEqual(H[l].keyHead.length, 2, l);
  }
  const help = read('renderer/help.js');
  assert.match(help, /md\(sec\.src, sec\.fm \? \{ fm: true \} : undefined\)/);
  assert.match(help, /querySelectorAll\('\.tag-link'\)/);
  assert.match(read('renderer/help.css'), /^\.help \.keys \{/m);
});
