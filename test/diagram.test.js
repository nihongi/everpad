'use strict';
/* Mermaid の図: Markdown の読み取り、AsciiDoc・Word への書き出し、画面・ヘルプ・ビルドへのつなぎ込み
   (図を描くのは画面の mermaid.min.js なので、ここでは描く前と後の HTML の扱いを確かめる) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const D = require('../docexport');
const P = require('../pageexport');
const { readZip } = require('../ziplite');
const HELP = require('../renderer/help-content');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const F = '```';
const srcs = html => [...html.matchAll(/class="diagram" data-src="([^"]*)"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

test('図: ```mermaid のコードブロックは図のかたまりになり、元の文をコードとして出す', () => {
  const src = 'flowchart LR\n  A["a & <b>"] --> B\n  B -->|"x"| C[C:\\Users]';
  const html = core.md('前\n\n' + F + 'mermaid\n' + src + '\n' + F + '\n\n後');
  assert.deepStrictEqual(srcs(html), [src]);
  assert.match(html, /<div class="diagram" data-src="[^"]*"><pre class="diagram-src"><code>flowchart LR\n {2}A\[&quot;a &amp; &lt;b&gt;&quot;\]/);
  assert.ok(!/<b>/.test(html), 'HTML として読まれない');
  assert.match(html, /^<p>前<\/p>\n<div class="diagram"[\s\S]*<\/div>\n<p>後<\/p>$/);
});

test('図: ~~~ でも書け、閉じていなければ最後まで、ほかの言語のコードブロックはそのまま', () => {
  assert.deepStrictEqual(srcs(core.md('~~~mermaid\npie\n  "A" : 1\n~~~')), ['pie\n  "A" : 1']);
  assert.deepStrictEqual(srcs(core.md(F + 'mermaid  \ngraph TD\n  A-->B')), ['graph TD\n  A-->B']);
  assert.deepStrictEqual(srcs(core.md('````mermaid\na\n' + F + '\nb\n````')), ['a\n' + F + '\nb']);
  for (const md of [F + 'js\nx\n' + F, F + 'mermaidx\nx\n' + F, F + '\nmermaid\n' + F]) {
    assert.deepStrictEqual(srcs(core.md(md)), [], md);
    assert.match(core.md(md), /<pre><code>/);
  }
  assert.deepStrictEqual(srcs(core.md(F + 'mermaid\n' + F)), ['']);
});

/* 画面側(app.js の exportPage)と同じ形: 図の中身を空にし、Word には PNG を付ける */
const PNG = fs.readFileSync(path.join(root, 'build', 'icon.png'));
const exported = (md, png) => core.md(md).replace(/(<div class="diagram" data-src="[^"]*")><pre class="diagram-src">[\s\S]*?<\/pre><\/div>/g,
  (m, open) => open + (png ? ' data-png="' + png + '" data-w="300" data-h="200"' : '') + '></div>');

test('図の書き出し: 構造と AsciiDoc([mermaid] のブロックで元の文のまま)', () => {
  const src = 'flowchart TD\n  A --> B\n....\n  B --> C';
  const tree = D.bodyTree(exported('# 題\n\n' + F + 'mermaid\n' + src + '\n' + F + '\n\n文'));
  assert.deepStrictEqual(tree[1], { t: 'diagram', src: src, png: '', w: 0, h: 0 });
  const adoc = D.toAsciiDoc(tree, { title: '題' });
  assert.ok(adoc.includes('[mermaid]\n.....\n' + src + '\n.....\n\n文'), adoc);
  // PNG に見えない値は捨てる
  assert.strictEqual(D.bodyTree('<div class="diagram" data-src="x" data-png="ab&quot;cd"></div>')[0].png, '');
});

