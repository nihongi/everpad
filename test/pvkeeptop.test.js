'use strict';
// 検索したままほかのアプリから戻ったとき・プレビューを作り直したときに、スクロールの位置が飛ばないこと
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('保存先を読み直したあとの検索は、一覧だけを新しくして、開いているメモの表示を作り直さない', () => {
  const app = read('renderer/app.js');
  const refresh = app.slice(app.indexOf('  async function doRefresh() {'), app.indexOf('  const metaOf = r =>'));
  assert.ok(refresh.length > 0);
  assert.match(refresh, /if \(S\.q\) runSearch\(\{ view: false \}\);/);
  assert.ok(!/runSearch\(\)/.test(refresh), '読み直しのあとは view: false で検索する');
  // 検索語(欄の文字そのまま)が変わっていなければ、作り直さない
  assert.match(app, /const keepView = !!opts && opts\.view === false && raw === hadRaw;/);
});

test('同じメモのままプレビューを作り直すときは、上端の行を同じ高さに戻す(スクロールの数字では戻さない)', () => {
  const app = read('renderer/app.js');
  const cap = app.slice(app.indexOf('  function pvTopCapture() {'), app.indexOf('  function pvTopApply(a) {'));
  assert.ok(cap.length > 0);
  // 見えているプレビューで、同じメモを見ているときだけ
  assert.match(cap, /if \(pv\.hidden \|\| !pv\.clientHeight \|\| !cur\(\) \|\| pvShownId !== cur\(\)\.id\) return null;/);
  assert.match(cap, /line: yToLine\(domAnchors\(pv\), top\)/);
  // いちばん上・いちばん下にいたら、その端のまま
  assert.match(cap, /a\.edge = 'top'/);
  assert.match(cap, /a\.edge = 'bottom'/);
  const apply = app.slice(app.indexOf('  function pvTopApply(a) {'), app.indexOf('  function refreshViewNow() {'));
  assert.match(apply, /if \(!a \|\| S\.mode !== 'preview' \|\| pe\.box\) return;/);
  assert.match(apply, /if \(a\.edge === 'bottom'\) \$\('preview'\)\.querySelectorAll\(':scope > \.pv-hold'\)\.forEach\(x => x\.remove\(\)\);/);
  assert.match(apply, /syncApply\(a, true\);/);
  // ほかの EverPad で書き換えた開いているメモを読み直すときも、プレビューは行で合わせる
  const reload = app.slice(app.indexOf('  async function reloadActive(id) {'), app.indexOf('  async function keepConflict('));
  assert.match(reload, /const pvA = S\.mode === 'preview' \? pvTopCapture\(\) : null;/);
  assert.match(reload, /if \(pvA\) pvTopApply\(pvA\); else \$\('preview'\)\.scrollTop = pvTop;/);
});
