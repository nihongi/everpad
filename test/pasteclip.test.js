'use strict';
/* 貼り付けの段階2: Word・Excel の画像の一時ファイル(pasteclip.js)と、別のメモの添付のコピー・画面へのつなぎ込み */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { officeClipPath } = require('../pasteclip');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const url = p => pathToFileURL(p).href;

test('Word・Excel の一時ファイル: 一時フォルダの msohtmlclip…\\01\\clip_image… の画像だけを読む', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-clip-'));
  const clipDir = path.join(tmpDir, 'msohtmlclip1', '01');
  fs.mkdirSync(clipDir, { recursive: true });
  const ok = path.join(clipDir, 'clip_image002.png');
  fs.writeFileSync(ok, 'png');
  assert.strictEqual(officeClipPath(url(ok), tmpDir), fs.realpathSync(ok));
  // 名前・フォルダの形が違うもの、一時フォルダの外、無いもの、file: でないもの
  const bad = [path.join(clipDir, 'secret.png'), path.join(clipDir, 'clip_image003.exe'), path.join(tmpDir, 'msohtmlclip1', 'clip_image004.png'),
    path.join(tmpDir, 'other', '01', 'clip_image005.png'), path.join(clipDir, 'clip_image009.png')];
  for (const f of bad.slice(0, 4)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); }
  for (const f of bad) assert.strictEqual(officeClipPath(url(f), tmpDir), null, f);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-out-'));
  const od = path.join(outside, 'msohtmlclip1', '01'); fs.mkdirSync(od, { recursive: true });
  fs.writeFileSync(path.join(od, 'clip_image001.png'), 'x');
  assert.strictEqual(officeClipPath(url(path.join(od, 'clip_image001.png')), clipDir), null, '一時フォルダの外');
  // .. で外へ出る URL も、行き先で確かめる
  assert.strictEqual(officeClipPath(url(path.join(clipDir, 'x')) + '/../../../../' + path.basename(outside) + '/msohtmlclip1/01/clip_image001.png', tmpDir), null);
  for (const u of ['https://e.com/msohtmlclip1/01/clip_image001.png', 'C:\\x\\msohtmlclip1\\01\\clip_image001.png', null, 42, 'file:///' + 'a'.repeat(3000)])
    assert.strictEqual(officeClipPath(u, tmpDir), null, String(u).slice(0, 40));
  // フォルダを指す・一時フォルダが無い
  fs.mkdirSync(path.join(clipDir, 'clip_image010.png'));
  assert.strictEqual(officeClipPath(url(path.join(clipDir, 'clip_image010.png')), tmpDir), null);
  assert.strictEqual(officeClipPath(url(ok), path.join(tmpDir, 'none')), null);
  assert.strictEqual(officeClipPath(url(ok), ''), null);
});

test('画面と main: 一時ファイルの画像・別のメモの添付のコピー・コピーした場所を覚える', () => {
  const app = read('renderer/app.js'), main = read('main.js'), pre = read('preload.js'), pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('pasteclip.js'));
  assert.match(pre, /attachClip: \(noteId, url, name\) => ipcRenderer\.invoke\('attach:clip', noteId, url, name\)/);
  assert.match(pre, /attachCopy: \(fromId, toId, fileIds\) => ipcRenderer\.invoke\('attach:copy', fromId, toId, fileIds\)/);
  // 一時ファイルは main が場所を確かめてから読む(読み取り専用のメモには入れない)
  assert.match(main, /const p = officeClipPath\(url, app\.getPath\('temp'\)\);/);
  assert.match(main, /ipcMain\.handle\('attach:clip', \(e, noteId, url, name\) => \{\n\s+if \(!fromOurWindow\(e\)\)[^\n]*\n\s+if \(store\.isReadOnly\(noteId\)\)/);
  // コピーは保存先のメモどうしだけ。同じメモ・読み取り専用のメモには何もしない
  assert.match(main, /if \(!fromOurWindow\(e\) \|\| !validId\(fromId\) \|\| !validId\(toId\) \|\| fromId === toId \|\| !Array\.isArray\(fileIds\) \|\| store\.isReadOnly\(toId\)\) return out;/);
  // プレビューのファイルの添付に元のメモを持たせる(画像は src から分かる)
  assert.match(app, /root\.querySelectorAll\('a\.att-file\[data-att\]'\)\.forEach\(a => \{ a\.dataset\.attNote = noteId; \}\);/);
  // 整形された文書: 文字を入れる前にファイルをコピーする
  assert.match(app, /await copyPastedAttachments\(r\.atts, noteId\);\n\s+const md = await fillPastedImages\(r\);/);
  assert.match(app, /await copyPastedAttachments\(r\.atts, S\.active\);\n\s+const md = await fillPastedImages\(r\);/);
  // 文字のままの貼り付け: コピーした文字と同じときだけ、覚えておいたメモから
  assert.match(app, /if \(\(cd\.getData\('text\/plain'\) \|\| ''\)\.replace\(\/\\r\\n\/g, '\\n'\) !== lastCopy\.text\) return \[\];/);
  assert.match(app, /for \(const ev of \['copy', 'cut'\]\) \{\n\s+\$\('editor'\)\.addEventListener\(ev, rememberCopy\);/);
  for (const lang of ['ja', 'en']) for (const k of ['clipImageGone', 'attCopyMissing']) assert.ok(I18N.DICT[lang][k], lang + ' ' + k);
  assert.strictEqual(I18N.t('en', 'attCopyMissing', { n: 2 }), '2 attachments were not found in the original note.');
  assert.strictEqual(I18N.t('ja', 'attCopyMissing', { n: 2 }), '元のメモに見つからない添付が2個ありました。');
});
