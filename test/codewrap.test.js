'use strict';
/* プレビューのコードブロックの長い行: 折り返す(初め)か横にスクロールするか。折り返した続きは字下げと矢印で、もとの改行と見分ける(app.js・styles.css) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('プレビューと履歴のプレビューで、コードブロックの行を囲む(印刷・書き出し・スライドショーは今までどおり)', () => {
  const app = read('renderer/app.js');
  assert.match(app, /applyDocOpts\(pv, docOpts\(cur\(\)\.text\), 'pv-h-'\);\n\s+codeBlocks\(pv\);\n\s+lastHydrate = hydrate\(pv, cur\(\)\.id\);/);
  assert.match(app, /codeBlocks\(body\);\n\s+lastHydrate = hydrate\(body, cur\(\)\.id\);/);
  assert.strictEqual((app.match(/codeBlocks\((pv|body|area|box|strip)\)/g) || []).length, 2);
  // 文字と改行はそのまま(改行は各行の終わりに残す)。中に要素があるときは、範囲を切り出して行ごとに分ける
  assert.match(app, /s\.textContent = l \+ \(i < lines\.length - 1 \? '\\n' : ''\);/);
  assert.match(app, /const len = lines\[i\]\.length \+ \(i < lines\.length - 1 \? 1 : 0\);/);
  assert.match(app, /s\.appendChild\(r\.extractContents\(\)\);/);
  // 図・数式の中のコードは触らない。2回囲まない
  assert.match(app, /if \(pre\.classList\.contains\('cb'\) \|\| pre\.closest\('\.diagram, \.math'\)\) return;/);
  // ボタン: すべてのコードブロックを切り替え、次回も同じ。押したコードブロックは画面の同じ高さに残す
  assert.match(app, /codeWrap = localStorage\.getItem\('everpad:codeWrap'\) !== '0';/);
  assert.match(app, /document\.body\.classList\.toggle\('code-nowrap', !codeWrap\);/);
  assert.match(app, /if \(sc\) sc\.scrollTop \+= pre\.getBoundingClientRect\(\)\.top - top;/);
  // ボタンを押しても、プレビューの編集を始めない(PE_SKIP に button がある)
  assert.match(app, /const PE_SKIP = '[^']*\bbutton\b/);
});

test('styles.css: 折り返しと、続きの行の字下げと矢印。横にスクロールするのは中の code', () => {
  const css = read('renderer/styles.css');
  assert(css.includes('.md pre.cb > code { display: block; padding: 16px 40px 16px 16px; overflow-x: auto; }'));
  assert(css.includes('body:not(.code-nowrap) .md pre.cb > code { white-space: pre-wrap; overflow-wrap: anywhere; }'));
  assert(css.includes('body:not(.code-nowrap) .md pre.cb .cl { display: block; position: relative; padding-left: 1.6em; text-indent: -1.6em; }'));
  assert.match(css, /body:not\(\.code-nowrap\) \.md pre\.cb \.cl::before \{ content: ''; position: absolute; left: \.3em; top: 1lh; bottom: 0;/);
  assert.match(css, /\.md pre\.cb:hover > \.code-wrap, \.md pre\.cb > \.code-wrap:focus-visible \{ opacity: 1; \}/);
  // 印刷は今までどおり折り返す
  assert(css.includes('.print-area .md pre { white-space: pre-wrap; overflow: visible; }'));
});

test('ボタンの説明とお知らせ(日本語・英語)', () => {
  const i18n = read('renderer/i18n.js');
  for (const k of ['codeWrapOn', 'codeWrapOff', 'codeWrapDone', 'codeScrollDone']) assert.strictEqual((i18n.match(new RegExp('\\n\\s+' + k + ': ', 'g')) || []).length, 2, k);
});
