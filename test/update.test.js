'use strict';
/* 更新の確認(0.22.0): updatecheck.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const U = require('../updatecheck');

// 決まった応答を返す fetch。呼ばれた URL と設定を覚える
function fakeFetch(status, body, calls) {
  return async (url, init) => {
    if (calls) calls.push({ url, init });
    return { status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}
const release = tag => ({ tag_name: tag, draft: false, prerelease: false, html_url: 'https://evil.example/' });

test('parseVersion / compareVersions: x.y.z と vx.y.z だけを読み、数として比べる', () => {
  assert.deepStrictEqual(U.parseVersion('0.21.0'), [0, 21, 0]);
  assert.deepStrictEqual(U.parseVersion('v1.2.3'), [1, 2, 3]);
  for (const bad of ['1.2', '1.2.3.4', 'v1.2.3-beta', ' v1.2.x', '<b>1.2.3</b>', '', null, 3, '1234567.0.0']) assert.strictEqual(U.parseVersion(bad), null, String(bad));
  assert.ok(U.compareVersions('0.10.0', '0.9.9') > 0, '文字列ではなく数で比べる');
  assert.ok(U.compareVersions('v0.21.0', '0.22.0') < 0);
  assert.strictEqual(U.compareVersions('v1.0.0', '1.0.0'), 0);
  assert.throws(() => U.compareVersions('x', '1.0.0'));
});

test('checkLatest: 新しい版・同じ版・古い版(開発中)を見分け、固定の API に問い合わせる', async () => {
  const calls = [];
  const r = await U.checkLatest({ fetch: fakeFetch(200, release('v0.22.0'), calls), current: '0.21.0', userAgent: 'EverPad/0.21.0' });
  assert.deepStrictEqual(r, { status: 'newer', current: '0.21.0', latest: '0.22.0' });
  assert.strictEqual(calls[0].url, 'https://api.github.com/repos/nihongi/everpad/releases/latest');
  assert.strictEqual(calls[0].init.method, 'GET');
  assert.strictEqual(calls[0].init.headers['User-Agent'], 'EverPad/0.21.0');
  assert.strictEqual(calls[0].init.cache, 'no-store');
  assert.strictEqual((await U.checkLatest({ fetch: fakeFetch(200, release('v0.21.0')), current: '0.21.0' })).status, 'latest');
  assert.strictEqual((await U.checkLatest({ fetch: fakeFetch(200, release('v0.20.0')), current: '0.21.0' })).status, 'latest');
});

test('checkLatest: 応答の URL は返さない(案内する先は固定)', async () => {
  const r = await U.checkLatest({ fetch: fakeFetch(200, release('v9.0.0')), current: '0.21.0' });
  assert.ok(!JSON.stringify(r).includes('evil'));
  assert.strictEqual(U.downloadUrl('win32'), 'https://github.com/nihongi/everpad/releases/latest');
  assert.strictEqual(U.downloadUrl('darwin'), 'https://github.com/nihongi/everpad');
  assert.strictEqual(U.downloadUrl('linux'), 'https://github.com/nihongi/everpad');
  // main.js も、応答の html_url などは使わない
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(!/html_url|\.assets\b|browser_download_url/.test(main));
});

test('checkLatest: おかしな応答・失敗は error にし、理由を分ける', async () => {
  const err = async (fetch, current = '0.21.0') => U.checkLatest({ fetch, current, timeoutMs: 50 });
  assert.strictEqual((await err(fakeFetch(200, { tag_name: 'v1.0.0', draft: true }))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, { tag_name: 'v1.0.0', prerelease: true }))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, release('v1.0.0-rc1')))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, release('latest')))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, 'not json'))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, 'null'))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(200, ' '.repeat(1024 * 1024 + 1)))).code, 'bad');
  assert.strictEqual((await err(fakeFetch(403, {}))).code, 'rate');
  assert.strictEqual((await err(fakeFetch(429, {}))).code, 'rate');
  const nf = await err(fakeFetch(404, {}));
  assert.deepStrictEqual([nf.code, nf.httpStatus], ['http', 404]);
  const net = await err(async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED'); });
  assert.deepStrictEqual([net.code, net.message], ['net', 'net::ERR_PROXY_CONNECTION_FAILED']);
  // 応答が来ないときは、時間切れで止める
  const hang = (url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.strictEqual((await err(hang)).code, 'timeout');
});

test('updatePrefs / shouldNotifyAtStart: 既定は起動時に確認し、「今後知らせない」にした版は起動時に出さない', () => {
  assert.deepStrictEqual(U.updatePrefs({}), { checkOnStart: true, skip: null });
  assert.deepStrictEqual(U.updatePrefs(null), { checkOnStart: true, skip: null });
  assert.deepStrictEqual(U.updatePrefs({ update: { checkOnStart: false, skip: '0.22.0' } }), { checkOnStart: false, skip: '0.22.0' });
  assert.strictEqual(U.updatePrefs({ update: { skip: 'junk' } }).skip, null);
  const newer = { status: 'newer', latest: '0.22.0' };
  assert.strictEqual(U.shouldNotifyAtStart(newer, { skip: null }), true);
  assert.strictEqual(U.shouldNotifyAtStart(newer, { skip: '0.22.0' }), false);
  assert.strictEqual(U.shouldNotifyAtStart({ status: 'newer', latest: '0.23.0' }, { skip: '0.22.0' }), true, 'もっと新しい版は知らせる');
  assert.strictEqual(U.shouldNotifyAtStart({ status: 'latest' }, { skip: null }), false);
  assert.strictEqual(U.shouldNotifyAtStart({ status: 'error' }, { skip: null }), false);
});

test('配布物: updatecheck.js がビルドに含まれる', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('updatecheck.js'));
});
