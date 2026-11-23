'use strict';
/* ソースに見えない文字を入れない: 私用領域の文字・幅の無い文字・文字の向きを変える文字・BOM(ファイルの先頭を除く)・制御文字(タブと改行を除く)。
   見た目では分からず、書き換えのときに消えたり壊れたりする。要るときは \u200B のようなエスケープで書く
   (道具でエスケープを書くと、その文字そのものに変わってしまうことがあった)。
   調べるのは、リポジトリのテキストのファイル(node_modules・dist・renderer/vendor・.git を除く)。
   renderer/emoji.js は絵文字のデータで、絵文字をつなぐ文字(U+200D)などを含むので除く */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor']);
const SKIP_FILES = new Set(['renderer/emoji.js', 'package-lock.json']);
const EXT = /\.(js|css|html|json|md|yml|yaml|ps1|sh|txt)$/;

// 調べる文字。ソースに文字そのものを書かないよう、文字の番号から作る
const ranges = [[0x00, 0x08], [0x0B, 0x0C], [0x0E, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2064], [0x2066, 0x2069], [0xFEFF, 0xFEFF], [0xE000, 0xF8FF]];
const BAD = new RegExp('[' + ranges.map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');

function files(dir, rel) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.claude')) out.push(...files(path.join(dir, e.name), r)); }
    else if (EXT.test(e.name) && !SKIP_FILES.has(r)) out.push(r);
  }
  return out;
}

test('ソースに見えない文字・私用領域の文字・制御文字が入っていない(要るときはエスケープで書く)', () => {
  const found = [];
  const list = files(ROOT, '');
  assert(list.includes('renderer/app.js') && list.includes('main.js'), '調べるファイルが見つからない');
  for (const f of list) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    BAD.lastIndex = 0;
    let m;
    while ((m = BAD.exec(s))) {
      if (m.index === 0 && m[0].charCodeAt(0) === 0xFEFF) continue;   // ファイルの先頭の BOM(日本語を含む PowerShell のスクリプトに要る)
      const line = s.slice(0, m.index).split('\n').length;
      found.push(f + ':' + line + ' U+' + m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
      if (found.length > 20) break;
    }
  }
  assert.deepStrictEqual(found, []);
});

test('テストが見えない文字を見つけられる(私用領域・幅の無い空白・途中の BOM)', () => {
  for (const code of [0xE000, 0x200B, 0xFEFF, 0x202E, 0x07]) {
    BAD.lastIndex = 0;
    assert(BAD.test('a' + String.fromCharCode(code) + 'b'), 'U+' + code.toString(16));
  }
  for (const ok of ['あ', '😀', '\t', '\n', '\r', 'é']) { BAD.lastIndex = 0; assert(!BAD.test(ok), JSON.stringify(ok)); }
});
