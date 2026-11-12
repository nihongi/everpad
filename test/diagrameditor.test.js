'use strict';
/* 図エディタ: 元の文の図のかたまりを探す(diagramBlock)、入れる・置き換える(diagramInsert・diagramReplace)、
   ひな型(diagramtemplates.js)、メニュー・キー・右クリック・ダブルクリックへのつなぎ込みと言葉 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/core');
const TPL = require('../renderer/diagramtemplates');
const { buildTemplate } = require('../contextmenu');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const F = '```';

test('図のかたまりを探す: 囲みの行から閉じの行まで(中の行でも見つかる)。図の外・コードブロックは null', () => {
  const t = 'a\n\n' + F + 'mermaid\nflowchart TD\n    A --> B\n' + F + '\n\nb';
  for (const line of [2, 3, 4, 5]) {
    assert.deepStrictEqual(C.diagramBlock(t, line), { line: 2, end: 6, pre: '', fence: F, closed: true, src: 'flowchart TD\n    A --> B' });
  }
  assert.strictEqual(C.diagramBlock(t, 0), null);
  assert.strictEqual(C.diagramBlock(t, 7), null);
  assert.strictEqual(C.diagramBlock(F + 'js\nx\n' + F, 1), null);
  // 閉じの無い図は最後まで。~~~ と長い囲みも
  assert.deepStrictEqual(C.diagramBlock(F + 'mermaid\npie\n  "a" : 1', 2), { line: 0, end: 3, pre: '', fence: F, closed: false, src: 'pie\n  "a" : 1' });
  assert.strictEqual(C.diagramBlock('~~~~mermaid\ngraph\n~~~~', 1).fence, '~~~~');
  // CRLF でも同じ
  assert.strictEqual(C.diagramBlock('x\r\n\r\n' + F + 'mermaid\r\ngraph\r\n' + F, 3).src, 'graph');
});

test('引用の中の図: > を外して読み、書き戻すときに付け直す(空の行は > だけ)。字下げは残す', () => {
  const q = '> x\n>\n> ~~~mermaid\n> mindmap\n>     root\n>\n>         a\n> ~~~\n';
  const b = C.diagramBlock(q, 4);
  assert.strictEqual(b.pre, '> ');
  assert.strictEqual(b.src, 'mindmap\n    root\n\n        a');
  assert.strictEqual(C.diagramReplace(q, b, 'mindmap\n    r\n\n        z').text, '> x\n>\n> ~~~mermaid\n> mindmap\n>     r\n>\n>         z\n> ~~~\n');
});

test('置き換え: 囲みの記号は元のまま。文の中に同じ記号の行があれば長くする。閉じが無ければ閉じる。前後の空の行と終わりの空白は取る', () => {
  const t = 'a\n\n' + F + 'mermaid\ngraph\n' + F + '\n\nb';
  const b = C.diagramBlock(t, 3);
  assert.deepStrictEqual(C.diagramReplace(t, b, '\n\npie\n  "x" : 1  \n\n'), { text: 'a\n\n' + F + 'mermaid\npie\n  "x" : 1\n' + F + '\n\nb', line: 2, end: 6 });
  assert.strictEqual(C.diagramReplace(t, b, 'graph\n' + F + '\nB').text, 'a\n\n````mermaid\ngraph\n' + F + '\nB\n````\n\nb');
  const u = F + 'mermaid\ngraph\nA';
  assert.strictEqual(C.diagramReplace(u, C.diagramBlock(u, 0), 'graph\nB').text, F + 'mermaid\ngraph\nB\n' + F);
  // CRLF は CRLF のまま
  const w = 'x\r\n\r\n' + F + 'mermaid\r\ngraph\r\n' + F;
  assert.strictEqual(C.diagramReplace(w, C.diagramBlock(w, 2), 'pie').text, 'x\r\n\r\n' + F + 'mermaid\r\npie\r\n' + F);
});

test('挿入: 新しいかたまりとして、after 行目の次に入れる(前後に空の行。空のメモはそのまま)', () => {
  assert.deepStrictEqual(C.diagramInsert('', 0, 'pie'), { text: F + 'mermaid\npie\n' + F, line: 0, end: 3 });
  assert.deepStrictEqual(C.diagramInsert('a\nb', 0, 'graph\nA'), { text: 'a\n\n' + F + 'mermaid\ngraph\nA\n' + F + '\n\nb', line: 2, end: 6 });
  assert.strictEqual(C.diagramInsert('a', 5, 'pie').text, 'a\n\n' + F + 'mermaid\npie\n' + F);
  assert.strictEqual(C.diagramInsert('a\r\nb', 0, 'pie').text, 'a\r\n\r\n' + F + 'mermaid\r\npie\r\n' + F + '\r\n\r\nb');
  // 入れた図は、プレビューで図になる
  const r = C.diagramInsert('a\n\nb', 0, 'graph\nA');
  assert.match(C.md(r.text, { lines: true }), new RegExp('<div data-line="' + r.line + '" data-end="' + r.end + '" class="diagram" data-src="graph\nA">'));
});

test('ひな型: 12 種類、日本語と英語の名前と見本の文があり、Mermaid の図の種類で始まる', () => {
  assert.strictEqual(TPL.length, 12);
  const kinds = /^(flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|gantt|pie|mindmap|timeline|gitGraph|quadrantChart)\b/;
  const ids = new Set();
  for (const t of TPL) {
    assert.ok(t.id && t.ja && t.en, t.id);
    ids.add(t.id);
    for (const l of ['ja', 'en']) {
      assert.match(t.src[l], kinds, t.id + ' ' + l);
      assert.doesNotMatch(t.src[l], /```|~~~|\t/, t.id + ' ' + l);
    }
  }
  assert.strictEqual(ids.size, TPL.length);
});

test('右クリック: 本文には「図を挿入…」(カーソルが図の中なら「図を編集…」)。表のセルには出さない', () => {
  const p = { isEditable: true, formControlType: 'text-area', selectionText: '', editFlags: {} };
  const labels = t => t.map(x => x.label).filter(Boolean);
  const base = { onFormat: () => {}, onMath: () => {}, onDiagram: () => {}, lang: 'ja', platform: 'win32' };
  let t = buildTemplate(p, base);
  const i = labels(t).indexOf('数式を挿入…');
  assert.strictEqual(labels(t)[i + 1], '図を挿入…');
  assert.strictEqual(t.find(x => x.label === '図を挿入…').accelerator, 'CmdOrCtrl+Shift+D');
  t = buildTemplate(p, Object.assign({}, base, { inDiagram: true }));
  assert.ok(labels(t).includes('図を編集…'));
  t = buildTemplate(Object.assign({}, p, { formControlType: 'input-text' }), Object.assign({}, base, { cell: true }));
  assert.ok(labels(t).includes('数式を挿入…'));
  assert.ok(!labels(t).some(l => /図を/.test(l)));
  // 画面側が知らせないとき(ほかの入力欄)は出さない
  t = buildTemplate(p, { onFormat: () => {}, lang: 'ja' });
  assert.ok(!labels(t).some(l => /図を/.test(l)));
});

test('図エディタ: 画面・メニュー・キー・ダブルクリック・右クリックへのつなぎ込みと言葉', () => {
  const app = read('renderer/app.js'), main = read('main.js'), html = read('renderer/index.html'), css = read('renderer/styles.css'), dg = read('renderer/diagram.js');
  assert.match(html, /<script src="diagramtemplates\.js"><\/script>/);
  // ビューア: ホイールで拡大縮小(passive でない)、ドラッグで移動、ダブルクリックで全体
  assert.match(app, /view\.addEventListener\('wheel', e => \{\n\s+e\.preventDefault\(\);/);
  assert.match(app, /\}, \{ passive: false \}\);/);
  assert.match(app, /view\.setPointerCapture\(e\.pointerId\);/);
  assert.match(app, /view\.addEventListener\('dblclick', e => \{ e\.preventDefault\(\); fit\(\); \}\);/);
  // 入力が止まって 0.3 秒で描き直す。描くのは図の覚えに入れない svgOf
  assert.match(app, /timer = setTimeout\(draw, 300\);/);
  assert.match(app, /r = await Diagrams\.svgOf\(src\);/);
  assert.match(dg, /if \(keep !== false\) remember\(key, v\);/);
  assert.match(dg, /await draw\(src, theme, false\)/);
  // 「テキスト」表示は frInsert、プレビューは peSetText と peRecord(どちらも1回で戻せる)
  assert.match(app, /function diagramCommand\(\) \{[\s\S]*?frInsert\(op\.p, op\.p \+ op\.d\.length, op\.i\);/);
  assert.match(app, /function peDiagramEdit\(m\) \{[\s\S]*?if \(peSetText\(r\.text\)\) \{ peRecord\(before, r\.text\); peRerender\(line, top\); \}/);
  assert.match(app, /function peInsertDiagram\(el0\) \{[\s\S]*?peRecord\(before, r\.text\);/);
  // 読み取り専用のメモと履歴の表示では見るだけ
  assert.match(app, /\$\('hvBody'\)\.addEventListener\('dblclick', e => \{[\s\S]*?diagramView\(m\);/);
  assert.match(app, /else if \(r && r\.status === 'view' && diagram\) diagramView\(m\);/);
  assert.match(app, /else if \(name === 'diagram'\) diagramCommand\(\);/);
  // 外側で離しても閉じない
  assert.match(app, /if \(e\.target === \$\('modal'\) && modalDown === \$\('modal'\)\) closeModal\(\);/);
  // メニュー・キー・右クリック
  assert.match(main, /\{ label: T\('mInsertDiagram'\), accelerator: A\('diagram'\), enabled: !ui\.hist && !ui\.ro, click: \(\) => send\('diagram'\) \}/);
  assert.match(main, /if \(kind === 'diagram'\) items\.unshift\(\{ label: T\(canEdit \? 'mEditDiagram' : 'mViewDiagram'\)/);
  assert.match(main, /onDiagram: ctx \? \(\) => send\('diagram'\) : null, inDiagram: !!\(ctx && ctx\.diagram\)/);
  assert.match(main, /diagram: !!st\.diagram/);
  const K = require('../keymap');
  assert.strictEqual(K.defaults('win32').diagram, 'CmdOrCtrl+Shift+D');
  assert.strictEqual(K.defaults('darwin').diagram, 'CmdOrCtrl+Shift+D');
  assert.match(css, /\.modal\.full \.modal-box \{/);
  assert.match(css, /\.de-view \{[^}]*touch-action: none;/);
  const I = require('../renderer/i18n');
  for (const l of ['ja', 'en']) {
    for (const k of ['mInsertDiagram', 'mEditDiagram', 'mViewDiagram', 'diagInsertTitle', 'diagEditTitle', 'diagViewTitle', 'diagTemplates', 'diagTplHint', 'diagSrcLabel',
      'diagPlaceholder', 'diagViewLabel', 'diagViewHint', 'diagZoomIn', 'diagZoomOut', 'diagActual', 'diagFit', 'diagFitTitle', 'diagEmpty', 'diagNothing', 'diagError', 'diagLoadFail', 'diagNotFound']) {
      assert.ok(I.DICT[l][k], l + ':' + k);
    }
  }
});
