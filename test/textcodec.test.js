'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decodeText, MAX_IMPORT } = require('../textcodec');

const B = (...parts) => Uint8Array.from(parts.flat());
const utf8 = s => [...Buffer.from(s, 'utf8')];
// 「こんにちは、世界」の各文字コードでのバイト列(文字コード表の値)
const SJIS = [0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD, 0x81, 0x41, 0x90, 0xA2, 0x8A, 0x45];
const EUC = [0xA4, 0xB3, 0xA4, 0xF3, 0xA4, 0xCB, 0xA4, 0xC1, 0xA4, 0xCF, 0xA1, 0xA2, 0xC0, 0xA4, 0xB3, 0xA6];
const JIS = [0x1B, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x24, 0x4B, 0x24, 0x41, 0x24, 0x4F, 0x21, 0x22, 0x40, 0x24, 0x33, 0x26, 0x1B, 0x28, 0x42];
const HELLO = 'こんにちは、世界';

test('取り込み: UTF-8(BOM あり・なし)と ASCII', () => {
  assert.deepStrictEqual(decodeText(B(utf8('abc\n'))), { ok: true, text: 'abc\n', encoding: 'UTF-8' });
  assert.deepStrictEqual(decodeText(B(utf8(HELLO))), { ok: true, text: HELLO, encoding: 'UTF-8' });
  assert.deepStrictEqual(decodeText(B([0xEF, 0xBB, 0xBF], utf8(HELLO))), { ok: true, text: HELLO, encoding: 'UTF-8' });   // BOM は本文に入れない
});

test('取り込み: Shift_JIS・EUC-JP・ISO-2022-JP を見分ける', () => {
  assert.deepStrictEqual(decodeText(B(SJIS)), { ok: true, text: HELLO, encoding: 'Shift_JIS' });
  // EUC-JP のバイト列は Shift_JIS としても(半角カナとして)読めてしまうが、日本語として自然な EUC-JP を選ぶ
  assert.deepStrictEqual(decodeText(B(EUC)), { ok: true, text: HELLO, encoding: 'EUC-JP' });
  assert.deepStrictEqual(decodeText(B(JIS)), { ok: true, text: HELLO, encoding: 'ISO-2022-JP' });
  // ASCII が混ざっても同じ
  assert.deepStrictEqual(decodeText(B(utf8('# '), SJIS, utf8('\nabc'))), { ok: true, text: '# ' + HELLO + '\nabc', encoding: 'Shift_JIS' });
});

test('取り込み: UTF-16(BOM あり・なし)', () => {
  const le = [...Buffer.from('メモ\nabc', 'utf16le')];
  const be = []; for (let i = 0; i < le.length; i += 2) be.push(le[i + 1], le[i]);
  assert.deepStrictEqual(decodeText(B([0xFF, 0xFE], le)), { ok: true, text: 'メモ\nabc', encoding: 'UTF-16LE' });
  assert.deepStrictEqual(decodeText(B([0xFE, 0xFF], be)), { ok: true, text: 'メモ\nabc', encoding: 'UTF-16BE' });
  const plain = [...Buffer.from('plain ascii text in utf-16\n', 'utf16le')];
  assert.deepStrictEqual(decodeText(B(plain)), { ok: true, text: 'plain ascii text in utf-16\n', encoding: 'UTF-16LE' });
});

test('取り込み: 改行は LF にそろえる', () => {
  assert.strictEqual(decodeText(B(utf8('a\r\nb\rc\n'))).text, 'a\nb\nc\n');
  assert.strictEqual(decodeText(B(SJIS, [0x0D, 0x0A], SJIS)).text, HELLO + '\n' + HELLO);
});

test('取り込み: テキストでないファイルと、大きすぎるファイルはエラー', () => {
  const png = B([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  assert.deepStrictEqual(decodeText(png), { ok: false, reason: 'binary', offset: 8 });
  const big = decodeText(new Uint8Array(MAX_IMPORT + 1));
  assert.strictEqual(big.ok, false);
  assert.strictEqual(big.reason, 'tooLarge');
});

test('取り込み: 読めない部分があれば、最も先まで読めた文字コードで場所を示す', () => {
  // Shift_JIS の「こんにちは、世界」(1行目)+ 改行 + 「こん」+ 読めないバイト(先行バイト 0x82 の後に 0xFF)
  const bad = B(SJIS, [0x0A], SJIS.slice(0, 4), [0x82, 0xFF, 0x41]);
  const r = decodeText(bad);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'undecodable');
  assert.strictEqual(r.encoding, 'Shift_JIS');
  assert.strictEqual(r.line, 2);
  assert.strictEqual(r.col, 3);                    // 「こん」の次 = 3文字目
  assert.strictEqual(r.offset, SJIS.length + 1 + 4);
  assert.deepStrictEqual(r.bytes, ['0x82', '0xFF', '0x41']);
  assert.strictEqual(r.context, 'こん');
  // UTF-8 として途中まで読めるファイル
  const u = decodeText(B(utf8('abc\nあいう'), [0xFF], utf8('x')));
  assert.strictEqual(u.ok, false);
  assert.strictEqual(u.encoding, 'UTF-8');
  assert.deepStrictEqual([u.line, u.col, u.context], [2, 4, 'あいう']);
});

const path = require('path');
const { sendToPath, shortcutTarget, filesFromArgv } = require('../sendto');
const W = (...p) => p.join('\\');   // Windows のパスを組み立てる(テストを読みやすくするため)

test('「送る」: ショートカットの場所と、起動するもの(インストール版・portable 版・開発中)', () => {
  const roaming = W('C:', 'Users', 'a', 'AppData', 'Roaming');
  assert.strictEqual(sendToPath(roaming), path.join(roaming, 'Microsoft', 'Windows', 'SendTo', 'EverPad.lnk'));
  assert.deepStrictEqual(shortcutTarget({ isPackaged: true, execPath: W('C:', 'P', 'EverPad.exe') }), { target: W('C:', 'P', 'EverPad.exe'), args: '' });
  assert.deepStrictEqual(shortcutTarget({ isPackaged: true, execPath: W('C:', 'Temp', 'x', 'EverPad.exe'), portableExe: W('D:', 'EverPad 0.10.0.exe') }), { target: W('D:', 'EverPad 0.10.0.exe'), args: '' });
  assert.deepStrictEqual(shortcutTarget({ isPackaged: false, execPath: W('C:', 'e', 'electron.exe'), appPath: W('C:', 'src', 'everpad') }), { target: W('C:', 'e', 'electron.exe'), args: '"' + W('C:', 'src', 'everpad') + '"' });
});

test('「送る」: 起動時の引数から、取り込むファイルだけを取り出す', () => {
  assert.deepStrictEqual(filesFromArgv([W('C:', 'P', 'EverPad.exe'), W('C:', 'a.txt'), '--allow-file-access-from-files', W('D:', 'b c.txt')], { isPackaged: true }), [W('C:', 'a.txt'), W('D:', 'b c.txt')]);
  assert.deepStrictEqual(filesFromArgv([W('C:', 'P', 'EverPad.exe')], { isPackaged: true }), []);
  const src = W('C:', 'src', 'everpad');
  assert.deepStrictEqual(filesFromArgv(['electron.exe', '--inspect=9', '.', 'memo.txt'], { isPackaged: false, appPath: src, cwd: src }), ['memo.txt']);
});

