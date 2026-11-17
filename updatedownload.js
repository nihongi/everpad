'use strict';
/* アプリの中からの更新(0.39.0): 新しい版のファイルをダウンロードして、SHA-256 を確かめる。
   Electron に依存しないので、テストできる(通信は呼ぶ側が渡す fetch で行う。main.js は net.fetch を渡す)。
   - 書きかけは「名前.part」に書き、大きさと SHA-256 が GitHub の記録と同じときだけ、本当の名前にする
   - 違ったとき・やめたとき・失敗したときは、書きかけを消す
   - しばらく何も届かなければ止める(全体の時間は区切らない。遅い回線でも終われるように) */
const fs = require('fs');
const crypto = require('crypto');

class DownloadError extends Error {
  constructor(code, extra) { super(code); this.code = code; Object.assign(this, extra || {}); }
}

/* o: { fetch, url, file, size, sha256, signal?, onProgress?(got, size), userAgent?, idleMs? }
   成功したら file を返す。失敗したら DownloadError を投げる。
   code: 'abort'(やめた) | 'net' | 'timeout' | 'http'(httpStatus) | 'mismatch'(大きさか SHA-256 が違う) | 'write'(保存できない) */
async function download(o) {
  const part = o.file + '.part';
  const ctrl = new AbortController();
  const outer = o.signal;
  if (outer && outer.aborted) throw new DownloadError('abort');
  const onOuter = () => ctrl.abort();
  if (outer) outer.addEventListener('abort', onOuter);
  let timedOut = false, timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, o.idleMs || 30000); };
  const why = e => (outer && outer.aborted) ? new DownloadError('abort')
    : timedOut ? new DownloadError('timeout')
    : e instanceof DownloadError ? e
    : new DownloadError('net', { message: String((e && e.message) || e) });
  let fh = null, reader = null;
  try {
    arm();
    let res;
    try {
      res = await o.fetch(o.url, {
        method: 'GET',
        headers: { 'Accept': 'application/octet-stream', 'User-Agent': o.userAgent || 'EverPad' },
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl.signal
      });
    } catch (e) { throw why(e); }
    if (!res.ok) throw new DownloadError('http', { httpStatus: res.status });
    const len = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
    if (len > 0 && len !== o.size) throw new DownloadError('mismatch');
    if (!res.body || typeof res.body.getReader !== 'function') throw new DownloadError('net', { message: 'no body' });
    try { fh = await fs.promises.open(part, 'w'); } catch (e) { throw new DownloadError('write', { message: e.message }); }
    const hash = crypto.createHash('sha256');
    let got = 0;
    reader = res.body.getReader();
    for (;;) {
      let r;
      try { r = await reader.read(); } catch (e) { throw why(e); }
      if (outer && outer.aborted) throw new DownloadError('abort');
      if (r.done) break;
      arm();
      const chunk = r.value;
      got += chunk.length;
      if (got > o.size) throw new DownloadError('mismatch');
      hash.update(chunk);
      try { await fh.write(chunk); } catch (e) { throw new DownloadError('write', { message: e.message }); }
      if (o.onProgress) o.onProgress(got, o.size);
    }
    if (got !== o.size || hash.digest('hex') !== o.sha256) throw new DownloadError('mismatch');
    try { await fh.close(); fh = null; await fs.promises.rename(part, o.file); } catch (e) { throw new DownloadError('write', { message: e.message }); }
    return o.file;
  } catch (e) {
    const err = why(e);
    if (reader) { try { await reader.cancel(); } catch (x) { /* もう止まっている */ } }
    if (fh) { try { await fh.close(); } catch (x) { /* 閉じられなくても消す */ } }
    try { await fs.promises.rm(part, { force: true }); } catch (x) { /* 消せなくても、次の起動で片づける */ }
    throw err;
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuter);
  }
}

/* すでにあるファイルの SHA-256(portable 版を前にダウンロードしてあるかを確かめる) */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/* インストーラーを、画面を出さずに更新として動かすときの引数(electron-builder の NSIS インストーラー)。
   --updated: 更新として動かす(アプリが残っていれば少し待ってから閉じる。ショートカットは作り直さない)
   /S: 画面を出さない(入れる場所と、自分だけか全ユーザーかは、前のインストールのものを使う)
   --force-run: 終わったら EverPad を起動する */
const INSTALLER_ARGS = Object.freeze(['--updated', '/S', '--force-run']);

/* 一時フォルダに作る、ダウンロード用のフォルダの名前の始まり(次の起動で片づける) */
const TEMP_PREFIX = 'EverPad-update-';

module.exports = { download, sha256File, DownloadError, INSTALLER_ARGS, TEMP_PREFIX };
