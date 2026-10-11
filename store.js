'use strict';
/*
 * ファイル保存層(Electronに依存しないので、Node.jsだけでテストできる)
 *
 * 1つのメモ = 保存先フォルダの中の2つのファイル
 *   <id>.jsonl  編集履歴の本体。1行目がヘッダー、2行目以降は1回の編集 [位置, 消した文字列, 入れた文字列, 時刻(ms)]。
 *               追記だけで更新するので、書き込み中にアプリが落ちても過去の履歴は壊れない。
 *   <id>.md     最新の本文。他のアプリから読むための控えで、読み込みには使わない。
 *   <id>.files/ 貼り付けた画像・添付ファイル。<ハッシュ16桁><拡張子> という名前で、同じ内容は1つだけ保存する。
 *               本文から消しても履歴に残っているので、アプリは添付ファイルを削除しない(メモごと削除するときだけフォルダごとごみ箱へ)。
 */
const fs = require('fs');
const crypto = require('crypto');
const core = require('./renderer/core');
const path = require('path');

const INDEX_NAME = '.everpad-index.json';
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
    if (!validId(id)) throw new Error('メモIDが正しくありません');
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
    if (!Array.isArray(ops) || !ops.every(validOp)) throw new Error('編集データが正しくありません');
    if (!ops.length) return true;
    if (!fs.existsSync(f)) throw new Error('メモのファイルが見つかりません');
    fs.appendFileSync(f, ops.map(o => JSON.stringify(o)).join('\n') + '\n');
    const e = this._entry(id), st = e && this._stat(id);
    if (e && st) { e.n += ops.length; e.t = ops[ops.length - 1][3]; e.size = st.size; e.mtime = st.mtime; this._dirty(); }
    return true;
  }

  saveText(id, text) {
    if (typeof text !== 'string') throw new Error('本文が正しくありません');
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
    if (!fs.existsSync(this.file(id, '.jsonl'))) throw new Error('メモのファイルが見つかりません');
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (buf.length > MAX_ATTACH) throw new Error('ファイルが大きすぎます(上限 ' + (MAX_ATTACH / 1024 / 1024) + 'MB)');
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
    return { id: id, c: r.head.c, ops: r.ops };
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
        if (j && j.v === 1 && j.notes && typeof j.notes === 'object') this._idx = j.notes;
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
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, notes: this._idx }));
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
        e = idx[id] = { c: note.c, t: note.ops.length ? note.ops[note.ops.length - 1][3] : note.c, n: note.ops.length, title: core.titleOf(text), size: st.size, mtime: st.mtime };
        this._dirty();
      }
      seen.add(id);
      out.push({ id: id, c: e.c, t: e.t, n: e.n, title: e.title });
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

module.exports = { Store, validId, validFileId, MAX_ATTACH, validOp, parseLog, applyWire };
