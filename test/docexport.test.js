'use strict';
/* AsciiDoc・Word の書き出し: 本文の HTML の読み取り、構造への変換、AsciiDoc、Word の数式(OMML)、.docx の組み立て、つなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../docexport');
const core = require('../renderer/core');
const { readZip } = require('../ziplite');
const katex = require('katex');
require('katex/dist/contrib/mhchem.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const IMG = '0123456789abcdef.png';

/* 画面側(renderer/app.js の exportPage)と同じ形の本文を作る: 数式は中身を空にして data-mml を付け、画像には大きさを付ける */
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unattr = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const MML = { throwOnError: true, trust: false, strict: 'ignore', output: 'mathml', maxExpand: 1000, maxSize: 50 };
const mmlOf = (tex, display) => katex.renderToString(tex, Object.assign({ displayMode: !!display }, MML));
function body(markdown) {
  return core.md(markdown)
    .replace(/<(span|div) class="math( math-display)? math-src" data-tex="([^"]*)">[\s\S]*?<\/\1>/g, (m, tag, disp, t) => {
      try { return '<' + tag + ' class="math' + (disp || '') + '" data-tex="' + t + '" data-mml="' + attr(mmlOf(unattr(t), !!disp)) + '"></' + tag + '>'; } catch (e) { return '<' + tag + ' class="math' + (disp || '') + ' math-error" data-tex="' + t + '"></' + tag + '>'; }
    })
    .replace(/ loading="lazy">/g, ' data-w="640" data-h="480">');
}
/* XML として正しく入れ子になっているか(開きと閉じの対応、& の書き方) */
function assertWellFormed(xml, name) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<\?xml[^>]*\?>|<(?![/?A-Za-z])/g)) {
    if (m[0].startsWith('<?')) continue;
    assert.ok(m[2], name + ': 書き方の正しくないタグ: ' + xml.slice(m.index, m.index + 40));
    if (m[1]) assert.strictEqual(stack.pop(), m[2], name + ': 閉じタグの対応 ' + m[2]);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepStrictEqual(stack, [], name + ': 閉じていないタグ');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(xml), name + ': & がそのまま');
}

test('文書: HTML の読み取り(空の要素・自分で閉じる要素・文字参照)', () => {
  const r = D.parseMarkup('<p>a &amp; b &lt;c&gt; &#x1F600; &nbsp;<br><img alt="x &quot;y&quot;" data-w="3"><mspace width="1em"/>z</p>');
  const p = r.children[0];
  assert.strictEqual(p.tag, 'p');
  assert.strictEqual(p.children[0].text, 'a & b <c> 😀 \u00a0');
  assert.deepStrictEqual(p.children.map(c => c.tag || '#'), ['#', 'br', 'img', 'mspace', '#']);
  assert.strictEqual(p.children[2].attrs.alt, 'x "y"');
  assert.strictEqual(p.children[4].text, 'z');
});

test('文書: 本文 → 構造(見出し・段落・改行・リスト・チェック・番号の始まり・表の寄せ・引用・コード・画像)', () => {
  const t = D.bodyTree(body('# 題\n\n本文 **太** *斜* ~~消~~ `c`\n次の行 [L](https://x.example/)\n\n- [x] 済み\n- [ ] まだ\n  1. 子\n\n3. 三\n\n> 引用\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n```\nx\n```\n\n![図](attach:' + IMG + ')'));
  assert.deepStrictEqual(t.map(b => b.t), ['h', 'p', 'list', 'list', 'quote', 'table', 'pre', 'p']);
  assert.strictEqual(t[0].level, 1);
  assert.deepStrictEqual(t[1].c.map(x => x.t), ['text', 'b', 'text', 'i', 'text', 's', 'text', 'code', 'br', 'text', 'a']);
  assert.strictEqual(t[1].c.find(x => x.t === 'a').href, 'https://x.example/');
  assert.deepStrictEqual(t[2].items.map(i => i.check), [true, false]);
  assert.strictEqual(t[2].items[1].c[1].t, 'list');
  assert.strictEqual(t[2].items[1].c[1].ordered, true);
  assert.deepStrictEqual([t[3].ordered, t[3].start], [true, 3]);
  assert.deepStrictEqual(t[5].align, ['c', 'r']);
  assert.strictEqual(t[6].text, 'x');
  assert.deepStrictEqual(t[7].c, [{ t: 'img', file: IMG, alt: '図', w: 640, h: 480 }]);
  assert.deepStrictEqual(D.treeImages(t), [IMG]);
  assert.strictEqual(D.treeHasMath(t), false);
});

