'use strict';
/*
 * 開発中の EverPad を、試験用のフォルダの設定と保存先で起動して、スクリプトから操作する(画面の動きを確かめる開発用の道具。アプリには入らない)。
 *
 *   const devdrive = require('<リポジトリ>/tools/devdrive.js');
 *   const app = await devdrive.start({
 *     dir: '<一時フォルダの中の、試験用のフォルダ>',   // この下に data(保存先)・settings(設定)・shots(画面)・log.txt を作る。毎回空にする
 *     notes: [{ id: '20261120-090000-a1', text: '# メモ' },                    // 本文だけ(1回の編集で書いたことにする)
 *             { id: '20261120-090001-b2', ops: [[0, '', 'あ', t], ...], head: { imported: Date.now() } }],   // 履歴を並べる
 *     attach: { '20261120-090000-a1': ['C:/…/画像.png'] },   // 添付(本文に書く名前は devdrive.fileId(パス))
 *     config: { editor: { scrollPast: false } },             // config.json に足す設定
 *     appDir: '<起動するアプリのフォルダ>',                   // 省略ならこのリポジトリ(展開した asar などの別の版も試せる)
 *     reuse: true,                                           // 前回の試験用のフォルダをそのまま使う(閉じて起動し直す確かめ)
 *   });
 *   const n = await app.page(sel => document.querySelectorAll(sel).length, '#noteList .note');   // 画面で関数を実行して、値を受け取る
 *   await app.main((req, label) => req('electron').Menu.getApplicationMenu().items[0].label, 'x'); // メインのプロセスで実行する
 *   app.check('メモが2つ', n === 2, n);
 *   await app.done();   // 結果を出して、アプリを閉じ、失敗があれば終了コード 1
 *
 *   // または、途中でエラーになってもアプリを閉じる形:
 *   await devdrive.run({ dir, notes }, async app => { … app.check(…) … });
 *
 * 関数は文字列にして送るので、外の変数は使えない(使う値は引数で渡す。引数と戻り値は JSON にできるもの)。
 * 画面の関数の中では $(id) で document.getElementById(id) を使える。コードを文字列で組み立てないので、引用符やバックスラッシュの
 * エスケープを気にしなくてよい。
 * 安全のため、dir は一時フォルダ(os.tmpdir())の中に限る。起動したら、画面の保存先が dir/data であることを確かめてから返す
 * (本物の保存先や設定を決して使わない)。
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 添付の名前(本文に attach:<名前> と書く)。EverPad と同じく、中身の SHA-256 の先頭16桁と拡張子 */
function fileId(file) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(file);
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16) + (m ? '.' + m[1].toLowerCase() : '');
}

