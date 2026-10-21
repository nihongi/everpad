'use strict';
/* 1つのメモのアーカイブ(.everpad): 本文・履歴・添付を1つの ZIP にまとめる(Electron に依存しないので、テストできる)。
   中身:
     manifest.json  形式名・形式の版・書き出した EverPad のバージョンと日時・メモID・題名・作成日時
     note.jsonl     履歴(保存先にあるファイルそのまま)
     note.md        最新の本文
     files/<ID>     添付ファイル
   読み込むときは、形式・メモID・履歴の中身・添付のファイル名を確かめ、合わなければ例外(code 付き)にする。 */
const { writeZip, readZip, isZip } = require('./ziplite');
const { validId, validFileId, parseLog } = require('./store');

const FORMAT = 'everpad-note';
const VERSION = 1;

function archiveError(code, message) { const e = new Error(message); e.code = code; return e; }

/* note: { id, title, created, jsonl(Buffer|string), md(string), files: [{ fileId, data }] } */
function buildArchive(note, appVersion, when) {
  const at = when || new Date();
  const manifest = { format: FORMAT, version: VERSION, app: 'EverPad ' + (appVersion || ''), exported: at.toISOString(), id: note.id, title: note.title || '', created: note.created };
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'note.jsonl', data: Buffer.isBuffer(note.jsonl) ? note.jsonl : Buffer.from(String(note.jsonl), 'utf8') },
    { name: 'note.md', data: Buffer.from(note.md || '', 'utf8') }
  ];
  for (const f of note.files || []) entries.push({ name: 'files/' + f.fileId, data: f.data });
  return writeZip(entries, at);
}

/* ZIP で、manifest.json に EverPad の形式名が書いてあるか(取り込むときに、テキストとアーカイブを見分ける) */
function looksLikeArchive(buf) {
  if (!isZip(buf)) return false;
  return buf.indexOf(Buffer.from('manifest.json')) >= 0;
}

/* アーカイブの Buffer → { manifest, head, ops, jsonl, md, files: [{ fileId, data }] } */
function readArchive(buf) {
  let entries;
  try { entries = readZip(buf); } catch (e) { throw archiveError(e.code === 'tooLarge' ? 'tooLarge' : 'broken', e.message); }
  const get = name => entries.find(e => e.name === name);
  const man = get('manifest.json');
  if (!man) throw archiveError('notArchive', 'EverPad のアーカイブではありません');
  let manifest;
  try { manifest = JSON.parse(man.data.toString('utf8')); } catch (e) { throw archiveError('broken', 'manifest.json を読めません'); }
  if (!manifest || manifest.format !== FORMAT) throw archiveError('notArchive', 'EverPad のアーカイブではありません');
  if (manifest.version !== VERSION) throw archiveError('newerFormat', '対応していない形式の版です');
  if (!validId(manifest.id)) throw archiveError('broken', 'メモIDが正しくありません');
  const log = get('note.jsonl');
  if (!log) throw archiveError('broken', '履歴がありません');
  const jsonl = log.data.toString('utf8');
  const r = parseLog(jsonl);
  if (!r.head || r.bad || r.head.id !== manifest.id) throw archiveError('broken', '履歴が正しくありません');
  const files = [];
  for (const e of entries) {
    if (!e.name.startsWith('files/')) continue;
    const fileId = e.name.slice(6);
    if (!validFileId(fileId)) throw archiveError('broken', '添付のファイル名が正しくありません');
    files.push({ fileId: fileId, data: e.data });
  }
  const md = get('note.md');
  return { manifest: manifest, head: r.head, ops: r.ops, jsonl: jsonl, md: md ? md.data.toString('utf8') : null, files: files };
}

module.exports = { buildArchive, readArchive, looksLikeArchive, FORMAT, VERSION };