test('文書: 数式(文中・独立した行・段落の中の $$・誤り)', () => {
  const t = D.bodyTree(body('文 $x^2$ と $$\\frac12$$ と $\\frac{1}{$\n\n$$\n\\sum_i a_i\n$$'));
  // 段落の中の $$…$$ は、段落を分けて独立した行の数式にする
  assert.deepStrictEqual(t.map(b => b.t), ['p', 'math', 'p', 'math']);
  const inl = t[0].c.find(x => x.t === 'math');
  assert.strictEqual(inl.tex, 'x^2');
  assert.match(inl.mml, /<msup>/);
  assert.strictEqual(t[1].tex, '\\frac12');
  assert.strictEqual(t[2].c.find(x => x.t === 'math').error, true);
  assert.strictEqual(t[3].tex, '\\sum_i a_i');
  assert.strictEqual(D.treeHasMath(t), true);
});

test('AsciiDoc: 題名・数式と画像の属性・見出しの段', () => {
  // 先頭に大見出しが1つだけ → それが題名、## は == になる
  let a = D.toAsciiDoc(D.bodyTree(body('# 題\n\n## 節\n\n文')), { title: '別名' });
  assert.strictEqual(a, '= 題\n\n== 節\n\n文\n');
  // 大見出しが無い・複数 → メモの題名を題名にして、# は == にする
  a = D.toAsciiDoc(D.bodyTree(body('## 節\n\n文 $x$\n\n![図](attach:' + IMG + ')')), { title: 'メモ', imagesDir: 'メモ_images' });
  assert.strictEqual(a, '= メモ\n:stem: latexmath\n:imagesdir: メモ_images\n\n=== 節\n\n文 latexmath:[$$x$$]\n\nimage::' + IMG + '["図"]\n');
  a = D.toAsciiDoc(D.bodyTree(body('# A\n\n# B')), { title: 'T' });
  assert.match(a, /^= T\n\n== A\n\n== B\n$/);
  // 画像が無ければ imagesdir は書かない
  assert.ok(!/imagesdir/.test(D.toAsciiDoc(D.bodyTree(body('文')), { title: 'T', imagesDir: 'x' })));
});

test('AsciiDoc: 書式は日本語の文中でも効く書き方、記号を含む文はそのまま表示させる', () => {
  const a = D.toAsciiDoc(D.bodyTree(body('これは**太**と*斜*と~~消~~と`a|b]`です。\n2つ目の行\n\n記号 a_b_c と {x} と <<y>> と C:\\ と [z]')), { title: 'T' });
  const lines = a.split('\n');
  assert.strictEqual(lines[2], 'これは**太**と__斜__と[.line-through]##消##と``pass:c[a|b\\]]``です。 +');
  assert.strictEqual(lines[3], '2つ目の行');
  assert.strictEqual(lines[5], 'pass:c[記号 a_b_c と {x} と <<y>> と C:\\ と [z\\]]');
  // 最後が \ のコードは {backslash} にする(\] で閉じ括弧が打ち消されないように)
  assert.match(D.toAsciiDoc(D.bodyTree(body('`C:\\`')), { title: 'T' }), /``pass:c\[C:\]\{backslash\}``/);
  // リンク: URL は ++ で囲み、表示名の , と = もそのまま出す
  assert.match(D.toAsciiDoc(D.bodyTree(body('[a, b=c](https://x.example/a_b__c)')), { title: 'T' }), /link:\+\+https:\/\/x\.example\/a_b__c\+\+\[pass:c\[a, b=c\]\]/);
});