function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* 試験用のフォルダに、設定(settings/config.json)と保存先(data)と見本のメモを作る */
function prepare(opts) {
  const dir = path.resolve(opts.dir);
  if (!inside(dir, os.tmpdir())) throw new Error('devdrive: dir must be inside the temp folder: ' + dir);
  const data = path.join(dir, 'data'), settings = path.join(dir, 'settings'), shots = path.join(dir, 'shots');
  // reuse: 前に作った試験用のフォルダを、そのまま使う(アプリを閉じて起動し直したときの確かめ。設定と localStorage も残る)
  if (opts.reuse && fs.existsSync(path.join(settings, 'config.json'))) return { dir, data, settings, shots };
  for (const d of [data, settings, shots]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  const config = Object.assign({ dataDir: data, dataDirs: [data], lang: 'ja', update: { checkOnStart: false },
    window: { x: 120, y: 60, width: 1100, height: 760, maximized: false } }, opts.config || {});
  config.dataDir = data;   // 保存先は必ず試験用のフォルダ
  if (!config.dataDirs || !config.dataDirs.every(d => inside(d, dir) || path.resolve(d) === data)) config.dataDirs = [data];
  fs.writeFileSync(path.join(settings, 'config.json'), JSON.stringify(config, null, 2));
  const { wireText } = require(path.join(REPO, 'store.js'));
  (opts.notes || []).forEach((n, k) => {
    const c = n.c || Date.UTC(2026, 0, 1) + k * 60000;
    const ops = n.ops || [[0, '', n.text || '', c + 1000]];
    const head = Object.assign({ v: 1, id: n.id, c: c }, n.head || {});
    fs.writeFileSync(path.join(data, n.id + '.jsonl'), [JSON.stringify(head)].concat(ops.map(o => JSON.stringify(o))).join('\n') + '\n');
    fs.writeFileSync(path.join(data, n.id + '.md'), wireText(ops));
  });
  for (const [id, list] of Object.entries(opts.attach || {})) {
    const fdir = path.join(data, id + '.files');
    fs.mkdirSync(fdir, { recursive: true });
    for (const f of list) fs.copyFileSync(f, path.join(fdir, fileId(f)));
  }
  return { dir, data, settings, shots };
}

async function start(opts) {
  const where = prepare(opts);
  const port = opts.port || 9300 + Math.floor(Math.random() * 600);
  const exe = require(path.join(REPO, 'node_modules', 'electron'));
  const log = fs.openSync(path.join(where.dir, 'log.txt'), 'w');
  const child = spawn(exe, ['--inspect=' + port, '.', '--user-data-dir=' + where.settings], { cwd: opts.appDir || REPO, stdio: ['ignore', log, log] });
  let exited = false;
  child.on('exit', () => { exited = true; });

  // メインのプロセスにつなぐ(Chrome DevTools Protocol)
  let list = null;
  for (let i = 0; i < 300 && !exited; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (list.length) break; } catch (e) { /* 起動待ち */ }
    await sleep(100);
  }
  if (!list || !list.length) { child.kill(); throw new Error('devdrive: could not connect to the app (see ' + path.join(where.dir, 'log.txt') + ')'); }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let seq = 0;
  const waiters = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++seq;
    waiters.set(id, m => {
      const r = m.result || {};
      if (m.error) reject(new Error(m.error.message));
      else if (r.exceptionDetails) reject(new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      else resolve(r.result ? r.result.value : undefined);
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  const REQ = '(process.mainModule ? process.mainModule.require : require)';
  const WIN = REQ + "('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))";

  /* メインのプロセスで fn(require, ...args) を実行して、値を返す */
  const main = (fn, ...args) => evaluate('(' + fn.toString() + ')(' + REQ + ', ...' + JSON.stringify(args) + ')');
  /* 画面で fn(...args) を実行して、値を返す($ は document.getElementById) */
  const page = (fn, ...args) => {
    const code = '(() => { const $ = id => document.getElementById(id); return (' + fn.toString() + ')(...' + JSON.stringify(args) + '); })()';
    return evaluate('(async () => { const w = ' + WIN + '; if (!w) throw new Error("devdrive: no window"); return w.webContents.executeJavaScript(' + JSON.stringify(code) + '); })()');
  };
  /* 画面で fn(...args) が真になるまで待つ(真になった値を返す。時間切れなら null) */
  const wait = async (fn, args, ms) => {
    const end = Date.now() + (ms || 10000);
    while (Date.now() < end) {
      try { const v = await page(fn, ...(args || [])); if (v) return v; } catch (e) { /* 読み込み中 */ }
      await sleep(100);
    }
    return null;
  };

  // 窓ができて、保存先が試験用のフォルダだと確かめる
  for (let i = 0; i < 300; i++) { if (await evaluate(WIN + ' ? 1 : 0').catch(() => 0)) break; await sleep(100); }
  const shown = await wait(() => { const d = $('dirPath'); return d && d.textContent; }, [], 30000);
  if (shown !== where.data) {
    try { await main(req => { req('electron').app.quit(); return 1; }); } catch (e) { /* 閉じる */ }
    throw new Error('devdrive: ABORT, the app is not using the scratch data folder: ' + shown);
  }
  // 起動の終わり(開いたメモを選び、表示を整える)まで待つ。待たずに操作すると、起動の続きで表示が元に戻ることがある
  await wait(() => !!document.querySelector('#noteList .note[aria-current=true]'), [], 15000);
  await sleep(800);

  let fails = 0, checks = 0;
  const app = {
    port, child, ...where,
    main, page, wait, sleep,
    /* 入力(窓の中の座標は CSS ピクセル。拡大率をかけて送る) */
    key: async (keyCode, modifiers) => { await main((req, k, mods) => { const w = req('electron').BrowserWindow.getAllWindows()[0]; w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); return 1; }, keyCode, modifiers || []); await sleep(150); },
    click: async (x, y) => { await main((req, x0, y0) => { const w = req('electron').BrowserWindow.getAllWindows()[0], z = w.webContents.getZoomFactor(); const p = { x: Math.round(x0 * z), y: Math.round(y0 * z), button: 'left', clickCount: 1 }; w.webContents.sendInputEvent(Object.assign({ type: 'mouseDown' }, p)); w.webContents.sendInputEvent(Object.assign({ type: 'mouseUp' }, p)); return 1; }, x, y); await sleep(300); },
    /* 画面を dir/shots/<name>.png に保存して、そのパスを返す */
    shot: async name => { const f = path.join(where.shots, name + '.png'); await main(async (req, file) => { const w = req('electron').BrowserWindow.getAllWindows()[0]; req('fs').writeFileSync(file, (await w.webContents.capturePage()).toPNG()); return 1; }, f); return f; },
    /* 結果を1行出す */
    check: (name, ok, value) => { checks++; if (!ok) fails++; console.log((ok ? 'OK   ' : 'FAIL ') + name + (value !== undefined ? ' -> ' + JSON.stringify(value).slice(0, 400) : '')); return !!ok; },
    /* アプリを閉じる(終わるまで待つ。閉じなければ、起動したプロセスだけを止める) */
    close: async () => {
      try { await main(req => { req('electron').app.quit(); return 1; }); } catch (e) { /* もう閉じている */ }
      try { ws.close(); } catch (e) { /* 無視 */ }
      for (let i = 0; i < 100 && !exited; i++) await sleep(100);
      if (!exited) child.kill();
    },
    /* まとめを出して閉じ、失敗があれば終了コード 1 にする */
    done: async () => {
      console.log(fails ? fails + ' of ' + checks + ' FAILED' : 'ALL OK (' + checks + ')');
      await app.close();
      process.exitCode = fails ? 1 : 0;
      return fails;
    },
  };
  return app;
}

/* start して fn(app) を実行し、終わったら(途中でエラーになっても)まとめを出してアプリを閉じる。
   エラーは失敗の1つとして数える。devdrive.run({ dir, notes }, async app => { … }) */
async function run(opts, fn) {
  const app = await start(opts);
  try { await fn(app); } catch (e) { app.check('script error: ' + ((e && e.message) || e), false); }
  finally { await app.done(); }
  return app;
}

module.exports = { start, run, prepare, fileId };
