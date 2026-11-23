'use strict';
/* プレビューの履歴の変更箇所: 変えたかたまりの印、追加した文字の色、削除した位置の線、見える所までの移動(app.js・styles.css) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../renderer/core.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

// app.js の hvHtml と同じ確かめ方: 印の文字を入れて整形し、印を除くと印なしと同じか
const MARK = /[\uE000-\uE002]/g;
const opts = { lines: true, fm: true };
function marked(text, p, ins) {
  const m = ins ? text.slice(0, p) + '\uE000' + ins + '\uE001' + text.slice(p + ins.length) : text.slice(0, p) + '\uE002' + text.slice(p);
  const html = L.md(m, opts);
  return { same: html.replace(MARK, '') === L.md(text, opts), html };
}

test('印の文字は整形を変えない(段落・リスト・表・強調・リンクの中の普通の文字)', () => {
  const cases = [
    ['振り子の何度も周期を測った。', '何度も'],
    ['- 糸の長さ(cm)\n- おもり', '(cm)'],
    ['| a | b |\n|---|---|\n| 1.005 | 秒 |', '5'],
    ['**とても大事** な話', 'とても'],
    ['[リンクの文字](https://example.com/) です', '文字'],
    ['# 見出しの言葉', '言葉'],
  ];
  for (const [text, ins] of cases) {
    const r = marked(text, text.indexOf(ins), ins);
    assert(r.same, 'text=' + text);
    assert.match(r.html, /\uE000[^<]*\uE001/, '同じ文字のかたまりに入る: ' + text);
  }
  // 削除した位置の印
  assert(marked('最後の段落は、一部を消します。', 7, '').same);
});

test('書式やかたまりが変わる編集では、印の整形が印なしと違う(印を使わない)', () => {
  // 行の頭に「## 」を足して見出しにした: 印が前にあると見出しにならない
  const t = '## 見出しにする行';
  assert(!marked(t, 0, '## ').same);
  // 字下げでリストの入れ子にした
  const u = '- a\n  - b';
  assert(!marked(u, u.indexOf('  - b'), '  ').same);
});

test('画面: プレビューの履歴で印を付け、変更箇所を見える所に出す。「追加 N文字」はプレビューのまま示す', () => {
  const app = read('renderer/app.js');
  // 整形は hvHtml。印を除いて印なしと同じときだけ印の整形を使い、タグの中(属性)の印は取り除く
  assert.match(app, /body\.innerHTML = '<div class="md">' \+ hvHtml\(text, op, slides\) \+ '<\/div>';/);
  assert.match(app, /if \(m\.replace\(HV_RE, ''\) !== html\) return html;\n\s+return m\.replace\(\/<\[\^>\]\*>\/g, t => t\.replace\(HV_RE, ''\)\);/);
  // 本文にもともと印の文字があるメモ・本文と編集が合わないときは使わない
  assert.match(app, /if \(p > text\.length \|\| \(il && text\.slice\(p, p \+ il\) !== op\.i\) \|\| \/\[\\uE000-\\uE002\]\/\.test\(text\)\) return html;/);
  // 印の文字は、数式・図を描く前に、色・線の要素にする(数式・図の中や、複数の文字のかたまりにまたがるときは取り除くだけ)
  assert.match(app, /const mark = op \? hvMarks\(body, op\) : null;\n\s+const chg = op \? hvBlocks\(body, text, op\) : \[\];/);
  assert.match(app, /if \(hits\.length > 1 \|\| t\.parentElement\.closest\('\.math, \.diagram'\)\) return strip\(\);/);
  assert(app.indexOf('const mark = op ? hvMarks(body, op)') < app.indexOf('lastHydrate = hydrate(body, cur().id);', app.indexOf('const mark = op ? hvMarks(body, op)')));
  // 変えた行に掛かる、いちばん内側のかたまり
  assert.match(app, /const inner = all\.filter\(x => !all\.some\(y => y !== x && x\.contains\(y\)\)\);\n\s+inner\.forEach\(x => x\.classList\.add\('hv-chg'\)\);/);
  // 見える所に出す。変更箇所を含むいちばん外側のかたまりは描くのを省かない(長いリストでも位置が見積もりにならない)
  assert.match(app, /if \(target && topOf\(target\)\) topOf\(target\)\.classList\.add\('hv-open'\);\n\s+if \(oldH\) hvSizes\(body\.firstChild, oldH, chg\.map\(topOf\)\.filter\(Boolean\)\);\n\s+codeBlocks\(body\);\n\s+lastHydrate = hydrate\(body, cur\(\)\.id\);\n\s+if \(target\) hvKeep\(body, target\);\n\s+else hvTok\+\+;/);
  // 再生のちらつき: 作り直す前のかたまりの中身の高さ(余白と線を引く)を、作り直したかたまりの仮の高さにする。変えたかたまりより前は前から、後ろは後ろから数える
  assert.match(app, /const oldMd = body\.dataset\.hvNote === n\.id \? body\.querySelector\(':scope > \.md'\) : null;\n\s+const oldH = oldMd \? \[\.\.\.oldMd\.children\]\.map\(hvInner\) : null;/);
  assert.match(app, /return x\.getBoundingClientRect\(\)\.height - px\(cs\.paddingTop\) - px\(cs\.paddingBottom\) - px\(cs\.borderTopWidth\) - px\(cs\.borderBottomWidth\);/);
  assert.match(app, /const h = i < lo \? oldH\[i\] : oldH\[M - \(N - i\)\];\n\s+if \(h > 0\) x\.style\.containIntrinsicSize = 'auto ' \+ Math\.round\(h \* 100\) \/ 100 \+ 'px';/);
  // 一度読んだ添付の画像は、作り直したときに大きさを先に付ける(読み込むまで高さが 0 にならない)
  assert.match(app, /const sz = attSizes\.get\(img\.dataset\.att\);\n\s+if \(sz\) \{ img\.width = sz\.w; img\.height = sz\.h; \}\n\s+else img\.addEventListener\('load', \(\) => \{ if \(img\.naturalWidth\) attSizes\.set\(img\.dataset\.att, \{ w: img\.naturalWidth, h: img\.naturalHeight \}\); \}, \{ once: true \}\);/);
  // 描き終えるまで毎回の描画で見えているかを確かめて動かし直す。この表示でのホイール・クリック・キー・タッチと、位置合わせ(syncApply)でやめる
  assert.match(app, /const evs = \['wheel', 'mousedown', 'keydown', 'touchstart'\];\n\s+evs\.forEach\(t => body\.addEventListener\(t, quit, \{ capture: true, passive: true \}\)\);/);
  assert.match(app, /if \(!shown\(\)\) target\.scrollIntoView\(\{ block: 'nearest' \}\);\n\s+requestAnimationFrame\(step\);/);
  assert.match(app, /function syncApply\(a, quiet\) \{\n\s+fitTail\(\);\n\s+hvTok\+\+;/);
  // 「追加 N文字」: プレビューの履歴では、印があればプレビューのまま示す
  assert.match(app, /if \(S\.hbase === 'preview'\) \{\n\s+const marks = \[\.\.\.\$\('hvBody'\)\.querySelectorAll\('\.hv-ins, \.hv-del'\)\];/);
  // 削除した文字は線の title に出す(両方の言語)
  const i18n = read('renderer/i18n.js');
  assert.strictEqual((i18n.match(/hvDeleted: p => /g) || []).length, 2);
  const css = read('renderer/styles.css');
  assert(css.includes('#hvBody > .md > .hv-open { content-visibility: visible; contain-intrinsic-size: none; }'));
  assert(css.includes('scroll-margin: 48px 0;'));
  for (const sel of ['#hvBody .md .hv-chg:not(tr)', '#hvBody .md tr.hv-chg > *', '#hvBody .md ins.hv-ins', '#hvBody .md .hv-del', '#hvBody .hv-chg.flash']) assert(css.includes(sel), sel);
  assert.strictEqual((css.match(/--ins-line: /g) || []).length, 5);
});
