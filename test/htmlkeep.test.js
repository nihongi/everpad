'use strict';
/* 中央揃え・上付き・下付き・画像の幅を、メモに書ける HTML で残す(htmlmd の opts.html。Evernote からの取り込みで使う)。
   メモの中の <img src="attach:…"> も添付として数え、消せる(core の attachRefs・removeAttachRefs) */
const test = require('node:test');
const assert = require('node:assert');
const C = require('../renderer/core');
const H = require('../renderer/htmlmd');
const E = require('../tools/import-evernote');
const { parseMarkup } = require('../docexport');

const md = (html, opts) => H.toMarkdown(parseMarkup(html), opts).md;
const ID = '0123456789abcdef.png';

test('opts.html: 上付き・下付きは <sup>・<sub>(太字の中も)。opts.html が無ければ(貼り付け)今までどおり文字だけ', () => {
  assert.strictEqual(md('<p>x<sup>2</sup> と H<sub>2</sub>O と <b>太字<sup>注</sup></b></p>', { html: true }), 'x<sup>2</sup> と H<sub>2</sub>O と **太字**<sup>**注**</sup>');
  assert.strictEqual(md('<p>x<sup>2</sup> と H<sub>2</sub>O</p>'), 'x2 と H2O');
  assert.match(C.md(md('<p>x<sup>2</sup></p>', { html: true })), /x<sup>2<\/sup>/);
  // 表のセルの中も
  assert.match(md('<table><tr><th>a</th></tr><tr><td>m<sup>2</sup></td></tr></table>', { html: true }), /\| m<sup>2<\/sup> \|/);
});

test('opts.html: 中央揃え・右揃えのかたまりは <div align> で囲み、中は Markdown のまま。リスト・引用・表の中と、同じ揃えの中では囲まない', () => {
  const s = md('<div style="text-align: center;">中央の <b>太字</b></div><p align="right">右</p><div>左</div>', { html: true });
  assert.strictEqual(s, '<div align="center">\n\n中央の **太字**\n\n</div>\n\n<div align="right">\n\n右\n\n</div>\n\n左');
  const html = C.md(s);
  assert.match(html, /<div align="center">\s*<p>中央の <strong>太字<\/strong><\/p>\s*<\/div>/);
  assert.match(html, /<div align="right">\s*<p>右<\/p>\s*<\/div>\s*<p>左<\/p>/);
  // 入れ子の同じ揃えは1つ
  assert.strictEqual(md('<div style="text-align:center"><div style="text-align:center">a</div><div>b</div></div>', { html: true }), '<div align="center">\n\na\n\nb\n\n</div>');
  // リスト・引用の中は囲まない
  assert.strictEqual(md('<ul><li><div style="text-align:center">項目</div></li></ul>', { html: true }), '- 項目');
  assert.strictEqual(md('<blockquote><p align="center">引用</p></blockquote>', { html: true }), '> 引用');
  // 見出しも
  assert.strictEqual(md('<h2 style="text-align:center">題</h2>', { html: true }), '<div align="center">\n\n## 題\n\n</div>');
  // opts.html が無ければ囲まない
  assert.strictEqual(md('<div style="text-align:center">中央</div>'), '中央');
});

test('opts.html: 添付の画像に幅があれば <img src="attach:…" width>。表示は幅のある添付の画像', () => {
  const s = md('<p><img data-att="' + ID + '" alt="図 &quot;1&quot;" width="120"></p>', { html: true });
  assert.strictEqual(s, '<img src="attach:' + ID + '" alt="図 1" width="120">');
  assert.match(C.md(s), new RegExp('<img class="att-img" data-att="' + ID + '" alt="図 1" width="120" loading="lazy">'));
  assert.strictEqual(md('<p><img data-att="' + ID + '" alt="図" width="50%"></p>', { html: true }), '<img src="attach:' + ID + '" alt="図" width="50%">');
  // 幅が無い・opts.html が無いときは Markdown の画像
  assert.strictEqual(md('<p><img data-att="' + ID + '" alt="図"></p>', { html: true }), '![図](attach:' + ID + ')');
  assert.strictEqual(md('<p><img data-att="' + ID + '" alt="図" width="120"></p>'), '![図](attach:' + ID + ')');
});

