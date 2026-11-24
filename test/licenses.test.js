'use strict';
/* 「EverPad について」の「ライセンス」ボタン: この版のタグの LICENSES.md(日本語なら LICENSES.ja.md)を開く。
   開く先のファイルがあり、アプリに入っているソフトウェアのライセンスの一覧があることを確かめる */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.js');

test('ライセンスのボタン: 版のタグの、画面の言語のライセンスのページを開く', () => {
  assert.match(main, /const licensesUrl = \(version, l\) => HOMEPAGE \+ 'blob\/v' \+ version \+ '\/' \+ \(l === 'ja' \? 'LICENSES\.ja\.md' : 'LICENSES\.md'\);/);
  assert.match(main, /buttons: \[T\('aboutOpenSite'\), T\('aboutLicenses'\), 'OK'\]/);
  assert.match(main, /r\.response === 1\) shell\.openExternal\(licensesUrl\(app\.getVersion\(\), lang\)\)/);
});

test('ライセンスのページ: アプリに入っているソフトウェアを、ライセンスへのリンクと一緒に並べる', () => {
  for (const [file, other] of [['LICENSES.md', 'LICENSES.ja.md'], ['LICENSES.ja.md', 'LICENSES.md']]) {
    const s = read(file);
    assert.match(s, /\[LICENSE\]\(LICENSE\)/, file);
    assert.ok(s.includes('](' + other + ')'), file + ': もう一方の言語へのリンク');
    assert.match(s, /Copyright \(c\) 2026 Nobuyoshi NIHONGI/, file);
    for (const name of ['Electron', 'Chromium', 'Node.js', 'KaTeX', 'Mermaid', 'gemoji']) {
      assert.match(s, new RegExp('^\\| \\[' + name.replace('.', '\\.') + '\\]\\(https://[^)]+\\) \\|[^|]+\\| \\[[^\\]]+\\]\\(https://[^)]+\\)', 'm'), file + ': ' + name);
    }
    assert.match(s, /LICENSES\.chromium\.html/, file);
  }
  // README の「ライセンス」の節から、それぞれの言語のページへリンクする
  const readme = read('README.md');
  assert.match(readme.split(/^### License$/m)[1].split(/^---$/m)[0], /\[LICENSES\.md\]\(LICENSES\.md\)/);
  assert.match(readme.split(/^### ライセンス$/m)[1], /\[LICENSES\.ja\.md\]\(LICENSES\.ja\.md\)/);
});
