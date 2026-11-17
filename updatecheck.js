'use strict';
/* 更新の確認(Electron に依存しないので、テストできる)。
   GitHub の「最新の release」を API で読み、いまの版より新しい版があるかを調べる。
   - 応答から使うのは版の番号(tag_name)と、更新に使うファイルの大きさと SHA-256(assets の size・digest)だけ。
     案内する先とダウンロードする先の URL は、ここに固定で書いたものと版の番号から作る
     (応答の html_url や browser_download_url は使わないので、応答が書き換えられても別のサイトへは案内しない)
   - 下書きとプレリリースは、API の /releases/latest が返さない
   - 通信は呼ぶ側が渡す fetch で行う(main.js は Electron の net.fetch を渡すので、システムのプロキシ設定を使う) */

const REPO_URL = 'https://github.com/nihongi/everpad';
const LATEST_API = 'https://api.github.com/repos/nihongi/everpad/releases/latest';
const MAX_BODY = 1024 * 1024;   // 応答はふつう数 KB。これより大きいものは読まない

/* '1.2.3' や 'v1.2.3' を [1, 2, 3] に。それ以外の形は null */
function parseVersion(s) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(typeof s === 'string' ? s.trim() : '');
  return m ? m.slice(1).map(Number) : null;
}
/* a が新しければ正、同じなら 0、古ければ負 */
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error('bad version');
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
/* API の応答(JSON)から、最新の版の番号('1.2.3')を取り出す。おかしな応答なら null */
function latestFromRelease(json) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const v = parseVersion(json.tag_name);
  return v ? v.join('.') : null;
}
/* アプリの中から更新するときにダウンロードするファイル(GitHub は名前の空白を . にする)。
   installer: インストーラー、portable: portable 版 */
const MAX_ASSET = 1024 * 1024 * 1024;   // 1 GB より大きいものはダウンロードしない(いまは 120 MB ほど)
const ASSET_NAMES = {
  installer: v => 'EverPad.Setup.' + v + '.exe',
  portable: v => 'EverPad.' + v + '.exe'
};
/* API の応答から、ダウンロードするファイルの名前・大きさ・SHA-256 を取り出す。
   - 名前は版の番号から決めたものだけを探す(1つだけあること)
   - SHA-256 は GitHub がファイルごとに記録している digest('sha256:…')。無いファイルは使わない
   - ダウンロードする先の URL は、REPO_URL(固定)と版の番号から作る(応答の browser_download_url は使わない)
   base: ダウンロードする先の始まり(開発中の試験だけ変える) */
function filesFromRelease(json, base) {
  const out = {};
  const v = latestFromRelease(json);
  if (!v) return out;
  const tag = String(json.tag_name).trim().startsWith('v') ? 'v' + v : v;
  const list = Array.isArray(json.assets) ? json.assets : [];
  for (const kind of Object.keys(ASSET_NAMES)) {
    const name = ASSET_NAMES[kind](v);
    const found = list.filter(a => a && a.name === name);
    if (found.length !== 1) continue;
    const m = /^sha256:([0-9a-f]{64})$/.exec(typeof found[0].digest === 'string' ? found[0].digest : '');
    const size = found[0].size;
    if (!m || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ASSET) continue;
    out[kind] = { name: name, size: size, sha256: m[1], url: (base || REPO_URL + '/releases/download/') + tag + '/' + name };
  }
  return out;
}

/* 案内する先: Windows は最新の release のページ、それ以外(まだ配布していない)はリポジトリのトップ */
function downloadUrl(platform) {
  return platform === 'win32' ? REPO_URL + '/releases/latest' : REPO_URL;
}

/* 確認する。o: { fetch, current, url?, downloadBase?, timeoutMs?, userAgent? }
   返す値: { status: 'newer', current, latest, files: filesFromRelease の結果 }
          { status: 'latest', current, latest }
          { status: 'error', code: 'net' | 'timeout' | 'rate' | 'http' | 'bad', httpStatus?, message? } */
async function checkLatest(o) {
  const current = o.current;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 15000);
  try {
    let res;
    try {
      res = await o.fetch(o.url || LATEST_API, {
        method: 'GET',
        headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': o.userAgent || 'EverPad' },
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl.signal
      });
    } catch (e) {
      return { status: 'error', code: ctrl.signal.aborted ? 'timeout' : 'net', message: String((e && e.message) || e) };
    }
    if (res.status === 403 || res.status === 429) return { status: 'error', code: 'rate', httpStatus: res.status };
    if (!res.ok) return { status: 'error', code: 'http', httpStatus: res.status };
    let text;
    try { text = await res.text(); } catch (e) { return { status: 'error', code: ctrl.signal.aborted ? 'timeout' : 'net', message: String((e && e.message) || e) }; }
    if (text.length > MAX_BODY) return { status: 'error', code: 'bad' };
    let json;
    try { json = JSON.parse(text); } catch (e) { return { status: 'error', code: 'bad' }; }
    const latest = latestFromRelease(json);
    if (!latest) return { status: 'error', code: 'bad' };
    if (compareVersions(latest, current) <= 0) return { status: 'latest', current: current, latest: latest };
    return { status: 'newer', current: current, latest: latest, files: filesFromRelease(json, o.downloadBase) };
  } finally {
    clearTimeout(timer);
  }
}

/* 起動時に知らせるか(設定でオフ、または「この版は今後知らせない」にした版なら知らせない) */
function shouldNotifyAtStart(result, prefs) {
  return !!result && result.status === 'newer' && prefs.skip !== result.latest;
}
/* config.json の update を読む(既定: 起動時に確認する) */
function updatePrefs(c) {
  const u = (c && typeof c.update === 'object' && c.update) || {};
  return { checkOnStart: u.checkOnStart !== false, skip: parseVersion(u.skip) ? u.skip : null };
}

/* 確認やダウンロードに失敗した理由を、画面に出す文言の名前にする(main.js が文言にする)。
   e: checkLatest の error か、updatedownload.js の DownloadError({ code, httpStatus?, message? })
   プロキシ(net.fetch は Windows のプロキシ設定を使う):
   - ユーザー名とパスワードを求めるプロキシは、407 を返す(EverPad は認証に答えないので、つながらない)
   - https のつなぐ先を断るプロキシでは、Chromium のエラーが net::ERR_TUNNEL_CONNECTION_FAILED になる */
function errorKey(e) {
  const code = e && e.code;
  if (code === 'http') return e.httpStatus === 407 ? 'updErrProxyAuth' : 'updErrHttp';
  if (code === 'net' && /ERR_PROXY_AUTH/.test(e.message || '')) return 'updErrProxyAuth';
  if (code === 'net' && /ERR_TUNNEL_CONNECTION_FAILED/.test(e.message || '')) return 'updErrTunnel';
  return { rate: 'updErrRate', bad: 'updErrBad', timeout: 'updErrTimeout', mismatch: 'updDlErrMismatch', exists: 'updDlErrExists', write: 'updDlErrWrite' }[code] || 'updErrNet';
}

module.exports = { REPO_URL, LATEST_API, MAX_ASSET, parseVersion, compareVersions, latestFromRelease, filesFromRelease, downloadUrl, checkLatest, shouldNotifyAtStart, updatePrefs, errorKey };
