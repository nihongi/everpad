'use strict';
/* 同じ保存先を開いている、ほかの EverPad(datalock.js・store.js・main.js・画面) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DL = require('../datalock');
const { Store, applyWire } = require('../store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-lock-'));
const A = { sid: 'aaaa1111', host: 'PC-A', pid: 100 };
const B = { sid: 'bbbb2222', host: 'PC-B', pid: 200 };
const A2 = { sid: 'cccc3333', host: 'PC-A', pid: 300 };   // 同じ PC の別の EverPad
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');   // CRLF で取り出しても同じに読む

test('印: 自分・手放した・同じ PC・別の PC を見分ける', () => {
  const dir = tmp();
  try {
    const now = 1e12;
    assert.strictEqual(DL.lockState(DL.readLock(dir), now, A), 'free');                        // 印が無い
    DL.writeLock(dir, { sid: A.sid, host: A.host, pid: A.pid, kind: 'installed' }, now);
    const lock = DL.readLock(dir);
    assert.strictEqual(lock.v.beat, now);                                                     // 時刻は中身に書く(同期されるように)
    assert.strictEqual(DL.lockState(lock, now, A), 'mine');
    // 同じ PC: プロセスが動いていて、新しい印だけを「編集中」とみなす
    assert.strictEqual(DL.lockState(lock, now + 1000, A2, () => true), 'busy');
    assert.strictEqual(DL.lockState(lock, now + 1000, A2, () => false), 'free');
    assert.strictEqual(DL.lockState(lock, now + DL.STALE_MS + 1, A2, () => true), 'free');
    // 別の PC: プロセス番号は調べず(意味が無い)、同期の遅れを見込んで長めに待つ
    assert.strictEqual(DL.lockState(lock, now + DL.STALE_MS + 1, B, () => false), 'busy');
    assert.strictEqual(DL.lockState(lock, now + DL.REMOTE_STALE_MS - 1, B, () => false), 'busy');
    assert.strictEqual(DL.lockState(lock, now + DL.REMOTE_STALE_MS + 1, B, () => false), 'free');
    // 手放すと、だれでも使える。自分のでない印は手放さない
    assert.strictEqual(DL.releaseLock(dir, B, now, {}), false);
    assert.strictEqual(DL.readLock(dir).v.released, undefined);
    assert.strictEqual(DL.releaseLock(dir, A, now + 5, { 'note-aaaa': 42 }, B.sid), true);
    const rel = DL.readLock(dir);
    assert.deepStrictEqual([rel.v.released, rel.v.to, rel.v.files], [now + 5, B.sid, { 'note-aaaa': 42 }]);
    assert.strictEqual(DL.lockState(rel, now + 10, B, () => true), 'free');
    // 引き継いだばかりの印は、引き継いだ先のためにとっておく(手放した本人も、ほかの EverPad も「閉じられた」とみなさない)
    assert.strictEqual(DL.lockFree(rel, now + 10, B, () => true), true);
    assert.strictEqual(DL.lockFree(rel, now + 10, A, () => true), false);
    assert.strictEqual(DL.lockFree(rel, now + 10, A2, () => true), false);
    assert.strictEqual(DL.lockFree(rel, now + 5 + DL.REMOTE_STALE_MS, A2, () => true), true);   // 引き継いだ先が来なかった
    assert.strictEqual(DL.lockFree(null, now, A2), true);                                      // 印が無い
    // 引き継いだ先の EverPad を印に書く(ほかの EverPad は、その EverPad を「編集中」として出す)
    DL.writeLock(dir, { sid: A.sid, host: A.host, pid: A.pid }, now);
    DL.releaseLock(dir, A, now + 5, {}, { sid: B.sid, host: B.host, kind: 'portable', dir: 'E:\\EverPad', at: now });
    const rel2 = DL.readLock(dir);
    assert.deepStrictEqual([rel2.v.to, rel2.v.toBy], [B.sid, { host: B.host, kind: 'portable', dir: 'E:\\EverPad' }]);
    assert.deepStrictEqual(DL.holderOf(rel2), { host: B.host, kind: 'portable', dir: 'E:\\EverPad' });
    // 閉じたとき(引き継ぐ先が無い)は、だれでも使える
    DL.writeLock(dir, { sid: A.sid, host: A.host, pid: A.pid, asked: 'r1' }, now);
    assert.strictEqual(DL.readLock(dir).v.asked, 'r1');                                        // 依頼への返事も印に書ける
    assert.strictEqual(DL.holderOf(DL.readLock(dir)).sid, A.sid);
    DL.releaseLock(dir, A, now + 5, {});
    assert.strictEqual(DL.lockFree(DL.readLock(dir), now + 10, A2, () => true), true);
    // 編集中の印は lockState と同じ
    DL.writeLock(dir, { sid: A.sid, host: A.host, pid: A.pid }, now);
    assert.strictEqual(DL.lockFree(DL.readLock(dir), now + 10, B), false);
    assert.strictEqual(DL.lockFree(DL.readLock(dir), now + DL.REMOTE_STALE_MS + 1, B), true);
    // 壊れた印は無視する
    fs.writeFileSync(path.join(dir, DL.LOCK_NAME), 'こわれた印');
    assert.strictEqual(DL.lockState(DL.readLock(dir), now, B), 'free');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('印: 古い EverPad(0.44 まで)の印は、更新時刻と同じ PC のプロセスで判断する', () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, DL.LOCK_NAME), JSON.stringify({ pid: 4242, kind: 'portable', dir: 'E:\\EverPad' }));
    const lock = DL.readLock(dir), now = lock.mtime + 1000;
    assert.strictEqual(DL.lockState(lock, now, B, () => true), 'busy');
    assert.strictEqual(DL.lockState(lock, now, B, () => false), 'free');
    assert.strictEqual(DL.lockState(lock, now + DL.STALE_MS, B, () => true), 'free');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('引き継ぎの依頼と、同期を待つメモの数', () => {
  const dir = tmp();
  try {
    const now = 1e12;
    assert.strictEqual(DL.readRequest(dir, now), null);
    DL.writeRequest(dir, B, now);
    assert.deepStrictEqual(DL.readRequest(dir, now + 1000), { sid: B.sid, host: B.host, at: now });
    assert.strictEqual(DL.readRequest(dir, now + DL.REQUEST_TTL + 1), null);                   // 古い依頼は残りもの
    DL.clearRequest(dir, A.sid);                                                              // ほかの依頼は消さない
    assert.ok(DL.readRequest(dir, now));
    DL.clearRequest(dir, B.sid);
    assert.strictEqual(DL.readRequest(dir, now), null);
    DL.writeRequest(dir, Object.assign({ kind: 'portable', dir: 'E:\\EverPad' }, B), now);     // どの EverPad に引き継ぐかを出せるように
    assert.deepStrictEqual(DL.readRequest(dir, now), { sid: B.sid, host: B.host, at: now, kind: 'portable', dir: 'E:\\EverPad' });
    DL.writeRequest(dir, B, now, 'rid-1');                                                    // 依頼ごとの識別子(返事を見分ける)
    assert.strictEqual(DL.readRequest(dir, now).rid, 'rid-1');
    DL.clearRequest(dir);
    // 手放した印の files に、手元のファイルが揃うまで待つ
    fs.writeFileSync(path.join(dir, 'note-aaaa.jsonl'), '12345');
    assert.strictEqual(DL.filesPending(dir, { 'note-aaaa': 5 }), 0);
    assert.strictEqual(DL.filesPending(dir, { 'note-aaaa': 9, 'note-bbbb': 3 }), 2);           // 大きさが違う・まだ無い
    assert.strictEqual(DL.filesPending(dir, { 'note-cccc': null }), 0);                       // 削除したメモは、無ければ揃っている
    assert.strictEqual(DL.filesPending(dir, { '../x': 1 }), 0);                                // 正しくない ID は見ない
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('同期の競合コピー: 印・依頼・索引のコピーだけを消す', () => {
  const dir = tmp();
  try {
    const copies = ['-DESKTOP-5Q1NKLS.everpad-lock', '-DESKTOP-5Q1NKLS-2.everpad-lock', '-DESKTOP-5Q1NKLS-4.everpad-lock',
      '-PC-B.everpad-takeover', '.everpad-lock-PC-B.tmp', '.everpad-index-DESKTOP-5Q1NKLS.json'];
    const keep = [DL.LOCK_NAME, DL.REQUEST_NAME, '.everpad-lock.tmp', '.everpad-index.json', 'note-aaaa.jsonl', 'note-aaaa.md',
      '-DESKTOP-5Q1NKLS.jsonl', 'a.everpad-lock', '-x.everpad-locks'];
    for (const n of copies.concat(keep)) fs.writeFileSync(path.join(dir, n), 'x');
    fs.mkdirSync(path.join(dir, '-folder.everpad-lock'));                          // フォルダは消さない
    for (const n of copies) assert.ok(DL.isConflictCopy(n), n);
    for (const n of keep) assert.ok(!DL.isConflictCopy(n), n);
    assert.strictEqual(DL.removeConflictCopies(dir), copies.length);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), keep.concat('-folder.everpad-lock').sort());
    assert.strictEqual(DL.removeConflictCopies(path.join(dir, 'none')), 0);         // 保存先が無くても止まらない
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // 消すのは編集中の EverPad だけ(印を書くとき)
  assert.match(read('main.js'), /function acquireLock\(\) \{[\s\S]*?if \(now - lastSweep >= datalock\.BEAT_MS\) \{ lastSweep = now; datalock\.removeConflictCopies\(store\.dir\); \}/);
});

test('保存: ほかの EverPad が書き換えたメモには書き足さず changed にする', () => {
  const dir = tmp();
  try {
    const a = new Store(dir), b = new Store(dir);
    a.create('note-aaaa', 1);
    a.append('note-aaaa', [[0, '', 'abc', 2]]);
    assert.strictEqual(b.loadForEdit('note-aaaa').ops.length, 1);
    b.append('note-aaaa', [[3, '', 'B', 3]]);                                // b が書き足す(同期で a の手元に届く)
    assert.strictEqual(a.changedOnDisk('note-aaaa'), 'changed');
    assert.throws(() => a.append('note-aaaa', [[3, '', 'A', 4]]), e => e.code === 'changed');
    assert.throws(() => a.saveText('note-aaaa', 'abcA'), e => e.code === 'changed');
    assert.throws(() => a.setReadOnly('note-aaaa', true), e => e.code === 'changed');
    assert.throws(() => a.prunePlan('note-aaaa', 2, 2), e => e.code === 'changed');
    assert.strictEqual(a.loadOne('note-aaaa').ops.reduce(applyWire, ''), 'abcB');     // b の編集だけが残る(位置のずれた編集を書かない)
    // 読み直せば、また書き足せる
    a.loadForEdit('note-aaaa');
    assert.strictEqual(a.changedOnDisk('note-aaaa'), null);
    a.append('note-aaaa', [[4, '', 'A', 5]]);
    assert.strictEqual(a.loadOne('note-aaaa').ops.reduce(applyWire, ''), 'abcBA');
    // 消されたメモは gone
    b.loadForEdit('note-aaaa');
    fs.unlinkSync(path.join(dir, 'note-aaaa.jsonl'));
    assert.strictEqual(b.changedOnDisk('note-aaaa'), 'gone');
    // 覚えていない(読み込んでいない)メモは、比べられないので書き足す
    const c = new Store(dir);
    c.readOnly = false;
    b.create('note-bbbb', 1);
    c.append('note-bbbb', [[0, '', 'x', 2]]);
    assert.strictEqual(c.loadOne('note-bbbb').ops.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('保存: 読み取り専用で開いた保存先には、何も書かない', () => {
  const dir = tmp();
  try {
    const w = new Store(dir);
    w.create('note-aaaa', 1);
    w.append('note-aaaa', [[0, '', 'abc', 2]]);
    fs.appendFileSync(path.join(dir, 'note-aaaa.jsonl'), '[3,"","de');        // 書きかけの行(編集中の EverPad が書いている途中)
    const before = fs.readFileSync(path.join(dir, 'note-aaaa.jsonl'), 'utf8');
    const s = new Store(dir);
    s.readOnly = true;
    s.init();
    assert.strictEqual(s.loadForEdit('note-aaaa').ops.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'note-aaaa.jsonl'), 'utf8'), before);   // 読み取り専用では直さない
    assert.ok(!fs.readdirSync(dir).some(n => n.includes('.corrupt-')));
    s.listMeta();
    s.writeIndex();
    assert.ok(!fs.existsSync(s.indexPath()));                                  // 索引も書かない
    for (const f of [() => s.create('note-bbbb', 1), () => s.append('note-aaaa', [[0, '', 'x', 3]]), () => s.saveText('note-aaaa', 'x'),
      () => s.saveAttachment('note-aaaa', 'a.txt', Buffer.from('a')), () => s.setReadOnly('note-aaaa', true), () => s.prune('note-aaaa', 2, 1, 5),
      () => s.importNote('note-cccc', { head: { v: 1, id: 'x', c: 1 }, ops: [], files: [] }, 5)]) {
      assert.throws(f, e => e.code === 'dirReadOnly');
    }
    assert.throws(() => s.copyAttachment('note-aaaa', 'note-bbbb', '0123456789abcdef'), e => e.code === 'dirReadOnly');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('保存: この起動で書いたメモを覚える(手放すときに印へ書く)', () => {
  const dir = tmp();
  try {
    const s = new Store(dir);
    s.create('note-aaaa', 1);
    s.append('note-aaaa', [[0, '', 'abc', 2]]);
    s.create('note-bbbb', 1);
    s.forget('note-bbbb');
    const size = fs.statSync(path.join(dir, 'note-aaaa.jsonl')).size;
    assert.deepStrictEqual(Object.fromEntries(s.touched), { 'note-aaaa': size, 'note-bbbb': null });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main.js: 後から開いたほうは読み取り専用で開き、引き継ぎ・待たずに引き継ぐ・手放すを行う', () => {
  const m = read('main.js');
  assert.ok(!/lockBusy|lockChoose|checkLock|touchLock/.test(m), '古い「別の保存先を選ぶ」の窓は使わない');
  assert.match(m, /if \(!datalock\.lockFree\(lock, now, me\)\) ro = \{ mode: 'ro', reason: 'busy', by: byOf\(datalock\.holderOf\(lock\)\)/);
  assert.match(m, /datalock\.filesPending\(wanted, lock\.v\.files\) > 0/);
  assert.match(m, /if \(ro\) s\.readOnly = true;/);
  assert.ok(!/!!lock\.v\.released \|\|/.test(m), '手放された印を、いつも「空いている」とはみなさない(引き継いだばかりの印は lockFree が見る)');
  // 編集中: ほかが印を書いたら読み取り専用。依頼が来たら帯に出し(返事を待っていることを印に書く)、渡すか断るかを選んでもらう
  assert.match(m, /demote\('taken', byOf\(lock\.v\)\)/);
  assert.ok(!/demote\('handed', byOf\(req\), req\.sid\)/.test(m), '頼まれただけでは渡さない');
  assert.match(m, /lockExtra = \{ asked: rid \};\n {8}acquireLock\(\);\n {8}setDirSt\(\{ mode: 'edit', ask: Object\.assign\(byOf\(ask\), \{ rid: rid \}\) \}\);\n {8}attention\(\);/);
  assert.match(m, /datalock\.writeLock\(store\.dir, Object\.assign\(lockInfo\(\), lockExtra\), now\)/);
  assert.match(m, /if \(name === 'allow'\) \{[\s\S]*?await demote\('handed', byOf\(req\), req\);[\s\S]*?\} else if \(name === 'deny'\) \{\n {6}lockExtra = \{ denied: dirSt\.ask\.rid \};/);
  assert.match(m, /await prepareRenderer\(\);[\s\S]*?datalock\.releaseLock\(store\.dir, me, Date\.now\(\), touchedFiles\(\), req\)[\s\S]*?store\.readOnly = true;/);
  // 頼んだ側: 断られたら依頼を消してそう出す。返事を待っていることが分かれば、待たずに引き継げるまで長めに待つ
  assert.match(m, /lock\.v\.denied === myReq\.rid\) \{\n {6}datalock\.clearRequest\(dir, me\.sid\);\n {6}myReq = null;\n {6}setDirSt\(\{ mode: 'ro', reason: dirSt\.reason, by: byOf\(holder\), free: false, denied: true \}\);/);
  assert.match(m, /const seen = !free && !!myReq && !!lock && lock\.v\.asked === myReq\.rid;/);
  assert.match(m, /if \(myReq && now - myReq\.wrote >= datalock\.BEAT_MS\) \{ try \{ datalock\.writeRequest\(dir, lockInfo\(\), now, myReq\.rid\);/);
  // 待っている: 手放されてファイルが揃ったら編集を始める。20秒(返事待ちなら2分)たったら待たずに引き継げる(確かめてから)
  assert.match(m, /if \(left === 0\) \{ promote\(\); return; \}/);
  assert.match(m, /canForce: now - dirSt\.since >= \(seen \? FORCE_SEEN_MS : FORCE_AFTER_MS\)/);
  assert.match(m, /buttons: \[T\('dirForceButton'\), T\('cancel'\)\], message: T\('dirForceQ'\)/);
  // 終わるとき: 編集していたら手放す(書いたメモの大きさを残す)。読み取り専用なら自分の依頼だけ消す
  assert.match(m, /if \(dirSt\.mode === 'edit'\) datalock\.releaseLock\(store\.dir, me, Date\.now\(\), touchedFiles\(\)\); else datalock\.clearRequest\(store\.dir, me\.sid\);/);
  // 書き込みの結果を画面に返す。読み込みは、画面に渡した内容を覚える loadForEdit
  assert.match(m, /catch \(err\) \{ return writeResult\(err\); \}/);
  assert.match(m, /catch \(err\) \{ e\.returnValue = writeResult\(err\); \}/);
  assert.match(m, /return store\.loadForEdit\(id\);/);
  for (const h of ['memo:remove', 'attach:trash', 'history:prune']) {
    const i = m.indexOf("ipcMain.handle('" + h + "'");
    assert.ok(i > 0 && /store\.readOnly \|\|/.test(m.slice(i, i + 300)), h + ' は読み取り専用の保存先では行わない');
  }
  assert.match(m, /if \(store\.readOnly\) \{ items\.push\(\{ name: path\.basename\(file\), ok: false, message: T\('dirRoBlocked'\) \}\); continue; \}/);
});

test('画面: 読み取り専用の帯、食い違ったメモを別のメモに残す、保存先から読み直す', () => {
  const a = read('renderer/app.js'), html = read('renderer/index.html'), pre = read('preload.js');
  assert.match(a, /const isRO = n => !!\(n && \(n\.ro \|\| S\.dirRO\)\);/);
  assert.match(a, /if \(ok === 'changed' \|\| ok === 'gone'\) \{ await keepConflict\(id, ok\); continue; \}/);
  assert.match(a, /if \(ok !== 'readonly'\) \{ clearTimeout\(flushTimer\); flushTimer = setTimeout\(flush, 3000\); \}/);
  assert.match(a, /if \(ok === true\) pendingOps\.delete\(id\); else saveError = true;/);
  assert.match(a, /async function createNote\(\) \{\n {4}if \(S\.dirRO\) \{ roBlocked\(\); return; \}/);
  assert.match(a, /if \(!n \|\| roBusy\) return;\n {4}if \(S\.dirRO\) \{ roBlocked\(\); return; \}/);
  // 食い違い: 新しいメモに本文を入れて開き、元のメモは保存先から読み直す
  assert.match(a, /const m = keep \? await makeNote\(\) : null;[\s\S]*?pendingOps\.delete\(id\);[\s\S]*?if \(wasActive && m\) \{ \+\+selTok; show\(m\.id\); \}[\s\S]*?if \(r\) fillNote\(n, r\); else unload\(n\);/);
  // 編集を始めるときは、先に読み直す
  assert.match(a, /if \(st\.reload && S\.booted\) await refreshFromDisk\(\);\n {6}S\.dirRO = false;/);
  // 読み取り専用になる前に、書き出してから知らせる
  assert.match(a, /api\.onDirPrepare\(async \(\) => \{[\s\S]*?S\.dirRO = true;[\s\S]*?await flush\(\);[\s\S]*?finally \{ api\.dirPrepared\(\); \}/);
  assert.match(a, /S\.dirRO = st\.mode === 'ro';/);
  for (const id of ['dirBar', 'dirText', 'dirReload', 'dirCancel', 'dirForce', 'dirTake', 'dirAllow', 'dirDeny']) assert.ok(html.includes('id="' + id + '"'), id);
  // 頼まれた側: 編集中でも帯を出して、渡すか断るかを選ぶ
  assert.match(a, /const ask = st\.mode === 'edit' && st\.ask \? st\.ask : null;\n {4}\$\('dirAllow'\)\.hidden = \$\('dirDeny'\)\.hidden = !ask;\n {4}if \(st\.mode !== 'ro' && !ask\) \{ bar\.hidden = true; return; \}/);
  assert.match(a, /api\.dirAction\('allow'\)/);
  assert.match(a, /api\.dirAction\('deny'\)/);
  assert.match(a, /else if \(st\.denied\) \{ msg = T\('dirDenied', \{ who: who \}\); take = T\('dirTake'\); \}/);
  for (const k of ['dirState', 'dirAction', 'onDirState', 'onDirPrepare', 'dirPrepared', 'changedNotes']) assert.ok(pre.includes(k + ':'), k);
});
