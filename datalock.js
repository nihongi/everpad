'use strict';
/* 保存先フォルダの「使用中」の印。同じ保存先を2つの EverPad で同時に書かないようにする。
   OneDrive などで保存先を共有し、別の PC の EverPad が同じフォルダを開くこともあるので、印は同期されるファイルで表す。

   .everpad-lock      いま編集している EverPad が書く(書くのはいつも1つだけ)。
                      編集中: { v: 2, sid, host, pid, kind, dir, started, beat, asked?, denied? }
                        sid は起動ごとの識別子、host は PC の名前。beat は最後に印を新しくした時刻で、30秒ごとに中身を書き直す
                        (更新時刻だけを変えても、同期されるとは限らないため)。
                        asked は、画面に出して返事を待っている引き継ぎの依頼の rid、denied は断った依頼の rid
                        (返事は、頼んだ側も読む印に書く。依頼のファイルを両方で書くと、同期で食い違いやすいため)。
                      手放した: { v: 2, sid, host, pid, released, to, toBy, files }
                        終了したときと、ほかの EverPad に編集を引き継いだときに書く。to は引き継いだ先の sid、toBy はその
                        EverPad({ host, kind, dir })。files は、この起動で書いたメモの履歴ファイルの大きさ
                        ({ id: バイト数 }、削除したメモは null)。次に開く EverPad は、手元のファイルがこれに揃う
                        (同期が届く)まで待ってから編集を始める。
   .everpad-takeover  編集を引き継ぎたい EverPad が書く: { sid, rid, host, kind, dir, at }。rid は依頼ごとの識別子。
                      待っている間は30秒ごとに at を新しくする。編集中の EverPad はこれを見つけると、画面に出して
                      渡すかどうかを選んでもらう。渡すときは、書き込み待ちの編集を書き出して読み取り専用になり、
                      印を「手放した」にする。

   古い EverPad(0.44 まで)の印 { pid, kind, dir, started } は、更新時刻と同じ PC のプロセス番号で判断する。 */
const fs = require('fs');
const path = require('path');

const LOCK_NAME = '.everpad-lock';
const REQUEST_NAME = '.everpad-takeover';
const BEAT_MS = 30 * 1000;
const STALE_MS = 90 * 1000;              // 同じ PC: これだけ新しくされていない印は、異常終了の残り
const REMOTE_STALE_MS = 5 * 60 * 1000;   // 別の PC: 同期の遅れを見込んで長めに待つ
const REQUEST_TTL = 2 * 60 * 1000;       // これより古い引き継ぎの依頼は、残りものとして無視する

const lockPath = dir => path.join(dir, LOCK_NAME);
const requestPath = dir => path.join(dir, REQUEST_NAME);

/* プロセスが動いているか(権限が無くて確かめられないときは、動いているとみなす) */
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readJson(p) {
  try {
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? { v: v, mtime: fs.statSync(p).mtimeMs } : null;
  } catch (e) { return null; }
}
/* 一時ファイルに書いてから置き換える(書きかけを、ほかの PC が読まないように) */
function writeJson(p, v) {
  const tmp = p + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, p); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* 無い */ } fs.writeFileSync(p, JSON.stringify(v)); }
}

/* 印を読む。{ info, mtime } か null(無い・壊れている) */
function readLock(dir) { return readJson(lockPath(dir)); }

/* 印の状態。me = { sid, host, pid }
   'mine'(自分の印)・'free'(無い・手放された・古い)・'busy'(ほかの EverPad が編集中) */
function lockState(lock, now, me, alive) {
  if (!lock) return 'free';
  const info = lock.v;
  if (typeof info.pid !== 'number' && typeof info.sid !== 'string') return 'free';
  if (info.sid ? info.sid === me.sid : info.pid === me.pid && (!info.host || info.host === me.host)) return 'mine';
  if (info.released) return 'free';
  const beat = Number.isFinite(info.beat) ? info.beat : lock.mtime;
  const sameHost = !info.host || info.host === me.host;
  if (sameHost) return typeof info.pid === 'number' && (alive || isAlive)(info.pid) && now - beat < STALE_MS ? 'busy' : 'free';
  return now - beat < REMOTE_STALE_MS ? 'busy' : 'free';
}

/* 編集を始めてよいか(印が無い・古い・手放された)。ほかの EverPad に引き継いだばかりの印は、引き継いだ先の
   EverPad が印を書くまで(同期の遅れを見込んで最長5分)、その EverPad のためにとっておく */