test('AsciiDoc: 行の先頭が AsciiDoc の記号に見えるときは {empty} を付ける', () => {
  const a = D.toAsciiDoc(D.bodyTree(body('文\n. 点で始まる\n= 等号\nNOTE: 注\n:attr: x\n// コメント\n最後')), { title: 'T' });
  const lines = a.split('\n').slice(2);
  assert.deepStrictEqual(lines.slice(1, 7), ['{empty}. 点で始まる +', '{empty}= 等号 +', '{empty}NOTE: 注 +', '{empty}:attr: x +', '{empty}// コメント +', '最後']);
});

test('AsciiDoc: リスト・チェック・番号の始まり・続くリストの区切り・引用・コード・表', () => {
  const a = D.toAsciiDoc(D.bodyTree(body('- a\n  - b\n    1. c\n- [x] d\n\n4. e\n5. f\n\n> q\n>\n> > qq\n\n```\nx <1>\n----\n```\n\n| h | i |\n|:-:|--:|\n| 1 | `a\\|b` |\n\n---')), { title: 'T' });
  assert.ok(a.includes('* a\n** b\n. c\n* [x] d\n\n//-\n\n[start=4]\n. e\n. f\n\n'), a);
  assert.ok(a.includes('______\nq\n\n_____\nqq\n_____\n______'), a);
  assert.ok(a.includes('[subs=-callouts]\n-----\nx <1>\n----\n-----'), a);
  assert.ok(a.includes('[cols="^,>",options="header"]\n|===\n|h |i\n\n|1 |``pass:c[a\\|b]``\n|==='), a);
  assert.ok(a.endsWith("\n'''\n"));
});

test('AsciiDoc: 数式は LaTeX のまま($$ で囲み、+ や ] が消えないように)', () => {
  const a = D.toAsciiDoc(D.bodyTree(body('文 $x+y+z_{[a]}$ 文\n\n$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$')), { title: 'T' });
  assert.ok(a.includes('文 latexmath:[$$x+y+z_{[a]}$$] 文'), a);
  assert.ok(a.includes('[latexmath]\n++++\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n++++'), a);
});

const omml = (tex, display) => D.mathmlToOmml(mmlOf(tex, display));
test('Word の数式: 分数・上付き・根号・囲み・二項係数', () => {
  let o = omml('\\sigma(t) = \\frac{1}{1+e^{-t}}');
  assert.match(o, /^<m:oMath>.*<\/m:oMath>$/);
  assert.match(o, /<m:f><m:num>.*<m:t xml:space="preserve">1<\/m:t>.*<\/m:num><m:den>.*<m:sSup><m:e>.*e<\/m:t>.*<\/m:e><m:sup>.*−.*t<\/m:t>.*<\/m:sup><\/m:sSup><\/m:den><\/m:f>/);
  // 数字は立体
  assert.match(o, /<m:rPr><m:sty m:val="p"\/><\/m:rPr><w:rPr>[^]*?<m:t xml:space="preserve">1<\/m:t>/);
  o = omml('\\sqrt[3]{x}+\\sqrt{y}');
  assert.match(o, /<m:rad><m:deg>.*3.*<\/m:deg><m:e>.*x.*<\/m:e><\/m:rad>/);
  assert.match(o, /<m:rad><m:radPr><m:degHide m:val="1"\/><\/m:radPr><m:deg\/><m:e>.*y.*<\/m:e><\/m:rad>/);
  o = omml('\\left(\\frac{a}{b}\\right)');
  assert.match(o, /^<m:oMath><m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/><\/m:dPr><m:e><m:f>/);
  assert.match(omml('\\binom{n}{k}'), /<m:f><m:fPr><m:type m:val="noBar"\/><\/m:fPr>/);
  // \left. … \right| は片側だけの囲み
  assert.match(omml('\\left.\\frac{a}{b}\\right|_0'), /<m:d><m:dPr><m:begChr m:val=""\/><m:endChr m:val="∣"\/>/);
});

