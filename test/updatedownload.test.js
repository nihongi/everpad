'use strict';
/* アプリの中からの更新(0.39.0): updatecheck.js の filesFromRelease と、updatedownload.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const U = require('../updatecheck');
const D = require('../updatedownload');

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-dl-test-'));
const asset = (name, size, digest) => ({ name, size, digest, browser_download_url: 'https://evil.example/' + name });

test('filesFromRelease: 版の番号で決まる名前のファイルだけを、大きさと SHA-256 つきで取り出し、URL は固定の場所から作る', () => {
  const h1 = 'a'.repeat(64), h2 = 'b'.repeat(64);
  const json = { tag_name: 'v0.39.0', draft: false, prerelease: false, assets: [
    asset('EverPad.Setup.0.39.0.exe', 123, 'sha256:' + h1),
    asset('EverPad.0.39.0.exe', 456, 'sha256:' + h2),
    asset('EverPad.Setup.0.39.0.exe.blockmap', 7, 'sha256:' + h1),
    asset('evil.exe', 1, 'sha256:' + h1)
  ] };
  const f = U.filesFromRelease(json);
  assert.deepStrictEqual(f, {
    installer: { name: 'EverPad.Setup.0.39.0.exe', size: 123, sha256: h1, url: 'https://github.com/nihongi/everpad/releases/download/v0.39.0/EverPad.Setup.0.39.0.exe' },
    portable: { name: 'EverPad.0.39.0.exe', size: 456, sha256: h2, url: 'https://github.com/nihongi/everpad/releases/download/v0.39.0/EverPad.0.39.0.exe' }
  });
  assert.ok(!JSON.stringify(f).includes('evil'), '応答の browser_download_url は使わない');
  // 開発中の試験だけ、ダウンロードする先の始まりを変えられる
  assert.strictEqual(U.filesFromRelease(json, 'http://127.0.0.1:1/dl/').installer.url, 'http://127.0.0.1:1/dl/v0.39.0/EverPad.Setup.0.39.0.exe');
  // v の付かないタグ
  assert.strictEqual(U.filesFromRelease(Object.assign({}, json, { tag_name: '0.39.0' })).installer.url, 'https://github.com/nihongi/everpad/releases/download/0.39.0/EverPad.Setup.0.39.0.exe');
});

test('filesFromRelease: SHA-256 が無い・おかしい、大きさがおかしい、同じ名前が2つある、版が違うファイルは使わない', () => {
  const h = 'c'.repeat(64);
  const one = (a, tag) => U.filesFromRelease({ tag_name: tag || 'v1.0.0', assets: a });
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 10, undefined)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 10, 'sha512:' + h)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 10, 'sha256:' + h.toUpperCase())]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 10, 'sha256:' + h + '0')]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 0, 'sha256:' + h)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', '10', 'sha256:' + h)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', U.MAX_ASSET + 1, 'sha256:' + h)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.1.0.0.exe', 10, 'sha256:' + h), asset('EverPad.Setup.1.0.0.exe', 10, 'sha256:' + h)]), {});
  assert.deepStrictEqual(one([asset('EverPad.Setup.0.9.0.exe', 10, 'sha256:' + h)]), {});
  assert.deepStrictEqual(one(null), {});
  assert.deepStrictEqual(U.filesFromRelease({ tag_name: 'v1.0.0', draft: true, assets: [asset('EverPad.Setup.1.0.0.exe', 10, 'sha256:' + h)] }), {});
});

test('checkLatest: 新しい版があるときは files も返す(同じ版・古い版では返さない)', async () => {
  const h = 'd'.repeat(64);
  const body = { tag_name: 'v0.39.0', draft: false, prerelease: false, assets: [asset('EverPad.Setup.0.39.0.exe', 99, 'sha256:' + h)] };
  const fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });
  const r = await U.checkLatest({ fetch, current: '0.38.1' });
  assert.strictEqual(r.status, 'newer');
  assert.deepStrictEqual(Object.keys(r.files), ['installer']);
  assert.strictEqual(r.files.installer.sha256, h);
  assert.strictEqual((await U.checkLatest({ fetch, current: '0.38.1', downloadBase: 'http://127.0.0.1:9/' })).files.installer.url, 'http://127.0.0.1:9/v0.39.0/EverPad.Setup.0.39.0.exe');
  assert.deepStrictEqual(await U.checkLatest({ fetch, current: '0.39.0' }), { status: 'latest', current: '0.39.0', latest: '0.39.0' });
});

// 本物に近い Response(ReadableStream の本文)を返す fetch
function streamFetch(chunks, opts) {
  const o = opts || {};
  return async (url, init) => {
    if (o.calls) o.calls.push({ url, init });
    if (o.throws) throw new Error(o.throws);
    let i = 0;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (i < chunks.length) { ctrl.enqueue(new Uint8Array(chunks[i++])); return; }
        if (o.hang) {
          return new Promise((_res, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); ctrl.error(e); rej(e); }, { once: true }));
        }
        ctrl.close();
      }
    });
    const headers = new Headers();
    if (o.length !== undefined) headers.set('content-length', String(o.length));
    return new Response(stream, { status: o.status || 200, headers });
  };
}

test('download: 大きさと SHA-256 が合えば保存し、進み具合を知らせ、書きかけ(.part)を残さない', async () => {
  const dir = tmp();
  try {
    const a = Buffer.from('hello, '), b = Buffer.from('EverPad update');
    const all = Buffer.concat([a, b]);
    const calls = [], prog = [];
    const file = path.join(dir, 'EverPad Setup 9.9.9.exe');
    const r = await D.download({ fetch: streamFetch([a, b], { calls, length: all.length }), url: 'https://example.test/x', file, size: all.length, sha256: sha(all), onProgress: (g, s) => prog.push([g, s]), userAgent: 'EverPad/1.0.0' });
    assert.strictEqual(r, file);
    assert.deepStrictEqual(fs.readFileSync(file), all);
    assert.ok(!fs.existsSync(file + '.part'));
    assert.deepStrictEqual(prog, [[a.length, all.length], [all.length, all.length]]);
    assert.strictEqual(calls[0].url, 'https://example.test/x');
    assert.strictEqual(calls[0].init.headers['User-Agent'], 'EverPad/1.0.0');
    assert.strictEqual(calls[0].init.cache, 'no-store');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: 中身・大きさが違えば mismatch にして、何も残さない', async () => {
  const dir = tmp();
  try {
    const data = Buffer.from('the real installer');
    const file = path.join(dir, 'x.exe');
    const run = async (chunks, size, hash, length) => {
      try { await D.download({ fetch: streamFetch(chunks, { length }), url: 'u', file, size, sha256: hash }); return 'ok'; } catch (e) { return e.code; }
    };
    assert.strictEqual(await run([Buffer.from('the fake installer')], data.length, sha(data)), 'mismatch', 'SHA-256 が違う');
    assert.strictEqual(await run([data, Buffer.from('!')], data.length, sha(data)), 'mismatch', '長すぎる');
    assert.strictEqual(await run([data.subarray(0, 5)], data.length, sha(data)), 'mismatch', '短すぎる');
    assert.strictEqual(await run([data], data.length, sha(data), data.length + 1), 'mismatch', 'Content-Length が違う');
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'ファイルも書きかけも残さない');
    assert.strictEqual(await run([data], data.length, sha(data)), 'ok');
    assert.deepStrictEqual(fs.readdirSync(dir), ['x.exe']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: HTTP のエラー・つながらない・保存できないときは、理由を分ける', async () => {
  const dir = tmp();
  try {
    const data = Buffer.from('abc');
    const base = { url: 'u', file: path.join(dir, 'x.exe'), size: data.length, sha256: sha(data) };
    const code = async o => { try { await D.download(Object.assign({}, base, o)); return null; } catch (e) { return e; } };
    const h = await code({ fetch: streamFetch([data], { status: 404 }) });
    assert.deepStrictEqual([h.code, h.httpStatus], ['http', 404]);
    const n = await code({ fetch: streamFetch([data], { throws: 'net::ERR_NAME_NOT_RESOLVED' }) });
    assert.deepStrictEqual([n.code, n.message], ['net', 'net::ERR_NAME_NOT_RESOLVED']);
    const w = await code({ fetch: streamFetch([data]), file: path.join(dir, 'no-such-dir', 'x.exe') });
    assert.strictEqual(w.code, 'write');
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('download: やめたとき(abort)と、しばらく何も届かないとき(timeout)は止めて、書きかけを消す', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'x.exe');
    const ctrl = new AbortController();
    const p = D.download({ fetch: streamFetch([Buffer.from('part')], { hang: true }), url: 'u', file, size: 100, sha256: 'e'.repeat(64), signal: ctrl.signal, onProgress: () => setTimeout(() => ctrl.abort(), 20) });
    await assert.rejects(p, e => e.code === 'abort');
    const t = D.download({ fetch: streamFetch([Buffer.from('part')], { hang: true }), url: 'u', file, size: 100, sha256: 'e'.repeat(64), idleMs: 50 });
    await assert.rejects(t, e => e.code === 'timeout');
    const pre = new AbortController(); pre.abort();
    await assert.rejects(D.download({ fetch: streamFetch([]), url: 'u', file, size: 1, sha256: 'e'.repeat(64), signal: pre.signal }), e => e.code === 'abort');
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('errorKey: 失敗の理由を文言の名前にする(プロキシの認証・プロキシが断ったときを分ける)', () => {
  assert.strictEqual(U.errorKey({ code: 'http', httpStatus: 407 }), 'updErrProxyAuth');
  assert.strictEqual(U.errorKey({ code: 'net', message: 'net::ERR_PROXY_AUTH_UNSUPPORTED' }), 'updErrProxyAuth');
  assert.strictEqual(U.errorKey({ code: 'net', message: 'net::ERR_TUNNEL_CONNECTION_FAILED' }), 'updErrTunnel');
  assert.strictEqual(U.errorKey({ code: 'net', message: 'net::ERR_PROXY_CONNECTION_FAILED' }), 'updErrNet');
  assert.strictEqual(U.errorKey({ code: 'http', httpStatus: 404 }), 'updErrHttp');
  assert.strictEqual(U.errorKey({ code: 'rate' }), 'updErrRate');
  assert.strictEqual(U.errorKey({ code: 'bad' }), 'updErrBad');
  assert.strictEqual(U.errorKey({ code: 'timeout' }), 'updErrTimeout');
  assert.strictEqual(U.errorKey({ code: 'mismatch' }), 'updDlErrMismatch');
  assert.strictEqual(U.errorKey({ code: 'exists' }), 'updDlErrExists');
  assert.strictEqual(U.errorKey({ code: 'write' }), 'updDlErrWrite');
  assert.strictEqual(U.errorKey(null), 'updErrNet');
  const I18N = require('../renderer/i18n');
  for (const lang of ['ja', 'en']) for (const k of ['updErrProxyAuth', 'updErrTunnel']) assert.ok(I18N.DICT[lang][k], lang + ' ' + k);
  assert.ok(I18N.DICT.ja.updErrTunnel.includes('release-assets.githubusercontent.com') && I18N.DICT.en.updErrTunnel.includes('release-assets.githubusercontent.com'));
  // main.js は、確認とダウンロードの両方で errorKey を使い、ダウンロードでは何も届かなくても2分は待つ
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.strictEqual(main.split('updater.errorKey(').length - 1, 2);
  assert.ok(main.includes('idleMs: 120000'));
});

test('sha256File: すでにあるファイルの SHA-256', async () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'a.exe');
    fs.writeFileSync(f, 'portable');
    assert.strictEqual(await D.sha256File(f), sha(Buffer.from('portable')));
    await assert.rejects(D.sha256File(path.join(dir, 'none')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('インストーラーは、画面を出さない更新として動かし、終わったら EverPad を起動させる', () => {
  assert.deepStrictEqual([...D.INSTALLER_ARGS], ['--updated', '/S', '--force-run']);
  assert.ok(Object.isFrozen(D.INSTALLER_ARGS));
  assert.strictEqual(D.TEMP_PREFIX, 'EverPad-update-');
});

test('main.js: Store 版と開発中は、インストーラーを動かさない。動かすのはアプリが終わったところだけ', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const fn = name => { const i = main.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return main.slice(i, main.indexOf('\n}', i)); };
  // どの版で、アプリの中から更新できるか
  const kind = fn('updateKind');
  assert.match(kind, /^function updateKind\(\) \{\s*if \(isStore \|\| process\.platform !== 'win32'\) return null;/);
  assert.ok(kind.includes("'Uninstall ' + APP_NAME + '.exe'"), 'インストール版は、インストーラーが入れたものだけ');
  assert.ok(kind.includes("layout.mode === 'portable'"), 'portable 版は、exe の隣に書けるときだけ');
  // インストーラーを動かすのは launchInstaller だけで、Store 版と開発中は動かさない
  assert.strictEqual(main.split('spawn(').length - 1, 1);
  const launch = fn('launchInstaller');
  assert.ok(launch.includes('spawn(file, updget.INSTALLER_ARGS'));
  assert.ok(launch.indexOf('if (isStore) return;') < launch.indexOf('spawn('));
  assert.ok(launch.indexOf('if (!app.isPackaged) {') < launch.indexOf('spawn('));
  assert.ok(/app\.on\('quit', \(\) => \{ if \(pendingInstaller\) launchInstaller\(pendingInstaller\); \}\);/.test(main));
  assert.strictEqual(main.split('launchInstaller(').length - 1, 2, '定義と、終わったところの1か所だけ');
  // 開発中だけの試験用の設定は、配布版では使わない
  for (const v of ['EVERPAD_UPDATE_KIND', 'EVERPAD_UPDATE_DL', 'EVERPAD_UPDATE_DIR']) {
    for (const line of main.split('\n').filter(l => l.includes('process.env.' + v))) assert.ok(/!app\.isPackaged|app\.isPackaged \?/.test(line) || /^\s*const out = process\.env\.EVERPAD_UPDATE_DIR;/.test(line), line.trim());
  }
  // 更新の確認は、いままでどおり Store 版ではしない
  assert.ok(main.includes('if (!isStore) scheduleStartupCheck();'));
  assert.ok(/\.\.\.\(isStore \? \[\] : \[\s*\{ label: T\('mCheckUpdate'\)/.test(main));
});

test('配布物と画面: updatedownload.js がビルドに含まれ、進み具合の表示と文言がそろっている', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('updatedownload.js'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  for (const id of ['updBar', 'updText', 'updProg', 'updCancel']) assert.ok(html.includes('id="' + id + '"'), id);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.ok(preload.includes("ipcRenderer.on('update:progress'") && preload.includes("ipcRenderer.send('update:cancel')"));
  const I18N = require('../renderer/i18n');
  const keys = ['updInstall', 'updDownload', 'updDetailInstall', 'updDetailPortable', 'updDownloading', 'updCancel', 'updCanceled', 'updReady', 'updReadyDetail', 'updRestart', 'updSaved', 'updSavedDetail', 'updShowFile', 'updDlError', 'updDlErrMismatch', 'updDlErrExists', 'updDlErrWrite'];
  for (const lang of ['ja', 'en']) for (const k of keys) assert.ok(typeof I18N.DICT[lang][k] === 'string' && I18N.DICT[lang][k], lang + ' ' + k);
});
