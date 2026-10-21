'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

// 画面と同じく KaTeX と mhchem を読み込んだ状態で確かめる(core.js は window.katex / global.katex を使う)
const withKatex = fn => () => {
  global.katex = require('katex');
  require('katex/contrib/mhchem');
  try { fn(); } finally { delete global.katex; }
};
const texs = html => [...html.matchAll(/data-tex="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
const count = (html, re) => (html.match(re) || []).length;

test('数式: $…$ と \\(…\\) は文中の数式、$$…$$ と \\[…\\] は独立した行の数式', withKatex(() => {
  const h = L.md('質量は $E = mc^2$ と \\(a+b\\) です。');
  assert.deepStrictEqual(texs(h), ['E = mc^2', 'a+b']);
  assert.strictEqual(count(h, /class="katex"/g), 2);
  assert.ok(h.startsWith('<p>'));
  // 段落の中の $$…$$ は、段落を壊さないよう <span>(表示は独立した行)
  const d = L.md('式 $$x^2$$ です');
  assert.match(d, /<span class="math math-display"/);
  assert.match(d, /katex-display/);
}));

test('数式: 段落の外の $$ … $$ / \\[ … \\] / ```math(1行・複数行)', withKatex(() => {
  for (const src of ['$$\\int_0^1 x\\,dx$$', '$$\n\\int_0^1 x\\,dx\n$$', '\\[\n\\int_0^1 x\\,dx\n\\]', '```math\n\\int_0^1 x\\,dx\n```']) {
    const h = L.md('前の段落\n\n' + src + '\n\n後の段落');
    assert.match(h, /<div class="math math-display" data-tex="\\int_0\^1 x\\,dx">/, src);
    assert.strictEqual(count(h, /<p>/g), 2, src);
  }
  // 閉じが無ければ数式にしない(後ろを全部のみこまない)
  assert.doesNotMatch(L.md('$$\nabc\n\n続き'), /class="math/);
}));

test('数式: 金額の $ は数式にしない。\\$ は $ の文字になる', withKatex(() => {
  assert.doesNotMatch(L.md('りんごは $5 で、みかんは $10 です'), /class="math/);
  assert.doesNotMatch(L.md('合計 $ 5 $'), /class="math/);            // 開きの直後・閉じの直前が空白
  assert.doesNotMatch(L.md('$a$1'), /class="math/);                  // 閉じの直後が数字
  assert.strictEqual(L.md('価格は \\$5 と \\$10'), '<p>価格は $5 と $10</p>');
  assert.deepStrictEqual(texs(L.md('$\\$5$')), ['\\$5']);              // 数式の中の \$ はそのまま
}));

test('数式: 中の * や _ は太字・斜体にならず、コード表記の中の $ は数式にならない', withKatex(() => {
  const h = L.md('$a*b*c$ と $x_1 + y_2$');
  assert.doesNotMatch(h, /<em>|<strong>/);
  assert.deepStrictEqual(texs(h), ['a*b*c', 'x_1 + y_2']);
  assert.strictEqual(L.md('`$x$` は数式でない'), '<p><code>$x$</code> は数式でない</p>');
}));

test('数式: 表・箇条書き・見出し・引用の中でも表示する', withKatex(() => {
  assert.strictEqual(count(L.md('| 式 | 値 |\n|---|---|\n| $x^2$ | $\\vert a \\vert$ |'), /class="katex"/g), 2);
  assert.strictEqual(count(L.md('- $a$\n- $b$'), /class="katex"/g), 2);
  assert.strictEqual(count(L.md('# 式 $c$'), /class="katex"/g), 1);
  assert.strictEqual(count(L.md('> $$\n> d\n> $$'), /class="katex-display"/g), 1);
}));

test('数式: 化学式(mhchem の \\ce)', withKatex(() => {
  const h = L.md('水は $\\ce{H2O}$');
  assert.strictEqual(count(h, /class="katex"/g), 1);
  assert.doesNotMatch(h, /math-error/);
}));

test('数式: 誤りは元の LaTeX を赤字で出し、外部を参照するコマンドは使えない', withKatex(() => {
  const bad = L.md('$\\frac{1}{$');
  assert.match(bad, /class="math math-error" data-tex="\\frac\{1\}\{" title="[^"]+">\\frac\{1\}\{<\/span>/);
  const href = L.md('$\\href{https://example.com}{x}$');
  assert.doesNotMatch(href, /<a /);                                    // trust: false
  assert.doesNotMatch(L.md('$\\includegraphics{a.png}$'), /<img/);
}));

test('数式: KaTeX が読み込まれていないときは、LaTeX をそのまま出す', () => {
  assert.strictEqual(L.md('$x^2$'), '<p><span class="math math-src" data-tex="x^2">x^2</span></p>');
});

test('数式: Markdown の書き方の「数式」の例が、説明どおりに表示される', withKatex(() => {
  const HELP = require('../renderer/help-content');
  for (const sec of [HELP.ja.sections.find(s => s.h === '数式'), HELP.en.sections.find(s => s.h === 'Math')]) {
    const h = L.md(sec.src);
    assert.strictEqual(count(h, /class="katex"/g), 3, sec.h);              // 文中 2 + 独立した行 1
    assert.strictEqual(count(h, /class="katex-display"/g), 1, sec.h);
    assert.match(h, /\$5/, sec.h);                                         // \$ は $ の文字
    assert.doesNotMatch(h, /math-error/, sec.h);
  }
}));
