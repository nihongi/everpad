'use strict';
/* portable 版の起動役を、起動ごとに別のフォルダへ展開するように直す(tools/portable-unpack.js) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { patch, MARK } = require('../tools/portable-unpack');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');   // CRLF で取り出しても同じに読む

// electron-builder 26 の portable.nsi の該当部分
const ORIGINAL = [
  'Section',
  '  StrCpy $INSTDIR "$PLUGINSDIR\\app"',
  '  !ifdef UNPACK_DIR_NAME',
  '    StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
  '  !endif',
  '',
  '  RMDir /r $INSTDIR',
  '  SetOutPath $INSTDIR',
  'SectionEnd',
  ''
].join('\n');

test('起動役: 決まったフォルダ(%TEMP%\\<ID>)ではなく、起動ごとの $PLUGINSDIR に展開する', () => {
  const out = patch(ORIGINAL);
  assert.ok(out.includes(MARK));
  assert.ok(!out.includes('UNPACK_DIR_NAME'), '決まったフォルダは使わない');
  assert.match(out, /  InitPluginsDir\n  StrCpy \$INSTDIR "\$PLUGINSDIR\\app"\n\n  RMDir \/r \$INSTDIR/, '画面を出さない起動でも $PLUGINSDIR を作ってから使う');
  assert.strictEqual(patch(out), null, '直してあれば何もしない');
  assert.ok(patch(ORIGINAL.replace(/\n/g, '\r\n')).includes('InitPluginsDir'), 'CRLF でも直せる');
  assert.throws(() => patch('Section\n  StrCpy $INSTDIR "$TEMP\\x"\nSectionEnd\n'), /portable\.nsi has changed/, '形が変わっていたらビルドを止める');
});

test('起動役: ビルドの前に直す。保存先を切り替えても起動し直さない(展開した EverPad をじかに起動し直すと、一時フォルダが消える)', () => {
  assert.match(JSON.parse(read('package.json')).scripts.predist, /&& node tools\/portable-unpack\.js$/);
  assert.ok(!/app\.relaunch\(/.test(read('main.js')), 'main.js は起動し直さない');
  // GitHub Actions: 起動中にもう一度起動しても、1つ目のファイルを消さず、待ち続けずに終わる。閉じると印は「手放した」
  const ci = read('tools/ci-smoke-windows.ps1');
  assert.match(ci, /\$second = Start-Process -FilePath \$pexe/);
  assert.match(ci, /if \(\$before -lt 1 -or \$after -ne \$before\)/);
  for (const f of ['tools/ci-smoke-windows.ps1', 'tools/ci-smoke-store.ps1']) {
    const s = read(f);
    assert.ok(!/lock was not removed/.test(s), f + ': 閉じたあとの印は消さずに残す');
    assert.match(s, /\(Get-Content -Raw \$lockFile \| ConvertFrom-Json\)\.released/, f);
  }
});
