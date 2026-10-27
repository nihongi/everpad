'use strict';
/*
 * ファイル保存層(Electronに依存しないので、Node.jsだけでテストできる)
 *
 * 1つのメモ = 保存先フォルダの中の2つのファイル
 *   <id>.jsonl  編集履歴の本体。1行目がヘッダー、2行目以降は1回の編集 [位置, 消した文字列, 入れた文字列, 時刻(ms)]。
 *               追記だけで更新するので、書き込み中にアプリが落ちても過去の履歴は壊れない。
 *               古い履歴を削除したメモは、ヘッダーに base(削除した版の数)と pruned(削除した日時)を持ち、
 *               最初の編集が「残した最も古い版の本文を位置0に入れる」になる。版の番号は base + 編集の個数で、削除しても変わらない。
 *               古い EverPad は base を知らないので読み飛ばし、版数が少なく見えるだけで、そのまま読み書きできる。
 *   <id>.md     最新の本文。他のアプリから読むための控えで、読み込みには使わない。
 *   <id>.files/ 貼り付けた画像・添付ファイル。<ハッシュ16桁><拡張子> という名前で、同じ内容は1つだけ保存する。
 *               本文から消しても履歴に残っているので、ふだんは削除しない。ごみ箱に入れるのは、メモごと削除するとき、
 *               編集画面で添付を「ごみ箱に入れる」を選んだとき、古い履歴を削除して、残る版のどこにも出てこなくなったときだけ。
 */
const fs = require('fs');
const crypto = require('crypto');
const core = require('./renderer/core');
/* 画面に出すときは code で訳す(main.js)。message は日本語のまま */
function storeError(code, message) { const e = new Error(message); e.code = code; return e; }
const path = require('path');

const INDEX_NAME = '.everpad-index.json';
const INDEX_VERSION = 3;   // 2: 題名が無いメモの title を '' にした 3: base(削除した版の数)を加え、n を版数(base + 編集の個数)にした
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_ATTACH = 50 * 1024 * 1024;
const FILEID_RE = /^[0-9a-f]{16}(\.[a-z0-9]{1,8})?$/;
const validFileId = f => typeof f === 'string' && FILEID_RE.test(f);
const validId = id => typeof id === 'string' && ID_RE.test(id);
const validOp = o =>
  Array.isArray(o) && o.length === 4 &&
  Number.isInteger(o[0]) && o[0] >= 0 &&
  typeof o[1] === 'string' && typeof o[2] === 'string' &&
  typeof o[3] === 'number' && Number.isFinite(o[3]);

function applyWire(text, o) { return text.slice(0, o[0]) + o[2] + text.slice(o[0] + o[1].length); }
const validBase = b => Number.isInteger(b) && b >= 0;
const baseOf = head => (head && validBase(head.base) ? head.base : 0);

/* 古い履歴を削除した後の編集の並び。k = 残す最も古い版(編集の個数で数えた位置)。
   最初の k 個の編集を「版 k の本文を位置0に入れる」1つにまとめる(時刻は版 k のまま) */
function pruneOps(ops, k) {
  let text = '';
  for (let i = 0; i < k; i++) text = applyWire(text, ops[i]);
  return [[0, '', text, ops[k - 1][3]]].concat(ops.slice(k));
}

/* どれかの版の本文に出てくる添付(attach: の後のハッシュ16桁)の集まり。
   新しく現れる参照は必ず編集した位置にかかるので、編集の前後 23文字(attach: とハッシュの長さ)だけを調べる */
const ATT_RE = /attach:([0-9a-f]{16})/g;
function attachHashes(ops) {
  const set = new Set();
  let text = '';
  for (const o of ops) {
    text = applyWire(text, o);
    const lo = Math.max(0, o[0] - 23), hi = Math.min(text.length, o[0] + o[2].length + 23);
    const seg = text.slice(lo, hi);
    ATT_RE.lastIndex = 0;
    let m;
    while ((m = ATT_RE.exec(seg))) set.add(m[1]);
  }
  return set;
}

/* ログ全文を読み、先頭から有効な行だけを取り出す */
function parseLog(raw) {
  const lines = raw.split('\n');
  let head = null;
  const ops = [];
  let bad = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    let v;
    try { v = JSON.parse(line); } catch (e) { bad = true; break; }
    if (!head) {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string' && Number.isFinite(v.c)) head = v;
      else { bad = true; break; }
    } else if (validOp(v)) ops.push(v);
    else { bad = true; break; }
  }
  return { head, ops, bad, endsWithNewline: raw === '' || raw.endsWith('\n') };
}

