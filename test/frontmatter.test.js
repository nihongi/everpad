'use strict';
/* フロントマター(メモの先頭の --- で囲んだ YAML)と、タグの検索(tag:名前) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../renderer/core');
const { Store } = require('../store');
const I18N = require('../renderer/i18n');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
// タグの名前と、その位置(s〜e)の文字
const tagsAt = t => { const f = core.frontMatter(t); return f.tags.map(x => [x.name, t.slice(x.s, x.e)]); };
const caret = (t, at) => t.slice(0, at) + '|' + t.slice(at);

test('フロントマター: 1行目が --- で、閉じの --- までがキーと値の並びのときだけ', () => {
  const t = '---\ntags: [YAML]\ntitle: x\n---\n# 見出し\n本文';
  const f = core.frontMatter(t);
  assert.strictEqual(f.lines, 4);
  assert.strictEqual(t.slice(f.next), '# 見出し\n本文');
  assert.strictEqual(t.slice(0, f.close), '---\ntags: [YAML]\ntitle: x\n');
  assert.ok(core.frontMatter('---\ntags: a\n...\nbody'), '閉じは ... でもよい');
  assert.ok(core.frontMatter('---\r\ntags: [a]\r\n---\r\nbody'), 'CRLF でも読む');
  assert.ok(core.frontMatter('---\n# コメント\n\ntags:\n  - a\n- b\n---'), 'コメント・空行・字下げ・- の行');
  // 区切り線で始まる今までのメモは、フロントマターとみなさない
  for (const t2 of ['---\nただの段落\n---\n', '---\n\n---\n', '---\n---\n', 'a\n---\ntags: a\n---', ' ---\ntags: a\n---', '---\nNote to self: x\n---', '---\ntags: a\n', '---\n  - a\n---'])
    assert.strictEqual(core.frontMatter(t2), null, JSON.stringify(t2));
  // 200行を超えて閉じが無いものも、みなさない
  assert.strictEqual(core.frontMatter('---\n' + 'k: v\n'.repeat(250) + '---\n'), null);
});

test('フロントマター: tags の書き方([a, b]・a, b・- の並び)と、引用符・# ・コメント', () => {
  assert.deepStrictEqual(tagsAt('---\ntags: [YAML, "a b", #設計]\n---\n'), [['YAML', 'YAML'], ['a b', 'a b'], ['設計', '設計']]);
  assert.deepStrictEqual(tagsAt('---\ntags: a, #b # コメント\n---\n'), [['a', 'a'], ['b', 'b']]);
  assert.deepStrictEqual(tagsAt('---\ntags: #a\n---\n'), [['a', 'a']]);
  assert.deepStrictEqual(tagsAt("---\ntags: ['x, y', z]\n---\n"), [['x, y', 'x, y'], ['z', 'z']], '引用符の中のコンマでは分けない');
  assert.deepStrictEqual(tagsAt('---\ntags:\n  - 仕事/会議\n  - "YAML" # c\n  - \n---\n'), [['仕事/会議', '仕事/会議'], ['YAML', 'YAML']]);
  assert.deepStrictEqual(tagsAt('---\ntags:\n- a\n- b\ntitle: t\n---'), [['a', 'a'], ['b', 'b']]);
  assert.deepStrictEqual(tagsAt('---\nTags: A, a, Ａ\n---\n'), [['A', 'A']], '大文字・小文字、全角・半角の違いだけのものは1つ');
  assert.deepStrictEqual(tagsAt('---\ntitle: t\n---\n'), []);
  assert.deepStrictEqual(core.tagsOf('---\ntags: [a, b]\n---\n'), ['a', 'b']);
  assert.deepStrictEqual(core.tagsOf('tags: a'), [], 'フロントマターの外は読まない');
  assert.deepStrictEqual(core.tagsOf('---\ntags: ' + 'x'.repeat(101) + ', y\n---'), ['y'], '長すぎるタグは使わない');
  assert.strictEqual(core.tagsOf('---\ntags: [' + Array.from({ length: 60 }, (_, i) => 't' + i).join(', ') + ']\n---').length, 50);
});

test('フロントマター: 題名はフロントマターの後ろから取る', () => {
  assert.strictEqual(core.titleOf('---\ntags: [a]\n---\n# 本当の題名\n本文'), '本当の題名');
  assert.strictEqual(core.titleOf('---\ntags: [a]\n---\n'), '');
  assert.strictEqual(core.titleOf('---\n\n---\n区切り線のあとの文'), '区切り線のあとの文', 'フロントマターでなければ今までどおり');
});

test('フロントマター: プレビュー(fm: true)ではキーと値の並び、印刷・書き出しでは出さない。行の範囲はずれない', () => {
  const t = '---\ntags: [YAML, <b>]\nauthor: 山田\nlist:\n  - p\n  - q\n---\n# 見出し\n本文[^1]\n\n[^1]: 注';
  const pv = core.md(t, { lines: true, fm: true });
  assert.match(pv, /^<div class="fm" data-line="0" data-end="7">/);
  assert.match(pv, /<div class="fm-row fm-tags"><span class="fm-k">tags<\/span><span class="fm-v"><button type="button" class="tag tag-link" data-tag="YAML">YAML<\/button><button type="button" class="tag tag-link" data-tag="&lt;b&gt;">&lt;b&gt;<\/button><\/span><\/div>/);
  assert.match(pv, /<span class="fm-k">author<\/span><span class="fm-v">山田<\/span>/);
  assert.match(pv, /<span class="fm-k">list<\/span><span class="fm-v">p, q<\/span>/);
  assert.match(pv, /<h1 data-line="7" data-end="8">見出し<\/h1>/);
  assert.match(pv, /<section class="footnotes"/, '脚注はそのまま');
  const out = core.md(t);
  assert.ok(!/class="fm"|tags|---|<hr>/.test(out), out);
  assert.match(out, /^<h1>見出し<\/h1>/);
  // 行の範囲だけを使うもの(表・数式の位置)は、フロントマターを出さなくても同じ行で数える
  assert.match(core.md(t, { lines: true }), /^<h1 data-line="7"/);
  // フロントマターでない --- は、今までどおり区切り線
  assert.match(core.md('---\nただの段落\n---'), /^<hr>/);
});

test('タグの検索: tag:名前 を検索語から分け、大文字・小文字と全角・半角は区別しない。下の階層にも当たる', () => {
  const pq = (text, tags, pre, any) => ({ text: text, tags: tags, pre: pre || '', any: !!any });
  assert.deepStrictEqual(core.parseQuery('tag:YAML'), pq('', ['yaml']));
  assert.deepStrictEqual(core.parseQuery('設計  tag:YAML 書き方'), pq('設計 書き方', ['yaml']));
  assert.deepStrictEqual(core.parseQuery('tag:"a b" TAG：ＹＡＭＬ tag:#yaml'), pq('', ['a b', 'yaml']));
  assert.deepStrictEqual(core.parseQuery('tag: 文字'), pq('文字', [], '', true), 'tag: の後ろが空なら、タグを持つメモ');
  assert.deepStrictEqual(core.parseQuery('tag:'), pq('', [], '', true));
  assert.deepStrictEqual(core.parseQuery('tag:""'), pq('', [], '', true));
  assert.deepStrictEqual(core.parseQuery('a  b'), pq('a  b', []), 'タグが無ければ検索語はそのまま');
  assert.deepStrictEqual(core.parseQuery(' a '), pq('a', []));
  assert.deepStrictEqual(core.parseQuery('mytag:x'), pq('mytag:x', []));
  assert.deepStrictEqual(core.parseQuery('tag:a"b'), pq('tag:a"b', []));
});

test('タグの検索: 打っている途中(欄の最後で、後ろに空白が無い)の tag:名前 は、その文字で始まるタグを探す', () => {
  const P = q => core.parseQuery(q, true);
  assert.deepStrictEqual(P('tag:s'), { text: '', tags: [], pre: 's', any: false });
  assert.deepStrictEqual(P('tag:s '), { text: '', tags: ['s'], pre: '', any: false }, '空白を打ったら、名前が同じタグ');
  assert.deepStrictEqual(P('tag:"a b'), { text: '', tags: [], pre: 'a b', any: false }, '引用符を閉じる前');
  assert.deepStrictEqual(P('tag:"a b"'), { text: '', tags: ['a b'], pre: '', any: false }, '引用符を閉じたら、名前が同じタグ');
  assert.deepStrictEqual(P('tag:x 会議 tag:ＳＴ'), { text: '会議', tags: ['x'], pre: 'st', any: false }, '最後のものだけ');
  assert.deepStrictEqual(P('tag:'), { text: '', tags: [], pre: '', any: true });
  assert.deepStrictEqual(P('tag:仕事 tag:仕事/'), { text: '', tags: ['仕事'], pre: '', any: false }, 'もう同じタグで絞っていれば、足さない');
  assert.deepStrictEqual(P('tag'), { text: 'tag', tags: [], pre: '', any: false });
  // メモのタグとの照らし合わせ
  const F = (names, q) => core.tagFilter(names, P(q));
  assert.ok(F(['star'], 'tag:s') && F(['star'], 'tag:sta') && F(['star'], 'tag:star') && F(['Star/x'], 'tag:st'));
  assert.ok(!F(['star'], 'tag:t') && !F(['star'], 'tag:stars'));
  assert.ok(F(['star'], 'tag:') && !F([], 'tag:') && !F(undefined, 'tag:'));
  assert.ok(F(['star'], 'tag:star ') && !F(['starfish'], 'tag:star '), '空白の後は、名前が同じタグ');
  assert.ok(F(['starfish'], 'tag:star'), '打っている途中は、その文字で始まるタグ');
  assert.ok(F(['a', 'star'], 'tag:a tag:s') && !F(['a'], 'tag:a tag:s'));
  assert.ok(core.hasTagQuery(P('tag:')) && core.hasTagQuery(P('tag:s')) && core.hasTagQuery(P('tag:s ')) && !core.hasTagQuery(P('s')));
  // 打っている途中の tag:
  assert.deepStrictEqual(core.tagTypingAt('tag:'), { from: 0, pre: '' });
  assert.deepStrictEqual(core.tagTypingAt('会議 TAG：#St'), { from: 3, pre: 'st' });
  assert.deepStrictEqual(core.tagTypingAt('a tag:"b c'), { from: 2, pre: 'b c' });
  assert.strictEqual(core.tagTypingAt('tag:s '), null);
  assert.strictEqual(core.tagTypingAt('mytag:s'), null);
  assert.strictEqual(core.tagTypingAt('tag:"b"'), null);
});

test('タグの候補: その文字で始まるタグを、名前が同じもの・メモの数の多い順に。もう絞っているタグは出さない', () => {
  const notes = [{ tags: ['star', 'Sun'] }, { tags: ['STAR', '#star'] }, { tags: ['sun', 'stone'] }, { tags: ['sun'] }, {}, { tags: ['仕事/会議'] }];
  assert.deepStrictEqual(core.tagSuggest(notes, 's'), [{ name: 'Sun', n: 3 }, { name: 'star', n: 2 }, { name: 'stone', n: 1 }]);
  assert.deepStrictEqual(core.tagSuggest(notes, 'st'), [{ name: 'star', n: 2 }, { name: 'stone', n: 1 }]);
  assert.deepStrictEqual(core.tagSuggest(notes, 'stone'), [{ name: 'stone', n: 1 }]);
  assert.deepStrictEqual(core.tagSuggest(notes, 's', ['sun']), [{ name: 'star', n: 2 }, { name: 'stone', n: 1 }]);
  assert.deepStrictEqual(core.tagSuggest([{ tags: ['sun'] }, { tags: ['sun'] }, { tags: ['s'] }], 's'), [{ name: 's', n: 1 }, { name: 'sun', n: 2 }], '名前が同じものを先に');
  assert.strictEqual(core.tagSuggest(notes, '').length, 4);
  assert.strictEqual(core.tagSuggest(notes, '', null, 2).length, 2);
  assert.deepStrictEqual(core.tagSuggest(notes, '仕事'), [{ name: '仕事/会議', n: 1 }]);
  assert.strictEqual(core.tagToken('a b'), 'tag:"a b"');
  assert.strictEqual(core.tagToken('仕事/会議'), 'tag:仕事/会議');
});

test('メモの検索: フロントマターのキーの名前と --- の行には当てない。値には当てる', () => {
  const t = '---\ntags: [star, tagged]\ntitle: 題名\n---\n本文の tag と ---';
  assert.deepStrictEqual(core.fmKeySpans(t).map(r => t.slice(r.s, r.e)), ['---', 'tags:', 'title:', '---']);
  const at = q => core.searchRanges(t, q).map(r => r.s);
  assert.deepStrictEqual(at('tag'), [t.indexOf('tagged'), t.indexOf('tag と')], '「tags:」のキーには当てない');
  assert.deepStrictEqual(at('title'), []);
  assert.deepStrictEqual(at('---'), [t.lastIndexOf('---')], '本文の --- には当てる');
  assert.deepStrictEqual(at('tags: [s'), [t.indexOf('tags:')], 'キーと値にまたがるものには当てる');
  assert.deepStrictEqual(at('題名'), [t.indexOf('題名')]);
  assert.deepStrictEqual(core.fmKeySpans('tags: a\n本文'), [], 'フロントマターでなければ、どこにでも当てる');
  assert.deepStrictEqual(core.fmKeySpans('---\nただの段落\n---'), []);
  // 最新の版の検索
  const r = core.searchLatest([{ id: 'a', text: t }, { id: 'b', text: '---\ntags: [x]\n---\n' }], 'tag');
  assert.deepStrictEqual(r.res.map(x => [x.id, x.n]), [['a', 2]]);
  // 履歴すべての検索: 最後の版でキーの名前の中にあるものは出さない
  const typed = s => { const ops = []; for (let i = 0; i < s.length; i++) ops.push({ p: i, d: '', i: s[i], t: i + 1 }); return { id: 'h', ops: ops }; };
  const h = core.searchHistory([typed('---\ntags: [a]\n---\nmy tag')], 'tag', 10);
  assert.deepStrictEqual(h.res.map(x => x.s), ['---\ntags: [a]\n---\nmy '.length]);
  // 消したあとの箇所も、消す直前の版で決める
  const n2 = typed('---\ntags: [a]\n---\nmy tag');
  n2.ops.push({ p: 0, d: '---\ntags: [a]\n---\nmy tag', i: '', t: 99 });
  assert.deepStrictEqual(core.searchHistory([n2], 'tag', 10).res.map(x => x.removedAt), [99]);
  assert.ok(core.hasTags(['YAML', '仕事/会議'], ['yaml']));
  assert.ok(core.hasTags(['YAML', '仕事/会議'], ['仕事']));
  assert.ok(core.hasTags(['YAML', '仕事/会議'], ['yaml', '仕事/会議']));
  assert.ok(!core.hasTags(['YAML'], ['yaml', '仕事']), 'すべてのタグを持つメモだけ');
  assert.ok(!core.hasTags(['仕事会議'], ['仕事']));
  assert.ok(!core.hasTags(undefined, ['a']));
});

test('フロントマターの挿入: いつもメモの先頭。もうあれば2つ目を入れず、tags の値の終わりにカーソル', () => {
  let r = core.frontMatterInsert('本文');
  assert.strictEqual(caret(r.text, r.caret), '---\ntags: |\n---\n\n本文');
  r = core.frontMatterInsert('');
  assert.strictEqual(caret(r.text, r.caret), '---\ntags: |\n---\n');
  r = core.frontMatterInsert('\n本文');
  assert.strictEqual(caret(r.text, r.caret), '---\ntags: |\n---\n\n本文', '空行で始まるメモには空行を足さない');
  r = core.frontMatterInsert('---\ntitle: a\n---\nb');
  assert.strictEqual(caret(r.text, r.caret), '---\ntitle: a\ntags: |\n---\nb', 'tags が無ければ閉じの前に足す');
  for (const [t, want] of [
    ['---\ntags: [a, b]\n---\n', '---\ntags: [a, b|]\n---\n'],
    ['---\ntags: a, b # c\n---\n', '---\ntags: a, b| # c\n---\n'],
    ['---\ntags:\n  - a\n---\n', '---\ntags:\n  - a|\n---\n'],
    ['---\ntags:\n---\n', '---\ntags:|\n---\n']
  ]) { r = core.frontMatterInsert(t); assert.strictEqual(r.text, t); assert.strictEqual(caret(r.text, r.caret), want); }
  // 入れたものは、フロントマターとして読める
  assert.ok(core.frontMatter(core.frontMatterInsert('# x').text));
});

test('索引: タグを持ち、一覧に渡す(本文を読まずにタグで探せる)。索引の版は 6(6 で title を題名にした)', () => {
  assert.match(read('store.js'), /const INDEX_VERSION = 6;/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-')); const s = new Store(dir); s.init();
  const id = '20260101-000001-aaaa', id2 = '20260101-000002-bbbb';
  s.create(id, 1); s.create(id2, 2);
  const text = '---\ntags: [YAML, 設計]\n---\n# 題名';
  s.append(id, [[0, '', text, 10]]);
  let m = s.listMeta();
  assert.deepStrictEqual(m.find(x => x.id === id).tags, ['YAML', '設計']);
  assert.strictEqual(m.find(x => x.id === id).title, '題名');
  assert.deepStrictEqual(m.find(x => x.id === id2).tags, []);
  // 保存した本文に合わせて変わる
  s.saveText(id, '---\ntags: [ほか]\n---\n');
  assert.deepStrictEqual(s.listMeta().find(x => x.id === id).tags, ['ほか']);
  s.saveText(id, 'なし');
  s.writeIndex();
  const idx = JSON.parse(fs.readFileSync(path.join(dir, '.everpad-index.json'), 'utf8'));
  assert.strictEqual(idx.v, 6);
  assert.ok(!('tags' in idx.notes[id]), 'タグの無いメモには項目を作らない');
  // 前の版(5)の索引は作り直す(title を題名にしたため)
  idx.v = 5; fs.writeFileSync(path.join(dir, '.everpad-index.json'), JSON.stringify(idx));
  const s2 = new Store(dir); s2.init(); s2.listMeta();
  assert.strictEqual(s2.scans, 2);
});

test('画面: メニュー・検索・プレビュー・文言がつながっている', () => {
  const main = read('main.js'), app = read('renderer/app.js'), css = read('renderer/styles.css');
  assert.match(main, /\{ label: T\('mInsertFm'\), accelerator: A\('frontmatter'\), enabled: !ui\.hist && !ui\.ro, click: \(\) => send\('frontmatter'\) \}/);
  assert.match(app, /else if \(name === 'frontmatter'\) frontMatterCommand\(\);/);
  assert.match(app, /const r = frontMatterInsert\(before\);|r = frontMatterInsert\(before\)/);
  // 検索: タグで絞り、タグだけなら索引のタグから(ファイルを読まない)
  assert.match(app, /const raw = \$\('q'\)\.value, q = raw\.trim\(\);/);
  assert.match(app, /const pq = parseQuery\(raw, true\);/);
  assert.match(app, /const tagged = hasTagQuery\(pq\);\n\s+const notes = tagged \? sorted\(\)\.filter\(n => tagFilter\(n\.tags, pq\)\) : sorted\(\);/);
  assert.match(app, /if \(tagged && !pq\.text\) \{ paintTagResults\(q, pq, notes\); refreshView\(\); return; \}/);
  assert.match(app, /searchHistory\(objs, pq\.text, 10\) : searchLatest\(objs, pq\.text\)/);
  // 履歴の変更箇所の表示の色付けも、フロントマターのキーの名前には付けない
  assert.match(app, /const ranges = S\.qText \? searchRanges\(text, S\.qText\) : \[\];/);
  // タグの候補: 検索欄の最後で tag: を打っている間だけ出す。選ぶと tag:名前 と空白を入れて探す
  assert.match(app, /q\.selectionStart === v\.length && q\.selectionEnd === v\.length \? tagTypingAt\(v\) : null;/);
  assert.match(app, /const items = at \? tagSuggest\(S\.notes, at\.pre, parseQuery\(v\.slice\(0, at\.from\)\)\.tags, 10\) : \[\];/);
  assert.match(app, /q\.value = q\.value\.slice\(0, at\.from\) \+ tagToken\(it\.name\) \+ ' ';/);
  assert.match(app, /\$\('q'\)\.addEventListener\('input', \(\) => \{ if \(!qComposing\) \{ tagPickUpdate\(\); scheduleSearch\(150\); \} \}\);/);
  assert.match(app, /\$\('q'\)\.addEventListener\('blur', tagPickClose\);/);
  assert.match(css, /\.tagpick \.tc \{/);
  for (const l of ['ja', 'en']) assert.ok(I18N.DICT[l].tagPick, l);
  assert.strictEqual(I18N.DICT.ja.tagCount({ n: 3 }), '3件');
  assert.strictEqual(I18N.DICT.en.tagCount({ n: 1 }), '1 note');
  assert.match(app, /tags: r\.tags \|\| \[\], ro: !!r\.ro, loaded: false/);
  assert.match(app, /n\.tags = tagsOf\(n\.text\);/);
  // 色付けと検索のバーには、タグを除いた検索語
  assert.ok(!/highlight\([a-z]+, S\.q\)|matchRanges\(text, S\.q\)|\$\('frFind'\)\.value = S\.q;/.test(app));
  // プレビューと履歴の Markdown 表示ではフロントマターを出す。印刷・書き出しでは出さない(題名・著者・日付だけを先頭に出す)
  assert.match(app, /pv\.innerHTML = md\(cur\(\)\.text, \{ lines: true, fm: true \}\)/);
  assert.match(app, /md\(text, \{ lines: true, fm: true \}\)/);
  assert.match(app, /const web = kind === 'html' \|\| kind === 'mhtml';\n\s+box\.innerHTML = \(web \? titleBlockHtml\(meta, T\('authorSep'\)\) : ''\) \+ md\(text\);/);
  assert.match(app, /area\.innerHTML = '<div class="md">' \+ titleBlockHtml\(meta, T\('authorSep'\)\) \+ md\(text\) \+ '<\/div>';/);
  assert.match(css, /\.md \.fm \{/);
  assert.match(css, /\.tag \{/);
  for (const l of ['ja', 'en']) for (const k of ['mInsertFm', 'tagMatches']) assert.ok(I18N.DICT[l][k], l + ' ' + k);
  assert.strictEqual(I18N.DICT.ja.tagMatches({ n: 3 }), '3件のメモ');
  assert.strictEqual(I18N.DICT.en.tagMatches({ n: 1 }), '1 note');
  assert.match(I18N.DICT.ja.hintLatest, /tag:名前/);
  assert.match(I18N.DICT.en.hintHistory, /tag:name/);
});

test('タグの札: プレビューで押すと検索欄を tag:名前 にし、Ctrl+クリック(Mac は ⌘+クリック)では今の検索に足す', () => {
  // 札はボタン(名前はエスケープして、data-tag に持つ)
  const pv = core.md('---\ntags: [YAML, "a b", <i>]\n---\n', { lines: true, fm: true });
  assert.match(pv, /<button type="button" class="tag tag-link" data-tag="YAML">YAML<\/button><button type="button" class="tag tag-link" data-tag="a b">a b<\/button><button type="button" class="tag tag-link" data-tag="&lt;i&gt;">&lt;i&gt;<\/button>/);
  const app = read('renderer/app.js'), css = read('renderer/styles.css');
  // プレビューと履歴の「Markdown表示」で押せる。ボタンなので、プレビューで押しても編集欄は開かない
  assert.match(app, /\$\('preview'\)\.addEventListener\('click', onTagClick, true\);/);
  assert.match(app, /\$\('hvBody'\)\.addEventListener\('click', onTagClick, true\);/);
  assert.match(app, /searchTag\(b\.dataset\.tag, IS_MAC \? e\.metaKey : e\.ctrlKey\);/);
  assert.match(app, /const PE_SKIP = '[^']*\bbutton\b/);
  assert.match(app, /root\.querySelectorAll\('\.fm \.tag-link'\)\.forEach\(b => \{ b\.title = T\('tagLinkTitle'\); \}\);/);
  assert.match(css, /\.tag-link \{[^}]*cursor: pointer;/);
  // searchTag を取り出して、検索欄の文字の変わり方を確かめる
  const src = app.match(/function searchTag\(name, add\) \{[\s\S]*?\n {2}\}/)[0];
  const q = { value: '' };
  let ran = 0;
  const searchTag = new Function('$', 'parseQuery', 'tagKey', 'tagToken', 'showSide', 'qTimer', 'runSearch', src + '; return searchTag;')(() => q, core.parseQuery, core.tagKey, core.tagToken, () => {}, null, () => { ran++; });
  // 後ろに空白を付ける(打っている途中の名前ではなく、名前が同じタグで探す)
  const run = (start, name, add) => { q.value = start; searchTag(name, add); return q.value; };
  assert.strictEqual(run('', 'YAML', false), 'tag:YAML ');
  assert.strictEqual(run('tag:設計 会議', 'YAML', false), 'tag:YAML ', '押すと置き換える');
  assert.strictEqual(run('tag:設計 会議', 'YAML', true), 'tag:設計 会議 tag:YAML ', 'Ctrl+クリックでは足す');
  assert.strictEqual(run('tag:yaml', 'YAML', true), 'tag:yaml ', '同じタグがもうあれば、そのまま');
  assert.strictEqual(run('tag:yaml ', 'YAML', true), 'tag:yaml ');
  assert.strictEqual(run('', 'a b', false), 'tag:"a b" ', '空白を含むタグは囲む');
  assert.strictEqual(run('', '仕事/会議', false), 'tag:仕事/会議 ');
  assert.deepStrictEqual(core.parseQuery(run('', 'a b', false), true).tags, ['a b'], '入れた文字で、そのタグが探せる');
  assert.deepStrictEqual(core.parseQuery(run('', 'star', false), true), { text: '', tags: ['star'], pre: '', any: false }, '名前が同じタグで');
  assert.strictEqual(ran, 9);
  // 説明: Mac では ⌘+クリック
  for (const l of ['ja', 'en']) assert.match(I18N.DICT[l].tagLinkTitle, /Ctrl\+(クリック|click)/);
  assert.match(core.macKeys(I18N.DICT.ja.tagLinkTitle), /⌘\+クリック/);
  assert.match(core.macKeys(I18N.DICT.en.tagLinkTitle), /⌘\+click/);
});

test('文言: 設定の窓の「その他」', () => {
  assert.strictEqual(I18N.DICT.ja.setOther, 'その他');
  assert.ok(read('build/installer.nsh').includes("「ファイル」→「設定…」(「その他」)"));
  for (const f of ['renderer/i18n.js', 'build/installer.nsh', 'main.js']) assert.ok(!/「そのほか」/.test(read(f)), f);
});

test('右クリック: 本文とプレビューの編集欄に「フロントマター(タグ)を挿入」(もうあれば「…を編集」)。表のセルには出さない', () => {
  const { buildTemplate } = require('../contextmenu');
  const keymap = require('../keymap');
  const labels = t => t.map(x => (x.type === 'separator' ? '-' : x.label));
  const area = { isEditable: true, formControlType: 'text-area', editFlags: {} };
  const on = () => {};
  let t = buildTemplate(area, { lang: 'ja', onFormat: on, onMath: on, onDiagram: on, onFrontMatter: on, hasFm: false });
  let l = labels(t);
  assert.deepStrictEqual(l.slice(l.indexOf('数式を挿入…'), l.indexOf('数式を挿入…') + 3), ['数式を挿入…', '図を挿入…', 'フロントマター(タグ)を挿入'], '数式・図の次');
  t = buildTemplate(area, { lang: 'en', onFormat: on, onMath: on, onDiagram: on, onFrontMatter: on, hasFm: true });
  assert.ok(labels(t).includes('Edit Front Matter (Tags)'));
  // 割り当てたキーを出す(既定はキーなし)
  assert.strictEqual(keymap.defaults('win32').frontmatter, '');
  t = buildTemplate(area, { lang: 'ja', onFormat: on, onMath: on, onDiagram: on, onFrontMatter: on, keys: { frontmatter: 'CmdOrCtrl+Alt+F' } });
  assert.strictEqual(t.find(x => x.label === 'フロントマター(タグ)を挿入').accelerator, 'CmdOrCtrl+Alt+F');
  // 画面側が知らせなかったとき(読み取り専用・数式エディタなどの入力欄)と、表のセル(1行の入力欄)には出さない
  assert.ok(!labels(buildTemplate(area, { lang: 'ja', onFormat: on })).some(x => /フロントマター/.test(x)));
  assert.ok(!labels(buildTemplate({ isEditable: true, formControlType: 'input-text', editFlags: {} }, { lang: 'ja', onFormat: on, onMath: on, cell: true, onFrontMatter: on })).some(x => /フロントマター/.test(x)));
  // 数式・図が無いときは、区切り線のあとに出す
  l = labels(buildTemplate(area, { lang: 'ja', onFormat: on, onFrontMatter: on }));
  assert.strictEqual(l[l.indexOf('フロントマター(タグ)を挿入') - 1], '-');
  // キーボードショートカットの一覧(「編集」)に入っている
  assert.ok(keymap.COMMANDS.some(c => c.id === 'frontmatter' && c.group === 'mEdit' && c.label === 'mInsertFm'));
  // 画面側: 右クリックの前に、フロントマターがあるかを知らせる。プレビューの表の外のメニューで選ぶと frontMatterCommand
  const app = read('renderer/app.js'), main = read('main.js');
  assert.match(app, /fm = !!frontMatter\(ed\.value\);/);
  assert.match(app, /fm = !!frontMatter\(cur\(\)\.text\);/);
  assert.match(app, /api\.tableMenu\(\{ inTable: false, fm: !!frontMatter\(cur\(\)\.text\) \}\)/);
  assert.match(app, /if \(action === 'frontmatter'\) \{ frontMatterCommand\(\); return; \}/);
  assert.match(main, /fm: !!st\.fm, t: Date\.now\(\)/);
  assert.match(main, /onFrontMatter: ctx \? \(\) => send\('frontmatter'\) : null, onPastePlain: ctx \? \(\) => send\('pastePlain'\) : null, hasFm: !!\(ctx && ctx\.fm\)/);
});
