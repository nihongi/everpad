'use strict';
/* Markdown の中の HTML(core.js の htmlSafe): 見た目だけのタグと属性を GitHub と同じように出し、危ないものは出さない */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core.js');
const D = require('../docexport.js');

test('見た目だけのタグと属性は HTML として出す(README の中央寄せ・幅を付けた画像・表・kbd・details)', () => {
  const out = L.md('<p align="center"><img src="attach:0123456789abcdef.gif" width="880" alt="A &amp; B"></p>\n<p align="center"><em>Every edit</em></p>');
  assert.match(out, /^<p align="center"><img class="att-img" data-att="0123456789abcdef\.gif" alt="A &amp; B" width="880" loading="lazy"><\/p>\n<p align="center"><em>Every edit<\/em><\/p>$/);
  const t = L.md('<table>\n<tr>\n<td width="50%"><img src="attach:0123456789abcdef.png" alt="x"><br>Slides with <code>---</code> lines</td>\n</tr>\n</table>');
  assert.match(t, /<table>\n<tr>\n<td width="50%"><img class="att-img" data-att="0123456789abcdef\.png" alt="x" loading="lazy"><br>Slides with <code>---<\/code> lines<\/td>\n<\/tr>\n<\/table>/);
  assert.strictEqual(L.md('Press <kbd>Ctrl</kbd>+<kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup>'), '<p>Press <kbd>Ctrl</kbd>+<kbd>S</kbd>, H<sub>2</sub>O, x<sup>2</sup></p>');
  // details の中の Markdown(空の行で分けた所)は Markdown として読む
  assert.strictEqual(L.md('<details>\n<summary>More</summary>\n\n- item **md**\n\n</details>'), '<details>\n<summary>More</summary>\n<ul><li>item <strong>md</strong></li></ul>\n</details>');
  // 文字参照は文字参照のまま(その文字になる)
  assert.strictEqual(L.md('&copy; 2026 &#x2192; &amp;'), '<p>&copy; 2026 &#x2192; &amp;</p>');
});

