'use strict';
/* evernote-backup(https://github.com/vzhd1701/evernote-backup)のデータベース(en_backup.db)を、EverPad のメモにする。
   node tools/import-evernote.js <en_backup.db> <出力フォルダ> [--notebooks=tag|folder|none] [--read-only] [--no-html] [--python=<コマンド>]
   - 中央揃え・右揃え・上付き・下付き・画像の表示の幅は、メモに書ける HTML(<div align>・<sup>・<sub>・<img width>)で残す。
     --no-html なら HTML を使わない(それらは外れる)。
   - データベースは Python で読む(tools/evernote-dump.py。標準ライブラリだけ。evernote-backup がノートを Python の形で持つため)。
   - ノートごとに <ID>.jsonl(履歴。Evernote の過去の版は無いので、更新日時の1版)と <ID>.md(本文)、添付は <ID>.files に置く。
   - 本文(ENML)は、貼り付けと同じ htmlmd.js で Markdown にする。<en-media> は添付に、<en-todo> はチェックボックスにする。
   - 1行目は「# 題名」。タグとノートブック(--notebooks=tag)と元の URL は、フロントマター(tags・source)に書く。
   - --notebooks=tag(既定): すべてを出力フォルダに入れ、ノートブックの名前をタグにする(スタックがあれば「スタック/ノートブック」)。
     folder: ノートブックごとにフォルダを分ける。none: すべてを出力フォルダに入れ、ノートブックのことは残さない。
   - ごみ箱のノートは変換しない。出力フォルダは、無いか空でなければならない(今あるメモを上書きしないため)。
   - 題名・ノートブックとメモの ID の対応を evernote-import-map.csv に書く。 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const core = require('../renderer/core');
const htmlmd = require('../renderer/htmlmd');
const { parseMarkup } = require('../docexport');
const { attachmentId, MAX_ATTACH } = require('../store');

const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(0xa0);

/* ---------- ENML → Markdown ---------- */
// parseMarkup が知らない、よく使う名前の文字参照(ENML は XHTML の名前を使える)
const ENTITIES = {
  copy: 169, reg: 174, trade: 8482, mdash: 8212, ndash: 8211, hellip: 8230, laquo: 171, raquo: 187, lsquo: 8216, rsquo: 8217,
  ldquo: 8220, rdquo: 8221, sbquo: 8218, bdquo: 8222, middot: 183, bull: 8226, times: 215, divide: 247, deg: 176, plusmn: 177,
  yen: 165, euro: 8364, pound: 163, cent: 162, sect: 167, para: 182, iexcl: 161, iquest: 191, shy: 173, ensp: 8194, emsp: 8195,
  thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, larr: 8592, rarr: 8594, uarr: 8593, darr: 8595, harr: 8596,
  hearts: 9829, frac12: 189, frac14: 188, frac34: 190, sup1: 185, sup2: 178, sup3: 179, micro: 181, prime: 8242, Prime: 8243,
  auml: 228, ouml: 246, uuml: 252, Auml: 196, Ouml: 214, Uuml: 220, szlig: 223, eacute: 233, egrave: 232, aacute: 225, agrave: 224
};
const entities = s => s.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (m, e) => (Object.prototype.hasOwnProperty.call(ENTITIES, e) ? String.fromCodePoint(ENTITIES[e]) : m));

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/tiff': 'tif', 'image/heic': 'heic', 'image/avif': 'avif',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/amr': 'amr', 'audio/x-ms-wma': 'wma', 'video/mp4': 'mp4', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
};
/* 添付の名前: 元のファイル名(拡張子が無ければ種類から足す)。名前が無ければ image.png・file.pdf のように */
function resourceName(r) {
  const ext = MIME_EXT[String(r.mime || '').toLowerCase()] || '';
  let name = String(r.fileName || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) name = (/^image\//i.test(r.mime || '') ? 'image' : 'file') + (ext ? '.' + ext : '');
  else if (ext && !/\.[A-Za-z0-9]{1,8}$/.test(name)) name += '.' + ext;
  return name;
}

const kids = n => n.children || [];
const textOf = n => (n.text != null ? n.text : kids(n).map(textOf).join(''));
const attr = (n, k) => (n.attrs && n.attrs[k] != null ? String(n.attrs[k]) : '');
// コードブロック(Evernote の --en-codeblock)の行: 中の div と br で改行する
function codeLines(n) {
  let s = '';
  const walk = x => {
    if (x.text != null) { s += x.text; return; }
    if (x.tag === 'br') { s += '\n'; return; }
    const block = x.tag === 'div' || x.tag === 'p';
    if (block && s && !s.endsWith('\n')) s += '\n';
    kids(x).forEach(walk);
    if (block && !s.endsWith('\n')) s += '\n';
  };
  kids(n).forEach(walk);
  return s.split(NBSP).join(' ').replace(/\n+$/, '');
}
const MAX_DEPTH = 120;

/* Evernote のノートへのリンクの、相手のノートの GUID(小文字)。ノートへのリンクでなければ ''。
   - evernote:///view/<ユーザー>/<シャード>/<GUID>/<GUID>/(アプリの「ノートリンクをコピー」)
   - https://www.evernote.com/shard/<シャード>/nl/<ユーザー>/<GUID>/ などの Web のリンク(evernote.com の、GUID を含むもの) */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function noteGuidOf(href) {
  const s = String(href || '');
  if (!/^evernote:/i.test(s) && !/^https?:\/\/([a-z0-9-]+\.)*evernote\.com\//i.test(s)) return '';
  const m = UUID_RE.exec(s);
  return m ? m[0].toLowerCase() : '';
}

/* ENML の木を、htmlmd が読む形にする。res: hash → { fileId, name, image }(添付にできないものは { missing: 理由 })。
   used: 本文から参照した hash を入れる。stats に数を足す。links(配列)があれば、ノートどうしのリンクを集める */
function adaptTree(tree, res, used, stats, links) {
  const conv = (n, depth) => {
    if (n.text != null) return n;
    const t = n.tag;
    // 深すぎる入れ子(Web クリップの組み方の表など)は、文字だけにする
    if (depth > MAX_DEPTH) { stats.flattened = (stats.flattened || 0) + 1; return { text: textOf(n) }; }
    if (t === 'en-note') return { tag: 'div', attrs: {}, children: kids(n).map(c => conv(c, depth + 1)) };
    if (t === 'en-media') {
      const h = attr(n, 'hash').toLowerCase(), r = res.get(h);
      if (!r) { stats.missingMedia = (stats.missingMedia || 0) + 1; return { text: '' }; }
      used.add(h);
      if (r.missing) return { tag: 'span', attrs: {}, children: [{ text: '[' + r.name + ': ' + r.missing + ']' }] };
      // 表示の幅: Evernote で元の大きさより小さく表示していたときだけ(% はそのまま)。htmlmd の opts.html で <img width> になる
      const img = { 'data-att': r.fileId, alt: r.name };
      if (r.image) {
        const sw = /(?:^|;)\s*width\s*:\s*(\d{1,4})px/i.exec(attr(n, 'style'));
        const w = (attr(n, 'width').trim().replace(/px$/i, '') || (sw ? sw[1] : ''));
        if (/^\d{1,4}%$/.test(w) && w !== '100%') { img.width = w; stats.imgWidth = (stats.imgWidth || 0) + 1; }
        else if (/^\d{1,4}$/.test(w) && +w > 0 && (!r.w || +w < r.w)) { img.width = w; stats.imgWidth = (stats.imgWidth || 0) + 1; }
      }
      return r.image ? { tag: 'img', attrs: img, children: [] }
        : { tag: 'a', attrs: { class: 'att-file', 'data-att': r.fileId, title: r.name }, children: [{ text: r.name }] };
    }
    if (t === 'en-todo') {
      stats.todo = (stats.todo || 0) + 1;
      return { tag: 'span', attrs: {}, children: [{ text: /^true$/i.test(attr(n, 'checked')) ? '☑ ' : '☐ ' }] };
    }
    if (t === 'en-crypt') { stats.crypt = (stats.crypt || 0) + 1; return { tag: 'span', attrs: {}, children: [{ text: '[暗号化された文(変換できません)]' }] }; }
    if (t === 'div' && /--en-codeblock\s*:\s*true/i.test(attr(n, 'style'))) return { tag: 'pre', attrs: {}, children: [{ text: codeLines(n) }] };
    // ノートどうしのリンク: 仮の ID の、EverPad のメモへのリンクにしておき、すべてを変換したあとで本当のメモ ID にする(resolveLinks)
    if (t === 'a' && links) {
      const href = attr(n, 'href').trim().split('&amp;').join('&'), guid = noteGuidOf(href);
      if (guid) {
        const key = 'enlink' + links.length;
        links.push({ key: key, guid: guid, href: href });
        stats.noteLinks = (stats.noteLinks || 0) + 1;
        return { tag: 'a', attrs: { class: 'note-link', 'data-note': key }, children: kids(n).map(c => conv(c, depth + 1)) };
      }
    }
    const attrs = Object.assign({}, n.attrs || {});
    // Web クリップのリンクには、& が二重にエスケープされた(&amp;amp;)URL がある。URL の中の &amp; は & に戻す
    for (const k of ['href', 'src']) {
      if (attrs[k] && attrs[k].includes('&amp;')) {
        let v = attrs[k];
        while (v.includes('&amp;')) v = v.split('&amp;').join('&');
        attrs[k] = v;
        stats.ampUrls = (stats.ampUrls || 0) + 1;
      }
    }
    return { tag: t, attrs: attrs, children: kids(n).map(c => conv(c, depth + 1)) };
  };
  return conv(tree, 0);
}

/* ENML → { md, stats }。res・used は adaptTree と同じ。
   html(既定は真): 中央揃え・右揃え・上付き・下付き・画像の表示の幅を、メモに書ける HTML で残す(htmlmd の opts.html) */
function enmlToMarkdown(enml, res, used, html, links) {
  const stats = {};
  const src = entities(String(enml || '').replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')));
  const tree = adaptTree(parseMarkup(src), res, used, stats, links);
  let md;
  try {
    const r = htmlmd.toMarkdown(tree, { html: html !== false });
    md = r.md;
    if (r.remote) stats.remoteImages = r.remote;
    if (r.images.length) { stats.droppedImages = r.images.length; md = md.split(NUL).filter((x, k) => k % 2 === 0).join(''); }
  } catch (e) {
    // 変換できないときは、文字だけを段落にする
    stats.plainText = 1;
    md = textOf(tree).split(/\n\s*\n/).map(p => htmlmd.escLineStart(htmlmd.escapeText(p.replace(/\s+/g, ' ').trim()))).filter(Boolean).join('\n\n');
  }
  return { md: md, stats: stats };
}

/* ---------- 1件のメモの文 ---------- */
const TAG_MAX = 100;
// タグの名前: " は外す(検索の tag:"…" に書けないため)。空白・コンマ・記号を含むなら "…" で囲む
function tagName(s) { return String(s || '').replace(/"/g, '').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX); }
const tagItem = s => (/^[^\s,'\[\]{}#:&*!|>%@`\\]+$/.test(s) ? s : '"' + s.replace(/\\/g, '\\\\') + '"');

/* note: evernote-dump.py の行。opts.notebooks。res・used は enmlToMarkdown と同じ。{ text, tags, stats } */
function noteText(note, res, used, opts) {
  const tags = [];
  const add = s => { const t = tagName(s); if (t && !tags.some(x => core.tagKey(x) === core.tagKey(t))) tags.push(t); };
  if ((opts.notebooks || 'tag') === 'tag' && note.notebook) add(note.stack ? tagName(note.stack) + '/' + tagName(note.notebook) : note.notebook);
  for (const t of note.tags || []) add(t);
  const fm = [];
  if (tags.length) fm.push('tags: [' + tags.map(tagItem).join(', ') + ']');
  const src = String(note.sourceURL || '').trim();
  if (src && !/[\u0000-\u001f]/.test(src)) fm.push('source: ' + JSON.stringify(src));
  const { md, stats } = enmlToMarkdown(note.content, res, used, opts.html, opts.links);
  // 本文から参照していない添付と、参照していても本文に出なかった添付(Web クリップの隠した部分の中など)は、最後に並べる
  const extra = [];
  for (const [h, r] of res) {
    if (used.has(h) && (r.missing || md.includes('(attach:' + r.fileId + ')') || md.includes('src="attach:' + r.fileId + '"'))) continue;
    if (used.has(h)) stats.hiddenMedia = (stats.hiddenMedia || 0) + 1;
    used.add(h);
    extra.push(r.missing ? '[' + r.name + ': ' + r.missing + ']' : core.attachMarkup(r.name, r.fileId, r.image));
  }
  const title = String(note.title || '').replace(/\s+/g, ' ').trim();
  const parts = [];
  if (title) parts.push('# ' + htmlmd.escapeText(title));
  if (md) parts.push(md);
  if (extra.length) parts.push(extra.join('\n\n'));
  const body = parts.join('\n\n');
  return { text: (fm.length ? '---\n' + fm.join('\n') + '\n---\n\n' : '') + body, tags: tags, stats: stats };
}

/* ---------- ノートどうしのリンク ----------
   変換した文の [表示](note:enlinkN) を、相手のメモへのリンクにする。links: adaptTree が集めた [{ key, guid, href }]、
   byGuid: GUID → { id, title }(変換したノート)。{ text, found, missing }
   - 相手がある: [表示](note:メモID)。表示が相手の題名と違うときは、後ろに (→ 題名)。表示が無いか URL なら、表示は題名
   - 相手が無い(削除・ごみ箱・バックアップに無い): Web のリンク(https://…evernote.com/…)は、そのまま Web のリンク。
     アプリのリンク(evernote:///…)は、表示の文字と (→ 見つからないノート) */
// 表示の中には、エスケープした文字と、画像([![名前](attach:…)](note:…) の内側)がありうる
const NOTE_PH_RE = /\[((?:\\.|!?\[(?:\\.|[^\]\\\n])*\]\([^)\s]*\)|[^[\]\\\n])*)\]\(note:(enlink\d+)\)/g;
const plainOf = s => String(s).replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
const escTitle = s => htmlmd.escapeText(core.linkText(s) || '無題').replace(/\|/g, '\\|');
function resolveLinks(text, links, byGuid) {
  const byKey = new Map(links.map(l => [l.key, l]));
  let found = 0, missing = 0;
  const out = text.replace(NOTE_PH_RE, (m, shown, key) => {
    const l = byKey.get(key);
    if (!l) return m;
    const p = plainOf(shown), noText = !p || p === key || /^(https?:|evernote:)/i.test(p);
    const to = byGuid.get(l.guid);
    if (to) {
      found++;
      if (noText) return '[' + escTitle(to.title) + '](note:' + to.id + ')';
      const same = core.tagKey(p) === core.tagKey(core.linkText(to.title));
      return '[' + shown + '](note:' + to.id + ')' + (same ? '' : ' (→ ' + escTitle(to.title) + ')');
    }
    missing++;
    if (/^https?:\/\//i.test(l.href)) return '[' + (noText ? 'Evernote' : shown) + '](' + l.href.replace(/[\s()<>]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) + ')';
    return (noText ? 'Evernote のノート' : shown) + ' (→ 見つからないノート)';
  });
  return { text: out, found: found, missing: missing };
}

/* ---------- 全体 ---------- */
const pad2 = n => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function suffix(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).padStart(4, '0').slice(-4);
}
const folderName = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 80) || 'ノートブック';

/* Python を探す: opts.python か、py -3(Windows)・python3・python の、動くもの */
function findPython(cmd) {
  const list = cmd ? [[cmd, []]] : process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [c, pre] of list) {
    const r = spawnSync(c, pre.concat(['-c', 'import sqlite3, lzma, pickle; print(1)']), { encoding: 'utf8' });
    if (r.status === 0 && /1/.test(r.stdout || '')) return { cmd: c, pre: pre };
  }
  return null;
}

/* db を outDir に変換する。log(文字)。opts: { notebooks, readOnly, python, html(false なら HTML を使わない) }。Promise<{ notes, attachments, problems, report }> */
function importEvernote(dbPath, outDir, opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const mode = opts.notebooks || 'tag';
  if (!['tag', 'folder', 'none'].includes(mode)) return Promise.reject(new Error('--notebooks は tag・folder・none のどれかです'));
  if (!fs.existsSync(dbPath)) return Promise.reject(new Error('データベースが見つかりません: ' + dbPath));
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) return Promise.reject(new Error('出力フォルダが空ではありません(今あるメモを上書きしないため、空のフォルダか、まだ無いフォルダを指定してください): ' + outDir));
  const py = findPython(opts.python);
  if (!py) return Promise.reject(new Error('Python 3 が見つかりません(--python=<コマンド> で指定できます)'));
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, '.evernote-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const used = new Set(), report = [], problems = [], folders = new Map();
  // ノートどうしのリンク: 変換したノート(GUID → { id, title })と、リンクのあるメモ(あとで書き直す)
  const byGuid = new Map(), pending = [];
  let notes = 0, attachments = 0, total = 0, dbVersion = null, linksFound = 0, linksMissing = 0;
  const dirFor = note => {
    if (mode !== 'folder') return outDir;
    const key = (note.stack ? note.stack + '/' : '') + note.notebook;
    if (!folders.has(key)) {
      let name = folderName(note.notebook), k = 2;
      while ([...folders.values()].includes(name)) name = folderName(note.notebook) + ' (' + k++ + ')';
      folders.set(key, name);
      fs.mkdirSync(path.join(outDir, name), { recursive: true });
    }
    return path.join(outDir, folders.get(key));
  };
  const convert = note => {
    const created = note.created || note.updated || Date.now(), updated = Math.max(created, note.updated || 0);
    let id = stamp(created) + '-' + suffix(note.guid);
    while (used.has(id)) id += 'x';
    used.add(id);
    const dir = dirFor(note), filesDir = path.join(dir, id + '.files');
    const res = new Map(), probs = [];
    let n = 0;
    for (const r of note.resources || []) {
      const name = resourceName(r), h = String(r.hash || '').toLowerCase() || 'nohash-' + (n++);
      if (res.has(h)) { if (r.file) fs.rmSync(path.join(tmp, r.file), { force: true }); continue; }
      if (!r.file) { res.set(h, { name: name, missing: '中身がありません' }); probs.push('中身の無い添付: ' + name); continue; }
      const src = path.join(tmp, r.file);
      if (r.size > MAX_ATTACH) { fs.rmSync(src, { force: true }); res.set(h, { name: name, missing: '大きすぎるため取り込めませんでした' }); probs.push('大きすぎる添付: ' + name); continue; }
      const fileId = attachmentId(name, fs.readFileSync(src));
      fs.mkdirSync(filesDir, { recursive: true });
      const dest = path.join(filesDir, fileId);
      if (fs.existsSync(dest)) fs.rmSync(src, { force: true }); else fs.renameSync(src, dest);
      res.set(h, { fileId: fileId, name: name, image: core.isImageName(name), w: r.width || 0 });
      attachments++;
    }
    const usedRes = new Set(), links = [];
    byGuid.set(String(note.guid || '').toLowerCase(), { id: id, title: note.title || '' });
    const { text, tags, stats } = noteText(note, res, usedRes, { notebooks: mode, html: opts.html, links: links });
    if (stats.plainText) probs.push('整形を変換できず、文字だけにしました');
    if (stats.missingMedia) probs.push('バックアップに無い添付の参照(本文から外しました): ' + stats.missingMedia);
    if (stats.crypt) probs.push('暗号化された文: ' + stats.crypt);
    if (stats.flattened) probs.push('入れ子が深すぎる部分を文字だけにしました: ' + stats.flattened);
    const op = core.makeOp('', text, updated);
    const head = opts.readOnly ? { v: 1, id: id, c: created, ro: true } : { v: 1, id: id, c: created };
    const jf = path.join(dir, id + '.jsonl'), mf = path.join(dir, id + '.md');
    fs.writeFileSync(jf, JSON.stringify(head) + '\n' + JSON.stringify([op.p, op.d, op.i, op.t]) + '\n');
    fs.writeFileSync(mf, text);
    fs.utimesSync(jf, new Date(updated), new Date(updated));
    fs.utimesSync(mf, new Date(updated), new Date(updated));
    const rep = { id: id, title: note.title || '', notebook: note.notebook || '', folder: mode === 'folder' ? path.basename(dir) : '', created: created, updated: updated,
      attachments: res.size, remoteImages: stats.remoteImages || 0, problems: probs };
    report.push(rep);
    if (links.length) pending.push({ head: head, jf: jf, mf: mf, updated: updated, links: links, rep: rep });
    for (const p of probs) problems.push((note.title || id) + ': ' + p);
    notes++;
    if (notes % 100 === 0) log(notes + ' / ' + total + ' 件を変換しました');
  };
  return new Promise((resolve, reject) => {
    const child = spawn(py.cmd, py.pre.concat(['-I', path.join(__dirname, 'evernote-dump.py'), dbPath, tmp]), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', failed = null, ended = false;
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { failed = e; });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', line => {
      if (failed || !line.trim()) return;
      let x;
      try { x = JSON.parse(line); } catch (e) { failed = new Error('Python の出力を読めません'); child.kill(); return; }
      if (x.kind === 'info') { total = x.notes; dbVersion = x.dbVersion; log('ノート ' + total + ' 件を変換します'); }
      else if (x.kind === 'error') problems.push(x.guid + ': 読めないノート(' + x.message + ')');
      else if (x.kind === 'end') ended = true;
      else if (x.kind === 'note') {
        try { convert(x); } catch (e) { problems.push((x.title || x.guid) + ': ' + e.message); }
      }
    });
    child.on('close', code => {
      rl.close();
      fs.rmSync(tmp, { recursive: true, force: true });
      if (failed) return reject(failed);
      if (code !== 0 || !ended) return reject(new Error('データベースを読めませんでした' + (err.trim() ? ':\n' + err.trim() : '')));
      // ノートどうしのリンクを、相手のメモ ID にする(相手が後から変換されることもあるので、すべてを変換したあとで)
      for (const p of pending) {
        try {
          const r = resolveLinks(fs.readFileSync(p.mf, 'utf8'), p.links, byGuid);
          linksFound += r.found;
          linksMissing += r.missing;
          if (r.missing) { p.rep.problems.push('見つからないノートへのリンク: ' + r.missing); problems.push((p.rep.title || p.rep.id) + ': 見つからないノートへのリンク: ' + r.missing); }
          const op = core.makeOp('', r.text, p.updated);
          fs.writeFileSync(p.jf, JSON.stringify(p.head) + '\n' + JSON.stringify([op.p, op.d, op.i, op.t]) + '\n');
          fs.writeFileSync(p.mf, r.text);
          fs.utimesSync(p.jf, new Date(p.updated), new Date(p.updated));
          fs.utimesSync(p.mf, new Date(p.updated), new Date(p.updated));
        } catch (e) { problems.push((p.rep.title || p.rep.id) + ': ' + e.message); }
      }
      const csvCell = s => '"' + String(s).replace(/"/g, '""') + '"';
      const rows = [['ID', '題名', 'ノートブック'].concat(mode === 'folder' ? ['フォルダ'] : []).concat(['作成日時', '更新日時', '添付', 'Web 上の画像', '注意'])]
        .concat(report.map(r => [r.id, csvCell(r.title), csvCell(r.notebook)].concat(mode === 'folder' ? [csvCell(r.folder)] : [])
          .concat([new Date(r.created).toISOString(), new Date(r.updated).toISOString(), r.attachments, r.remoteImages, csvCell(r.problems.join(' / '))])));
      fs.writeFileSync(path.join(outDir, 'evernote-import-map.csv'), BOM + rows.map(r => r.join(',')).join('\n') + '\n');
      resolve({ notes: notes, attachments: attachments, problems: problems, report: report, dbVersion: dbVersion, linksFound: linksFound, linksMissing: linksMissing });
    });
  });
}

module.exports = { enmlToMarkdown, noteText, resourceName, tagName, noteGuidOf, resolveLinks, importEvernote, findPython };

if (require.main === module) {
  const USAGE = '使い方: node tools/import-evernote.js <en_backup.db> <出力フォルダ> [--notebooks=tag|folder|none] [--read-only] [--no-html] [--python=<コマンド>]';
  const args = process.argv.slice(2), files = [], opts = { log: s => console.log(s) };
  for (const a of args) {
    let m;
    if (!a.startsWith('--')) files.push(a);
    else if ((m = /^--notebooks=(tag|folder|none)$/.exec(a))) opts.notebooks = m[1];
    else if (a === '--read-only') opts.readOnly = true;
    else if (a === '--no-html') opts.html = false;
    else if ((m = /^--python=(.+)$/.exec(a))) opts.python = m[1];
    else { console.error('知らないオプションです: ' + a + '\n' + USAGE); process.exit(2); }
  }
  if (files.length !== 2) { console.error(USAGE); process.exit(2); }
  importEvernote(path.resolve(files[0]), path.resolve(files[1]), opts).then(r => {
    console.log(r.notes + ' 件のメモ(添付 ' + r.attachments + ' 個)を ' + path.resolve(files[1]) + ' に書きました。');
    if (r.linksFound || r.linksMissing) console.log('ノートどうしのリンク: ' + r.linksFound + ' 個をメモへのリンクにしました' + (r.linksMissing ? '。相手が見つからないもの: ' + r.linksMissing + ' 個' : '') + '。');
    if (r.problems.length) { console.log('注意(' + r.problems.length + ' 件。evernote-import-map.csv の「注意」の列にもあります):'); for (const p of r.problems) console.log('  ' + p); }
  }, e => { console.error(e.message); process.exit(1); });
}
