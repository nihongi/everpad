'use strict';
/* Microsoft Store 版(MSIX)のアイコン画像を build/icon.png から作り、build/appx に置く。
   npm run dist:store の前に自動で動く(package.json の predist:store)。electron-builder は build/appx の画像を使う。
   スタートメニューやタスクバーで、Windows が画面の拡大率や大きさに合う画像を選べるよう、いくつもの大きさを作る。
   画像の読み書きと縮小は、ほかのライブラリを使わずにここでする(icon.png は 8 ビットの RGBA)。 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG の読み書き ---------- */
function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('only 8-bit RGBA, non-interlaced PNG is supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4), stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[dst + i - 4] : 0, b = y ? px[dst - stride + i] : 0, c = y && i >= 4 ? px[dst - stride + i - 4] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  return { w, h, px };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
function writePng(img) {
  const { w, h, px } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 ビット、RGBA
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {   // 各行は「左との差」(Sub)で書く(透明な部分が多いので小さくなる)
    raw[y * (stride + 1)] = 1;
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (px[y * stride + i] - (i >= 4 ? px[y * stride + i - 4] : 0)) & 255;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 縮小 ----------
   面積平均(出力の1画素が覆う元の画素を、覆う割合で平均する)。縁が汚れないよう、色に透明度を掛けた値で平均する */
function weights(n, m) {
  const s = n / m, out = [];
  for (let o = 0; o < m; o++) {
    const a = o * s, b = (o + 1) * s, ws = [];
    for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) ws.push([i, (Math.min(b, i + 1) - Math.max(a, i)) / s]);
    out.push(ws);
  }
  return out;
}
function resize(img, W, H) {
  const { w, h, px } = img;
  const pre = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const al = px[i * 4 + 3] / 255;
    pre[i * 4] = px[i * 4] * al; pre[i * 4 + 1] = px[i * 4 + 1] * al; pre[i * 4 + 2] = px[i * 4 + 2] * al; pre[i * 4 + 3] = px[i * 4 + 3];
  }
  const wx = weights(w, W), wy = weights(h, H);
  const tmp = new Float64Array(W * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) for (const [i, k] of wx[x]) for (let c = 0; c < 4; c++) tmp[(y * W + x) * 4 + c] += pre[(y * w + i) * 4 + c] * k;
  const acc = new Float64Array(W * H * 4);
  for (let y = 0; y < H; y++) for (const [j, k] of wy[y]) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) acc[(y * W + x) * 4 + c] += tmp[(j * W + x) * 4 + c] * k;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = acc[i * 4 + 3];
    out[i * 4 + 3] = Math.round(a);
    if (a > 0) for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(acc[i * 4 + c] / (a / 255))));
  }
  return { w: W, h: H, px: out };
}

/* 透明な W×H の画像の真ん中に、高さ(と幅)が size の大きさのアイコンを置く */
function place(src, W, H, size) {
  const icon = resize(src, size, size), out = Buffer.alloc(W * H * 4);
  const ox = Math.round((W - size) / 2), oy = Math.round((H - size) / 2);
  for (let y = 0; y < size; y++) icon.px.copy(out, ((oy + y) * W + ox) * 4, y * size * 4, (y + 1) * size * 4);
  return { w: W, h: H, px: out };
}

/* ---------- 作る画像の一覧 ----------
   scale-XXX: 画面の拡大率ごとの画像。targetsize-NN: タスクバーやエクスプローラーで使う、決まった大きさの画像。
   altform-unplated / altform-lightunplated は、色の付いた四角(プレート)を敷かずに出すときの画像 */
const SCALES = [100, 125, 150, 200, 400];
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];
function assetList() {
  const list = [];
  for (const s of SCALES) {
    const k = s / 100;
    list.push({ name: `StoreLogo.scale-${s}.png`, w: Math.round(50 * k), h: Math.round(50 * k), icon: 1 });
    list.push({ name: `Square44x44Logo.scale-${s}.png`, w: Math.round(44 * k), h: Math.round(44 * k), icon: 1 });
    list.push({ name: `Square150x150Logo.scale-${s}.png`, w: Math.round(150 * k), h: Math.round(150 * k), icon: 0.6 });
    list.push({ name: `Wide310x150Logo.scale-${s}.png`, w: Math.round(310 * k), h: Math.round(150 * k), icon: 0.6 });
  }
  for (const t of TARGET_SIZES) {
    for (const alt of ['', '_altform-unplated', '_altform-lightunplated']) list.push({ name: `Square44x44Logo.targetsize-${t}${alt}.png`, w: t, h: t, icon: 1 });
  }
  return list;
}

function makeAssets(srcFile, outDir) {
  const src = readPng(fs.readFileSync(srcFile));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const cache = new Map();
  const list = assetList();
  for (const a of list) {
    const size = Math.round(Math.min(a.w, a.h) * a.icon), key = a.w + 'x' + a.h + '@' + size;
    if (!cache.has(key)) cache.set(key, writePng(place(src, a.w, a.h, size)));
    fs.writeFileSync(path.join(outDir, a.name), cache.get(key));
  }
  return list.length;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const n = makeAssets(path.join(root, 'build', 'icon.png'), path.join(root, 'build', 'appx'));
  console.log('Store 版のアイコン画像 ' + n + ' 個 → build/appx');
}

module.exports = { readPng, writePng, resize, place, assetList, makeAssets };