test('HTML の要素でないもの・コードの中・md() の外は、今までどおり文字', () => {
  assert.strictEqual(L.md('<date-time>-<id>.jsonl'), '<p>&lt;date-time&gt;-&lt;id&gt;.jsonl</p>');
  assert.strictEqual(L.md('`<b>x</b>`'), '<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>');
  assert.match(L.md('```\n<b>x</b>\n```'), /<pre><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
  assert.strictEqual(L.inline('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
  assert.strictEqual(L.md('a < b and c > d'), '<p>a &lt; b and c &gt; d</p>');
});

test('危ないものは出さない(スクリプト・スタイル・イベント・id・class・javascript: のリンク・ほかの場所の画像)', () => {
  const payloads = [
    '<script>alert(1)</script>', '<SCRIPT SRC=//x.example/a.js></SCRIPT>', '<img src=x onerror=alert(1)>', '<img src="javascript:alert(1)">',
    '<a href="javascript:alert(1)">x</a>', '<a href=" JaVaScRiPt:alert(1)">x</a>', '<a href="data:text/html,<script>1</script>">x</a>',
    '<div style="position:fixed;inset:0">x</div>', '<style>body{display:none}</style>', '<iframe src="https://x.example"></iframe>',
    '<svg onload=alert(1)><circle/></svg>', '<p onmouseover="alert(1)" id="editor" class="pane">x</p>', '<details open ontoggle=alert(1)>x</details>',
    '<math><mtext><script>1</script></mtext></math>', '<object data="x"></object>', '<embed src="x">', '<form action="x"><input name=a></form>',
    '<meta http-equiv="refresh" content="0;url=https://x.example">', '<base href="https://x.example/">', '<link rel=stylesheet href=x>',
    '<img src="attach:0123456789abcdef.png" onload="x()" style="width:9999px">', '<td width="50%;background:red">x</td>', '<img """><script>alert(1)</script>">',
    '<a href="https://ok.example/" onclick="x()" target="_self">ok</a>', '<<script>script>alert(1)<</script>/script>', '<!--<script>x()</script>-->',
    '<textarea><img src=x onerror=1></textarea>', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  ];
  for (const p of payloads) {
    for (const src of [p, 'text ' + p + ' text', '- ' + p, '> ' + p, '| a |\n|---|\n| ' + p + ' |']) {
      const out = L.md(src);
      assert(!/<(script|style|iframe|svg|math|object|embed|form|input|meta|base|link|textarea)\b/i.test(out), src + ' -> ' + out);
      assert(!/\son[a-z]+\s*=/i.test(out.replace(/&[a-z]+;|&#\d+;/g, '')) || !/<[^>]*\son[a-z]+\s*=/i.test(out), src + ' -> ' + out);
      // style・id は出さない。class は EverPad 自身が付けるものだけ
      assert(!/<[^>]*\s(style|id)\s*=/i.test(out), src + ' -> ' + out);
      for (const c of out.match(/\sclass="[^"]*"/g) || []) assert(/^ class="(att-img|link-other|al-[lcr]|tblwrap)"$/.test(c), src + ' -> ' + out);
      assert(!/(href|src)="\s*(javascript|data|vbscript):/i.test(out), src + ' -> ' + out);
      assert(!/<img(?![^>]*class="att-img")/i.test(out), src + ' -> ' + out);
    }
  }
  // 添付でない画像: インターネットはリンク(読み込まない)、ほかは名前だけ
  assert.strictEqual(L.md('<img src="https://x.example/a.png" alt="remote">'), '<a href="https://x.example/a.png" target="_blank" rel="noopener noreferrer">remote</a>');
  assert.strictEqual(L.md('<img src="docs/a.png">'), '<span class="link-other" data-target="docs/a.png">a.png</span>');
});

test('閉じ忘れたタグは閉じ、開いていない閉じのタグは出さない。HTML のコメントは出さない', () => {
  assert.strictEqual(L.md('<div>\nunclosed'), '<div>\nunclosed</div>');
  assert.strictEqual(L.md('text </div> more'), '<p>text  more</p>');
  assert.strictEqual(L.md('<!-- hidden -->\nafter'), '<p>after</p>');
  assert.strictEqual(L.md('<!--\nmulti\nline\n-->\n\nafter'), '<p>after</p>');
  // スライドのそれぞれの中でも、最後で閉じる
  assert.match(L.md('<div>\na\n\n---\n\nb', { slides: true }), /<\/div>$/);
});

test('HTML のかたまり: 空の行まで。pre などは閉じのタグまで。タグだけの行は、段落の途中ではかたまりにしない。行の範囲を付ける', () => {
  assert.strictEqual(L.md('<div align="center">\n**not md**\n</div>\n\n**md**', { lines: true }), '<div data-line="0" data-end="3" align="center">\n**not md**\n</div>\n<p data-line="4" data-end="5"><strong>md</strong></p>');
  assert.strictEqual(L.md('<pre>\na\n\nb\n</pre>'), '<pre>\na\n\nb\n</pre>');
  assert.strictEqual(L.md('para\n<b>x</b>'), '<p>para<br><b>x</b></p>');
  assert.strictEqual(L.md('<img src="attach:0123456789abcdef.png">\n\nnext', { lines: true }), '<img data-line="0" data-end="1" class="att-img" data-att="0123456789abcdef.png" loading="lazy">\n<p data-line="2" data-end="3">next</p>');
});

test('書き出し(Word・AsciiDoc・LaTeX): HTML の入れ物の中身も書き出す', () => {
  const tree = D.bodyTree(L.md('<details>\n<summary>More</summary>\n\n- item\n\n</details>\n\n<center>c</center>'));
  const a = D.toAsciiDoc(tree, { title: 't' });
  assert.match(a, /More\n\n\* item/);
  assert.match(a, /\nc\n/);
});
