'use strict';
/* 更新の確認(Electron に依存しないので、テストできる)。
   GitHub の「最新の release」を API で読み、いまの版より新しい版があるかを調べる。
   - 応答から使うのは版の番号(tag_name)だけ。案内する先の URL は、ここに固定で書いたものだけを使う
     (応答の html_url などは使わないので、応答が書き換えられても別のサイトへは案内しない)
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
/* 案内する先: Windows は最新の release のページ、それ以外(まだ配布していない)はリポジトリのトップ */
function downloadUrl(platform) {
  return platform === 'win32' ? REPO_URL + '/releases/latest' : REPO_URL;
}

/* 確認する。o: { fetch, current, url?, timeoutMs?, userAgent? }
   返す値: { status: 'newer' | 'latest', current, latest }
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
    return { status: compareVersions(latest, current) > 0 ? 'newer' : 'latest', current: current, latest: latest };
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

module.exports = { REPO_URL, LATEST_API, parseVersion, compareVersions, latestFromRelease, downloadUrl, checkLatest, shouldNotifyAtStart, updatePrefs };
