#!/usr/bin/env node
'use strict';
/* Etherpad(MySQLのダンプ)を EverPad の保存形式に変換する。
   使い方:  node tools/import-etherpad.js <ダンプファイル> <出力フォルダ>
   - パッドごとに <ID>.jsonl(全履歴)と <ID>.md(最新の本文)を作る。出力フォルダを EverPad の保存先に置けば読める。
   - 各メモの1行目に、パッド名を普通の文字で足す(--no-title-line で足さない。--as-is=パッド名 で、そのパッドだけ足さない)。
   - Etherpad の「変更」を1版ずつ再生して本文を作り直す。装飾はMarkdownにする:
       見出し→# 、箇条書き→- 、番号付き→1. 、太字→**、斜体→*、取り消し線→~~、表(ep_tables2のJSON行)→Markdownの表
   - 下線・色などMarkdownで表せないもの、作者、チャット、保存した版(しおり)は取り込まない。 */
const fs = require('fs');
const path = require('path');
const core = require('../renderer/core');

/* ---------- MySQLダンプ(store テーブルの INSERT)を読む ---------- */
const UNESC = { '0': '\0', n: '\n', r: '\r', t: '\t', Z: '\x1a', b: '\b' };
function* parseDump(sql) {
  const re = /INSERT INTO `store` VALUES /g;
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length;
    const n = sql.length;
    while (i < n) {
      const c = sql[i];
      if (c === ';') break;
      if (c === ',' || c === ' ' || c === '\n') { i++; continue; }
      if (c !== '(') throw new Error('ダンプの形式が想定と違います(位置 ' + i + ')');
      i++;
      const vals = [];
      for (;;) {
        if (sql[i] === "'") {
          i++;
          let out = '', start = i;
          for (;;) {
            const ch = sql[i];
            if (ch === '\\') { out += sql.slice(start, i); const e = sql[i + 1]; out += e in UNESC ? UNESC[e] : e; i += 2; start = i; }
            else if (ch === "'") {
              if (sql[i + 1] === "'") { out += sql.slice(start, i) + "'"; i += 2; start = i; }
              else { out += sql.slice(start, i); i++; break; }
            } else i++;
          }
          vals.push(out);
        } else {
          let j = i;
          while (sql[j] !== ',' && sql[j] !== ')') j++;
          vals.push(sql.slice(i, j)); i = j;
        }
        if (sql[i] === ',') { i++; continue; }
        if (sql[i] === ')') { i++; break; }
        throw new Error('ダンプの形式が想定と違います(位置 ' + i + ')');
      }
      yield vals;
    }
  }
}

/* ---------- Etherpad の変更(changeset)を本文に当てる ----------
   文書は { text, attrs }。attrs は1文字ごとの属性(「キー\u0002値」を\u0001でつないだ文字列、無ければ空)。 */
const A_SEP = '\u0001', KV_SEP = '\u0002';
const decodeCache = new Map();
function decodeAttr(s) {
  let r = decodeCache.get(s);
  if (!r) { r = new Map(); if (s) for (const kv of s.split(A_SEP)) { const k = kv.indexOf(KV_SEP); r.set(kv.slice(0, k), kv.slice(k + 1)); } decodeCache.set(s, r); }
  return r;
}
const encodeAttr = map => [...map].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + KV_SEP + v).join(A_SEP);
const mergeCache = new Map();
function mergeAttr(base, pairs) {   // '=' の属性変更: 値が空なら外す
  const key = base + '\u0003' + pairs.map(p => p[0] + KV_SEP + p[1]).join(A_SEP);
  let r = mergeCache.get(key);
  if (r === undefined) {
    const m = new Map(decodeAttr(base));
    for (const [k, v] of pairs) { if (v === '') m.delete(k); else m.set(k, v); }
    r = encodeAttr(m); mergeCache.set(key, r);
  }
  return r;
}
const setAttr = pairs => encodeAttr(new Map(pairs.filter(p => p[1] !== '')));

