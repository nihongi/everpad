'use strict';
/* 整形された文書(HTML)の貼り付け: renderer/htmlmd.js と、画面・メニュー・設定へのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const H = require('../renderer/htmlmd');
const { parseMarkup } = require('../docexport');
const { buildTemplate } = require('../contextmenu');
const keymap = require('../keymap');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const tree = html => parseMarkup(html);
const md = (html, opts) => H.toMarkdown(tree(html), Object.assign({ imageLabel: '画像' }, opts)).md;
// EverPad のプレビューの HTML(md() の結果)を、元の Markdown に戻せるか
const round = src => md(core.md(src, { lines: true, fm: true }));

test('EverPad のプレビューからのコピー: 元の書き方に戻る', () => {
  for (const src of [
    '# 見出し\n\n本文の **太字** と *斜体* と ~~取り消し~~ と `コード`。\n2行目',
    '- りんご\n- みかん\n  - 温州\n- [x] 済み\n- [ ] まだ',
    '1. 一\n2. 二',
    '> 引用の1行目\n> 2行目',
    '> [!NOTE]\n> 注記です',
    '```\nconst a = 1;\n```',
    '| a | b |\n| :---: | ---: |\n| 1 | 2 \\| 3 |',
    '数式 $E = mc^2$ と\n\n$$\n\\frac{1}{2}\n$$',
    '```mermaid\ngraph TD\nA-->B\n```',
    '[メモ](note:20261118-090001-fmaaaa) と [サイト](https://example.com) と https://example.com/x',
    '![図](attach:0123456789abcdef.png) と [資料](attach:0123456789abcdef.pdf)',
    '絵文字 :smile: です',
    '本文[^1]\n\n[^1]: 注の文',
    '[見出しへ](#見出し)',
    '\\*星\\* と a\\*b\\*c'
  ]) assert.strictEqual(round(src), src);
  // フロントマター(タグは同じ並び)
  assert.strictEqual(round('---\ntags: [YAML, 設計]\nauthor: 山田\n---\n# 題'), '---\ntags: YAML, 設計\nauthor: 山田\n---\n\n# 題');
  // 番号は表示どおり(空行をはさんだ項目も同じリスト)
  assert.strictEqual(round('1. 一\n\n4. 四'), '1. 一\n2. 四');
});

test('ほかのアプリ: Google ドキュメント・Word・Excel・GitHub', () => {
  // Google ドキュメントは全体を <b style="font-weight:normal"> で囲み、太字・斜体は文字飾りの指定で付ける
  assert.strictEqual(md('<b style="font-weight:normal;" id="docs-internal-guid-1"><h1><span style="font-weight:400">見出し</span></h1><p><span style="font-weight:700">太い</span><span style="font-weight:400"> と </span><span style="font-style:italic;font-weight:400">斜め</span></p><ul><li><p><span>項目1</span></p></li><li><p><span>項目2</span></p></li></ul></b>'),
    '# 見出し\n\n**太い** と *斜め*\n\n- 項目1\n- 項目2');
  // Word: 箇条書きの段落。箇条書きの印(mso-list:Ignore)は外す(番号や入れ子は下の test)
  assert.strictEqual(md('<p class=MsoNormal><b><span>太字</span></b><span>の文<o:p></o:p></span></p><p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">・<span>&nbsp;&nbsp; </span></span><span>箇条1</span></p><p class=MsoListParagraphCxSpLast style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">・</span><span>箇条2</span></p>'),
    '**太字**の文\n\n- 箇条1\n- 箇条2');
  // Excel: 1行目を見出しの行に。配置は align から。| はエスケープ
  assert.strictEqual(md('<table><col width=72><tr><td>名前</td><td align=right>数</td></tr><tr><td>a|b</td><td>3</td></tr></table>'), '| 名前 | 数 |\n| --- | ---: |\n| a\\|b | 3 |');
  // 結合したセルは外す。見出しの無い行も揃える
  assert.strictEqual(md('<table><tr><th colspan=2>まとめ</th></tr><tr><td>1</td></tr></table>'), '| まとめ |   |\n| --- | --- |\n| 1 |   |');
  // GitHub のコード(言語は外側の div)と、文中のリンクとコード
  assert.strictEqual(md('<div class="highlight highlight-source-js"><pre><span class="pl-k">const</span> x = 1;\n<span>y</span>();</pre></div><p>see <a href="https://github.com">GitHub</a> and <code>x</code></p>'),
    '```js\nconst x = 1;\ny();\n```\n\nsee [GitHub](https://github.com) and `x`');
  assert.strictEqual(md('<pre><code class="language-python">print("a")\n```\n</code></pre>'), '````python\nprint("a")\n```\n````', '中に ``` があれば囲みを長く');
});

// Word の箇条書きの段落(Word が「Web ページ」で保存した HTML と同じ書き方。<![if !supportLists]> は画面の DOMParser ではコメントになるので省く)
const wordP = (lv, lfo, mark, text, font) => '<p class=MsoListParagraphCxSpMiddle style="margin-left:22.0pt;mso-add-space:\nauto;text-indent:-22.0pt;mso-list:l0 level' + lv + ' lfo' + lfo + '"><span lang=EN-US style="' + (font ? 'font-family:' + font + ';mso-fareast-font-family:' + font : 'mso-fareast-font-family:游明朝') + '"><span style="mso-list:Ignore">' + mark + '<span style="font:7.0pt &quot;Times New Roman&quot;">&nbsp;&nbsp;&nbsp; </span></span></span><span lang=EN-US>' + text + '</span></p>';
test('Word の番号付き・入れ子の箇条書き: 段の深さ(mso-list の level)と、しるしの文字から', () => {
  // アウトライン番号(1 / 1.1 / 1.1.1)。入れ子は上の段のしるしの幅だけ字下げ。番号は Word の表示から
  assert.strictEqual(md('<p class=MsoNormal>前</p>' + wordP(1, 1, '1', 'First') + wordP(2, 1, '1.1', 'First a') + wordP(3, 1, '1.1.1', 'First a i') + wordP(1, 1, '2', 'Second') + '<p class=MsoNormal>後</p>'),
    '前\n\n1. First\n   1. First a\n      1. First a i\n2. Second\n\n後');
  // 箇条書き: Wingdings・Symbol のしるし(l・§・·)や、Courier New の o
  assert.strictEqual(md(wordP(1, 2, 'l', 'Apple', 'Wingdings') + wordP(2, 2, 'o', 'Green', 'Courier New') + wordP(3, 2, '§', 'Light', 'Wingdings') + wordP(1, 2, '·', 'Orange', 'Symbol')),
    '- Apple\n  - Green\n    - Light\n- Orange');
  // 番号の下に箇条書き、箇条書きの下に番号。a. i. (1) ① ・全角の番号も番号付き(数字の無いものは 1 から数える)
  assert.strictEqual(md(wordP(1, 3, '3.', '三') + wordP(2, 3, 'l', '点', 'Wingdings') + wordP(2, 3, 'l', '点2', 'Wingdings') + wordP(1, 3, '4.', '四')),
    '3. 三\n   - 点\n   - 点2\n4. 四');
  assert.strictEqual(md(wordP(1, 4, '-', '点') + wordP(2, 4, 'a.', 'あ') + wordP(2, 4, 'b.', 'い') + wordP(3, 4, '(1)', 'う') + wordP(3, 4, '①', 'え') + wordP(1, 4, '１．', 'お')),
    '- 点\n  1. あ\n  2. い\n     1. う\n     1. え\n1. お');
  // 段が飛んだときは1段ずつ。番号の途中から(コピーしたのが3番目から)
  assert.strictEqual(md(wordP(1, 5, '3)', 'c') + wordP(3, 5, 'i.', 'ii')), '3. c\n   1. ii');
  // ふつうの段落をはさむと、別のリスト(番号は Word の表示のまま)
  assert.strictEqual(md(wordP(1, 6, '1.', 'a') + '<p class=MsoNormal>間</p>' + wordP(1, 6, '2.', 'b')), '1. a\n\n間\n\n2. b');
});
test('Google ドキュメントの、aria-level で入れ子を表した平らなリスト', () => {
  const li = (lv, t) => '<li dir="ltr" aria-level="' + lv + '"><p dir="ltr"><span>' + t + '</span></p></li>';
  assert.strictEqual(md('<ul>' + li(1, 'a') + li(2, 'b') + li(3, 'c') + li(1, 'd') + '</ul>'), '- a\n  - b\n    - c\n- d');
  assert.strictEqual(md('<ol start="2">' + li(1, 'a') + li(2, 'b') + li(2, 'c') + li(1, 'd') + '</ol>'), '2. a\n   1. b\n   2. c\n3. d');
  // ul の中の ul で入れ子にしたもの(段はどれも同じ)は、今までどおり
  assert.strictEqual(md('<ul>' + li(1, 'a') + '<ul>' + li(2, 'b') + '</ul>' + li(1, 'c') + '</ul>'), '- a\n  - b\n- c');
});
test('Word・Excel の一時ファイルの画像と、別のメモの添付の元', () => {
  const clip = 'file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image002.png';
  const r = H.toMarkdown(tree('<p class=MsoNormal>図: <img width=512 height=512 src="' + clip + '" v:shapes="図_x0020_1"> と <img src="file:///C:/Users/x/secret.png" alt="ほか"></p>'), { imageLabel: '画像' });
  assert.deepStrictEqual(r.images, [clip]);
  assert.strictEqual(r.md, '図: \u00000\u0000 と ほか');
  assert.strictEqual(H.isRich(tree('<p class=MsoNormal>文 <img src="' + clip + '"></p>')), true, '文字と画像だけでも画像を添付にする');
  // EverPad のプレビュー: 画像は src、ファイルは data-att-note から元のメモが分かる
  const p = H.toMarkdown(tree('<p><img class="att-img" data-att="0123456789abcdef.png" alt="図" src="everpad-file://f/20261118-100001-pastea/0123456789abcdef.png"> <a class="att-file" href="#" data-att="fedcba9876543210.pdf" data-att-note="20261118-100001-pastea" title="資料">資料</a> <img class="att-img" data-att="1111111111111111.png" alt="x"></p>'), {});
  assert.strictEqual(p.md, '![図](attach:0123456789abcdef.png) [資料](attach:fedcba9876543210.pdf) ![x](attach:1111111111111111.png)');
  assert.deepStrictEqual(p.atts, [{ note: '20261118-100001-pastea', file: '0123456789abcdef.png' }, { note: '20261118-100001-pastea', file: 'fedcba9876543210.pdf' }]);
});

test('整形があるときだけ Markdown にする(色やフォントだけの HTML は、今までどおり文字のまま)', () => {
  const vscode = '<div style="color: #cccccc;font-family: Consolas;white-space: pre;"><div><span style="color: #569cd6;">const</span> a = b * c;</div></div>';
  assert.strictEqual(H.isRich(tree(vscode)), false);
  assert.strictEqual(H.isRich(tree('<p>ただの段落</p><p>もう1つ</p>')), false);
  assert.strictEqual(H.isRich(tree('<b style="font-weight:normal"><p><span style="font-weight:400">太くない</span></p></b>')), false);
  for (const h of ['<h2>x</h2>', '<p><b>x</b></p>', '<p><span style="font-weight:bold">x</span></p>', '<ul><li>x</li></ul>', '<table><tr><td>x</td></tr></table>',
    '<p><a href="https://e.com">x</a></p>', '<p><img src="data:image/png;base64,AA=="></p>', '<span class="math" data-tex="x"></span>', '<pre>x</pre>'])
    assert.strictEqual(H.isRich(tree(h)), true, h);
  // 画像だけのコピー(Web ページの画像など)は、今までどおり添付にする(hasText が偽)
  assert.strictEqual(H.hasText(tree('<img src="https://e.com/a.png">')), false);
  assert.strictEqual(H.hasText(tree('<p>文 <img src="x"></p>')), true);
});

test('画像・リンク・危ないもの: タグは入れない。data: の画像は添付にする目印、Web の画像はリンク', () => {
  const r = H.toMarkdown(tree('<p>画像 <img src="data:image/png;base64,iVBORw0KGgo=" alt="x"> と <img src="https://example.com/a.png" alt="外"> と <img src="file:///C:/x.png" alt="ローカル"></p>'), { imageLabel: '画像' });
  assert.deepStrictEqual(r.images, ['data:image/png;base64,iVBORw0KGgo=']);
  assert.strictEqual(r.md, '画像 \u00000\u0000 と [外](https://example.com/a.png) と ローカル');
  assert.strictEqual(md('<p><img src="https://e.com/b.png"></p>'), '[画像](https://e.com/b.png)');
  // javascript: などのリンクは文字だけ。script・style は捨てる。HTML のタグは文字として残さない
  assert.strictEqual(md('<p><a href="javascript:alert(1)">押す</a><script>alert(1)</script><style>p{}</style> <a href="mailto:a@b.jp">メール</a></p>'), '押す [メール](mailto:a@b.jp)');
  assert.strictEqual(md('<p>&lt;b&gt;タグの文字&lt;/b&gt; <u>下線</u> <span style="color:red">赤</span></p>'), '<b>タグの文字</b> 下線 赤');
  // 表示の文字が URL そのものなら URL だけ。リンクの文字の ] はエスケープ
  assert.strictEqual(md('<p><a href="https://e.com/x">https://e.com/x</a> <a href="https://e.com/y">a]b</a></p>'), 'https://e.com/x [a\\]b](https://e.com/y)');
  // 制御文字は捨てる
  assert.strictEqual(md('<p>a\u0001b\u0007c</p>'), 'abc');
});

test('文字のエスケープ: Markdown の記号として読まれるときだけ', () => {
  assert.strictEqual(md('<p><b>太字</b> と 2 * 3 と a*b*c と $5 と $5 と [注] と [x](y) と :smile: と 12:30:45</p>'),
    '**太字** と 2 \\* 3 と a\\*b\\*c と \\$5 と \\$5 と [注] と \\[x](y) と \\:smile: と 12:30:45');
  // 行の初めの # > - 1. --- は文字のまま
  assert.strictEqual(md('<p><b>x</b><br># 見出しではない<br>&gt; 引用ではない<br>- 項目ではない<br>1. 番号ではない<br>---</p>'), '**x**\n\\# 見出しではない\n\\> 引用ではない\n\\- 項目ではない\n1\\. 番号ではない\n\\---');
  // \ の後に記号があるときだけ \ を重ねる(C:\Users はそのまま)
  assert.strictEqual(md('<p><b>C:\\Users</b> と a\\*b</p>'), '**C:\\Users** と a\\\\*b');
  // できたものを EverPad で表示すると、元の文字になる
  assert.strictEqual(core.md(md('<p><b>x</b> 2 * 3 * 4 と $a$ と [y](z)</p>')), '<p><strong>x</strong> 2 * 3 * 4 と $a$ と [y](z)</p>');
});

test('入れ子の書式・コード・チェックボックス・入れ子のリスト', () => {
  // EverPad は太字の中の斜体を書けないので、印を分けて並べる(表示は同じになる)
  const nested = md('<p><strong>太字の中の<em>斜体</em>です</strong></p>');
  assert.strictEqual(core.md(nested), '<p><strong>太字の中の</strong><em><strong>斜体</strong></em><strong>です</strong></p>');
  assert.strictEqual(md('<p>Press <kbd>Ctrl</kbd>+<kbd>C</kbd>. <code>a`b</code></p>'), 'Press `Ctrl`+`C`. ``a`b``');
  assert.strictEqual(md('<ul><li><input type="checkbox" checked> 済み</li><li><input type="checkbox"> まだ<ul><li>子</li></ul></li></ul><ol start="3"><li>三</li><li><p>四</p><p>続き</p></li></ol>'),
    '- [x] 済み\n- [ ] まだ\n  - 子\n\n3. 三\n4. 四\n   続き');
  // 項目の中のコードは字下げした囲み
  assert.strictEqual(md('<ul><li>手順<pre><code>npm test</code></pre></li></ul>'), '- 手順\n  ```\n  npm test\n  ```');
});

test('数式: KaTeX・MathML の LaTeX の注釈から戻す', () => {
  assert.strictEqual(md('<p>式 <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">x2</span></span> です</p>'), '式 $x^2$ です');
  assert.strictEqual(md('<p><span class="katex-display"><span class="katex"><math><annotation encoding="application/x-tex">\\sum_i a_i</annotation></math></span></span></p>'), '$$\\sum_i a_i$$');
  assert.strictEqual(md('<math display="block"><annotation encoding="application/x-tex">y = 1</annotation></math>'), '$$\ny = 1\n$$');
});

test('表のセル(1行の入力欄): 見出しやリストは作らず、改行は空白', () => {
  assert.strictEqual(md('<p><b>a</b> | b</p><ul><li>c</li></ul>', { inline: true }), '**a** | b c');
  assert.strictEqual(md('<h1>題</h1><p>本文</p>', { inline: true }), '題 本文');
});

test('fromDom: DOM の節を木にする(大きすぎるときは null)', () => {
  const el = (tag, attrs, kids) => ({ nodeType: 1, nodeName: tag.toUpperCase(), attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })), childNodes: kids });
  const tx = v => ({ nodeType: 3, nodeValue: v });
  const t = H.fromDom(el('body', {}, [el('p', { Class: 'x' }, [tx('a'), { nodeType: 8 }, el('b', {}, [tx('b')])])]));
  assert.deepStrictEqual(t, { tag: 'body', attrs: {}, children: [{ tag: 'p', attrs: { class: 'x' }, children: [{ text: 'a' }, { tag: 'b', attrs: {}, children: [{ text: 'b' }] }] }] });
  const big = el('body', {}, Array.from({ length: 50001 }, () => tx('x')));
  assert.strictEqual(H.fromDom(big), null);
});

test('画面: 貼り付け・テキストとして貼り付け・設定・メニューへのつなぎ込み', () => {
  const app = read('renderer/app.js'), main = read('main.js'), html = read('renderer/index.html'), pre = read('preload.js');
  assert.match(html, /<script src="htmlmd\.js"><\/script>\n<script src="app\.js"><\/script>/);
  // 「テキスト」表示: コードブロックの中では文字のまま。整形があれば Markdown、無ければ今までどおり(ファイルだけなら添付)
  assert.match(app, /const r = !inFenceAt\(ed\.value, ed\.selectionStart\) && pastedMarkdown\(cd, false\);\n\s+if \(r\) \{ e\.preventDefault\(\); pasteIntoEditor\(r\); return; \}/);
  // プレビューの編集欄: 表のセルは1行
  assert.match(app, /pastedMarkdown\(cd, pe\.kind === 'cell'\)/);
  // 設定がオフ・Ctrl+Shift+V の直後は文字のまま。画像だけのコピーは添付
  assert.match(app, /if \(!EDIT\.pasteRich \|\| Date\.now\(\) - plainPasteAt < 1500 \|\| !cd\) return null;/);
  assert.match(app, /if \(cd\.files && cd\.files\.length && !HtmlMd\.hasText\(tree\)\) return null;/);
  assert.match(app, /\(IS_MAC \? e\.metaKey : e\.ctrlKey\) && e\.shiftKey && !e\.altKey && e\.code === 'KeyV'\) plainPasteAt = Date\.now\(\);/);
  // 1回の編集として入れる(frInsert は元に戻せる入力)
  assert.match(app, /frInsert\(s, e, separateBlocks\(ed\.value, s, e, md\)\);/);
  // 「テキストとして貼り付け」: 覚えてから Chromium の書式なしの貼り付けを頼む
  assert.match(app, /else if \(name === 'pastePlain'\) \{ plainPasteAt = Date\.now\(\); api\.pastePlain\(\); \}/);
  assert.match(pre, /pastePlain: \(\) => ipcRenderer\.invoke\('edit:pastePlain'\)/);
  assert.match(main, /ipcMain\.handle\('edit:pastePlain', e => \{ if \(fromOurWindow\(e\)\) e\.sender\.pasteAndMatchStyle\(\); return null; \}\);/);
  // メニュー: Windows・Linux はキーを表示だけ(Chromium の Ctrl+Shift+V と2回にならないよう)
  assert.match(main, /\{ label: T\('mPastePlain'\), accelerator: 'CmdOrCtrl\+Shift\+V', registerAccelerator: process\.platform === 'darwin', click: \(\) => send\('pastePlain'\) \}/);
  assert.match(main, /onPastePlain: ctx \? \(\) => send\('pastePlain'\) : null/);
  // 設定: 既定はオン。画面には pr で渡す
  assert.match(main, /pasteRich: c\.pasteRich !== false/);
  assert.match(main, /pr: p\.pasteRich \? '1' : '0'/);
  assert.match(app, /pasteRich: query\.get\('pr'\) !== '0'/);
  assert.match(app, /check\(ed, T\('setPasteRich'\), T\('setPasteRichHint'\), P\.editor\.pasteRich, v => setPref\('pasteRich', v\)\);/);
  // 右クリック: 本文などでは「貼り付け」の次に。画面側が知らせないときは出さない
  const area = { isEditable: true, formControlType: 'text-area', editFlags: { canPaste: true } };
  const labels = t => t.map(x => (x.type === 'separator' ? '-' : x.label));
  const l = labels(buildTemplate(area, { lang: 'ja', onFormat: () => {}, onPastePlain: () => {} }));
  assert.deepStrictEqual(l.slice(l.indexOf('貼り付け'), l.indexOf('貼り付け') + 2), ['貼り付け', 'テキストとして貼り付け']);
  assert.ok(!labels(buildTemplate(area, { lang: 'ja', onFormat: () => {} })).includes('テキストとして貼り付け'));
  // キー: 変えられないキーとして一覧に出し、ほかの操作には割り当てられない
  assert.ok(keymap.fixedKeys('win32').some(k => k.label === 'mPastePlain' && k.keys[0] === 'CmdOrCtrl+Shift+V'));
  assert.ok(keymap.reservedKeys('win32').has('CmdOrCtrl+Shift+V') && keymap.reservedKeys('darwin').has('CmdOrCtrl+Shift+V'));
  for (const lang of ['ja', 'en']) for (const k of ['mPastePlain', 'setPasteRich', 'setPasteRichHint']) assert.ok(I18N.DICT[lang][k], lang + ' ' + k);
});
