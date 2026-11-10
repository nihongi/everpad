'use strict';
/* LaTeX の書き出し(docexport.js の toLatex): 前置き、文字のエスケープ、数式、リスト、脚注、表、コード、画像と図、注意書き */
const test = require('node:test');
const assert = require('node:assert');
const D = require('../docexport');
const core = require('../renderer/core');
require('katex');
require('katex/dist/contrib/mhchem.js');

/* 画面側(renderer/app.js の exportPage)と同じ形の本文: 数式は中身を空にし(読めない式は math-error)、画像には大きさを付ける */
const katex = require('katex');
const unattr = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function body(markdown) {
  return core.md(markdown)
    .replace(/<(span|div) class="math( math-display)? math-src" data-tex="([^"]*)">[\s\S]*?<\/\1>/g, (m, tag, disp, t) => {
      let err = '';
      try { katex.renderToString(unattr(t), { throwOnError: true, strict: 'ignore', displayMode: !!disp }); } catch (e) { err = ' math-error'; }
      return '<' + tag + ' class="math' + (disp || '') + err + '" data-tex="' + t + '"></' + tag + '>';
    })
    .replace(/ loading="lazy">/g, ' data-w="640" data-h="480">');
}
const tex = (md, o) => D.toLatex(D.bodyTree(body(md)), Object.assign({ title: 'T' }, o));
const doc = s => s.slice(s.indexOf('\\begin{document}'));
const preamble = s => s.slice(0, s.indexOf('\\begin{document}'));

test('LaTeX: 前置き(英語は article、日本語は ltjsarticle、用紙、題名、使う機能のパッケージだけ)', () => {
  let t = tex('Hello', { title: 'Notes', lang: 'en', generator: 'EverPad 9.9.9' });
  assert.match(t, /^% !TEX program = lualatex\n% Exported from EverPad 9\.9\.9\. Compile with LuaLaTeX/);
  assert.match(t, /\\documentclass\[a4paper\]\{article\}/);
  assert.deepStrictEqual(preamble(t).match(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g), ['\\usepackage[colorlinks,linkcolor=black,urlcolor=blue]{hyperref}']);
  assert.match(t, /\\setcounter\{secnumdepth\}\{0\}\n\\title\{Notes\}\n\\author\{\}\n\\date\{\}\n\n\\begin\{document\}\n\\maketitle\n\nHello\n\n\\end\{document\}\n$/);
  t = tex('こんにちは', { title: 'メモ', lang: 'ja', paper: 'Letter' });
  assert.match(t, /\\documentclass\[letterpaper\]\{ltjsarticle\}/);
  assert.match(t, /LuaLaTeX でコンパイルしてください/);
  // 題名に日本語があるだけでも ltjsarticle
  assert.match(tex('abc', { title: '日本' }), /\{ltjsarticle\}/);
  // 題名が空なら \maketitle を書かない
  t = tex('abc', { title: '' });
  assert.ok(!/\\title|\\maketitle/.test(t));
  // 本文が空でも文書になる
  assert.match(D.toLatex([], {}), /\\begin\{document\}\n\\end\{document\}\n$/);
});

test('LaTeX: 先頭のただ1つの大見出しは題名にして、## を \\section にする。そうでなければ # が \\section', () => {
  let t = tex('# 題 $x$\n\n## 節\n\n### 小節\n\n#### 4\n\n##### 5\n\n###### 6\n\n文', { title: '別名' });
  assert.match(t, /\\title\{題 \\texorpdfstring\{\\\(x\\\)\}\{x\}\}/);
  assert.match(doc(t), /\\section\{節\}\n\n\\subsection\{小節\}\n\n\\subsubsection\{4\}\n\n\\paragraph\{5\}\n\n\\subparagraph\{6\}\n\n文/);
  t = tex('# A\n\n# B', { title: 'T' });
  assert.match(t, /\\title\{T\}/);
  assert.match(doc(t), /\\section\{A\}\n\n\\section\{B\}/);
  assert.match(doc(tex('文\n\n# A')), /\\section\{A\}/);
});

