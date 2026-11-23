'use strict';
/* Markdown のインポートで、近くの画像を添付にする(mdimages.js)と、そのつなぎ込み(main.js・preload.js・app.js)。
   Web ページから貼った画像はリンクにして知らせる(htmlmd.js・app.js) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { localImages } = require('../mdimages.js');
const { attachmentId } = require('../store.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-mdimages-'));
  const dir = path.join(root, 'repo');
  fs.mkdirSync(path.join(dir, 'docs', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'images', 'a.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'docs', 'images', 'b c.gif'), Buffer.from([4, 5]));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(root, 'secret.png'), Buffer.from([9]));
  return { root, dir, md: path.join(dir, 'README.md') };
}

test('同じフォルダかその下の画像を添付にして、参照を attach: に書き換える(Markdown の画像と <img>)', () => {
  const s = sandbox();
  try {
    const t = '![A](docs/images/a.png "title")\n<p align="center"><img src="./docs/images/a.png" width="880" alt="x"></p>\n![B](<docs/images/b c.gif>) ![B2](docs/images/b%20c.gif?raw=true)';
    const r = localImages(t, s.md);
    const idA = attachmentId('a.png', Buffer.from([1, 2, 3])), idB = attachmentId('b c.gif', Buffer.from([4, 5]));
    assert.strictEqual(r.files.length, 2);   // 同じ画像は1つ
    assert.deepStrictEqual(r.files.map(f => f.id).sort(), [idA, idB].sort());
    assert.strictEqual(r.text, '![A](attach:' + idA + ')\n<p align="center"><img src="attach:' + idA + '" width="880" alt="x"></p>\n![B](attach:' + idB + ') ![B2](attach:' + idB + ')');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('ほかの場所・インターネット・画像でないもの・無いもの・コードの中は、そのまま', () => {
  const s = sandbox();
  try {
    const t = [
      '![up](../secret.png) ![abs](' + path.join(s.root, 'secret.png').replace(/\\/g, '/') + ') ![root](/docs/images/a.png)',
      '![web](https://example.com/a.png) ![data](data:image/png;base64,AAAA) ![att](attach:0123456789abcdef.png)',
      '![txt](notes.txt) ![none](docs/images/none.png)',
      '`![code](docs/images/a.png)`',
      '```', '![fence](docs/images/a.png)', '<img src="docs/images/a.png">', '```',
    ].join('\n');
    const r = localImages(t, s.md);
    assert.deepStrictEqual(r.files, []);
    assert.strictEqual(r.text, t);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('つなぎ込み: 取り込むファイルは main.js が預かり、画面には合言葉だけを渡す。メモができてから添付にする', () => {
  const main = read('main.js'), pre = read('preload.js'), app = read('renderer/app.js'), pkg = JSON.parse(read('package.json'));
  assert.match(main, /const li = mdImages\.localImages\(r\.text, file\);/);
  assert.match(main, /pendingImportImages\.set\(token, li\.files\);/);
  assert.match(main, /item\.images = token;/);
  // 合言葉は1回だけ。読み取り専用のメモ・保存先には入れない。読んだときと中身が違えば入れない
  assert.match(main, /ipcMain\.handle\('import:images', \(e, token, noteId\) => \{[\s\S]*?pendingImportImages\.delete\(token\);[\s\S]*?store\.isReadOnly\(noteId\)[\s\S]*?if \(item\.fileId === f\.id\) out\.saved\+\+; else out\.failed\+\+;/);
  assert.match(pre, /importImages: \(token, noteId\) => ipcRenderer\.invoke\('import:images', token, noteId\)/);
  assert.match(app, /if \(it\.images\) \{[\s\S]*?r = await api\.importImages\(it\.images, n\.id\);[\s\S]*?\}\n\s+if \(it\.text\) \{ const op = makeOp/);
  assert(pkg.build.files.includes('mdimages.js'), 'mdimages.js が配布物に入る');
  // 添付の名前の決め方は store.js の1か所
  assert.match(read('store.js'), /const fileId = attachmentId\(name, buf\);/);
});

test('Web ページから貼った画像: どこにあってもリンクにした数を返す(表のセル・リンクの中も)。リンクの中にリンクを作らない', () => {
  const H = require('../renderer/htmlmd.js');
  const { parseMarkup } = require('../docexport.js');
  const conv = html => H.toMarkdown(parseMarkup(html), { imageLabel: '画像' });
  const table = cell => '<table><tr><th>見出し</th></tr><tr><td>' + cell + '</td></tr></table>';
  const cases = [
    ['<p>本文<img src="https://e.com/a.png" alt="図"></p>', 1, '本文[図](https://e.com/a.png)'],
    ['<p><a href="https://e.com/big.png"><img src="https://e.com/a.png" alt="図"></a></p>', 1, '[図](https://e.com/big.png)'],
    [table('<img src="https://e.com/a.png" alt="図">'), 1, '| 見出し |\n| --- |\n| [図](https://e.com/a.png) |'],
    [table('<a href="https://e.com/big.png"><img src="https://e.com/a.png" alt="図"></a>'), 1, '| 見出し |\n| --- |\n| [図](https://e.com/big.png) |'],
    [table('<a href="https://e.com/p"><img src="https://e.com/a.png">説明</a>'), 1, '| 見出し |\n| --- |\n| [画像](https://e.com/a.png) [説明](https://e.com/p) |'],
    // リンク先が使えないときは画像へのリンク。同じ画像は1枚と数える
    ['<p><a href="javascript:x()"><img src="https://e.com/a.png" alt="図"></a><img src="https://e.com/a.png" alt="図"></p>', 1, '[図](https://e.com/a.png)[図](https://e.com/a.png)'],
    ['<ul><li><a href="https://e.com/p"><img src="https://e.com/a.png" alt="A"></a></li><li><img src="https://e.com/b.png" alt="B"></li></ul>', 2, '- [A](https://e.com/p)\n- [B](https://e.com/b.png)'],
    ['<p>画像なし</p>', 0, '画像なし'],
  ];
  for (const [html, n, md] of cases) {
    const r = conv(html);
    assert.strictEqual(r.remote, n, html);
    assert.strictEqual(r.md, md, html);
  }
  const app = read('renderer/app.js'), i18n = read('renderer/i18n.js');
  assert.match(app, /if \(r\.remote\) toast\(T\('pasteRemoteImages', \{ n: r\.remote \}\), 8000\);/);
  assert.strictEqual((i18n.match(/\n\s+pasteRemoteImages: /g) || []).length, 2);
  assert.strictEqual((i18n.match(/\n\s+impImages: /g) || []).length, 2);
  assert.strictEqual((i18n.match(/\n\s+impImagesFailed: /g) || []).length, 2);
});
