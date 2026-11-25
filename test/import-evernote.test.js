'use strict';
/* evernote-backup のデータベースの変換(tools/import-evernote.js と tools/evernote-dump.py)。
   データベースは、Python で小さな偽物を作って試す(Python が無ければ、そのテストは飛ばす) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const C = require('../renderer/core');
const E = require('../tools/import-evernote');
const { parseLog, wireText } = require('../store');

const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const resMap = entries => new Map(entries);

test('ENML → Markdown: 見出し・太字・リスト・リンク・表(結合)・文字参照。en-note は外す', () => {
  const enml = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">' +
    '<en-note><h2>見出し</h2><div>本文 <b>太字</b> &amp; &copy; &mdash; <span style="color:red">色</span></div>' +
    '<ul><li>一</li><li>二</li></ul><div><a href="https://example.com/">例</a></div>' +
    '<table><tr><td colspan="2">結合</td></tr><tr><td>a</td><td>b</td></tr></table></en-note>';
  const { md, stats } = E.enmlToMarkdown(enml, new Map(), new Set());
  assert.match(md, /^## 見出し$/m);
  assert.match(md, /本文 \*\*太字\*\* & © — 色/);
  assert.match(md, /^- 一\n- 二$/m);
  assert.match(md, /\[例\]\(https:\/\/example\.com\/\)/);
  assert.match(md, /\| 結合 \|\|/);
  assert.ok(!/en-note|<\?xml|DOCTYPE/.test(md), md);
  assert.deepStrictEqual(stats, {});
});

test('ENML → Markdown: en-media は添付(画像は表示、ほかはファイル)。見つからない参照は数える。en-todo・en-crypt・コードブロック', () => {
  const res = resMap([['aa11', { fileId: '0123456789abcdef.png', name: 'shot.png', image: true }], ['bb22', { fileId: 'fedcba9876543210.pdf', name: '資料.pdf', image: false }],
    ['cc33', { name: 'big.bin', missing: '大きすぎるため取り込めませんでした' }]]);
  const used = new Set();
  const enml = '<en-note><div><en-media hash="AA11" type="image/png"/></div><div><en-media hash="bb22" type="application/pdf"/></div>' +
    '<div><en-media hash="cc33" type="application/octet-stream"/></div><div><en-media hash="zz99" type="image/png"/></div>' +
    '<div><en-todo checked="true"/>済み</div><div><en-todo/>まだ</div><div><en-crypt>xxx</en-crypt></div>' +
    '<div style="box-sizing: border-box; --en-codeblock:true;"><div>let a = 1;</div><div>let b = 2;</div></div></en-note>';
  const { md, stats } = E.enmlToMarkdown(enml, res, used);
  assert.match(md, /!\[shot\.png\]\(attach:0123456789abcdef\.png\)/);
  assert.match(md, /\[資料\.pdf\]\(attach:fedcba9876543210\.pdf\)/);
  assert.match(md, /big\.bin: 大きすぎるため取り込めませんでした/);
  assert.match(md, /☑ 済み/);
  assert.match(md, /☐ まだ/);
  assert.match(md, /暗号化された文/);
  assert.match(md, /```\nlet a = 1;\nlet b = 2;\n```/);
  assert.deepStrictEqual([...used].sort(), ['aa11', 'bb22', 'cc33']);
  assert.strictEqual(stats.missingMedia, 1);
  assert.strictEqual(stats.todo, 2);
  assert.strictEqual(stats.crypt, 1);
});

test('メモの文: フロントマターにタグ(ノートブックが先、同じものは1つ、" は外す)と元の URL。1行目は # 題名。参照していない添付は最後に', () => {
  const res = resMap([['aa11', { fileId: '0123456789abcdef.png', name: 'a.png', image: true }], ['bb22', { fileId: 'fedcba9876543210.pdf', name: 'b.pdf', image: false }]]);
  const note = { title: '題名 *強調* の', notebook: 'My "Work" notes', stack: '', tags: ['旅行', 'my work notes', "it's"], sourceURL: 'https://example.com/a?b=1#c',
    content: '<en-note><div><en-media hash="aa11" type="image/png"/></div></en-note>' };
  const r = E.noteText(note, res, new Set(), { notebooks: 'tag' });
  assert.ok(r.text.startsWith('---\ntags: ["My Work notes", 旅行, "it\'s"]\nsource: "https://example.com/a?b=1#c"\n---\n\n# 題名 \\*強調\\* の\n\n'), r.text);
  assert.deepStrictEqual(C.tagsOf(r.text), ['My Work notes', '旅行', "it's"]);
  assert.strictEqual(C.titleOf(r.text), '題名 *強調* の');
  assert.ok(r.text.endsWith('![a.png](attach:0123456789abcdef.png)\n\n[b.pdf](attach:fedcba9876543210.pdf)'), r.text);
  // スタックは「スタック/ノートブック」の階層のタグ。folder・none ではノートブックのタグを付けない
  assert.deepStrictEqual(C.tagsOf(E.noteText(Object.assign({}, note, { stack: '仕事' }), new Map(), new Set(), { notebooks: 'tag' }).text)[0], '仕事/My Work notes');
  for (const m of ['folder', 'none']) assert.deepStrictEqual(C.tagsOf(E.noteText(note, new Map(), new Set(), { notebooks: m }).text), ['旅行', 'my work notes', "it's"]);
  // タグも URL も無ければフロントマターは無し
  assert.strictEqual(E.noteText({ title: 'T', content: '<en-note>本文</en-note>' }, new Map(), new Set(), {}).text, '# T\n\n本文');
});

test('Web クリップ: URL の二重のエスケープ(&amp;amp;)は & に戻す。隠した部分の中の添付は最後に並べる。文字の <div> は HTML にしない', () => {
  const { md, stats } = E.enmlToMarkdown('<en-note><a href="https://a.example/?x=1&amp;amp;y=2">u</a></en-note>', new Map(), new Set());
  assert.strictEqual(md, '[u](https://a.example/?x=1&y=2)');
  assert.strictEqual(stats.ampUrls, 1);
  const res = resMap([['aa11', { fileId: '0123456789abcdef.gif', name: 'a.gif', image: true }]]);
  const r = E.noteText({ title: 'T', content: '<en-note><div>見える</div><div style="display:none"><en-media hash="aa11" type="image/gif"/></div></en-note>' }, res, new Set(), {});
  assert.strictEqual(r.text, '# T\n\n見える\n\n![a.gif](attach:0123456789abcdef.gif)');
  assert.strictEqual(r.stats.hiddenMedia, 1);
  const t = E.noteText({ title: '<div> の使い方', content: '<en-note><div>&lt;table&gt; は表</div></en-note>' }, new Map(), new Set(), {}).text;
  assert.strictEqual(t, '# \\<div> の使い方\n\n\\<table> は表');
  assert.strictEqual(C.titleOf(t), '<div> の使い方');
  assert.ok(!/<(div|table)/.test(C.md(t)), C.md(t));
});

const G1 = '3ba1eea5-8f77-41d7-a2bc-116f18f7c034', G2 = '0f0e0d0c-0b0a-4909-8807-060504030201', G9 = '99999999-9999-4999-8999-999999999999';
test('ノートへのリンクの GUID: アプリのリンク(evernote:///view/…)と evernote.com の Web のリンク。ほかのリンクは対象外', () => {
  assert.strictEqual(E.noteGuidOf('evernote:///view/138788/s3/' + G1 + '/' + G1 + '/'), G1);
  assert.strictEqual(E.noteGuidOf('evernote:///view/1/s1/' + G1.toUpperCase() + '/' + G1.toUpperCase() + '/'), G1);
  assert.strictEqual(E.noteGuidOf('https://www.evernote.com/shard/s3/nl/138788/' + G1 + '/?title=x'), G1);
  assert.strictEqual(E.noteGuidOf('https://share.evernote.com/note/' + G1), G1);
  assert.strictEqual(E.noteGuidOf('https://example.com/' + G1), '');
  assert.strictEqual(E.noteGuidOf('https://www.evernote.com/'), '');
  assert.strictEqual(E.noteGuidOf('https://evernote.com.example.net/' + G1), '');
});

test('ノートへのリンクの変換: 相手があればメモへのリンク(表示が題名と違えば (→ 題名))。無ければ、Web のリンクはそのまま、アプリのリンクは (→ 見つからないノート)', () => {
  const links = [];
  const enml = '<en-note><div><a href="evernote:///view/1/s1/' + G1 + '/' + G1 + '/">会議の記録</a></div>' +
    '<div><a href="evernote:///view/1/s1/' + G1 + '/' + G1 + '/">こちら</a></div>' +
    '<div><a href="https://www.evernote.com/shard/s1/nl/1/' + G2 + '/">https://www.evernote.com/shard/s1/nl/1/' + G2 + '/</a></div>' +
    '<div><a href="evernote:///view/1/s1/' + G9 + '/' + G9 + '/">消えたノート</a></div>' +
    '<div><a href="https://www.evernote.com/shard/s1/nl/1/' + G9 + '/">Web の [リンク]</a></div>' +
    '<div><a href="evernote:///view/1/s1/' + G2 + '/' + G2 + '/"><en-media hash="aa" type="image/png"/></a></div></en-note>';
  const res = new Map([['aa', { fileId: '0123456789abcdef.png', name: 'p.png', image: true }]]);
  const { md, stats } = E.enmlToMarkdown(enml, res, new Set(), true, links);
  assert.strictEqual(links.length, 6);
  assert.strictEqual(stats.noteLinks, 6);
  const byGuid = new Map([[G1, { id: '20130506-100203-ab12', title: '会議の記録' }], [G2, { id: '20140102-120405-cd34', title: '題名 | 縦線' }]]);
  const r = E.resolveLinks(md, links, byGuid);
  assert.deepStrictEqual([r.found, r.missing], [4, 2]);
  assert.strictEqual(r.text, [
    '[会議の記録](note:20130506-100203-ab12)',
    '[こちら](note:20130506-100203-ab12) (→ 会議の記録)',
    '[題名 \\| 縦線](note:20140102-120405-cd34)',
    '消えたノート (→ 見つからないノート)',
    '[Web の [リンク\\]](https://www.evernote.com/shard/s1/nl/1/' + G9 + '/)',
    '[![p.png](attach:0123456789abcdef.png)](note:20140102-120405-cd34) (→ 題名 \\| 縦線)'
  ].join('\n\n'));
  assert.ok(!/enlink/.test(r.text));
  // EverPad の表示: メモへのリンクになる
  const html = C.md(r.text);
  assert.strictEqual((html.match(/class="note-link"/g) || []).length, 4);
  // links を渡さなければ、今までどおり(リンクの文字だけ)
  assert.strictEqual(E.enmlToMarkdown('<en-note><a href="evernote:///view/1/s1/' + G1 + '/' + G1 + '/">会議</a></en-note>', new Map(), new Set()).md, '会議');
});

test('添付の名前: 元の名前(拡張子が無ければ種類から足す)。名前が無ければ image.png・file.pdf', () => {
  assert.strictEqual(E.resourceName({ mime: 'image/png', fileName: '' }), 'image.png');
  assert.strictEqual(E.resourceName({ mime: 'application/pdf', fileName: '' }), 'file.pdf');
  assert.strictEqual(E.resourceName({ mime: 'image/jpeg', fileName: '写真' }), '写真.jpg');
  assert.strictEqual(E.resourceName({ mime: 'application/pdf', fileName: 'a/b:c.pdf' }), 'a b c.pdf');
  assert.strictEqual(E.resourceName({ mime: 'application/x-foo', fileName: 'x.dat' }), 'x.dat');
});

/* ---- 偽物のデータベース(evernote-backup と同じ形: Note を pickle にして lzma で縮める) ---- */
const PY_MAKE = [
  'import sqlite3, lzma, pickle, sys, types, json, hashlib',
  "m = types.ModuleType('evernote.edam.type.ttypes')",
  "sys.modules['evernote'] = types.ModuleType('evernote'); sys.modules['evernote.edam'] = types.ModuleType('evernote.edam')",
  "sys.modules['evernote.edam.type'] = types.ModuleType('evernote.edam.type'); sys.modules['evernote.edam.type.ttypes'] = m",
  'def mk(name):',
  '    def init(self, **kw): self.__dict__.update(kw)',
  "    c = type(name, (object,), {'__init__': init, '__module__': 'evernote.edam.type.ttypes'})",
  '    setattr(m, name, c); return c',
  "Note, NoteAttributes, Resource, Data, ResourceAttributes = [mk(n) for n in ['Note', 'NoteAttributes', 'Resource', 'Data', 'ResourceAttributes']]",
  'spec = json.load(open(sys.argv[2], encoding="utf-8"))',
  'db = sqlite3.connect(sys.argv[1])',
  "db.execute('CREATE TABLE notebooks(guid TEXT PRIMARY KEY, name TEXT, stack TEXT)')",
  "db.execute('CREATE TABLE notes(guid TEXT PRIMARY KEY, title TEXT, notebook_guid TEXT, is_active BOOLEAN, raw_note BLOB)')",
  "db.execute('CREATE TABLE config(name TEXT PRIMARY KEY, value TEXT)')",
  "db.execute(\"INSERT INTO config VALUES ('DB_VERSION', '7')\")",
  "for nb in spec['notebooks']: db.execute('INSERT INTO notebooks VALUES (?, ?, ?)', (nb['guid'], nb['name'], nb.get('stack')))",
  "for n in spec['notes']:",
  '    rs = []',
  "    for r in n.get('resources', []):",
  "        body = r['body'].encode('utf-8')",
  "        rs.append(Resource(mime=r['mime'], data=Data(body=body, bodyHash=hashlib.md5(body).digest(), size=len(body)), attributes=ResourceAttributes(fileName=r.get('fileName'))))",
  "    note = Note(guid=n['guid'], title=n['title'], content=n['content'], created=n['created'], updated=n['updated'], tagNames=n.get('tags'), resources=rs or None,",
  "                attributes=NoteAttributes(sourceURL=n.get('source')))",
  "    db.execute('INSERT INTO notes VALUES (?, ?, ?, ?, ?)', (n['guid'], n['title'], n['nb'], n.get('active', True), lzma.compress(pickle.dumps(note, protocol=5))))",
  'db.commit()'
].join('\n');