test('LaTeX: 文字のエスケープ(特別な文字、合字にしない、改行)と書式', () => {
  const t = doc(tex('記号 \\ { } $ & % # _ ~ ^ ` -- --- \'\' << >> ,, と <tag>\n次の行\n\n**太**と*斜*と~~消~~'));
  assert.ok(t.includes('記号 \\textbackslash{} \\{ \\} \\$ \\& \\% \\# \\_ \\textasciitilde{} \\textasciicircum{} \\textasciigrave{} -\\kern0pt - -\\kern0pt -\\kern0pt - \'\\kern0pt \' <\\kern0pt < >\\kern0pt > ,\\kern0pt , と <tag>\\newline\n次の行'), t);
  assert.ok(t.includes('\\textbf{太}と\\textit{斜}と\\strikeThrough{消}'), t);
  assert.match(tex('~~消~~'), /\\usepackage\{lua-ul\}/);
  // 制御文字は捨てる、改行しない空白は ~
  assert.ok(doc(D.toLatex([{ t: 'p', c: [{ t: 'text', v: 'a\u0001b\u00a0c' }] }], {})).includes('ab~c'));
});

test('LaTeX: コード(文中は \\texttt、ブロックは EPcode、引数の中では1行ずつ)', () => {
  let t = tex('`a  b \'q\' "d" -- \\ {x} %`');
  assert.ok(doc(t).includes('\\texttt{a\\ \\ b \\textquotesingle{}q\\textquotesingle{} \\textquotedbl{}d\\textquotedbl{} -\\kern0pt - \\textbackslash{} \\{x\\} \\%}'), t);
  t = tex('```\n\\begin{x}\ntab\there\n  2\n```');
  assert.match(t, /\\usepackage\{fvextra\}\n\\DefineVerbatimEnvironment\{EPcode\}\{Verbatim\}\{breaklines,breakanywhere,tabsize=4\}/);
  assert.ok(doc(t).includes('\\begin{EPcode}\n\\begin{x}\ntab\there\n  2\n\\end{EPcode}'), t);
  // 終わりの印と同じ行を含むコードは、verbatim にしない
  t = doc(tex('```\na\n\\end{EPcode}\n```'));
  assert.ok(t.includes('\\noindent\\texttt{a}\\newline\n\\texttt{\\textbackslash{}end\\{EPcode\\}}'), t);
  // 脚注の中のコードブロック(空白はそのまま)
  t = doc(tex('文[^1]\n\n[^1]: 注\n\n    ```\n    x  y\n    ```'));
  assert.ok(t.includes('\\footnote{注\n\n\\noindent\\texttt{x\\ \\ y}}'), t);
});

test('LaTeX: リンク(\\url と \\href、# と % のエスケープ、引数の中で困る文字は %XX)', () => {
  const t = doc(tex('[説明](https://ex.example/a_b#f%20x?q=1&r=2) と https://ex.example/p_q#top と <https://ex.example/~u/{x}> と [](https://ex.example/e)'));
  assert.ok(t.includes('\\href{https://ex.example/a_b\\#f\\%20x?q=1&r=2}{説明}'), t);
  assert.ok(t.includes('\\url{https://ex.example/p_q\\#top}'), t);
  assert.ok(t.includes('\\href{https://ex.example/\\%7Eu/\\%7Bx\\%7D}{https://ex.example/\\textasciitilde{}u/\\{x\\}}'), t);
  assert.ok(t.includes('\\url{https://ex.example/e}'), t);
});