test('図の書き出し: Word では PNG の画像(中央)、PNG が無い・壊れているときは元の文', () => {
  const md = F + 'mermaid\nflowchart LR\n  A --> B\n' + F;
  const parts = buf => { const p = {}; for (const e of readZip(buf)) p[e.name] = e.data; return p; };
  const p = parts(D.toDocx(D.bodyTree(exported(md, PNG.toString('base64'))), {}));
  assert.ok(p['word/media/image1.png'].equals(PNG));
  const doc = p['word/document.xml'].toString('utf8');
  assert.match(doc, /<w:jc w:val="center"\/><\/w:pPr><w:r><w:drawing>/);
  assert.match(doc, /<wp:extent cx="2857500" cy="1905000"\/>/);   // 300×200px
  assert.match(p['[Content_Types].xml'].toString('utf8'), /Extension="png"/);
  for (const png of ['', Buffer.from('not a png').toString('base64')]) {
    const q = parts(D.toDocx(D.bodyTree(exported(md, png)), {}));
    assert.ok(!Object.keys(q).some(n => n.startsWith('word/media/')));
    assert.match(q['word/document.xml'].toString('utf8'), /<w:pStyle w:val="SourceCode"\/>[\s\S]*flowchart LR<\/w:t><w:br\/><w:t xml:space="preserve">  A --&gt; B/);
  }
});

test('図: HTML・MHTML の書き出しの CSS に図の規則が入る', () => {
  const css = P.exportCss(read('renderer/styles.css'));
  assert.match(css, /^\.md \.diagram \{[^}]*break-inside: avoid/m);
  assert.match(css, /^\.md \.diagram svg \{ max-width: 100%; height: auto; \}/m);
  assert.match(css, /^\.md \.diagram-error \.diagram-src \{/m);
});

test('図: 画面・ヘルプ・main.js・ビルドへのつなぎ込み', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['prestart', 'predist', 'predist:store']) assert.match(pkg.scripts[s], /node tools\/vendor-mermaid\.js/, s);
  assert.ok(pkg.devDependencies.mermaid);
  assert.ok(pkg.build.files.includes('renderer/**/*'));
  const vendor = read('tools/vendor-mermaid.js');
  assert.match(vendor, /dist', 'mermaid\.min\.js'/);
  assert.match(vendor, /'LICENSE'/);
  for (const f of ['renderer/index.html', 'renderer/help.html']) {
    assert.match(read(f), /<script src="core\.js"><\/script>\n<script src="diagram\.js"><\/script>/, f);
    assert.ok(!/vendor\/mermaid/.test(read(f)), f + ': 図があるときだけ読み込む');
  }
  // CSP は変えない(スクリプトは自分のファイルだけ、接続しない)
  assert.match(read('renderer/index.html'), /script-src 'self'; style-src 'self' 'unsafe-inline';[^"]*connect-src 'none'/);
  const dg = read('renderer/diagram.js');
  assert.match(dg, /s\.src = 'vendor\/mermaid\/mermaid\.min\.js'/);
  assert.match(dg, /securityLevel: 'strict'/);
  assert.match(dg, /htmlLabels: false, flowchart: \{ htmlLabels: false \}/);
  assert.match(dg, /maxTextSize: 50000, maxEdges: 500/);
  const app = read('renderer/app.js');
  assert.match(app, /return Diagrams\.render\(root, diagramOpts\)/);
  assert.match(app, /await hydrate\(area, n\.id, \{ light: true \}\)/);
  assert.match(app, /await Diagrams\.render\(box, \{ light: true \}\)/);
  assert.match(app, /closest\('\.math, \.diagram'\)/);
  assert.match(app, /Diagrams\.onThemeChange/);
  assert.match(read('renderer/help.js'), /Diagrams\.render\(root\)/);
  assert.match(read('main.js'), /T\(kind === 'diagram' \? 'mCopyDiagram' : 'mCopyTex'\)/);
  assert.match(read('preload.js'), /mathMenu: \(tex, kind\) => ipcRenderer\.invoke\('math:menu', tex, kind\)/);
});

test('図: 表示の言葉(日本語・英語)とヘルプの例', () => {
  for (const lang of ['ja', 'en']) {
    for (const k of ['mCopyDiagram', 'diagramCopied']) assert.ok(I18N.DICT[lang][k], lang + ' ' + k);
    const sec = HELP[lang].sections.find(s => /Mermaid/.test(s.h));
    assert.ok(sec, lang + ': ヘルプの節');
    assert.ok(!sec.noRender);
    assert.strictEqual(srcs(core.md(sec.src)).length, 1, lang + ': 例が図になる');
    const math = HELP[lang].sections.findIndex(s => /数式|Math/.test(s.h));
    assert.strictEqual(HELP[lang].sections.indexOf(sec), math + 1, lang + ': 数式の次');
  }
});