test('Word の数式: 大型演算子(∑ ∫)・関数(sin・lim)', () => {
  let o = omml('\\sum_{i=1}^n a_i', true);
  assert.match(o, /<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*i.*=.*1.*<\/m:sub><m:sup>.*n.*<\/m:sup><m:e><m:sSub>/);
  o = omml('\\int_0^1 x^2\\,dx', true);
  assert.match(o, /<m:chr m:val="∫"\/><m:limLoc m:val="subSup"\/>/);
  o = omml('\\sum x');
  assert.match(o, /<m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><m:subHide m:val="1"\/><m:supHide m:val="1"\/>/);
  o = omml('\\sin x');
  assert.match(o, /<m:func><m:fName>.*<m:sty m:val="p"\/>.*sin<\/m:t><\/m:r><\/m:fName><m:e>.*x<\/m:t><\/m:r><\/m:e><\/m:func>/);
  assert.ok(!/\u2061/.test(o), '関数の適用の記号は残さない');
  o = omml('\\lim_{x\\to 0}\\frac{\\sin x}{x}', true);
  assert.match(o, /<m:func><m:fName><m:limLow><m:e>.*lim<\/m:t>.*<\/m:e><m:lim>.*→.*<\/m:lim><\/m:limLow><\/m:fName><m:e><m:f>/);
});

test('Word の数式: アクセント・上線・波括弧・行列・場合分け・aligned・\\tag', () => {
  let o = omml('\\hat{x}\\bar{y}\\vec{v}\\overline{AB}');
  assert.match(o, /<m:acc><m:accPr><m:chr m:val="\u0302"\/><\/m:accPr>/);
  assert.match(o, /<m:acc><m:accPr><m:chr m:val="\u0305"\/><\/m:accPr>/);
  assert.match(o, /<m:acc><m:accPr><m:chr m:val="\u20D7"\/><\/m:accPr>/);
  assert.match(o, /<m:bar><m:barPr><m:pos m:val="top"\/><\/m:barPr>/);
  assert.match(omml('\\underbrace{a+b}_{n}'), /<m:limLow><m:e><m:groupChr><m:groupChrPr><m:chr m:val="⏟"\/>/);
  o = omml('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}');
  assert.match(o, /<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/><\/m:dPr><m:e><m:m><m:mPr><m:plcHide m:val="1"\/><m:mcs>(<m:mc>.*?<\/m:mc>){2}<\/m:mcs><\/m:mPr>(<m:mr>(<m:e>.*?<\/m:e>){2}<\/m:mr>){2}<\/m:m>/);
  o = omml('\\begin{cases}1&x>0\\\\0&\\text{それ以外}\\end{cases}');
  assert.match(o, /<m:begChr m:val="\{"\/><m:endChr m:val=""\/>/);
  assert.match(o, /<m:rPr><m:nor\/><\/m:rPr>.*それ以外/);
  assert.match(o, /<m:mcJc m:val="left"\/>/);
  // aligned: 列の間を空けず、= の前に空の文字を置いて記号の間隔を保つ
  o = omml('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', true);
  assert.match(o, /<m:cGpRule m:val="3"\/><m:cGp m:val="0"\/>/);
  assert.match(o, /<m:mcJc m:val="right"\/>.*<m:mcJc m:val="left"\/>/);
  assert.match(o, /<m:e><m:r><m:t>\u200B<\/m:t><\/m:r><m:r>.*=<\/m:t>/);
  // \tag は式と番号を空白で並べる
  o = omml('x \\tag{1}', true);
  assert.ok(!/<m:m>/.test(o) && /x<\/m:t>.*\u2003\u2003.*\(1\)/.test(o), o);
});