test('LaTeX: 数式(文中・独立した行・環境、コメント、読めない式)', () => {
  let t = tex('文 $E = mc^2$ と $x % c$ と $\\frac{1}{$ の後\n\n$$\n\\begin{aligned}a&=b\\\\\n\nc&=d\\end{aligned}\n$$\n\n$$\n\\begin{align*}\na &= b\n\\end{align*}\n$$');
  assert.match(t, /\\usepackage\{mathtools\}\n\\usepackage\{amssymb\}/);
  const d = doc(t);
  assert.ok(d.includes('文 \\(E = mc^2\\) と \\(x % c\n\\) と \\texttt{\\$\\textbackslash{}frac\\{1\\}\\{\\$} の後'), d);
  // 数式の中の空行は取る
  assert.ok(d.includes('\\[\n\\begin{aligned}a&=b\\\\\nc&=d\\end{aligned}\n\\]'), d);
  // align などの環境は \[ \] で囲まない
  assert.ok(d.includes('\n\\begin{align*}\na &= b\n\\end{align*}\n'), d);
  // 独立した行の読めない式は、元の文をコードとして
  assert.ok(doc(tex('$$\n\\badcommand{\n$$')).includes('\\begin{EPcode}\n$$\n\\badcommand{\n$$\n\\end{EPcode}'));
  // 表のセルの中の $$…$$ は \displaystyle
  assert.ok(doc(tex('| a |\n|---|\n| $$x$$ |')).includes('\\(\\displaystyle x\\)'));
});

test('LaTeX: KaTeX にだけある命令は、使っているものだけ定義する。パッケージも使っているものだけ', () => {
  const t = tex('$\\R \\ni x$ と $\\argmax_x \\red{y}$ と $\\set{x \\mid x>0}$ と $\\ce{H2O}$ と $\\cancel{a}+\\bm{v}+\\mathscr{L}$ と $\\empty$ と $\\llbracket a \\rrbracket$');
  const p = preamble(t);
  for (const pkg of ['[version=4]{mhchem}', '{cancel}', '{bm}', '{mathrsfs}', '{braket}', '{stmaryrd}', '{xcolor}']) assert.ok(p.includes('\\usepackage' + pkg), pkg);
  assert.ok(p.includes('\\providecommand{\\R}{\\mathbb{R}}'));
  assert.ok(p.includes('\\providecommand{\\argmax}{\\operatorname*{arg\\,max}}'));
  assert.ok(p.includes('\\providecommand{\\red}[1]{\\textcolor[HTML]{DF0030}{#1}}'));
  assert.ok(!/\\providecommand\{\\(N|Z|Complex|reals)\}/.test(p), p);
  assert.ok(!p.includes('{amscd}'));
  // KaTeX の \empty は ∅
  assert.ok(doc(t).includes('\\(\\emptyset\\)'));
  // \Ree などを \Re と取り違えない
  assert.ok(!preamble(tex('$\\Reals x$')).includes('\\providecommand{\\real}'));
  // 数式が無ければ数式のパッケージは入れない
  assert.ok(!/mathtools|amssymb/.test(preamble(tex('文'))));
});

test('LaTeX: 数式に直接書いたギリシャ文字と記号は命令にする(\\text{…} と \\ce{…} の中はそのまま)', () => {
  const d = doc(tex('$α ≤ β + φε + Ω + Α + ℝ + 30°$ と $αx$ と $\\text{α ≤} + \\ce{α} + \\mathrm{α}$'));
  assert.ok(d.includes('\\(\\alpha \\leq \\beta + \\varphi\\varepsilon + \\Omega + \\mathrm{A} + \\mathbb{R} + 30^{\\circ}\\)'), d);
  assert.ok(d.includes('\\(\\alpha x\\)'), d);
  assert.ok(d.includes('\\(\\text{α ≤} + \\ce{α} + \\mathrm{\\alpha}\\)'), d);
});

