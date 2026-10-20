'use strict';
/* テキストファイルの取り込み: 文字コードを見分けて文字列にする(Electron に依存しないので、テストできる)。
   - BOM があれば UTF-8 / UTF-16 として読む。
   - BOM が無ければ UTF-8 → ISO-2022-JP(エスケープ文字があるとき)→ Shift_JIS・EUC-JP の順に厳密に試し、
     複数読めたときは日本語として自然な文字の割合で選ぶ。
   - 読めないときは、最も先まで読めた文字コードで、最初に読めなくなった場所(行・文字・バイト)を返す。
   改行は LF にそろえる。 */
const MAX_IMPORT = 10 * 1024 * 1024;   // 10MB

const NAMES = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16LE', 'utf-16be': 'UTF-16BE', 'shift_jis': 'Shift_JIS', 'euc-jp': 'EUC-JP', 'iso-2022-jp': 'ISO-2022-JP' };

function tryDecode(bytes, enc) {
  try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch (e) { return null; }
}

/* 厳密に読んだとき、最初に読めなくなる文字の先頭のバイト位置(全部読めるときは -1)。
   stream: true で読むと途中で切れた文字は誤りにならないので、誤りが出る最短の長さを二分探索で探し、
   そこから数バイト戻って、その手前までは完全に読める位置(= 読めない文字の先頭)を返す */
function firstInvalid(bytes, enc) {
  if (tryDecode(bytes, enc) !== null) return -1;
  const streamOk = len => { try { new TextDecoder(enc, { fatal: true }).decode(bytes.subarray(0, len), { stream: true }); return true; } catch (e) { return false; } };
  let lo = 0, hi = bytes.length;          // 長さ lo までは読める。長さ hi では誤りになる
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (streamOk(mid)) lo = mid; else hi = mid; }
  for (let p = hi - 1; p >= Math.max(0, hi - 4); p--) if (tryDecode(bytes.subarray(0, p), enc) !== null) return p;
  return hi - 1;
}

/* 日本語として自然かどうかの点数(ひらがな・カタカナ・漢字・全角記号は加点、半角カナや私用領域などは減点) */
function score(text) {
  let good = 0, bad = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF01 && c <= 0xFF5E)) good++;
    else if ((c >= 0xFF61 && c <= 0xFF9F) || (c >= 0xE000 && c <= 0xF8FF) || (c >= 0x80 && c <= 0x9F)) bad++;
    else if (c >= 0x0100 && c < 0x3000 && !(c >= 0x2000 && c <= 0x206F) && !(c >= 0x2190 && c <= 0x25FF)) bad++;   // 日本語の文章にはまれな文字
  }
  return good - 2 * bad;
}

/* UTF-16 の BOM が無いファイル: ASCII の文字の片側が 0 になるので、偶数・奇数番目の 0 の多さで見分ける */
function guessUtf16(bytes) {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
  const half = n / 2;
  if (oddZero > half * 0.3 && evenZero < half * 0.05) return 'utf-16le';
  if (evenZero > half * 0.3 && oddZero < half * 0.05) return 'utf-16be';
  return null;
}

const normalize = s => s.replace(/\r\n?/g, '\n');

/* ISO-2022-JP で漢字に切り替えるエスケープ文字(ESC $ @ または ESC $ B)があるか */
function hasJisEscape(bytes) {
  for (let i = bytes.indexOf(0x1B); i >= 0 && i + 2 < bytes.length; i = bytes.indexOf(0x1B, i + 1)) {
    if (bytes[i + 1] === 0x24 && (bytes[i + 2] === 0x40 || bytes[i + 2] === 0x42)) return true;
  }
  return false;
}

/* 失敗の詳しい場所: 読めたところまでの文字列から行と文字を数え、読めないバイトと直前の文字を返す */
function failure(bytes, enc, at) {
  const before = new TextDecoder(enc).decode(bytes.subarray(0, at));
  const text = normalize(before);
  const ls = text.lastIndexOf('\n') + 1;
  let col = 0; for (const _ of text.slice(ls)) col++;
  const line = (text.match(/\n/g) || []).length + 1;
  const ctx = [...text.slice(ls)].slice(-16).join('');
  const hex = [...bytes.subarray(at, Math.min(bytes.length, at + 4))].map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0'));
  return { ok: false, reason: 'undecodable', encoding: NAMES[enc] || enc, line: line, col: col + 1, offset: at, bytes: hex, context: ctx };
}

function decodeText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_IMPORT) return { ok: false, reason: 'tooLarge', size: bytes.length, limit: MAX_IMPORT };
  const done = (text, enc) => ({ ok: true, text: normalize(text), encoding: NAMES[enc] || enc });

  // 1. BOM
  const bomEnc = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 'utf-8'
    : bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le'
    : bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' : null;
  if (bomEnc) {
    const t = tryDecode(bytes, bomEnc);          // BOM は TextDecoder が取り除く
    return t !== null ? done(t, bomEnc) : failure(bytes, bomEnc, firstInvalid(bytes, bomEnc));
  }
  // 2. NUL を含む: BOM の無い UTF-16 か、テキストでないファイル
  if (bytes.indexOf(0) >= 0) {
    const u16 = guessUtf16(bytes);
    const t = u16 && tryDecode(bytes, u16);
    if (t !== null && t !== undefined && t.indexOf('\0') < 0) return done(t, u16);
    return { ok: false, reason: 'binary', offset: bytes.indexOf(0) };
  }
  // 3. ISO-2022-JP: 7ビットなので UTF-8(ASCII)としても読めてしまう。漢字に切り替えるエスケープ文字(ESC $ @ / ESC $ B)があり、
  //    8ビット目を使っていないときは、先に ISO-2022-JP として読む
  const hasEsc = bytes.indexOf(0x1B) >= 0;
  if (hasEsc && hasJisEscape(bytes) && bytes.every(b => b < 0x80)) { const t = tryDecode(bytes, 'iso-2022-jp'); if (t !== null) return done(t, 'iso-2022-jp'); }
  // 4. ASCII だけ / UTF-8
  const utf8 = tryDecode(bytes, 'utf-8');
  if (utf8 !== null) return done(utf8, 'utf-8');
  // 5. Shift_JIS と EUC-JP: 両方読めたら、日本語として自然なほう(同点なら Windows で多い Shift_JIS)
  const sj = tryDecode(bytes, 'shift_jis'), ej = tryDecode(bytes, 'euc-jp');
  if (sj !== null && ej !== null) return score(ej) > score(sj) ? done(ej, 'euc-jp') : done(sj, 'shift_jis');
  if (sj !== null) return done(sj, 'shift_jis');
  if (ej !== null) return done(ej, 'euc-jp');
  // 6. どれでも読めない: 最も先まで読めた文字コードで場所を示す
  const cands = ['utf-8', 'shift_jis', 'euc-jp'].concat(hasEsc ? ['iso-2022-jp'] : []);
  let best = null;
  for (const enc of cands) { const at = firstInvalid(bytes, enc); if (!best || at > best.at) best = { enc: enc, at: at }; }
  return failure(bytes, best.enc, best.at);
}

module.exports = { decodeText, firstInvalid, MAX_IMPORT };