test('Word の数式: 書体・色・化学式・取り消し・未知の要素', () => {
  let o = omml('\\mathbb{R}\\mathbf{v}\\mathrm{d}\\mathcal{L}');
  assert.match(o, /<m:scr m:val="double-struck"\/><m:sty m:val="p"\/>/);
  assert.match(o, /<m:sty m:val="b"\/>.*v<\/m:t>/);
  assert.match(o, /<m:scr m:val="script"\/>/);
  assert.match(omml('\\color{red}{x}+\\color{#00f}{y}'), /<w:color w:val="FF0000"\/>.*<w:color w:val="0000FF"\/>/);
  // 化学式の添字の位置合わせ(幅0の見えない文字)は、場所を取らない見えない要素
  o = omml('\\ce{H2O}');
  assert.match(o, /<m:sSub><m:e><m:phant><m:phantPr><m:show m:val="0"\/><m:zeroWid m:val="1"\/>/);
  assert.match(omml('\\cancel{x}'), /<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"\/><m:hideBot m:val="1"\/><m:hideLeft m:val="1"\/><m:hideRight m:val="1"\/><m:strikeBLTR m:val="1"\/><\/m:borderBoxPr>/);
  assert.match(omml('\\boxed{y}'), /<m:borderBox><m:e>/);
  assert.strictEqual(D.mathmlToOmml('<p>no math</p>'), null);
  assert.strictEqual(D.mathmlToOmml('<math><mfoo><mi>q</mi></mfoo></math>'), '<m:oMath><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">q</m:t></m:r></m:oMath>');
  // どの式も XML として正しい
  for (const t of ['\\frac{a<b}{c\\&d}', '\\ce{CO2 + C -> 2 CO}', '\\ce{^{14}_{6}C}', '\\overbrace{x+y}^{k}', '\\iint_D f\\,dA', 'a \\bmod b \\pmod{n}', "f'(x)", '\\left\\{ x \\middle| x>0 \\right\\}', '\\begin{array}{c|c}a&b\\end{array}']) {
    assertWellFormed(omml(t, true), t);
  }
});

function docxParts(buf) {
  const parts = {};
  for (const e of readZip(buf)) parts[e.name] = e.data;
  return parts;
}
test('Word: .docx の組み立て(部品・見出し・リスト・リンク・画像・表・数式)', () => {
  const md = '# 題 & <x>\n\n文 **太** [L](https://x.example/?a=1&b=2)\n\n- a\n  - b\n- [x] c\n\n3. d\n4. e\n\n> 引用\n\n| h | i |\n|:-:|--:|\n| 1 | $x$ |\n\n```\nx\ty\n```\n\n$$\n\\frac12\n$$\n\n![図](attach:' + IMG + ')\n\n![無し](attach:fedcba9876543210.webp)\n\n---';
  const png = fs.readFileSync(path.join(root, 'build', 'icon.png'));
  const buf = D.toDocx(D.bodyTree(body(md)), { title: '題 & <x>', lang: 'ja', paper: 'A4', generator: 'EverPad test', date: Date.UTC(2026, 9, 29), images: { [IMG]: { data: png, ext: 'png' } } });
  const p = docxParts(buf);
  assert.deepStrictEqual(Object.keys(p).slice(0, 2), ['[Content_Types].xml', '_rels/.rels']);
  for (const n of ['word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/settings.xml', 'word/numbering.xml', 'docProps/core.xml', 'docProps/app.xml', 'word/media/image1.png']) assert.ok(p[n], n);
  for (const [n, d] of Object.entries(p)) if (n.endsWith('.xml') || n.endsWith('.rels')) assertWellFormed(d.toString('utf8'), n);
  assert.ok(p['word/media/image1.png'].equals(png));
  const doc = p['word/document.xml'].toString('utf8');
  const rels = p['word/_rels/document.xml.rels'].toString('utf8');
  const types = p['[Content_Types].xml'].toString('utf8');
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">題 &amp; &lt;x&gt;<\/w:t>/);
  assert.match(doc, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">太<\/w:t>/);
  // リンクは外部への関係で、URL の & も正しく書く
  const link = /<w:hyperlink r:id="(rIdLink\d+)" w:history="1">/.exec(doc);
  assert.ok(link);
  assert.ok(rels.includes('Id="' + link[1] + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://x.example/?a=1&amp;b=2" TargetMode="External"'));
  // 箇条書きは numId 1(段は ilvl)、番号付きはリストごとの numId で、始まりの番号を持つ
  assert.match(doc, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/);
  assert.match(doc, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="1"\/><\/w:numPr>/);
  assert.match(doc, /<w:t>☑<\/w:t><w:tab\/>/);
  assert.match(doc, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="2"\/><\/w:numPr>/);
  assert.match(p['word/numbering.xml'].toString('utf8'), /<w:num w:numId="2"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"\/><\/w:lvlOverride><\/w:num>/);
  assert.match(doc, /<w:pStyle w:val="BlockQuote"\/>/);
  // 表: 見出しの行、寄せ、セルの中の数式
  assert.match(doc, /<w:tbl>.*<w:trPr><w:tblHeader\/><\/w:trPr>.*<w:jc w:val="center"\/>.*<w:jc w:val="right"\/>.*<m:oMath>.*<\/w:tbl>/);
  // コード: タブは w:tab
  assert.match(doc, /<w:pStyle w:val="SourceCode"\/>.*<w:t xml:space="preserve">x<\/w:t><w:tab\/><w:t xml:space="preserve">y<\/w:t>/);
  assert.match(doc, /<m:oMathPara><m:oMath><m:f>/);
  // 画像: 入れたものだけ(96dpi の 640×480px は本文の幅より広いので、幅に収める)。Word に入れられない形式で、渡されなかった画像は入れない
  assert.match(doc, /<wp:extent cx="5731510" cy="4298633"\/>.*<wp:docPr id="1" name="Picture 1" descr="図"\/>.*<a:blip r:embed="rIdImg1"\/>/);
  assert.strictEqual((doc.match(/<w:drawing>/g) || []).length, 1);
  assert.ok(rels.includes('Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"'));
  assert.ok(types.includes('<Default Extension="png" ContentType="image/png"/>'));
  assert.match(doc, /<w:pBdr><w:bottom /);
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  const core2 = p['docProps/core.xml'].toString('utf8');
  assert.ok(core2.includes('<dc:title>題 &amp; &lt;x&gt;</dc:title>') && core2.includes('2026-10-29T00:00:00Z'));
  // 見出しは Word の組み込みの「見出し 1〜6」(ナビゲーションウィンドウ・目次に出る)
  const styles = p['word/styles.xml'].toString('utf8');
  for (let i = 1; i <= 6; i++) assert.ok(styles.includes('<w:style w:type="paragraph" w:styleId="Heading' + i + '"><w:name w:val="heading ' + i + '"/>') && styles.includes('<w:outlineLvl w:val="' + (i - 1) + '"/>'));
});

test('Word: 大きい画像はページの幅に収め、用紙は Letter も選べる、本文が空でも開ける', () => {
  const tree = D.bodyTree('<p><img class="att-img" data-att="' + IMG + '" alt="" data-w="4000" data-h="2000"></p>');
  const p = docxParts(D.toDocx(tree, { paper: 'Letter', images: { [IMG]: { data: Buffer.from('x'), ext: 'png' } } }));
  const doc = p['word/document.xml'].toString('utf8');
  const w = (12240 - 2 * 1440) * 635;
  assert.match(doc, new RegExp('<wp:extent cx="' + w + '" cy="' + Math.round(w / 2) + '"/>'));
  assert.match(doc, /<w:pgSz w:w="12240" w:h="15840"\/>/);
  const empty = docxParts(D.toDocx([], {}))['word/document.xml'].toString('utf8');
  assert.match(empty, /<w:body><w:p\/><w:sectPr>/);
  assert.strictEqual(D.docxImageExt('0123456789abcdef.jpg'), 'jpeg');
  assert.strictEqual(D.docxImageExt('0123456789abcdef.webp'), null);
});

test('AsciiDoc・Word: メニュー・画面・main.js へのつなぎ込み', () => {
  const main = read('main.js'), app = read('renderer/app.js');
  assert.match(main, /require\('\.\/docexport'\)/);
  for (const [label, kind] of [['mExportAdoc', 'adoc'], ['mExportDocx', 'docx']]) {
    assert.match(main, new RegExp("T\\('" + label + "'\\), click: \\(\\) => send\\('" + kind + "'\\)"));
    assert.match(main, new RegExp("T\\('" + label + "'\\), click: pick\\('export" + kind[0].toUpperCase() + kind.slice(1) + "'\\)"));
  }
  assert.match(app, /action === 'exportAdoc'\) exportPage\('adoc', n\)/);
  assert.match(app, /action === 'exportDocx'\) exportPage\('docx', n\)/);
  const h = main.slice(main.indexOf("ipcMain.handle('export:page'"));
  assert.match(h.slice(0, h.indexOf('\n});')), /kind === 'adoc' \|\| kind === 'docx'\) \{\n\s+try \{\n\s+await writeDocFile\(id, title, p\.bodyHtml, kind, r\.filePath\)/);
  // 画像は、そのメモの添付からだけ読む
  const w = main.slice(main.indexOf('async function writeDocFile'), main.indexOf('async function imagesToPng'));
  assert.match(w, /filter\(f => store\.attachmentPath\(id, f\)\)/);
  assert.match(w, /docexport\.toDocx\(tree, \{ title: title, lang: lang, paper: paperSize\(\)/);
  const conv = main.slice(main.indexOf('async function imagesToPng'), main.indexOf('/* 画面にまだ書き出していない'));
  assert.match(conv, /show: false, webPreferences: \{ sandbox: true, contextIsolation: true, nodeIntegration: false \}/);
  assert.match(conv, /finally \{ w\.destroy\(\); \}/);
  // 画面側: 画像の大きさ、数式の中身を空にして MathML を付ける
  const fn = app.slice(app.indexOf('async function exportPage'), app.indexOf('/* ---------- 画面の上に出す小さな窓'));
  assert.match(fn, /img\.dataset\.w = img\.naturalWidth; img\.dataset\.h = img\.naturalHeight/);
  assert.match(fn, /output: 'mathml'/);
  assert.match(fn, /el\.textContent = ''/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('docexport.js') && pkg.build.files.includes('ziplite.js'));
});

test('AsciiDoc・Word: 表示の言葉(日本語・英語)と、ヘルプの分数の説明', () => {
  const I = require('../renderer/i18n');
  for (const l of ['ja', 'en']) for (const k of ['mExportAdoc', 'adocSaveTitle', 'adocSaved', 'adocFailed', 'mExportDocx', 'docxSaveTitle', 'docxSaved', 'docxFailed']) {
    const v = I.t(l, k, { path: 'X' });
    assert.ok(v && v !== k, l + ':' + k);
  }
  const H = require('../renderer/help-content');
  for (const l of ['ja', 'en']) {
    const s = H[l].sections.find(x => /数式|Math/.test(x.h));
    assert.match(s.note, /\\dfrac\{1\}\{3\}/);
    assert.match(s.src, /\$\\frac\{1\}\{3\}\$.*\$\\dfrac\{1\}\{3\}\$/);
  }
});
