'use strict';
/* 保存先フォルダの「使用中」の印(.everpad-lock)。同じ保存先を2つの EverPad で同時に開かないようにする。
   印には開いている EverPad のプロセス番号と種類を書き、開いている間は30秒ごとに更新時刻を新しくする。
   プロセスが終わっている、または90秒以上更新されていない印は、古いもの(異常終了の残り)として扱う。 */
const fs = require('fs');
const path = require('path');

const LOCK_NAME = '.everpad-lock';
const STALE_MS = 90 * 1000;

const lockPath = dir => path.join(dir, LOCK_NAME);

/* プロセスが動いているか(権限が無くて確かめられないときは、動いているとみなす) */
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/* { busy: false } か { busy: true, info: { pid, app } } */
function checkLock(dir, now, alive, myPid) {
  let info, mtime;
  try { info = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')); mtime = fs.statSync(lockPath(dir)).mtimeMs; } catch (e) { return { busy: false }; }
  if (!info || typeof info.pid !== 'number' || info.pid === myPid) return { busy: false };
  if ((alive || isAlive)(info.pid) && now - mtime < STALE_MS) return { busy: true, info: info };
  return { busy: false };
}
function writeLock(dir, info) { fs.writeFileSync(lockPath(dir), JSON.stringify(info)); }
function touchLock(dir) { const t = new Date(); try { fs.utimesSync(lockPath(dir), t, t); } catch (e) { /* 印が消されていたら次の書き込みで作り直す */ } }
/* 自分の印だけを消す */
function releaseLock(dir, myPid) {
  try { const info = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')); if (info.pid === myPid) fs.unlinkSync(lockPath(dir)); } catch (e) { /* 無い */ }
}

module.exports = { checkLock, writeLock, touchLock, releaseLock, isAlive, LOCK_NAME, STALE_MS };