class Store {
  constructor(dir) { this.dir = dir; }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.accessSync(this.dir, fs.constants.W_OK);
  }

  file(id, ext) {
    if (!validId(id)) throw storeError('badId', 'メモIDが正しくありません');
    return path.join(this.dir, id + ext);
  }

  create(id, c) {
    const f = this.file(id, '.jsonl');
    if (fs.existsSync(f)) return false;
    fs.writeFileSync(f, JSON.stringify({ v: 1, id: id, c: c }) + '\n', { flag: 'wx' });
    if (this._idx) { const st = this._stat(id); if (st) { this._idx[id] = { c: c, t: c, n: 0, title: core.titleOf(''), size: st.size, mtime: st.mtime }; this._dirty(); } }
    return true;
  }

  append(id, ops) {
    const f = this.file(id, '.jsonl');
    if (!Array.isArray(ops) || !ops.every(validOp)) throw storeError('badOps', '編集データが正しくありません');
    if (!ops.length) return true;
    if (!fs.existsSync(f)) throw storeError('noFile', 'メモのファイルが見つかりません');
    fs.appendFileSync(f, ops.map(o => JSON.stringify(o)).join('\n') + '\n');
    const e = this._entry(id), st = e && this._stat(id);
    if (e && st) { e.n += ops.length; e.t = ops[ops.length - 1][3]; e.size = st.size; e.mtime = st.mtime; this._dirty(); }
    return true;
  }

  saveText(id, text) {
    if (typeof text !== 'string') throw storeError('badText', '本文が正しくありません');
    const f = this.file(id, '.md');
    const tmp = f + '.tmp';
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, f);
    } catch (e) {
      // 他のアプリがファイルを開いていて置き換えられない場合は、直接書く
      try { fs.unlinkSync(tmp); } catch (e2) { /* 無視 */ }
      fs.writeFileSync(f, text);
    }
    const e = this._entry(id);
    if (e) { e.title = core.titleOf(text); this._dirty(); }
    return true;
  }

  /* ---- 添付ファイル ---- */
  filesDir(id) { return this.file(id, '.files'); }

  /* 添付を保存して、本文に書くための fileId を返す。同じ内容なら既にあるものを使う */
  saveAttachment(id, name, bytes) {
    if (!fs.existsSync(this.file(id, '.jsonl'))) throw storeError('noFile', 'メモのファイルが見つかりません');
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buf.length > MAX_ATTACH) throw storeError('tooLarge', 'ファイルが大きすぎます(上限 ' + (MAX_ATTACH / 1024 / 1024) + 'MB)');
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(typeof name === 'string' ? name : '');
    const fileId = hash + (m ? '.' + m[1].toLowerCase() : '');
    const dir = this.filesDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, fileId);
    if (!fs.existsSync(f) || fs.statSync(f).size !== buf.length) {
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, f);
    }
    return { fileId: fileId, size: buf.length };
  }

  /* 添付ファイルの場所。IDが正しくない・無いときは null(フォルダの外は決して返さない) */
  attachmentPath(id, fileId) {
    if (!validId(id) || !validFileId(fileId)) return null;
    const f = path.join(this.filesDir(id), fileId);
    return fs.existsSync(f) ? f : null;
  }

  /* ゴミ箱へ送る対象のパス(存在するものだけ。添付ファイルのフォルダも含む) */
  paths(id) {
    return ['.jsonl', '.md', '.files'].map(e => this.file(id, e)).filter(p => fs.existsSync(p));
  }

  /* 1つのメモの全編集を読む(途中で壊れた行があれば取り除いて書き直す)。読めなければ null */
  loadOne(id) {
    if (!validId(id)) return null;
    const f = path.join(this.dir, id + '.jsonl');
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
    const r = parseLog(raw);
    if (!r.head) return null;
    if (r.bad || !r.endsWithNewline) {
      // 途中で切れた行などを取り除いて書き直す。壊れていた場合は元のファイルを残しておく
      try {
        if (r.bad) fs.copyFileSync(f, f + '.corrupt-' + Date.now());
        const fixed = JSON.stringify(r.head) + '\n' + r.ops.map(o => JSON.stringify(o)).join('\n') + (r.ops.length ? '\n' : '');
        const tmp = f + '.tmp';
        fs.writeFileSync(tmp, fixed);
        fs.renameSync(tmp, f);
      } catch (e) { /* 読み込みは続ける */ }
    }
    return { id: id, c: r.head.c, imported: Number.isFinite(r.head.imported) ? r.head.imported : 0, base: baseOf(r.head), pruned: Number.isFinite(r.head.pruned) ? r.head.pruned : 0, ops: r.ops };
  }

  /* ---- 古い履歴の削除 ----
     k = 残す最も古い版(編集の個数で数えた位置、2 以上)、expectN = 画面が持っている編集の個数(食い違えば中止)。
     prunePlan は書き換えずに、削除する版の数と、ごみ箱に入れる添付を返す。prune は書き換えて、同じものを返す
     (添付をごみ箱に入れるのは呼ぶ側)。一時ファイルに書いてから置き換えるので、途中で失敗しても元のファイルは壊れない */
  _prunable(id, k, expectN) {
    const f = this.file(id, '.jsonl');
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { throw storeError('noFile', 'メモのファイルが見つかりません'); }
    const r = parseLog(raw);
    if (!r.head || r.bad) throw storeError('badOps', '履歴が正しくありません');
    if (r.ops.length !== expectN) throw storeError('changed', '履歴が変わっています');
    if (!Number.isInteger(k) || k < 2 || k > r.ops.length) throw storeError('badRev', '版の指定が正しくありません');
    const ops = pruneOps(r.ops, k);
    return { f: f, head: r.head, ops: ops, base: baseOf(r.head), removed: k - 1 };
  }
  _orphans(id, ops) {
    const used = attachHashes(ops), out = [];
    const dir = this.filesDir(id);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return out; }
    for (const name of names) {
      if (!validFileId(name) || used.has(name.slice(0, 16))) continue;
      const p = path.join(dir, name);
      try { const st = fs.statSync(p); if (st.isFile()) out.push({ fileId: name, path: p, size: st.size }); } catch (e) { /* 飛ばす */ }
    }
    return out;
  }
  prunePlan(id, k, expectN) {
    const x = this._prunable(id, k, expectN);
    const orphans = this._orphans(id, x.ops);
    return { base: x.base, removed: x.removed, orphans: orphans, bytes: orphans.reduce((a, o) => a + o.size, 0) };
  }
  prune(id, k, expectN, prunedAt) {
    const x = this._prunable(id, k, expectN);
    const base = x.base + x.removed;
    const head = Object.assign({}, x.head, { base: base, pruned: prunedAt });
    const tmp = x.f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(head) + '\n' + x.ops.map(o => JSON.stringify(o)).join('\n') + '\n');
    fs.renameSync(tmp, x.f);
    const e = this._entry(id), st = e && this._stat(id);
    if (e && st) { e.base = base; e.size = st.size; e.mtime = st.mtime; this._dirty(); }
    return { base: base, removed: x.removed, ops: x.ops, orphans: this._orphans(id, x.ops) };
  }

  /* アーカイブから取り込んだメモを書く(同じ ID のメモがあれば、呼ぶ側が先にごみ箱へ移しておく)。
     見出し行の id を差し替え、取り込んだ日時(imported)を記録する。本文(.md)は履歴から作り直す。
     添付と本文を先に書き、履歴(.jsonl)を最後に書く(途中で失敗しても、中途半端なメモが一覧に出ないように) */
  importNote(id, arc, importedAt) {
    const f = this.file(id, '.jsonl');
    if (fs.existsSync(f)) throw storeError('exists', 'メモが既にあります');
    if (arc.files.length) {
      const dir = this.filesDir(id);
      fs.mkdirSync(dir, { recursive: true });
      for (const x of arc.files) { if (!validFileId(x.fileId)) throw storeError('badId', '添付のファイル名が正しくありません'); fs.writeFileSync(path.join(dir, x.fileId), x.data); }
    }
    let text = '';
    for (const o of arc.ops) text = applyWire(text, o);
    fs.writeFileSync(this.file(id, '.md'), text);
    const head = Object.assign({}, arc.head, { id: id, imported: importedAt });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(head) + '\n' + arc.ops.map(o => JSON.stringify(o)).join('\n') + (arc.ops.length ? '\n' : ''));
    fs.renameSync(tmp, f);
    this.forget(id);
    return true;
  }

  loadAll() {
    const notes = [];
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (e) { return notes; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const n = this.loadOne(name.slice(0, -'.jsonl'.length));
      if (n) notes.push(n);
    }
    notes.sort((a, b) => a.c - b.c);
    return notes;
  }

  /* ---- メモの一覧用の情報(題名・最終更新・版数) ----
     起動のたびに全メモの履歴を読み直さないよう、保存先に索引(.everpad-index.json)を置く。
     索引は「控え」で、ファイルの大きさと更新時刻が合うメモだけに使い、合わないものはそのメモだけ読み直す。
     索引が無くなっても壊れても、読み直すだけで元に戻る。 */
  indexPath() { return path.join(this.dir, INDEX_NAME); }
  _index() {
    if (!this._idx) {
      this._idx = {};
      try {
        const j = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8'));
        if (j && j.v === INDEX_VERSION && j.notes && typeof j.notes === 'object') this._idx = j.notes;
      } catch (e) { /* 無い・壊れているときは作り直す */ }
    }
    return this._idx;
  }
  writeIndex() {
    clearTimeout(this._idxTimer); this._idxTimer = null;
    if (!this._idx || !this._idxDirty) return;
    this._idxDirty = false;
    try {
      const tmp = this.indexPath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: INDEX_VERSION, notes: this._idx }));
      fs.renameSync(tmp, this.indexPath());
    } catch (e) { /* 索引は控えなので、書けなくても動く */ }
  }
  _dirty() {
    this._idxDirty = true;
    if (!this._idxTimer) { this._idxTimer = setTimeout(() => this.writeIndex(), 2000); if (this._idxTimer.unref) this._idxTimer.unref(); }
  }
  _entry(id) { const idx = this._idx; return idx && idx[id] ? idx[id] : null; }
  _stat(id) { try { const st = fs.statSync(path.join(this.dir, id + '.jsonl')); return { size: st.size, mtime: st.mtimeMs }; } catch (e) { return null; } }

  listMeta() {
    const idx = this._index();
    this.scans = 0;
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch (e) { return []; }
    const out = [], seen = new Set();
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (!validId(id)) continue;
      let st = this._stat(id);
      if (!st) continue;
      let e = idx[id];
      if (!e || e.size !== st.size || e.mtime !== st.mtime) {
        const note = this.loadOne(id);          // この1つだけ読み直す
        if (!note) continue;
        this.scans++;
        let text = '';
        for (const o of note.ops) text = applyWire(text, o);
        st = this._stat(id) || st;               // 壊れた行を直した場合は、直した後のファイルで記録する
        // 並びの時刻は、最後に編集した時刻と取り込んだ時刻の新しいほう(取り込んだメモを一覧の上に出す)
        e = idx[id] = { c: note.c, t: Math.max(note.ops.length ? note.ops[note.ops.length - 1][3] : note.c, note.imported || 0), imported: note.imported || 0, base: note.base, n: note.base + note.ops.length, title: core.titleOf(text), size: st.size, mtime: st.mtime };
        this._dirty();
      }
      seen.add(id);
      out.push({ id: id, c: e.c, t: e.t, imported: e.imported || 0, base: e.base || 0, n: e.n, title: e.title });
    }
    for (const id of Object.keys(idx)) if (!seen.has(id)) { delete idx[id]; this._dirty(); }
    out.sort((a, b) => a.c - b.c);
    return out;
  }

  /* 最新の本文。.md が履歴(.jsonl)より新しければそれを使い、そうでなければ履歴から組み立てる */
  readLatest(id) {
    if (!validId(id)) return null;
    try {
      const j = fs.statSync(path.join(this.dir, id + '.jsonl')).mtimeMs;
      const m = fs.statSync(path.join(this.dir, id + '.md')).mtimeMs;
      if (m >= j) return fs.readFileSync(path.join(this.dir, id + '.md'), 'utf8');
    } catch (e) { /* 履歴から組み立てる */ }
    const n = this.loadOne(id);
    if (!n) return null;
    let text = '';
    for (const o of n.ops) text = applyWire(text, o);
    return text;
  }

  /* ファイルを消した後に呼ぶ */
  forget(id) { const idx = this._index(); if (idx[id]) { delete idx[id]; this._dirty(); } }
}

module.exports = { Store, validId, validFileId, MAX_ATTACH, validOp, parseLog, applyWire, pruneOps, attachHashes };