const HEAD = /^Z:([0-9a-z]+)([><])([0-9a-z]+)/;
const OPS = /((?:\*[0-9a-z]+)*)(?:\|([0-9a-z]+))?([-+=])([0-9a-z]+)/g;
function applyChangeset(doc, cs, numToAttrib) {
  const h = HEAD.exec(cs);
  if (!h) throw new Error('変更の形式が正しくありません: ' + cs.slice(0, 40));
  const oldLen = parseInt(h[1], 36), newLen = oldLen + (h[2] === '>' ? 1 : -1) * parseInt(h[3], 36);
  if (oldLen !== doc.text.length) throw new Error('変更の元の長さが合いません(' + oldLen + ' と ' + doc.text.length + ')');
  const dollar = cs.indexOf('$', h[0].length);
  const opsStr = cs.slice(h[0].length, dollar), bank = cs.slice(dollar + 1);
  const pairsOf = s => (s.match(/\*[0-9a-z]+/g) || []).map(x => { const a = numToAttrib[parseInt(x.slice(1), 36)]; return a ? [a[0], a[1]] : null; }).filter(Boolean);
  const texts = [], attrs = [];
  let pos = 0, bpos = 0;
  OPS.lastIndex = 0;
  let m;
  while ((m = OPS.exec(opsStr))) {
    const len = parseInt(m[4], 36), pairs = m[1] ? pairsOf(m[1]) : [];
    if (m[3] === '+') {
      texts.push(bank.slice(bpos, bpos + len)); bpos += len;
      const a = setAttr(pairs);
      for (let k = 0; k < len; k++) attrs.push(a);
    } else if (m[3] === '-') {
      pos += len;
    } else {
      texts.push(doc.text.slice(pos, pos + len));
      if (pairs.length) for (let k = 0; k < len; k++) attrs.push(mergeAttr(doc.attrs[pos + k], pairs));
      else for (let k = 0; k < len; k++) attrs.push(doc.attrs[pos + k]);
      pos += len;
    }
  }
  texts.push(doc.text.slice(pos));                       // 末尾まで変えない部分は省略されている
  for (let k = pos; k < doc.text.length; k++) attrs.push(doc.attrs[k]);
  const text = texts.join('');
  if (text.length !== newLen) throw new Error('変更のあとの長さが合いません(' + newLen + ' と ' + text.length + ')');
  return { text, attrs };
}
const emptyDoc = () => ({ text: '\n', attrs: [''] });

