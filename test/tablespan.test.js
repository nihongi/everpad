'use strict';
/* 表の MultiMarkdown の書き方: セルの結合(横は「||」、縦は「^^」)、表題(「[表題]」の行)、見出しの行を複数にする。
   表示(core.js の md)、表の操作(tableEdit の結合・解除と、結合したセルのまわりの行・列の挿入と削除)、貼り付け(htmlmd.js)、
   書き出し(docexport.js の Word・LaTeX・AsciiDoc)と、画面・メニューへのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const H = require('../renderer/htmlmd');
const D = require('../docexport');
const { readZip } = require('../ziplite');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const L = s => s.split('\n');
// 表の HTML から、class と data- を除いたもの
const bare = h => h.replace(/ (class|data-[a-z]+)="[^"]*"/g, '').replace(/<\/?div>/g, '').replace(/\n/g, '');
const paste = h => H.toMarkdown(D.parseMarkup(h), { imageLabel: '画像' }).md;

const SALES = '[売上][uriage]\n| 品目 | 期間 ||\n| ^^ | 上期 | 下期 |\n|---|---|---:|\n| 果物 | りんご | 100 |\n| ^^ | みかん | 80 |\n| 合計 || 180 |';

test('表示: 横の結合(||)・縦の結合(^^)・見出しの行を複数・表題とラベル', () => {
  assert.strictEqual(bare(C.md(SALES)), '<table><caption>売上</caption><thead>'
    + '<tr><th rowspan="2">品目</th><th colspan="2">期間</th></tr><tr><th>上期</th><th>下期</th></tr></thead><tbody>'
    + '<tr><td rowspan="2">果物</td><td>りんご</td><td>100</td></tr><tr><td>みかん</td><td>80</td></tr><tr><td colspan="2">合計</td><td>180</td></tr></tbody></table>');
  const h = C.md(SALES, { lines: true });
  assert.match(h, /<table data-label="uriage"><caption data-line="0" data-end="1">売上<\/caption>/);
  // 行の範囲: 見出しの行はそれぞれ1行、最後の見出しの行は区切りの行まで。セルには元の文の列
  assert.match(h, /<tr data-line="1" data-end="2"><th class="al-l" rowspan="2" data-col="0">品目<\/th><th class="al-l" colspan="2" data-col="1">期間<\/th><\/tr>/);
  assert.match(h, /<tr data-line="2" data-end="4"><th class="al-l" data-col="1">上期<\/th><th class="al-r" data-col="2">下期<\/th><\/tr>/);
  assert.match(h, /<td class="al-l" colspan="2" data-col="0">合計<\/td><td class="al-r" data-col="2">180<\/td>/);
  // 書き出し・印刷(行の範囲なし)には data-col を付けない
  assert.ok(!/data-col/.test(C.md(SALES)));
  // 縦横の両方: 下の行に同じ幅の「^^ ||」
  assert.strictEqual(bare(C.md('| a | b | c |\n|---|---|---|\n| X || y |\n| ^^ || z |')), '<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody>'
    + '<tr><td colspan="2" rowspan="2">X</td><td>y</td></tr><tr><td>z</td></tr></tbody></table>');
});

test('表示: 結合しないもの(空白のある空のセル、行の最初の ||、幅の違う ^^、見出しと本文をまたぐ ^^、\\^^)', () => {
  const t = s => bare(C.md('| a | b | c |\n|---|---|---|\n' + s)).replace(/^.*<tbody>|<\/tbody>.*$/g, '');
  assert.strictEqual(t('| x | | y |'), '<tr><td>x</td><td></td><td>y</td></tr>');
  assert.strictEqual(t('|| x | y |'), '<tr><td></td><td>x</td><td>y</td></tr>');
  assert.strictEqual(t('| X || y |\n| ^^ | z | w |'), '<tr><td colspan="2">X</td><td>y</td></tr><tr><td>^^</td><td>z</td><td>w</td></tr>');
  assert.strictEqual(t('| ^^ | z | w |'), '<tr><td>^^</td><td>z</td><td>w</td></tr>');
  assert.strictEqual(t('| x | y | z |\n| \\^^ | y | z |'), '<tr><td>x</td><td>y</td><td>z</td></tr><tr><td>^^</td><td>y</td><td>z</td></tr>');
  // 横の結合が行の終わりにあっても、列の数は変わらない
  assert.strictEqual(t('| x | y ||'), '<tr><td>x</td><td colspan="2">y</td></tr>');
});

test('表示: 表題は表のすぐ上か下の「[…]」だけの行。上と下の両方なら上。見出しに足すのは「|」で始まる行だけ', () => {
  const base = '| a | b |\n|---|---|\n| 1 | 2 |';
  assert.match(C.md(base + '\n[下の表題]'), /<table><caption>下の表題<\/caption>/);
  const both = C.md('[上]\n' + base + '\n[下]');
  assert.match(both, /<caption>上<\/caption>/);
  assert.match(both, /<\/table><\/div>\n<p>\[下\]<\/p>/);
  // 空の行をはさむと表題ではない。脚注 [^1]・リンクだけの行・空の [ ] も表題ではない
  assert.ok(!/<caption>/.test(C.md('[離れた]\n\n' + base)));
  for (const l of ['[^1]', '[リンク](https://example.com/)', '[ ]']) assert.ok(!/<caption>/.test(C.md(l + '\n' + base)), l);
  // 段落の終わりの行: 「|」で始まれば見出しの行、そうでなければ段落のまま
  const p = C.md('説明の文\n| 上 | の見出し |\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(p, /<p[^>]*>説明の文<\/p>/);
  assert.match(bare(p), /<thead><tr><th>上<\/th><th>の見出し<\/th><\/tr><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/);
  assert.match(C.md('A|B の比較\n| a | b |\n|---|---|'), /<p>A\|B の比較<\/p>/);
  // 表題・見出しの行・段落が続くとき
  const q = C.md('前の段落\n[表題]\n| x | y |\n| a | b |\n|---|---|');
  assert.match(q, /<p>前の段落<\/p>/);
  assert.match(bare(q), /<caption>表題<\/caption><thead><tr><th>x<\/th><th>y<\/th><\/tr><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/);
  assert.deepStrictEqual(C.tableCaption('[表 [1] の題][lbl]'), { text: '表 [1] の題', label: 'lbl' });
  assert.deepStrictEqual(C.tableCaption('  [題]  '), { text: '題', label: '' });
});

test('表の操作: 表を探す(見出しの行・表題)、結合したセルの左上、結合の操作ができるか', () => {
  const t = C.tableAt(SALES, 5);
  assert.deepStrictEqual([t.heads, t.head, t.delim, t.rows, t.caption, t.first, t.last], [[1, 2], 2, 3, [4, 5, 6], 0, 0, 6]);
  assert.strictEqual(C.tableAt(SALES, 0), null);   // 表題の行は表の行ではない
  assert.deepStrictEqual(C.tableAnchor(SALES, 5, 0), { row: 4, col: 0 });
  assert.deepStrictEqual(C.tableAnchor(SALES, 6, 1), { row: 6, col: 0 });
  assert.deepStrictEqual(C.tableAnchor(SALES, 2, 0), { row: 1, col: 0 });
  assert.deepStrictEqual(C.tableSpan(SALES, 4, 0), { right: false, down: false, merged: true });
  assert.deepStrictEqual(C.tableSpan(SALES, 4, 1), { right: true, down: true, merged: false });
  assert.deepStrictEqual(C.tableSpan(SALES, 6, 2), { right: false, down: false, merged: false });
  assert.deepStrictEqual(C.tableSpan(SALES, 2, 2), { right: false, down: false, merged: false });   // 見出しと本文は結合しない
  // セルを移る: 結合したセルは1つ。最後の次は行を足す合図
  assert.deepStrictEqual(C.tableNav(SALES, 4, 0, 1, 0), { row: 4, col: 1 });
  assert.deepStrictEqual(C.tableNav(SALES, 5, 1, 1, 0), { row: 5, col: 2 });
  assert.deepStrictEqual(C.tableNav(SALES, 5, 2, 1, 0), { row: 6, col: 0 });
  assert.deepStrictEqual(C.tableNav(SALES, 6, 0, -1, 0), { row: 5, col: 2 });
  assert.deepStrictEqual(C.tableNav(SALES, 6, 2, 1, 0), { append: true });
  assert.deepStrictEqual(C.tableNav(SALES, 4, 0, 0, 1), { row: 6, col: 0 });   // 縦に2行の「果物」の下
  assert.deepStrictEqual(C.tableNav(SALES, 4, 1, 0, -1), { row: 2, col: 1 });
  assert.strictEqual(C.tableNav(SALES, 1, 0, 0, -1), null);
});

test('表の操作: 右・下のセルと結合、結合を解除(中身は消さずに後ろに足す)', () => {
  const T = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';
  let r = C.tableEdit(T, 2, 0, 'mergeRight');
  assert.deepStrictEqual(L(r.text).slice(2), ['| 1 2 || 3 |', '| 4 | 5 | 6 |']);
  assert.deepStrictEqual([r.row, r.col], [2, 0]);
  assert.strictEqual(C.tableEdit(r.text, 2, 0, 'mergeDown'), null);   // 下のセルの幅が違う
  r = C.tableEdit(C.tableEdit(r.text, 3, 0, 'mergeRight').text, 2, 0, 'mergeDown');
  assert.deepStrictEqual(L(r.text).slice(2), ['| 1 2 4 5 || 3 |', '| ^^ || 6 |']);
  assert.strictEqual(bare(C.md(r.text)).match(/<tbody>.*<\/tbody>/)[0], '<tbody><tr><td colspan="2" rowspan="2">1 2 4 5</td><td>3</td></tr><tr><td>6</td></tr></tbody>');
  assert.deepStrictEqual(C.tableSpan(r.text, 3, 1), { right: false, down: false, merged: true });
  r = C.tableEdit(r.text, 3, 1, 'unmerge');   // 結合の中のどのセルからでも
  assert.deepStrictEqual(L(r.text).slice(2), ['| 1 2 4 5 |  | 3 |', '|  |  | 6 |']);
  // 空のセルどうし・見出しの行どうし
  assert.deepStrictEqual(L(C.tableEdit('| a |  |\n|---|---|', 0, 0, 'mergeRight').text), ['| a ||', '|---|---|']);
  // できないとき: 右に高さの違うセル、見出しと本文、結合していないセルの解除
  const S = '| a | b |\n|---|---|\n| X | y |\n| ^^ | z |';
  assert.strictEqual(C.tableEdit(S, 3, 1, 'mergeRight'), null);
  assert.strictEqual(C.tableEdit(S, 0, 0, 'mergeDown'), null);
  assert.strictEqual(C.tableEdit(S, 2, 1, 'unmerge'), null);
  // 結合した結果がちょうど ^^ なら、文字のまま
  assert.deepStrictEqual(L(C.tableEdit('| a | b |\n|---|---|\n|  | ^^ |', 2, 0, 'mergeRight').text)[2], '| \\^^ ||');
});

test('表の操作: 結合したセルのまわりで行・列を足す・消す(内側なら広がり、一部を消すと縮む。左上の中身は隣へ)', () => {
  const T = '| a | b | c |\n|---|---|---|\n| X || y |\n| ^^ || z |\n| p | q | r |';
  // 列: 結合の内側に足すと広がる。右に足すときは結合したセルの右に
  assert.deepStrictEqual(L(C.tableEdit(T, 2, 0, 'colRight').text).slice(2, 5), ['| X ||  | y |', '| ^^ ||  | z |', '| p | q |  | r |']);
  assert.deepStrictEqual(L(C.tableEdit(T, 4, 1, 'colLeft').text).slice(2, 5), ['| X ||| y |', '| ^^ ||| z |', '| p |  | q | r |']);
  // 列を消す: 左上の列を消すと中身は右へ、続きの列を消すと縮む
  assert.deepStrictEqual(L(C.tableEdit(T, 4, 0, 'colDelete').text).slice(0, 5), ['| b | c |', '|---|---|', '| X | y |', '| ^^ | z |', '| q | r |']);
  assert.deepStrictEqual(L(C.tableEdit(T, 4, 1, 'colDelete').text).slice(2, 5), ['| X | y |', '| ^^ | z |', '| p | r |']);
  // 行: 縦の結合の内側に足すと広がる(上の行のすぐ下)。結合の上・下に足すときは広げない
  let r = C.tableEdit(T, 2, 2, 'rowBelow');
  assert.deepStrictEqual(L(r.text).slice(2, 6), ['| X || y |', '| ^^ ||  |', '| ^^ || z |', '| p | q | r |']);
  assert.deepStrictEqual([r.row, r.col], [3, 2]);   // 新しい行の、結合していないセル
  assert.deepStrictEqual(L(C.tableEdit(T, 2, 2, 'rowAbove').text).slice(2, 4), ['|  |  |  |', '| X || y |']);
  assert.deepStrictEqual(L(C.tableEdit(T, 3, 2, 'rowBelow').text).slice(4, 6), ['|  |  |  |', '| p | q | r |']);
  // 行を消す: 左上の行を消すと中身は下の行へ
  assert.deepStrictEqual(L(C.tableEdit(T, 2, 2, 'rowDelete').text).slice(2, 4), ['| X || z |', '| p | q | r |']);
  assert.deepStrictEqual(L(C.tableEdit(T, 3, 2, 'rowDelete').text).slice(2, 4), ['| X || y |', '| p | q | r |']);
});

test('表の操作: 見出しの行を足す・消す、表題ごと表を消す、表の後ろに表を入れる', () => {
  let r = C.tableEdit(SALES, 1, 0, 'rowBelow');   // 見出しの行の間
  assert.deepStrictEqual(L(r.text).slice(1, 5), ['| 品目 | 期間 ||', '| ^^ |  |  |', '| ^^ | 上期 | 下期 |', '|---|---|---:|']);
  assert.deepStrictEqual(C.tableAt(r.text, 2).heads, [1, 2, 3]);
  // 最後の見出しの行を消すと、上の見出しの行が区切りの行の上になる(縦の結合の中身は下へ移る)
  r = C.tableEdit(SALES, 2, 1, 'rowDelete');
  assert.deepStrictEqual(L(r.text).slice(1, 3), ['| 品目 | 期間 ||', '|---|---|---:|']);
  assert.strictEqual(r.row, 1);
  r = C.tableEdit(SALES, 1, 1, 'rowDelete');
  assert.deepStrictEqual(L(r.text).slice(1, 3), ['| 品目 | 上期 | 下期 |', '|---|---|---:|']);
  // 表を消すと表題も消える
  assert.strictEqual(C.tableEdit('前\n\n' + SALES + '\n\n後', 6, 0, 'delete').text, '前\n\n後');
  assert.strictEqual(C.tableEdit('| a |\n|---|\n| 1 |\n[下の表題]\n\n後', 2, 0, 'delete').text, '\n後');
  assert.strictEqual(C.tableInsertAfter('| a |\n|---|\n| 1 |\n[下の表題]\n\n後', 0), 3);
});

test('貼り付け: 結合したセル(縦・横・両方)、見出しの行、表題を引き継ぐ。縦の結合でセルがずれない', () => {
  assert.strictEqual(paste('<table><caption>売上</caption><thead><tr><th rowspan=2>品目</th><th colspan=2>期間</th></tr><tr><th>上期</th><th align=right>下期</th></tr></thead>'
    + '<tbody><tr><td rowspan=2>果物</td><td>りんご</td><td>100</td></tr><tr><td>みかん</td><td>80</td></tr><tr><td colspan=2>合計</td><td>180</td></tr></tbody></table>'),
  '[売上]\n| 品目 | 期間 ||\n| ^^ | 上期 |  下期 |\n| --- | --- | --- |\n| 果物 | りんご | 100 |\n| ^^ | みかん | 80 |\n| 合計 || 180 |');   // 見出しだけ右寄せ
  // 見出しの無い表で縦の結合: 以前は「みかん」が左の列にずれた
  assert.strictEqual(paste('<table><thead><tr><td>区分</td><td>項目</td></tr></thead><tr><td rowspan=2>果物</td><td>りんご</td></tr><tr><td>みかん</td></tr></table>'), '| 区分 | 項目 |\n| --- | --- |\n| 果物 | りんご |\n| ^^ | みかん |');
  assert.strictEqual(paste('<table><thead><tr><td colspan=2 rowspan=2>A</td><td>b</td></tr></thead><tr><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>'),
    '| A || b |\n| --- | --- | --- |\n|  |  | c |\n| d | e | f |');   // 見出しと本文をまたぐ結合: 本文の側は空のセル
  // 先頭から続く <th> の行は見出しの行。中身が ^^ のセルは \^^、空のセルは空白2つ
  assert.strictEqual(paste('<table><tr><th>a</th><th>b</th></tr><tr><th>c</th><th>d</th></tr><tr><td>^^</td><td></td></tr></table>'), '| a | b |\n| c | d |\n| --- | --- |\n| \\^^ |  |');
  assert.strictEqual(paste('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td rowspan=0>y</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'),
    '| a | b |\n| --- | --- |\n| 1 | y |\n| 2 | ^^ |\n| 3 | ^^ |');   // rowspan=0 は部分(本文)の終わりまで
  // 貼り付けた Markdown を表示すると、元の表と同じ結合になる
  const html = '<table><tr><th>h1</th><th>h2</th><th>h3</th></tr><tr><td rowspan=3 colspan=2>大</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr><tr><td>a</td><td colspan=2>b</td></tr></table>';
  assert.strictEqual(bare(C.md(paste(html))).replace(/<\/?t(head|body)>/g, ''), '<table><tr><th>h1</th><th>h2</th><th>h3</th></tr><tr><td colspan="2" rowspan="3">大</td><td>1</td></tr>'
    + '<tr><td>2</td></tr><tr><td>3</td></tr><tr><td>a</td><td colspan="2">b</td></tr></table>');
});

test('貼り付け: 見出しの行の無い表は、空の見出しの行を足してすべて本文に。1行目がすべて太字なら見出しの行', () => {
  // 見出しの印が無い: 空の見出しの行(細い行)を足す。1行目からの縦の結合も残る
  assert.strictEqual(paste('<table><tr><td rowspan=2>果物</td><td>りんご</td></tr><tr><td>みかん</td></tr></table>'), '|  |  |\n| --- | --- |\n| 果物 | りんご |\n| ^^ | みかん |');
  assert.match(C.md(paste('<table><tr><td>1</td><td>2</td></tr></table>')), /<thead><tr><th class="al-l"><\/th><th class="al-l"><\/th><\/tr><\/thead><tbody><tr><td class="al-l">1<\/td>/);
  // 1行目のセルがすべて太字(<b>・<strong>・font-weight、空のセルは除く): 見出しの行にして、** は外す
  assert.strictEqual(paste('<table><tr><td><b>品目</b></td><td style="font-weight:700">数</td><td></td></tr><tr><td>りんご</td><td>3</td><td>x</td></tr></table>'),
    '| 品目 | 数 |  |\n| --- | --- | --- |\n| りんご | 3 | x |');
  assert.strictEqual(paste('<table><tr><td><b>品目</b></td><td>数</td></tr><tr><td>りんご</td><td>3</td></tr></table>'),
    '|  |  |\n| --- | --- |\n| **品目** | 数 |\n| りんご | 3 |');   // 一部だけ太字なら見出しではない
  // 1行だけの表も、空の見出しの行を足す
  assert.strictEqual(paste('<table><tr><td>a</td><td>b</td></tr></table>'), '|  |  |\n| --- | --- |\n| a | b |');
  // Excel: 太字はクラス(<style>)で指定する。applyClassStyles でセルの style に足す
  const tree = D.parseMarkup('<table><tr><td class=xl65>品目</td><td class="xl65 xl66">数</td></tr><tr><td class=xl67>りんご</td><td class=xl66>3</td></tr></table>');
  H.applyClassStyles(tree, '<!--td {font-weight:400;}\n.xl65\n\t{mso-style-parent:style0;\n\tfont-weight:700;}\n.xl66 {text-align:right;}\n.xl67, .other {font-style:italic;}-->');
  assert.strictEqual(H.toMarkdown(tree, { imageLabel: '画像' }).md, '| 品目 | 数 |\n| --- | ---: |\n| *りんご* | 3 |');
});

test('セルだけの配置(DokuWiki と同じ): 両側に空白2つ以上で中央、左だけで右寄せ、右だけで左寄せ', () => {
  const h = C.md('|  数量  |   備考 | x |\n|-----:|---|:-:|\n| 120 | a   | y |\n|  1  |  b  | z |', { lines: true });
  const cells = [...h.matchAll(/<t[hd] class="al-([lcr])"( data-al="([lcr])")?[^>]*>([^<]*)</g)].map(m => m[4] + ':' + m[1] + (m[3] ? '!' : ''));
  assert.deepStrictEqual(cells, ['数量:c!', '備考:r!', 'x:c', '120:r', 'a:l', 'y:c', '1:c!', 'b:c!', 'z:c']);
  // 空白1つずつ・空のセル・空白の数が足りないものは列の配置。全角の空白は数えない
  assert.deepStrictEqual(['| a |', '|  |', '|  a |', '| a  |', '|　a　|'].map(r => /class="al-([lcr])"/.exec(C.md('| h |\n|:-:|\n' + r).split('<tbody>')[1])[1]), ['c', 'c', 'r', 'l', 'c']);
  // EverPad が作る空のセル(空白2つ)に「テキスト」表示で打つと、左右に1つずつ(列の配置のまま)
  const t = '| a |\n|--:|\n|  |', p = C.tableCellPos(t, 2, 0);
  assert.strictEqual((t.slice(0, p) + 'x' + t.slice(p)).split('\n')[2], '| x |');
  // プレビューで書き換えても、前後の空白(配置)はそのまま
  assert.strictEqual(C.tableEdit('| a |\n|---|\n|  b  |', 2, 0, 'cell', 'c').text.split('\n')[2], '|  c  |');
  // 書き出し: AsciiDoc は ^ > <、LaTeX は \multicolumn{1}{…}、Word は w:jc。列の配置は、セルだけの配置の無いセルから
  const b = D.bodyTree(C.md('|  数量  | 品目 |\n|-----:|---|\n| 120 |  中  |'));
  assert.deepStrictEqual([b[0].align, b[0].rows.map(r => r.map(x => x.al))], [['r', 'l'], [['c', ''], ['', 'c']]]);
  assert.ok(D.toAsciiDoc(b, {}).includes('^|数量 |品目\n\n|120 ^|中'));
  assert.ok(D.toLatex(b, {}).includes('\\multicolumn{1}{c}{\\textbf{数量}} & \\textbf{品目} \\tabularnewline') && D.toLatex(b, {}).includes('120 & \\multicolumn{1}{c}{中}'));
  let doc = '';
  for (const e of readZip(D.toDocx(b, {}))) if (e.name === 'word/document.xml') doc = e.data.toString('utf8');
  assert.deepStrictEqual(doc.match(/<w:jc w:val="[a-z]+"\/>/g).map(x => x.slice(13, -3)), ['center', 'left', 'right', 'center']);
  // 貼り付け: 列の配置は本文でいちばん多い配置。それと違う配置を指定したセルは空白で書く(指定の無いセルは列に従う)
  assert.strictEqual(paste('<table><tr><th align=center>数量</th><th>品目</th></tr><tr><td align=right>1</td><td align=center>a</td></tr><tr><td align=right>2</td><td>b</td></tr><tr><td align=left>3</td><td>c</td></tr></table>'),
    '|  数量  | 品目 |\n| ---: | --- |\n| 1 |  a  |\n| 2 | b |\n| 3  | c |');
  // EverPad のプレビューをコピーして貼ると、元に戻る
  const src = '|  数量  | 品目 |\n| ---: | --- |\n| 120 |  中  |\n|  5 | x |';
  assert.strictEqual(paste(C.md(src)), src.replace('|  5 |', '| 5 |'));   // 「  5 」は列と同じ右寄せなので、空白1つに
});

test('書き出し: 表の中身(結合・見出しの行・表題)、AsciiDoc・LaTeX・Word', () => {
  const blocks = D.bodyTree(C.md(SALES));
  const t = blocks[0];
  assert.strictEqual(t.t, 'table');
  assert.deepStrictEqual([t.nh, t.align, t.caption], [2, ['l', 'l', 'r'], [{ t: 'text', v: '売上' }]]);
  assert.deepStrictEqual(t.rows.map(r => r.map(x => (x ? x.c.map(y => y.v).join('') + (x.cs > 1 ? '>' + x.cs : '') + (x.rs > 1 ? 'v' + x.rs : '') : null))),
    [['品目v2', '期間>2', null], [null, '上期', '下期'], ['果物v2', 'りんご', '100'], [null, 'みかん', '80'], ['合計>2', null, '180']]);
  // AsciiDoc: 見出しが2行なので、見出しのセルは h。表題に番号を付けない
  const ad = D.toAsciiDoc(blocks, {});
  assert.ok(ad.includes('.売上\n[caption="",cols="<,<,>",options="noheader"]\n|===\n.2+h|品目 2+h|期間\nh|上期 h|下期\n.2+|果物 |りんご |100\n|みかん |80\n2+|合計 |180\n|==='), ad);
  assert.ok(D.toAsciiDoc(D.bodyTree(C.md('| a | b |\n|---|---|\n| 1 || ')), {}).includes('[cols="<,<",options="header"]\n|===\n|a |b\n\n2+|1\n|==='));
  // LaTeX: \multicolumn・\multirow(multirow パッケージ)、見出しの間の \cmidrule、番号の無い表題
  const tex = D.toLatex(blocks, {});
  assert.ok(tex.includes('\\usepackage{multirow}'));
  assert.ok(tex.includes('\\begin{longtable}{llr}\n\\caption*{売上}\\tabularnewline\n\\toprule\n\\multirow{2}{*}{\\textbf{品目}} & \\multicolumn{2}{l}{\\textbf{期間}} \\tabularnewline\n\\cmidrule(lr){2-3}\n'
    + ' & \\textbf{上期} & \\textbf{下期} \\tabularnewline\n\\midrule\n\\endhead\n\\multirow{2}{*}{果物} & りんご & 100 \\tabularnewline\n & みかん & 80 \\tabularnewline\n\\multicolumn{2}{l}{合計} & 180 \\tabularnewline\n\\bottomrule'), tex);
  assert.ok(!D.toLatex(D.bodyTree(C.md('| a |\n|---|\n| 1 |')), {}).includes('multirow'));
  // Word: gridSpan・vMerge、見出しの行はどれも繰り返す、表題は Caption のスタイルの段落
  const p = {};
  for (const e of readZip(D.toDocx(blocks, {}))) p[e.name] = e.data.toString('utf8');
  const doc = p['word/document.xml'];
  assert.match(doc, /<w:p><w:pPr><w:pStyle w:val="Caption"\/><\/w:pPr><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>売上<\/w:t><\/w:r><\/w:p><w:tbl>/);
  assert.strictEqual((doc.match(/<w:tblHeader\/>/g) || []).length, 2);
  assert.strictEqual((doc.match(/<w:vMerge w:val="restart"\/>/g) || []).length, 2);
  assert.strictEqual((doc.match(/<w:vMerge\/>/g) || []).length, 2);
  assert.strictEqual((doc.match(/<w:gridSpan w:val="2"\/>/g) || []).length, 2);
  assert.strictEqual((doc.match(/<w:tr>/g) || []).length, 5);
  assert.strictEqual((doc.match(/<w:tc>/g) || []).length, 2 + 3 + 3 + 3 + 2);   // 縦の結合の続きにもセルを置く
  assert.match(p['word/styles.xml'], /w:styleId="Caption"/);
});

test('画面・メニュー: 結合の操作と、元の文の列でセルを扱うつなぎ込み', () => {
  const app = read('renderer/app.js');
  assert.ok(/const cellCol = cell => \(cell\.dataset\.col != null/.test(app));
  assert.ok(!/\[\.\.\.tr\.children\]\.indexOf\(cell\)/.test(app), 'セルの列は data-col で');
  assert.ok(/tableNav\(cur\(\)\.text, row, col, dx, dy\)/.test(app));
  assert.ok(/tableMenuState\(/.test(app) && /tableSpan\(text, row, col\)/.test(app));
  assert.ok(/mergeRight: 'tblNoMergeRight', mergeDown: 'tblNoMergeDown', unmerge: 'tblNotMerged'/.test(app));
  assert.ok(/table\[data-label\]/.test(app), 'メモの中のリンクでラベルの表へ');
  assert.ok(/el\.tagName === 'CAPTION' \? el\.closest\('\.tblwrap'\)/.test(app), '表題の編集欄は表の上に');
  assert.ok(/right: !!st\.right, down: !!st\.down, merged: !!st\.merged/.test(read('main.js')));
  const keymap = require('../keymap');
  for (const id of ['tbl:mergeRight', 'tbl:mergeDown', 'tbl:unmerge']) assert.ok(keymap.COMMANDS ? keymap.COMMANDS.some(c => c.id === id) : read('keymap.js').includes("'" + id + "'"), id);
  const I = require('../renderer/i18n');
  for (const l of ['ja', 'en']) for (const k of ['mTblMergeRight', 'mTblMergeDown', 'mTblUnmerge', 'tblNoMergeRight', 'tblNoMergeDown', 'tblNotMerged']) assert.ok(I.DICT[l][k], l + ':' + k);
  assert.strictEqual(I.DICT.ja.mTblMergeRight, '右のセルと結合');
  assert.strictEqual(I.DICT.ja.mTblMergeDown, '下のセルと結合');
  assert.strictEqual(I.DICT.ja.mTblUnmerge, '結合を解除');
  assert.ok(/\.md caption \{ caption-side: top;/.test(read('renderer/styles.css')));
});