test('メモの中の <img src="attach:…"> も、添付の一覧に出し、添付を消すときに本文から消す', () => {
  const text = '前 <img src="attach:' + ID + '" alt="図" width="120"> 後\n<img src="attach:fedcba9876543210.pdf.png" alt="x">\n[資料](attach:fedcba9876543210.pdf)\n<img src="attach:' + ID + '">';
  assert.deepStrictEqual(C.attachRefs(text), [{ id: ID, name: '図', image: true }, { id: 'fedcba9876543210.pdf', name: '資料', image: false }]);
  const r = C.removeAttachRefs(text, ID);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.text, '前  後\n<img src="attach:fedcba9876543210.pdf.png" alt="x">\n[資料](attach:fedcba9876543210.pdf)');
  // ID の一部が同じ別の添付は消さない
  assert.strictEqual(C.removeAttachRefs('<img src="attach:0123456789abcdef.png.x">', '0123456789abcdef.png').count, 0);
});

test('リンクの中の添付の画像: 画像の記法の ] はエスケープしない(画像として表示される)。添付の一覧は画像として数える', () => {
  const one = md('<p><a href="https://e.com/"><img data-att="' + ID + '" alt="a.png"></a></p>');
  assert.strictEqual(one, '[![a.png](attach:' + ID + ')](https://e.com/)');
  assert.match(C.md(one), new RegExp('<a href="https://e.com/"[^>]*><img class="att-img" data-att="' + ID + '"'));
  assert.strictEqual(md('<p><a href="https://e.com/">a]b <img data-att="' + ID + '" alt="a.png"></a></p>'), '[a\\]b ![a.png](attach:' + ID + ')](https://e.com/)');
  assert.strictEqual(md('<p><a href="https://e.com/"><img data-att="' + ID + '" alt="a.png" width="80"></a></p>', { html: true }), '[<img src="attach:' + ID + '" alt="a.png" width="80">](https://e.com/)');
  assert.deepStrictEqual(C.attachRefs(one), [{ id: ID, name: 'a.png', image: true }]);
  const r = C.removeAttachRefs('前 ' + one + ' 後', ID);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.text, '前 [](https://e.com/) 後');
});

test('Evernote: 画像の幅は、元の大きさより小さく表示していたときだけ残す。--no-html(html: false)なら HTML を使わない', () => {
  const res = new Map([['aa', { fileId: ID, name: 'p.png', image: true, w: 800 }]]);
  const one = (attrs, html) => E.enmlToMarkdown('<en-note><div><en-media hash="aa" type="image/png"' + attrs + '/></div></en-note>', res, new Set(), html).md;
  assert.strictEqual(one(' width="300"'), '<img src="attach:' + ID + '" alt="p.png" width="300">');
  assert.strictEqual(one(' style="width: 240px;"'), '<img src="attach:' + ID + '" alt="p.png" width="240">');
  assert.strictEqual(one(' width="800"'), '![p.png](attach:' + ID + ')');
  assert.strictEqual(one(' width="1200"'), '![p.png](attach:' + ID + ')');
  assert.strictEqual(one(''), '![p.png](attach:' + ID + ')');
  assert.strictEqual(one(' width="300"', false), '![p.png](attach:' + ID + ')');
  // 幅のある画像(<img>)は、本文に出ているので、最後にもう一度並べない
  assert.strictEqual(E.noteText({ title: 'T', content: '<en-note><div><en-media hash="aa" type="image/png" width="300"/></div></en-note>' }, res, new Set(), {}).text,
    '# T\n\n<img src="attach:' + ID + '" alt="p.png" width="300">');
  const all = E.enmlToMarkdown('<en-note><div style="text-align:center">中央</div><div>x<sup>2</sup></div></en-note>', new Map(), new Set()).md;
  assert.strictEqual(all, '<div align="center">\n\n中央\n\n</div>\n\nx<sup>2</sup>');
  assert.strictEqual(E.enmlToMarkdown('<en-note><div style="text-align:center">中央</div><div>x<sup>2</sup></div></en-note>', new Map(), new Set(), false).md, '中央\n\nx2');
});