function lockFree(lock, now, me, alive) {
  if (!lock || !lock.v.released) return lockState(lock, now, me, alive) === 'free';
  const to = lock.v.to;
  return !to || to === me.sid || !(Math.abs(now - lock.v.released) < REMOTE_STALE_MS);
}
/* 印から、いま編集している(引き継いだばかりなら、引き継いだ先の)EverPad の情報 */
function holderOf(lock) {
  if (!lock) return null;
  return lock.v.released && lock.v.toBy && typeof lock.v.toBy === 'object' ? lock.v.toBy : lock.v;
}

function writeLock(dir, info, now) { writeJson(lockPath(dir), Object.assign({ v: 2 }, info, { beat: now })); }

/* 手放す。自分の印のときだけ書き換える(ほかの EverPad の印は残す)。files は書いたメモの大きさ、
   to は引き継ぐ先の依頼({ sid, host, kind, dir })か sid */
function releaseLock(dir, me, now, files, to) {
  const lock = readLock(dir);
  if (lock && lockState(lock, now, me) !== 'mine') return false;
  const rec = { v: 2, sid: me.sid, host: me.host, pid: me.pid, released: now, files: files || {} };
  if (to && typeof to === 'object') { rec.to = to.sid; rec.toBy = { host: to.host || '', kind: to.kind || '', dir: to.dir || '' }; }
  else if (to) rec.to = to;
  writeJson(lockPath(dir), rec);
  return true;
}

/* 手放した印の files のうち、手元のファイルがまだ揃っていない(同期が届いていない)メモの数 */
function filesPending(dir, files) {
  let n = 0;
  for (const id of Object.keys(files || {})) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) continue;
    let size = null;
    try { size = fs.statSync(path.join(dir, id + '.jsonl')).size; } catch (e) { size = null; }
    if (size !== files[id]) n++;
  }
  return n;
}

/* ---- 引き継ぎの依頼 ---- */
function readRequest(dir, now) {
  const r = readJson(requestPath(dir));
  if (!r || typeof r.v.sid !== 'string' || !Number.isFinite(r.v.at)) return null;
  if (Math.abs(now - r.v.at) > REQUEST_TTL) return null;
  return r.v;
}
/* me = { sid, host, kind, dir }(kind と dir は、頼まれた側が「どの EverPad に引き継ぐか」を出すのに使う)、rid は依頼の識別子 */
function writeRequest(dir, me, now, rid) {
  const r = { sid: me.sid, host: me.host, at: now };
  if (rid) r.rid = rid;
  if (me.kind) r.kind = me.kind;
  if (me.dir) r.dir = me.dir;
  writeJson(requestPath(dir), r);
}
/* 自分の依頼だけを消す(sid を渡さないときは、どれでも消す) */
function clearRequest(dir, sid) {
  const r = readJson(requestPath(dir));
  if (!r) return;
  if (sid && r.v.sid !== sid) return;
  try { fs.unlinkSync(requestPath(dir)); } catch (e) { /* 無い */ }
}

/* ---- 同期の競合コピー ----
   印・依頼・索引を2台の PC で同じころに書くと、OneDrive は片方を別の名前のコピーにして残す。
   「.everpad-lock」は名前が空で拡張子が「.everpad-lock」と扱われ、「-PC名.everpad-lock」「-PC名-2.everpad-lock」になる。
   一時ファイル「.everpad-lock.tmp」は「.everpad-lock-PC名.tmp」、索引「.everpad-index.json」は「.everpad-index-PC名.json」。
   どれも EverPad は読まないので、編集中の EverPad が消す(メモのファイルや、元の名前の印には当たらない形だけ) */
const CONFLICT_COPY = [
  /^-[^\\/]+\.everpad-(lock|takeover)$/,
  /^\.everpad-(lock|takeover)-[^\\/]+\.tmp$/,
  /^\.everpad-index-[^\\/]+\.json$/
];
const isConflictCopy = name => typeof name === 'string' && CONFLICT_COPY.some(re => re.test(name));
/* 消したファイルの数 */
function removeConflictCopies(dir) {
  let n = 0, names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return 0; }
  for (const name of names) {
    if (!isConflictCopy(name)) continue;
    try { if (fs.statSync(path.join(dir, name)).isFile()) { fs.unlinkSync(path.join(dir, name)); n++; } } catch (e) { /* 次に消す */ }
  }
  return n;
}

module.exports = {
  readLock, lockState, lockFree, holderOf, writeLock, releaseLock, filesPending, readRequest, writeRequest, clearRequest, isAlive,
  isConflictCopy, removeConflictCopies,
  LOCK_NAME, REQUEST_NAME, BEAT_MS, STALE_MS, REMOTE_STALE_MS, REQUEST_TTL
};
