'use strict';
// Microsoft Store 版(MSIX)のアイコン画像の作成(tools/make-store-assets.js)と、package.json の Store 版の設定
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPng, writePng, resize, place, assetList, makeAssets } = require('../tools/make-store-assets');

const root = path.join(__dirname, '..');
const img = (w, h, f) => { const px = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4); return { w, h, px }; };
const at = (im, x, y) => [...im.px.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)];

test('PNG: 書いたものを読むと同じ画素に戻る(各行の差の書き方を含む)', () => {
  const a = img(7, 5, (x, y) => [x * 30, y * 50, (x * y * 17) & 255, (x + y) * 20]);
  const b = readPng(writePng(a));
  assert.strictEqual(b.w, 7);
  assert.strictEqual(b.h, 5);
  assert.deepStrictEqual(b.px, a.px);
});

test('PNG: build/icon.png(フィルターの付いた本物の PNG)を読める', () => {
  const icon = readPng(fs.readFileSync(path.join(root, 'build', 'icon.png')));
  assert.strictEqual(icon.w, 512);
  assert.strictEqual(icon.h, 512);
  assert.deepStrictEqual(at(icon, 0, 0).slice(3), [0], '角は透明');
  assert.strictEqual(at(icon, 256, 256)[3], 255, '真ん中は不透明');
});

test('PNG: 8 ビットの RGBA 以外は、はっきり断る', () => {
  const png = writePng(img(1, 1, () => [0, 0, 0, 255]));
  png[24 + 1] = 2;   // IHDR の色の種類を RGB にする
  assert.throws(() => readPng(png), /8-bit RGBA/);
  assert.throws(() => readPng(Buffer.from('not a png at all')), /not a PNG/);
});

test('縮小: 同じ色は同じ色のまま。透明な画素と混ぜても色が暗くならない', () => {
  const flat = resize(img(9, 9, () => [10, 120, 230, 255]), 4, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepStrictEqual(at(flat, x, y), [10, 120, 230, 255]);
  const half = resize(img(2, 1, x => (x ? [0, 0, 0, 0] : [200, 40, 0, 255])), 1, 1);
  assert.deepStrictEqual(at(half, 0, 0), [200, 40, 0, 128]);
});

test('縮小: 面積の割合で平均する(3 → 2 で、真ん中の画素は半分ずつ)', () => {
  const r = resize(img(3, 1, x => [[0, 0, 0, 255], [90, 90, 90, 255], [180, 180, 180, 255]][x]), 2, 1);
  assert.deepStrictEqual(at(r, 0, 0), [30, 30, 30, 255]);
  assert.deepStrictEqual(at(r, 1, 0), [150, 150, 150, 255]);
});

test('配置: 横長の画像の真ん中にアイコンを置き、周りは透明', () => {
  const p = place(img(4, 4, () => [255, 0, 0, 255]), 10, 6, 4);
  assert.strictEqual(p.w, 10);
  assert.strictEqual(p.h, 6);
  assert.deepStrictEqual(at(p, 0, 0), [0, 0, 0, 0]);
  assert.deepStrictEqual(at(p, 2, 3), [0, 0, 0, 0]);
  assert.deepStrictEqual(at(p, 3, 1), [255, 0, 0, 255]);
  assert.deepStrictEqual(at(p, 6, 4), [255, 0, 0, 255]);
  assert.deepStrictEqual(at(p, 7, 4), [0, 0, 0, 0]);
});

test('一覧: マニフェストが参照する4種類の画像が、拡大率ごとにそろっている', () => {
  const list = assetList();
  const names = list.map(a => a.name);
  assert.strictEqual(new Set(names).size, names.length, '名前の重複なし');
  const size = n => { const a = list.find(x => x.name === n); return a && [a.w, a.h]; };
  assert.deepStrictEqual(size('StoreLogo.scale-100.png'), [50, 50]);
  assert.deepStrictEqual(size('Square44x44Logo.scale-100.png'), [44, 44]);
  assert.deepStrictEqual(size('Square150x150Logo.scale-200.png'), [300, 300]);
  assert.deepStrictEqual(size('Wide310x150Logo.scale-400.png'), [1240, 600]);
  for (const base of ['StoreLogo', 'Square44x44Logo', 'Square150x150Logo', 'Wide310x150Logo']) {
    for (const s of [100, 125, 150, 200, 400]) assert.ok(names.includes(`${base}.scale-${s}.png`), `${base}.scale-${s}`);
  }
  // タスクバー・スタートメニュー用(プレートなし)
  for (const t of [16, 24, 32, 48, 256]) {
    assert.deepStrictEqual(size(`Square44x44Logo.targetsize-${t}_altform-unplated.png`), [t, t]);
    assert.ok(names.includes(`Square44x44Logo.targetsize-${t}_altform-lightunplated.png`));
  }
});

test('作成: すべての画像を、決めた大きさの PNG として書く', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-appx-'));
  try {
    const out = path.join(dir, 'appx');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'old.png'), 'x');   // 前回の残りは消える
    const n = makeAssets(path.join(root, 'build', 'icon.png'), out);
    const files = fs.readdirSync(out).sort();
    assert.strictEqual(files.length, n);
    assert.ok(!files.includes('old.png'));
    for (const a of assetList()) {
      const p = readPng(fs.readFileSync(path.join(out, a.name)));
      assert.deepStrictEqual([p.w, p.h], [a.w, a.h], a.name);
    }
    const wide = readPng(fs.readFileSync(path.join(out, 'Wide310x150Logo.scale-100.png')));
    assert.strictEqual(at(wide, 5, 75)[3], 0, '横長のタイルの左端は透明');
    assert.strictEqual(at(wide, 155, 75)[3], 255, '真ん中にアイコン');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('package.json: Store 版の ID は Partner Center の値で、通常のビルドには入らない', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const a = pkg.build.appx;
  assert.strictEqual(a.identityName, 'NobuyoshiNIHONGI.EverPad');
  assert.strictEqual(a.publisher, 'CN=FF39C3C1-D637-493A-B421-F7BB5B267F9F');
  assert.strictEqual(a.publisherDisplayName, 'Nobuyoshi NIHONGI');
  assert.match(a.applicationId, /^[A-Za-z][A-Za-z0-9]*$/);
  assert.match(a.artifactName, /store/);
  assert.ok(!pkg.build.win.target.includes('appx'), 'npm run dist(GitHub の release 用)では作らない');
  assert.strictEqual(pkg.scripts['dist:store'], 'electron-builder --win appx');
  assert.match(pkg.scripts['predist:store'], /make-store-assets/);
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).includes('build/appx/'), '作った画像はリポジトリに入れない');
});

test('main.js: Store 版では更新の確認・「送る」・AppUserModelId の変更をしない', () => {
  const src = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(src, /const isStore = process\.windowsStore === true;/);
  assert.match(src, /if \(!isStore\) scheduleStartupCheck\(\);/);
  assert.match(src, /process\.platform === 'win32' && !isStore \? \[\{ label: T\('mSendTo'\)/);
  assert.match(src, /\.\.\.\(isStore \? \[\] : \[\s*\{ label: T\('mCheckUpdate'\)/);
  assert.match(src, /process\.platform === 'win32' && !isStore\) app\.setAppUserModelId/);
});