const py = E.findPython();
const pyOpt = { skip: py ? false : 'Python 3 がありません' };
function makeDb(dir, spec) {
  const script = path.join(dir, 'make.py'), specFile = path.join(dir, 'spec.json'), db = path.join(dir, 'en_backup.db');
  fs.writeFileSync(script, PY_MAKE);
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = spawnSync(py.cmd, py.pre.concat([script, db, specFile]), { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return db;
}
const T0 = Date.UTC(2013, 4, 6, 1, 2, 3), T1 = Date.UTC(2014, 0, 2, 3, 4, 5);
const PNG = 'png-bytes', PDF = 'pdf-bytes';
const SPEC = {
  notebooks: [{ guid: 'nb1', name: '仕事 ノート' }, { guid: 'nb2', name: '個人' }, { guid: 'nb3', name: '空' }],
  notes: [
    { guid: 'g1', nb: 'nb1', title: '会議', created: T0, updated: T1, tags: ['議事録'], source: 'https://example.com/',
      content: '<en-note><div>議題</div><en-media hash="' + md5(PNG) + '" type="image/png"/><en-media hash="' + md5(PNG) + '" type="image/png"/></en-note>',
      resources: [{ mime: 'image/png', body: PNG, fileName: '図.png' }, { mime: 'application/pdf', body: PDF, fileName: '' }, { mime: 'image/png', body: PNG, fileName: '図.png' }] },
    { guid: 'g2', nb: 'nb2', title: '買い物', created: T0, updated: T0, content: '<en-note><ul><li>牛乳</li></ul></en-note>' },
    { guid: 'g3', nb: 'nb2', title: '消したもの', created: T1, updated: T1, active: false, content: '<en-note>ごみ箱</en-note>' }
  ]
};

test('データベースの変換: 1つのフォルダに、ノートブックをタグにして書く。ごみ箱は変換しない。添付・履歴・対応表', pyOpt, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-en-'));
  try {
    const db = makeDb(dir, SPEC), out = path.join(dir, 'out');
    const r = await E.importEvernote(db, out, { notebooks: 'tag' });
    assert.strictEqual(r.notes, 2);
    assert.strictEqual(r.dbVersion, '7');
    const names = fs.readdirSync(out).sort();
    const ids = names.filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6));
    assert.strictEqual(ids.length, 2);
    assert.ok(!names.includes('.evernote-tmp'), names);
    for (const id of ids) {
      assert.match(id, /^\d{8}-\d{6}-[0-9a-z]{4}$/);
      const log = parseLog(fs.readFileSync(path.join(out, id + '.jsonl'), 'utf8'));
      const md = fs.readFileSync(path.join(out, id + '.md'), 'utf8');
      assert.strictEqual(wireText(log.ops), md);
      assert.strictEqual(log.head.c, T0);
    }
    const meeting = ids.find(id => fs.readFileSync(path.join(out, id + '.md'), 'utf8').includes('# 会議'));
    const text = fs.readFileSync(path.join(out, meeting + '.md'), 'utf8');
    assert.deepStrictEqual(C.tagsOf(text), ['仕事 ノート', '議事録']);
    assert.match(text, /source: "https:\/\/example\.com\/"/);
    assert.strictEqual(parseLog(fs.readFileSync(path.join(out, meeting + '.jsonl'), 'utf8')).ops[0][3], T1);
    // 同じ画像は1つの添付。本文に2回。参照していない PDF は最後に
    const files = fs.readdirSync(path.join(out, meeting + '.files')).sort();
    assert.strictEqual(files.length, 2, files);
    const png = files.find(f => f.endsWith('.png')), pdf = files.find(f => f.endsWith('.pdf'));
    assert.strictEqual(fs.readFileSync(path.join(out, meeting + '.files', png), 'utf8'), PNG);
    assert.strictEqual(text.split('![図.png](attach:' + png + ')').length - 1, 2);
    assert.ok(text.endsWith('[file.pdf](attach:' + pdf + ')'), text);
    const csv = fs.readFileSync(path.join(out, 'evernote-import-map.csv'), 'utf8');
    assert.ok(csv.startsWith(String.fromCharCode(0xfeff) + 'ID,題名,ノートブック,作成日時'), csv);
    assert.match(csv, /"会議","仕事 ノート"/);
    assert.ok(!csv.includes('消したもの'));
    // 空でない出力フォルダには書かない
    await assert.rejects(E.importEvernote(db, out, {}), /空ではありません/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('データベースの変換: --notebooks=folder はノートブックごとのフォルダ(タグは付けない)', pyOpt, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-en-'));
  try {
    const db = makeDb(dir, SPEC), out = path.join(dir, 'out');
    const r = await E.importEvernote(db, out, { notebooks: 'folder', readOnly: true });
    assert.strictEqual(r.notes, 2);
    const subs = fs.readdirSync(out).filter(f => fs.statSync(path.join(out, f)).isDirectory()).sort();
    assert.deepStrictEqual(subs, ['仕事 ノート', '個人'].sort());
    const work = fs.readdirSync(path.join(out, '仕事 ノート')).find(f => f.endsWith('.md'));
    const text = fs.readFileSync(path.join(out, '仕事 ノート', work), 'utf8');
    assert.deepStrictEqual(C.tagsOf(text), ['議事録']);
    const head = parseLog(fs.readFileSync(path.join(out, '仕事 ノート', work.replace(/\.md$/, '.jsonl')), 'utf8')).head;
    assert.strictEqual(head.ro, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('データベースの変換: ノートどうしのリンクは、後から変換するノートへのものも、メモへのリンクになる。ごみ箱のノートへのリンクは見つからない扱い', pyOpt, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-en-'));
  try {
    // GUID の順に変換するので、G2 のノート(先)が G1 のノート(後)へリンクする
    const db = makeDb(dir, {
      notebooks: [{ guid: 'nb1', name: '本' }],
      notes: [
        { guid: G2, nb: 'nb1', title: '目次', created: T0, updated: T1, content: '<en-note><div><a href="evernote:///view/1/s1/' + G1 + '/' + G1 + '/">第1章</a></div><div><a href="evernote:///view/1/s1/' + G9 + '/' + G9 + '/">下書き</a></div></en-note>' },
        { guid: G1, nb: 'nb1', title: '第1章', created: T1, updated: T1, content: '<en-note>本文</en-note>' },
        { guid: G9, nb: 'nb1', title: '下書き', created: T1, updated: T1, active: false, content: '<en-note>ごみ箱</en-note>' }
      ]
    });
    const out = path.join(dir, 'out');
    const r = await E.importEvernote(db, out, {});
    assert.deepStrictEqual([r.notes, r.linksFound, r.linksMissing], [2, 1, 1]);
    const ids = fs.readdirSync(out).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
    const toc = ids.find(id => fs.readFileSync(path.join(out, id + '.md'), 'utf8').includes('# 目次'));
    const ch1 = ids.find(id => id !== toc);
    const text = fs.readFileSync(path.join(out, toc + '.md'), 'utf8');
    assert.ok(text.endsWith('# 目次\n\n[第1章](note:' + ch1 + ')\n\n下書き (→ 見つからないノート)'), text);
    // 履歴(.jsonl)も書き直した文
    const log = parseLog(fs.readFileSync(path.join(out, toc + '.jsonl'), 'utf8'));
    assert.strictEqual(wireText(log.ops), text);
    assert.strictEqual(log.ops[0][3], T1);
    assert.match(fs.readFileSync(path.join(out, 'evernote-import-map.csv'), 'utf8'), /"目次",.*見つからないノートへのリンク: 1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Python の読み取り: evernote の型だけを読み、ほかの型(コードを動かせるもの)は読まない', pyOpt, () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'evernote-dump.py'), 'utf8');
  assert.match(src, /class SafeUnpickler\(pickle\.Unpickler\):/);
  assert.match(src, /if module == 'evernote' or module\.startswith\('evernote\.'\):/);
  assert.match(src, /raise pickle\.UnpicklingError/);
  assert.match(src, /\?mode=ro/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-en-'));
  try {
    const db = path.join(dir, 'evil.db');
    const script = path.join(dir, 'evil.py');
    fs.writeFileSync(script, [
      'import sqlite3, lzma, pickle, sys, os',
      'class Evil:',
      '    def __reduce__(self): return (os.system, ("echo pwned",))',
      'db = sqlite3.connect(sys.argv[1])',
      "db.execute('CREATE TABLE notebooks(guid TEXT PRIMARY KEY, name TEXT, stack TEXT)')",
      "db.execute('CREATE TABLE notes(guid TEXT PRIMARY KEY, title TEXT, notebook_guid TEXT, is_active BOOLEAN, raw_note BLOB)')",
      "db.execute('CREATE TABLE config(name TEXT PRIMARY KEY, value TEXT)')",
      "db.execute('INSERT INTO notes VALUES (?, ?, ?, ?, ?)', ('x', 't', 'nb', True, lzma.compress(pickle.dumps(Evil()))))",
      'db.commit()'
    ].join('\n'));
    assert.strictEqual(spawnSync(py.cmd, py.pre.concat([script, db])).status, 0);
    const r = spawnSync(py.cmd, py.pre.concat(['-I', path.join(__dirname, '..', 'tools', 'evernote-dump.py'), db, path.join(dir, 'res')]), { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n').map(l => JSON.parse(l));
    assert.strictEqual(lines[1].kind, 'error');
    assert.match(lines[1].message, /os\.system|posix\.system|nt\.system/);
    assert.ok(!/pwned/.test(r.stdout));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