/* ---------- 本文と装飾 → Markdown ---------- */
const styleCache = new Map();
function styleOf(s) {
  let r = styleCache.get(s);
  if (!r) {
    const m = decodeAttr(s), on = k => m.has(k) && m.get(k) !== '' && m.get(k) !== 'false';
    r = { b: on('bold'), i: on('italic'), s: on('strikethrough'), mk: on('lmkr'), list: m.get('list') || '', heading: m.get('heading') || '', start: m.get('start') || '' };
    styleCache.set(s, r);
  }
  return r;
}
function wrapRun(text, st) {
  if (!text || !(st.b || st.i || st.s)) return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m[2]) return text;
  let core_ = m[2];
  if (st.s) core_ = '~~' + core_ + '~~';
  if (st.i) core_ = '*' + core_ + '*';
  if (st.b) core_ = '**' + core_ + '**';
  return m[1] + core_ + m[3];
}
function inlineMd(text, attrs, from, to) {
  let out = '', i = from;
  while (i < to) {
    const st = styleOf(attrs[i]);
    let j = i + 1;
    while (j < to) { const s2 = styleOf(attrs[j]); if (s2.b !== st.b || s2.i !== st.i || s2.s !== st.s) break; j++; }
    out += wrapRun(text.slice(i, j), st);
    i = j;
  }
  return out;
}
function tableRow(line) {
  if (!line.startsWith('{"payload"')) return null;
  try { const j = JSON.parse(line); if (Array.isArray(j.payload) && Array.isArray(j.payload[0])) return { id: String(j.tblId), cells: j.payload[0].map(c => String(c).replace(/\s*[\r\n]+\s*/g, ' ').trim()) }; } catch (e) { /* 編集の途中などで壊れた行はそのまま残す */ }
  return null;
}
function emitTable(rows, out) {
  rows = rows.filter(r => r.cells.some(c => c));          // 空白だけの行はプラグインの作業用の行
  if (!rows.length) return;
  const w = Math.max(...rows.map(r => r.cells.length));
  const fmt = r => '| ' + Array.from({ length: w }, (_, k) => (r.cells[k] || '').replace(/\|/g, '\\|')).join(' | ') + ' |';
  if (out.length && out[out.length - 1] !== '') out.push('');
  out.push(fmt(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |');
  for (let k = 1; k < rows.length; k++) out.push(fmt(rows[k]));
  out.push('');
}
function render(doc) {
  const { text, attrs } = doc;
  const out = [];
  let pos = 0, tbl = null;
  const flush = () => { if (tbl) { emitTable(tbl.rows, out); tbl = null; } };
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    let bodyFrom = pos, ln = null;
    if (text[pos] === '*' && end > pos) { const st = styleOf(attrs[pos]); if (st.mk || st.list || st.heading) { ln = st; bodyFrom = pos + 1; } }
    const plain = text.slice(bodyFrom, end);
    const tr = tableRow(plain);
    if (tr) {
      if (!tbl || tbl.id !== tr.id) { flush(); tbl = { id: tr.id, rows: [] }; }
      tbl.rows.push(tr);
    } else {
      flush();
      let body = inlineMd(text, attrs, bodyFrom, end), prefix = '';
      const heading = (ln && ln.heading) || (bodyFrom < end ? styleOf(attrs[bodyFrom]).heading : '');
      const list = ln ? ln.list : '';
      const lm = /^([a-z]+)(\d+)$/.exec(list);
      if (lm) {
        const lvl = +lm[2];
        if (lm[1] === 'number') prefix = '  '.repeat(lvl - 1) + (ln.start || '1') + '. ';
        else prefix = '  '.repeat(lvl - 1) + '- ';        // 箇条書き・インデントは - の入れ子にする
      }
      const hm = /^h([1-6])$/.exec(heading);
      if (hm) prefix = '#'.repeat(+hm[1]) + ' ';
      else if (heading === 'code' && body) body = '`' + body.replace(/`/g, "'") + '`';
      out.push(prefix + body);
    }
    pos = end + 1;
  }
  flush();
  if (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/* ---------- 1つのパッド ---------- */
function convertPad(pad, revs, titleLine) {
  // pad: { head, pool:{numToAttrib}, atext:{text} } / revs: 版番号順の [{ cs, ts }]
  const num = pad.pool.numToAttrib;
  let doc = emptyDoc(), prev = '', lastT = 0;
  const ops = [];
  let skippedWelcome = false;
  for (let k = 0; k < revs.length; k++) {
    doc = applyChangeset(doc, revs[k].cs, num);
    if (k === 0 && doc.text.startsWith('Welcome to Etherpad!') && revs.length > 1) { skippedWelcome = true; continue; }  // 新規パッドの見本の文章
    const body = render(doc);
    const md = titleLine && body.trim() ? titleLine + '\n' + body : body;   // パッド名を、普通の文字として1行目に置く
    if (md === prev) continue;                         // 作者の色だけの変更など
    const t = Math.max(lastT, revs[k].ts || 0);
    ops.push(core.makeOp(prev, md, t));
    prev = md; lastT = t;
  }
  return { ops, text: prev, rawText: doc.text, skippedWelcome };
}

/* ---------- 全体 ---------- */
const pad2 = n => String(n).padStart(2, '0');
function jstStamp(ms) {
  const d = new Date(ms + 9 * 3600e3);
  return '' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + '-' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
}
function suffix(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).padStart(4, '0').slice(-4);
}

function importDump(dumpPath, outDir, log, opts) {
  log = log || (() => {});
  opts = opts || {};
  const asIs = new Set(opts.asIs || []);               // パッド名を足さずに前回のまま変換するパッド
  const sql = fs.readFileSync(dumpPath, 'utf8');
  const pads = new Map(), revs = new Map();
  for (const [key, value] of parseDump(sql)) {
    if (!key.startsWith('pad:')) continue;
    const m = /^pad:(.*):revs:(\d+)$/.exec(key);
    if (m) { if (!revs.has(m[1])) revs.set(m[1], []); revs.get(m[1])[+m[2]] = value; }
    else if (!/^pad:.*:chat:\d+$/.test(key)) pads.set(key.slice(4), value);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const report = [], problems = [];
  const used = new Set();
  let n = 0;
  for (const [name, value] of [...pads].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pad = JSON.parse(value), list = revs.get(name) || [];
    const parsed = [];
    let broken = false;
    for (let k = 0; k <= pad.head; k++) {
      if (!list[k]) { broken = true; break; }
      const r = JSON.parse(list[k]);
      parsed.push({ cs: r.changeset, ts: r.meta && r.meta.timestamp });
    }
    if (broken || !parsed.length) { problems.push(name + ': 履歴の一部が見つかりません'); continue; }
    let res;
    try { res = convertPad(pad, parsed, opts.titleLine === false || asIs.has(name) ? '' : name); } catch (e) { problems.push(name + ': ' + e.message); continue; }
    if (res.rawText !== pad.atext.text) { problems.push(name + ': 再生した本文がEtherpadの最新の本文と一致しません'); continue; }
    if (!res.text.trim()) { report.push({ name, skipped: '空' }); continue; }
    const created = parsed[0].ts || Date.now();
    let id = jstStamp(created) + '-' + suffix(name);
    while (used.has(id)) id += 'x';
    used.add(id);
    const lines = [JSON.stringify({ v: 1, id, c: created })];
    for (const o of res.ops) lines.push(JSON.stringify([o.p, o.d, o.i, o.t]));
    const jf = path.join(outDir, id + '.jsonl'), mf = path.join(outDir, id + '.md');
    fs.writeFileSync(jf, lines.join('\n') + '\n');
    fs.writeFileSync(mf, res.text);
    const last = res.ops.length ? res.ops[res.ops.length - 1].t : created;
    fs.utimesSync(jf, new Date(last), new Date(last)); fs.utimesSync(mf, new Date(last), new Date(last));
    report.push({ name, id, versions: res.ops.length, etherpadRevisions: pad.head + 1, created, last });
    n++;
    if (n % 50 === 0) log(n + ' 件変換しました');
  }
  const csv = ['EverPadのID,Etherpadのパッド名,EverPadの版数,Etherpadの版数,作成,最終更新'].concat(
    report.filter(r => r.id).map(r => [r.id, '"' + r.name.replace(/"/g, '""') + '"', r.versions, r.etherpadRevisions, new Date(r.created).toISOString(), new Date(r.last).toISOString()].join(','))).join('\n');
  fs.writeFileSync(path.join(outDir, 'etherpad-import-map.csv'), '﻿' + csv + '\n');
  return { converted: n, skippedEmpty: report.filter(r => r.skipped).length, problems, report };
}

module.exports = { parseDump, applyChangeset, emptyDoc, render, convertPad, importDump };

if (require.main === module) {
  const args = process.argv.slice(2);
  const asIs = args.filter(a => a.startsWith('--as-is=')).map(a => a.slice(8));
  const rest = args.filter(a => !a.startsWith('--'));
  const noTitle = args.includes('--no-title-line');
  const [dump, out] = rest;
  if (!dump || !out) { console.error('使い方: node tools/import-etherpad.js <ダンプファイル> <出力フォルダ> [--no-title-line] [--as-is=パッド名 ...]'); process.exit(1); }
  const r = importDump(dump, out, console.log, { titleLine: !noTitle, asIs });
  console.log('変換: ' + r.converted + '件 / 空のため除外: ' + r.skippedEmpty + '件 / 問題: ' + r.problems.length + '件');
  r.problems.forEach(p => console.log('  ' + p));
}
