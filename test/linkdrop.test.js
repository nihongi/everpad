'use strict';
/* ブラウザから落としたリンク([タイトル](URL))と、「表示」→「常に手前に表示」 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');
const H = require('../renderer/htmlmd');
const { parseMarkup } = require('../docexport');
const keymap = require('../keymap');
const I18N = require('../renderer/i18n');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('dropUrl: text/uri-list の最初の URL(http・https・mailto だけ)', () => {
  assert.strictEqual(H.dropUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.strictEqual(H.dropUrl('# 注釈\r\nhttp://example.org/\r\nhttps://other/'), 'http://example.org/');
  assert.strictEqual(H.dropUrl('mailto:a@example.com'), 'mailto:a@example.com');
  for (const bad of ['', 'file:///C:/x.txt', 'javascript:alert(1)', 'note:abc', 'data:text/html,x', 'https://', 'https://a\u0007b']) assert.strictEqual(H.dropUrl(bad), '', bad);
  assert.strictEqual(H.dropUrl('https://e.com/' + 'a'.repeat(5000)), '');
});

test('anchorTitle: 落とした HTML のリンクの文字', () => {
  const t = html => H.anchorTitle(parseMarkup(html), 'https://e.com/p');
  assert.strictEqual(t('<a href="https://e.com/p">記事の  題名\n</a>'), '記事の 題名');
  // 同じ URL の <a> を選ぶ。無ければ最初のリンク
  assert.strictEqual(t('<a href="https://other/">他</a><a href="https://e.com/p">これ</a>'), 'これ');
  assert.strictEqual(t('<p><a href="https://other/">他</a></p>'), '他');
  // 画像だけのリンクは代わりの文字
  assert.strictEqual(t('<a href="https://e.com/p"><img src="x.png" alt="ロゴ"></a>'), 'ロゴ');
  assert.strictEqual(t('<a href="https://e.com/p"><img src="x.png"></a>'), '');
  assert.strictEqual(t('<p>リンクなし</p>'), '');
  assert.strictEqual(H.anchorTitle(null, 'x'), '');
});

test('shortcutUrl: インターネットのショートカット(.url)の URL', () => {
  assert.strictEqual(H.shortcutUrl('[InternetShortcut]\r\nURL=https://example.com/a b\r\nIDList=\r\n'), 'https://example.com/a b');   // 空白は linkMd が %20 にする
  assert.strictEqual(H.shortcutUrl('[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,11\r\n[InternetShortcut]\r\nIDList=\r\nURL=https://example.com/x?q=1\r\n'), 'https://example.com/x?q=1');
  assert.strictEqual(H.shortcutUrl('[InternetShortcut]\nURL=file:///C:/secret.txt\n'), '');
  assert.strictEqual(H.shortcutUrl('ただの文字'), '');
});

test('linkMd: [タイトル](URL)。記号はエスケープ、タイトルが無ければ URL だけ', () => {
  assert.strictEqual(H.linkMd('https://e.com/p', 'Example Domain'), '[Example Domain](https://e.com/p)');
  // ] はいつもエスケープ(リンクが途中で切れないように)。[ はそのまま(\[ と \] がそろうと数式になる)。* などは必要なときだけ
  assert.strictEqual(H.linkMd('https://e.com/p', 'タイトル「例」[1] / 2?'), '[タイトル「例」[1\\] / 2?](https://e.com/p)');
  assert.strictEqual(H.linkMd('https://e.com/p', '注[^1] と [a](b)'), '[注[^1\\] と [a\\](b)](https://e.com/p)');
  assert.strictEqual(H.linkMd('https://e.com/p', '**太字** と `code`'), '[\\*\\*太字\\*\\* と \\`code\\`](https://e.com/p)');
  // URL の空白・かっこ・<> は %XX に
  assert.strictEqual(H.linkMd('https://e.com/a (b)', 'T'), '[T](https://e.com/a%20%28b%29)');
  // タイトルが無い・URL と同じ: URL だけ
  for (const t of ['', '  ', 'https://e.com/p', 'https://e.com/p/']) assert.strictEqual(H.linkMd('https://e.com/p', t), 'https://e.com/p', JSON.stringify(t));
  assert.strictEqual(H.linkMd('mailto:a@e.com', ''), '[a@e.com](mailto:a@e.com)');
  // 改行は空白に、長すぎるタイトルは切る、表のセルでは | をエスケープ
  assert.strictEqual(H.linkMd('https://e.com/', 'a\n\tb'), '[a b](https://e.com/)');
  assert.ok(H.linkMd('https://e.com/', 'あ'.repeat(400)).startsWith('[' + 'あ'.repeat(300) + '…]('));
  assert.strictEqual(H.linkMd('https://e.com/', 'A | B', { table: true }), '[A \\| B](https://e.com/)');
});

test('linkMd の結果は、EverPad のプレビューで1つのリンクになる', () => {
  const strip = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const title of ['タイトル「例」[1] / 2?', '[先頭] と [末尾]', 'a ] b [ c', '**x** と $1 と $2', 'C:\\path\\to', '注[^1] と [a](b)', ':smile: と 1:2:3']) {
    const md = H.linkMd('https://e.com/p?q=1', title);
    const html = core.md(md);
    const links = html.match(/<a [^>]*href="https:\/\/e\.com\/p\?q=1"[^>]*>/g) || [];
    assert.strictEqual(links.length, 1, md + ' -> ' + html);
    assert.ok(!/katex|math/.test(html), '数式にならない: ' + html);
    assert.strictEqual(strip(html).trim(), title, md + ' -> ' + html);
  }
});

test('画面へのつなぎ込み: 重ねた contenteditable で受ける・.url は添付にしない', () => {
  const app = read('renderer/app.js');
  assert.match(app, /linkDrop\.contentEditable = 'true'/);
  assert.match(app, /includes\('text\/uri-list'\)/);
  assert.match(app, /document\.caretPositionFromPoint/);
  assert.match(app, /HtmlMd\.shortcutUrl\(await f\.text\(\)\)/);
  // プレビュー: 落とした高さで前か次か(上の余白なら最初のかたまりの前)。フロントマターの前には入れない
  assert.match(app, /pt\.y < r\.top \+ r\.height \/ 2 && canBefore\(top\)/);
  assert.match(app, /if \(pt\.y < blocks\[0\]\.getBoundingClientRect\(\)\.top && canBefore\(blocks\[0\]\)\) return \{ before: blocks\[0\] \};/);
  assert.match(app, /const canBefore = b => !b\.classList\.contains\('fm'\);/);
  assert.match(app, /first \? \+first\.dataset\.line - 1 :/);
  assert.match(app, /peDropTargetAt\(e\.target, \{ x: e\.clientX, y: e\.clientY \}\)/);
  // EverPad の中から始めたドラッグでは重ねない
  assert.match(app, /addEventListener\('dragstart', \(\) => \{ ownDrag = true; \}/);
});

test('常に手前に表示: 表示メニュー・キーの割り当て・覚えておく', () => {
  const c = keymap.COMMANDS.find(x => x.id === 'onTop');
  assert.ok(c && c.group === 'mView' && c.label === 'mOnTop' && c.def === '');
  const main = read('main.js');
  assert.match(main, /\{ id: 'onTop', label: T\('mOnTop'\), type: 'checkbox', checked: onTop, accelerator: A\('onTop'\), click: \(\) => setOnTop\(!onTop\) \}/);
  assert.match(main, /onTop = readConfig\(\)\.onTop === true;/);
  assert.match(main, /writeConfig\(Object\.assign\(readConfig\(\), \{ onTop: onTop \}\)\)/);
  // メインの窓と「Markdown の書き方」の窓の両方。Windows は level を 'normal' に(既定の 'floating' では手前にならない)
  assert.match(main, /if \(onTop && process\.platform === 'win32'\) w\.setAlwaysOnTop\(true, 'normal'\);\s*else w\.setAlwaysOnTop\(onTop\);/);
  assert.match(main, /for \(const w of \[win, helpWin\]\) applyOnTop\(w\);/);
  assert.match(main, /win\.show\(\); applyOnTop\(win\); \}\);/);
  assert.match(main, /helpWin\.removeMenu\(\);\s*applyOnTop\(helpWin\);/);
  assert.ok(!/alwaysOnTop:/.test(main), 'new BrowserWindow の alwaysOnTop は使わない');
  // 全画面表示の前
  assert.ok(main.indexOf("id: 'onTop', label") < main.indexOf("roleItem(KM, 'fullscreen'"));
  for (const lang of ['ja', 'en']) assert.ok(I18N.DICT[lang].mOnTop, lang);
  assert.strictEqual(I18N.DICT.ja.mOnTop, '常に手前に表示');
  assert.strictEqual(I18N.DICT.en.mOnTop, 'Always on Top');
});
