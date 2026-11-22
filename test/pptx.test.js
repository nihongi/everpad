'use strict';
/* PowerPoint の書き出し(pptxexport.js): 測った場所に置く図形、数式(OMML)、表、画像と図、ファイルの部品、メニューなどへのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../pptxexport');
const { readZip } = require('../ziplite');
const I18N = require('../renderer/i18n');
const K = require('../keymap');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const unzip = buf => { const o = {}; for (const e of readZip(buf)) o[e.name] = e.data.toString('utf8'); return o; };
// 1x1 の PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math>';
// 開始と終了のタグが対応しているか(XML として読めるか)を、簡単に確かめる
function wellFormed(xml) {
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}
const slide = (fit, inner) => '<section class="slide" data-fit="' + fit + '"><div class="slide-in">' + inner + '</div></section>';
const BODY = slide('1',
  '<h1 data-box="80,100,1120,80">題名 <a href="https://example.com/">リンク</a></h1>'
  + '<p data-box="80,200,1120,50">式 <span class="math" data-tex="x^2" data-mml="' + MML.replace(/"/g, '&quot;') + '"></span> と <code>code</code></p>'
  + '<div class="tblwrap" data-box="80,300,400,120" data-cols="200,200" data-rows="60,60" data-cap="80,260,400,40"><table><caption>表題</caption><thead><tr><th class="al-l">A</th><th class="al-r">B</th></tr></thead><tbody><tr><td class="al-l">1</td><td class="al-r">2</td></tr></tbody></table></div>')
  + '\n' + slide('0.6',
    '<pre data-box="80,80,1120,120"><code>a &lt; b\n  c</code></pre>'
    + '<ol start="3" data-box="80,220,1120,140"><li>一<ul><li>入れ子</li></ul></li><li>二</li></ol>'
    + '<p data-box="80,380,240,135"><img data-att="0123456789abcdef.png" alt="絵" data-box="80,380,240,135"></p>'
    + '<div class="diagram" data-src="flowchart LR" data-png="' + PNG.toString('base64') + '" data-w="1" data-h="1" data-box="500,380,300,200"></div>'
    + '<blockquote data-box="80,600,600,60"><p>引用</p></blockquote>');

test('PowerPoint: スライドごとに部品を作り、16:9 にする', () => {
  const z = unzip(P.toPptx(BODY, { lang: 'ja', font: 'Yu Gothic UI', meta: { title: 'T', author: ['A'], keywords: ['k'] }, images: { '0123456789abcdef.png': { data: PNG, ext: 'png' } }, date: Date.UTC(2026, 10, 22) }));
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels', 'docProps/core.xml']) {
    assert.ok(z[name], name);
    if (/\.(xml|rels)$/.test(name)) assert.ok(wellFormed(z[name]), name + ' は XML として読める');
  }
  assert.match(z['ppt/presentation.xml'], /<p:sldSz cx="12192000" cy="6858000"\/>/);
  assert.strictEqual((z['ppt/presentation.xml'].match(/<p:sldId /g) || []).length, 2);
  assert.match(z['[Content_Types].xml'], /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(z['[Content_Types].xml'], /PartName="\/ppt\/slides\/slide2\.xml"/);
  assert.match(z['docProps/core.xml'], /<dc:title>T<\/dc:title><dc:creator>A<\/dc:creator><cp:keywords>k<\/cp:keywords>/);
  assert.match(z['ppt/theme/theme1.xml'], /<a:latin typeface="Yu Gothic UI"\/><a:ea typeface="Yu Gothic UI"\/>/);
  assert.ok(Object.keys(z).filter(n => /^ppt\/media\//.test(n)).length === 2, '画像と図');
});

test('PowerPoint: 測った場所に置き、文字の大きさは幅 1280px で 35px(26.25pt)× 縮めた割合', () => {
  const z = unzip(P.toPptx(BODY, { lang: 'ja', images: { '0123456789abcdef.png': { data: PNG, ext: 'png' } } }));
  const s1 = z['ppt/slides/slide1.xml'], s2 = z['ppt/slides/slide2.xml'];
  // 見出し: x=80px → 762000 EMU。h1 は 1.8em(47.25pt)の太字で、下に線
  assert.match(s1, /<a:off x="762000" y="952500"\/><a:ext cx="10668000" cy="762000"\/>/);
  assert.match(s1, /sz="4725" b="1"/);
  assert.match(s1, /<p:cxnSp>/);
  assert.match(s1, /sz="2625"/);
  // リンク
  assert.match(s1, /<a:hlinkClick r:id="rIdL1"\/>/);
  assert.match(z['ppt/slides/_rels/slide1.xml.rels'], /Id="rIdL1" Type="[^"]*\/hyperlink" Target="https:\/\/example\.com\/" TargetMode="External"/);
  // 縮めた割合 0.6: 35 × 0.6 = 21px → 15.75pt
  assert.match(s2, /sz="1575"/);
});

test('PowerPoint: 数式は PowerPoint の数式(a14:m の OMML)にし、読めないソフト用に LaTeX の文字の図形も入れる', () => {
  const s1 = unzip(P.toPptx(BODY, { lang: 'en' }))['ppt/slides/slide1.xml'];
  assert.match(s1, /<mc:AlternateContent><mc:Choice Requires="a14"><p:sp>[\s\S]*<a14:m><m:oMath><m:sSup>/);
  assert.match(s1, /<mc:Fallback><p:sp>[\s\S]*<a:t>x\^2<\/a:t>[\s\S]*<\/mc:Fallback><\/mc:AlternateContent>/);
  // Word の書式(w:rPr)は残さない
  assert.ok(!/<w:/.test(s1));
  assert.match(s1, /<m:r><a:rPr lang="en-US" sz="2625">[^]*?<a:latin typeface="Cambria Math"\/>/);
  // 数式の無い図形は、そのまま
  assert.strictEqual((s1.match(/<mc:AlternateContent>/g) || []).length, 1);
});

test('PowerPoint: 見えない文字(\\vphantom など)は空の文字にする(PowerPoint では見えてしまう)', () => {
  const mml = '<math><mrow><mi>H</mi><msub><mpadded width="0px"><mphantom><mi>X</mi></mphantom></mpadded><mn>2</mn></msub><mi>O</mi></mrow></math>';
  const s = unzip(P.toPptx(slide('1', '<p data-box="0,0,100,40"><span class="math" data-tex="\\ce{H2O}" data-mml="' + mml.replace(/"/g, '&quot;') + '"></span></p>'), {}))['ppt/slides/slide1.xml'];
  assert.ok(!/m:phant|>X</.test(s), s);
  assert.match(s, /<m:sSub>/);
});

test('PowerPoint: 表は測った列の幅・行の高さで、表題は上の文に', () => {
  const s1 = unzip(P.toPptx(BODY, {}))['ppt/slides/slide1.xml'];
  assert.match(s1, /<a:tblGrid><a:gridCol w="1905000"\/><a:gridCol w="1905000"\/><\/a:tblGrid>/);
  assert.strictEqual((s1.match(/<a:tr h="571500">/g) || []).length, 2);
  assert.match(s1, /<a:t>表題<\/a:t>/);
  assert.match(s1, /<a:pPr algn="r">/);
  assert.match(s1, /<a:solidFill><a:srgbClr val="F2F2F2"\/><\/a:solidFill><\/a:tcPr>/);
});

test('PowerPoint: 結合したセルは gridSpan・rowSpan と hMerge・vMerge', () => {
  const html = slide('1', '<div class="tblwrap" data-box="0,0,300,90" data-cols="100,100,100" data-rows="30,30,30"><table><thead><tr><th colspan="2">AB</th><th>C</th></tr></thead><tbody><tr><td rowspan="2">D</td><td>E</td><td>F</td></tr><tr><td>G</td><td>H</td></tr></tbody></table></div>');
  const s = unzip(P.toPptx(html, {}))['ppt/slides/slide1.xml'];
  assert.match(s, /<a:tc gridSpan="2">[\s\S]*?<\/a:tc><a:tc hMerge="1">/);
  assert.match(s, /<a:tc rowSpan="2">/);
  assert.match(s, /<a:tc vMerge="1">/);
  for (const tr of s.match(/<a:tr [\s\S]*?<\/a:tr>/g)) assert.strictEqual((tr.match(/<a:tc[ >]/g) || []).length, 3);
});

test('PowerPoint: コード・リスト・画像・図・引用', () => {
  const z = unzip(P.toPptx(BODY, { images: { '0123456789abcdef.png': { data: PNG, ext: 'png' } } }));
  const s2 = z['ppt/slides/slide2.xml'];
  // コード: 背景の色、折り返さない、等幅の文字、行ごとの段落
  assert.match(s2, /<a:srgbClr val="F6F8FA"\/>[\s\S]*?wrap="none"/);
  assert.match(s2, /<a:latin typeface="Consolas"\/>/);
  assert.match(s2, /<a:t>a &lt; b<\/a:t>[\s\S]*<a:t>  c<\/a:t>/);
  // 番号付きのリスト(3 から)と、入れ子の箇条書き(深さ 1)
  assert.match(s2, /<a:buAutoNum type="arabicPeriod" startAt="3"\/>/);
  assert.match(s2, /lvl="1"[^>]*>[\s\S]*?<a:buChar char="◦"\/>/);
  // 画像と図は画像の図形
  assert.strictEqual((s2.match(/<p:pic>/g) || []).length, 2);
  const rels = z['ppt/slides/_rels/slide2.xml.rels'];
  assert.match(rels, /Target="\.\.\/media\/image1\.png"/);
  assert.match(rels, /Target="\.\.\/media\/image2\.png"/);
  // 引用: 左の線(四角)と、灰色の文
  assert.match(s2, /<p:cNvPr id="\d+" name="Rectangle \d+"\/>/);
  assert.match(s2, /<a:srgbClr val="59636E"\/><\/a:solidFill><a:latin[^>]*\/><a:ea[^>]*\/><a:cs[^>]*\/><\/a:rPr><a:t>引用<\/a:t>/);
});

test('PowerPoint: 画像の一覧と、スライドが無いときも開けるファイル', () => {
  assert.deepStrictEqual(P.pptxImages(BODY + BODY), ['0123456789abcdef.png']);
  const z = unzip(P.toPptx('', {}));
  assert.strictEqual((z['ppt/presentation.xml'].match(/<p:sldId /g) || []).length, 1);
  assert.ok(wellFormed(z['ppt/slides/slide1.xml']));
  // 画像が無ければ media は入れない
  assert.ok(!Object.keys(unzip(P.toPptx(BODY, {}))).some(n => /image\d\.png$/.test(n) && n.includes('0123')));
});

test('PowerPoint: メニュー・キー・言葉・画面・main.js へのつなぎ込み', () => {
  const main = read('main.js'), app = read('renderer/app.js');
  assert.match(main, /T\('mExportPptx'\), accelerator: A\('pptx'\), click: \(\) => send\('pptx'\)/);
  assert.match(main, /T\('mExportPptx'\), click: pick\('exportPptx'\)/);
  assert.match(main, /pptx: \{ ext: 'pptx', title: 'pptxSaveTitle'/);
  assert.match(main, /await writePptxFile\(id, title, p\.bodyHtml, r\.filePath, meta,/);
  // 画像は、そのメモの添付からだけ読む
  const fn = main.slice(main.indexOf('async function writePptxFile'), main.indexOf('async function imagesToPng'));
  assert.match(fn, /store\.attachmentPath\(id, f\)/);
  assert.match(app, /action === 'exportPptx'\) exportPage\('pptx', n\)/);
  assert.match(app, /if \(slides\) fitForExport\(box, pptx \? pptxLayout : null\);/);
  assert.match(app, /\(kind === 'docx' \|\| pptx\) && !el\.classList\.contains\('math-error'\)/);
  assert.strictEqual(K.defaults('win32').pptx, '');
  for (const l of ['ja', 'en']) for (const k of ['mExportPptx', 'pptxSaveTitle', 'pptxSaved', 'pptxFailed']) assert.ok(I18N.DICT[l][k], l + ' ' + k);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('pptxexport.js'));
});