test('LaTeX: リスト(チェック、番号の始まり、[ で始まる項目、深い入れ子)', () => {
  let t = tex('- a\n  - b\n- [x] c\n- [ ] d\n- [e] f\n\n4. g\n5. h');
  const d = doc(t);
  assert.ok(d.includes('\\begin{itemize}\n\\item a\n\n\\begin{itemize}\n\\item b\n\\end{itemize}\n\\item[\\(\\boxtimes\\)] c\n\\item[\\(\\square\\)] d\n\\item {}[e] f\n\\end{itemize}'), d);
  assert.ok(d.includes('\\begin{enumerate}[start=4]\n\\item g\n\\item h\n\\end{enumerate}'), d);
  assert.match(t, /\\usepackage\{amssymb\}/);
  assert.match(t, /\\usepackage\{enumitem\}/);
  assert.ok(!/setlistdepth/.test(t));
  t = tex('- 1\n  - 2\n    - 3\n      - 4\n        - 5');
  assert.match(t, /\\usepackage\{enumitem\}\n\\setlistdepth\{9\}\n\\renewlist\{itemize\}\{itemize\}\{9\}/);
  // 番号が1から始まるだけなら enumitem は要らない
  assert.ok(!/enumitem/.test(tex('1. a\n2. b')));
});

test('LaTeX: 脚注(2回目からは \\footref、題名では \\thanks、注の中の参照、見出しの脚注は目次用の見出しを分ける)', () => {
  const t = tex('# 題[^n]\n\n## 節[^a]\n\n文[^b]と[^a]と[^c]。\n\n[^a]: 注A[^b][^d]\n[^b]: 注B\n[^c]: 注C\n[^d]: 注D\n[^n]: 題の注');
  assert.match(t, /\\title\{題\\thanks\{題の注\}\}/);
  const d = doc(t);
  // 注の中から、本文でも参照する注 B は \footref(先に出てきても LaTeX が番号を合わせる)。注の中からしか参照しない注 D は ( ) で入れる
  assert.ok(d.includes('\\section[{節}]{節\\footnote{\\label{EPfn2}注A\\footref{EPfn3} (注D)}}'), d);
  assert.ok(d.includes('文\\footnote{\\label{EPfn3}注B}と\\footref{EPfn2}と\\footnote{注C}。'), d);
  // 脚注の一覧そのものは書かない
  assert.ok(!/題の注/.test(d), d);
  // 自分を参照する注でも止まる
  assert.ok(doc(tex('文[^a]\n\n[^a]: 注[^a]')).includes('文\\footnote{\\label{EPfn1}注\\footref{EPfn1}}'));
});

test('LaTeX: 表(短い表は l/c/r、長い・改行のある表は折り返す列、本文は longtable、リストの中は tabular)', () => {
  let t = tex('| a | b | c |\n|:--|:-:|--:|\n| 1 | `x\\|y` | 3 |');
  assert.match(t, /\\usepackage\{array,longtable,booktabs\}/);
  assert.ok(doc(t).includes('\\begin{longtable}{lcr}\n\\toprule\n\\textbf{a} & \\textbf{b} & \\textbf{c} \\tabularnewline\n\\midrule\n\\endhead\n1 & \\texttt{x|y} & 3 \\tabularnewline\n\\bottomrule\n\\end{longtable}'), t);
  const long = 'あ'.repeat(40);
  t = doc(tex('| 左 | 右 |\n|---|--:|\n| ' + long + ' | 短い |'));
  assert.match(t, /\\begin\{longtable\}\{>\{\\raggedright\\arraybackslash\}p\{\\dimexpr0\.952\\linewidth-2\\tabcolsep\\relax\}>\{\\raggedleft\\arraybackslash\}p\{\\dimexpr0\.048\\linewidth-2\\tabcolsep\\relax\}\}/);
  t = doc(tex('> | a |\n> |---|\n> | 1 |'));
  assert.ok(t.includes('\\begin{quote}\n\\begin{center}\n\\begin{tabular}{l}\n\\toprule\n\\textbf{a} \\tabularnewline\n\\midrule\n1 \\tabularnewline\n\\bottomrule\n\\end{tabular}\n\\end{center}'), t);
  // 空のセル・足りないセル
  t = doc(tex('| a | b |\n|---|---|\n| 1 |'));
  assert.ok(t.includes('1 &  \\tabularnewline'), t);
});

