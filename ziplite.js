'use strict';
/* EverPad のアーカイブ(.everpad)に使う、最小限の ZIP の読み書き(Node.js 標準の zlib だけを使う)。
   - 書き込み: deflate で圧縮し、小さくならないものは無圧縮で入れる。ファイル名は UTF-8。
   - 読み込み: 無圧縮と deflate だけ。暗号化・ZIP64・分割は扱わない(EverPad が書き出したものを読めればよい)。
     展開すると巨大になるファイルに備えて、1つあたりと合計の大きさに上限を設ける。 */
const zlib = require('zlib');

const LIMITS = { entries: 20000, entry: 512 * 1024 * 1024, total: 1024 * 1024 * 1024 };

function zipError(code, message) { const e = new Error(message); e.code = code; return e; }

/* DOS 形式の日時(ZIP のヘッダーに入れる) */
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/* entries: [{ name, data: Buffer }] → ZIP の Buffer */
function writeZip(entries, when) {
  const { time, date } = dosTime(when || new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const ent of entries) {
    const name = Buffer.from(ent.name, 'utf8');
    const data = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(ent.data);
    const crc = zlib.crc32(data) >>> 0;
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const isZip = buf => buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;

/* ZIP の Buffer → [{ name, data }]。正しくない・扱えない・大きすぎるときは例外(code 付き) */
function readZip(buf, limits) {
  const lim = Object.assign({}, LIMITS, limits);
  if (!isZip(buf)) throw zipError('notZip', 'ZIP ではありません');
  // 終わりの見出し(コメントの分だけ前にあることがある)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw zipError('broken', 'ZIP の終わりが見つかりません');
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw zipError('unsupported', 'ZIP64 には対応していません');
  if (count > lim.entries) throw zipError('tooLarge', 'ファイルが多すぎます');
  if (cdOff + cdSize > eocd) throw zipError('broken', 'ZIP の目次が正しくありません');
  const out = [];
  let p = cdOff, total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw zipError('broken', 'ZIP の目次が正しくありません');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw zipError('unsupported', '暗号化された ZIP には対応していません');
    if (method !== 0 && method !== 8) throw zipError('unsupported', '対応していない圧縮方式です');
    if (usize > lim.entry || (total += usize) > lim.total) throw zipError('tooLarge', '展開すると大きすぎます');
    if (loff + 30 > buf.length || buf.readUInt32LE(loff) !== 0x04034b50) throw zipError('broken', 'ZIP の中身が正しくありません');
    const start = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    if (start + csize > buf.length) throw zipError('broken', 'ZIP の中身が途中で切れています');
    const raw = buf.slice(start, start + csize);
    let data;
    try { data = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) }) : Buffer.from(raw); } catch (e) { throw zipError('broken', 'ZIP の中身を展開できません'); }
    if (data.length !== usize || (zlib.crc32(data) >>> 0) !== crc) throw zipError('broken', 'ZIP の中身が壊れています');
    if (name.endsWith('/')) continue;   // フォルダの項目
    out.push({ name: name, data: data });
  }
  return out;
}

module.exports = { writeZip, readZip, isZip, LIMITS };
