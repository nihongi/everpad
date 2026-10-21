'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

const B = n => '`'.repeat(n);   // バッククォートを n 個(テストを読みやすくするため)

test('コード表記: CommonMark と同じく、同じ数のバッククォートで閉じるまでがコード', () => {
  assert.strictEqual(L.md('a `b` c'), '<p>a <code>b</code> c</p>');
  assert.strictEqual(L.md(B(2) + ' `x` ' + B(2)), '<p><code>`x`</code></p>');                  // 中にバッククォート
  assert.strictEqual(L.md(B(4) + ' ' + B(3) + ' ' + B(4)), '<p><code>' + B(3) + '</code></p>');  // 中に ```
  assert.strictEqual(L.md(B(2) + 'a`b' + B(2)), '<p><code>a`b</code></p>');
  assert.strictEqual(L.md('`a` と ``b``'), '<p><code>a</code> と <code>b</code></p>');
});

test('コード表記: 前後の空白は1つずつだけ取り除き、空白だけのものはそのまま', () => {
  assert.strictEqual(L.md('` a `'), '<p><code>a</code></p>');
  assert.strictEqual(L.md('`  a  `'), '<p><code> a </code></p>');
  assert.strictEqual(L.md('` a`'), '<p><code> a</code></p>');                                   // 片側だけなら取り除かない
  assert.strictEqual(L.md('`   `'), '<p><code>   </code></p>');
});

test('コード表記: 閉じる側が無いバッククォートは文字のまま。数が違えば閉じない', () => {
  assert.strictEqual(L.md('a ` b'), '<p>a ` b</p>');
  assert.strictEqual(L.md(B(2) + 'x`'), '<p>' + B(2) + 'x`</p>');
  assert.strictEqual(L.md('`a' + B(2) + 'b`'), '<p><code>a' + B(2) + 'b</code></p>');            // 2つの並びは1つの閉じにならない
});

test('コード表記: 中の書式・数式・リンクは効かず、表の \\| は | になる', () => {
  assert.strictEqual(L.md('`**x** $y$ [a](note:abcdef1)`'), '<p><code>**x** $y$ [a](note:abcdef1)</code></p>');
  assert.match(L.md('| 表 |\n|---|\n| `\\| a \\|` |'), /<td class="al-l"><code>\| a \|<\/code><\/td>/);
});

test('コードブロック: ``` か ~~~ を3つ以上並べて囲み、同じ文字を同じ数以上並べた行で閉じる', () => {
  assert.strictEqual(L.md(B(3) + '\nx\n' + B(3)), '<pre><code>x</code></pre>');
  assert.strictEqual(L.md('~~~\nx\n~~~'), '<pre><code>x</code></pre>');
  // ```` で囲めば、中に ``` の行を書ける
  assert.strictEqual(L.md(B(4) + '\n' + B(3) + '\ncode\n' + B(3) + '\n' + B(4)), '<pre><code>' + B(3) + '\ncode\n' + B(3) + '</code></pre>');
  // ~~~ の中の ``` も文字
  assert.strictEqual(L.md('~~~\n' + B(3) + '\n~~~'), '<pre><code>' + B(3) + '</code></pre>');
  // 閉じる行は開いた行より長くてもよい。違う文字・短いものでは閉じない
  assert.strictEqual(L.md(B(3) + '\na\n' + B(5) + '\nafter'), '<pre><code>a</code></pre>\n<p>after</p>');
  assert.strictEqual(L.md(B(4) + '\na\n' + B(3) + '\n~~~~\n' + B(4)), '<pre><code>a\n' + B(3) + '\n~~~~</code></pre>');
  // 閉じる行が無ければ最後までコード
  assert.strictEqual(L.md(B(3) + '\na\nb'), '<pre><code>a\nb</code></pre>');
});

test('コードブロック: 数式の ```math も、```` や ~~~ で囲める', () => {
  assert.match(L.md('~~~math\nx^2\n~~~'), /<div class="math math-display math-src" data-tex="x\^2">/);
  assert.match(L.md(B(4) + 'math\nx\n' + B(3) + '\ny\n' + B(4)), /data-tex="x\n```\ny"/);
});

test('Markdown の書き方: バッククォートとコードブロックの例が説明どおりに表示される', () => {
  const HELP = require('../renderer/help-content');
  for (const [lang, emph, nest] of [['ja', '文字の強調', 'コードブロックの中に ``` を書く'], ['en', 'Emphasis', 'Writing ``` inside a code block']]) {
    const sec = h => HELP[lang].sections.find(s => s.h === h);
    assert.match(L.md(sec(emph).src), /<code>`[^<]+`<\/code>/, lang);                                  // バッククォートを含むコード表記
    assert.match(L.md(sec(nest).src), /^<pre><code>```\n[^`]+\n```<\/code><\/pre>$/, lang);           // ``` の行を含むコードブロック
  }
});

test('番号付きの箇条書き: 最初の項目に書いた番号から数え、字下げした段落は項目の続きにする', () => {
  assert.strictEqual(L.md('4. 起動\n5. 確認'), '<ol start="4"><li>起動</li><li>確認</li></ol>');
  assert.strictEqual(L.md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');                       // 1 から始まるなら start は付けない
  assert.strictEqual(L.md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  // 項目の後の、字下げした段落とコードブロックは、その項目の中。次の番号の項目も同じ箇条書きに続く
  const t = '1. 準備\n2. 導入\n\n   ```\n   npm install\n   ```\n\n   このあと確かめます。\n\n3. 起動';
  assert.strictEqual(L.md(t), '<ol><li>準備</li><li>導入<pre><code>npm install</code></pre><p>このあと確かめます。</p></li><li>起動</li></ol>');
  // 字下げしていない段落は、箇条書きの外(今までどおり)
  assert.strictEqual(L.md('1. a\n\n続きの段落'), '<ol><li>a</li></ol>\n<p>続きの段落</p>');
});