test('LaTeX: 画像と図(\\graphicspath、大きさ、PNG にした名前、見つからない画像、フォルダーの名前)', () => {
  const IMG = '0123456789abcdef.png', WEBP = 'fedcba9876543210.webp';
  const md = '![図](attach:' + IMG + ')\n\n文 ![小](attach:' + WEBP + ') と ![無](attach:aaaaaaaaaaaaaaaa.png)\n\n```mermaid\ngraph TD\nA-->B\n```';
  const html = body(md).replace(/(<div class="diagram" data-src="[^"]*")><pre class="diagram-src">[\s\S]*?<\/pre><\/div>/g, (m, open) => open + ' data-png="iVBORw0KGgo=" data-w="300" data-h="200"></div>');
  const tree = D.bodyTree(html);
  assert.deepStrictEqual(D.texDiagrams(tree), [{ file: 'everpad-diagram-1.png', png: 'iVBORw0KGgo=' }]);
  const t = D.toLatex(tree, { title: 'T', imagesDir: 'メモ_images', images: { [IMG]: IMG, [WEBP]: 'fedcba9876543210-webp.png' } });
  assert.match(t, /\\usepackage\{graphicx\}\n\\graphicspath\{\{メモ_images\/\}\}\n\\newlength\{\\EPw\}\n%[^\n]*\n\\newcommand\{\\EPimage\}\[2\]/);
  const d = doc(t);
  assert.ok(d.includes('\\begin{center}\n\\EPimage{480bp}{' + IMG + '}\n\\end{center}'), d);
  assert.ok(d.includes('文 \\EPimage{480bp}{fedcba9876543210-webp.png} と [無]'), d);
  assert.ok(d.includes('\\begin{center}\n\\EPimage{225bp}{everpad-diagram-1.png}\n\\end{center}'), d);
  // フォルダーが無いときは、画像を参照しない(コンパイルできなくならないように)
  const none = D.toLatex(D.bodyTree(html), { title: 'T', images: { [IMG]: IMG } });
  assert.ok(!/graphicx|EPimage/.test(none));
  assert.ok(doc(none).includes('[図]'));
  assert.ok(doc(none).includes('\\begin{EPcode}\ngraph TD\nA-->B\n\\end{EPcode}'));
  // 名前の決まり
  assert.strictEqual(D.texImagesDir('メモ 1 {a}#%'), 'メモ_1__a____images');
  assert.strictEqual(D.texImagesDir('a-b.c_d'), 'a-b.c_d_images');
  assert.ok(D.texImageOk('a.png') && D.texImageOk('a.JPG') && D.texImageOk('a.jpeg') && !D.texImageOk('a.webp') && !D.texImageOk('a.gif'));
});

test('LaTeX: 引用・注意書き・区切り線', () => {
  const t = tex('> q\n>\n> > qq\n\n> [!NOTE]\n> 本文\n\n> [!CAUTION]\n> 注意\n\n---');
  const p = preamble(t);
  assert.match(p, /\\usepackage\{xcolor\}/);
  assert.match(p, /\\usepackage\{tcolorbox\}\n\\tcbuselibrary\{skins,breakable\}\n\\definecolor\{EPnote\}\{HTML\}\{0969DA\}\n\\definecolor\{EPcaution\}\{HTML\}\{CF222E\}\n\\newtcolorbox\{EPalert\}/);
  assert.ok(!/EPtip/.test(p));
  const d = doc(t);
  assert.ok(d.includes('\\begin{quote}\nq\n\n\\begin{quote}\nqq\n\\end{quote}\n\\end{quote}'), d);
  assert.match(d, /\\begin\{EPalert\}\{EPnote\}\{[^}]+\}\n本文\n\\end\{EPalert\}/);
  assert.ok(d.includes('\\noindent\\rule{\\linewidth}{0.4pt}'), d);
});
