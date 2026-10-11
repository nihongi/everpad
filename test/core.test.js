'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/core');

/* 文字列の変化を順に並べて、1回ずつの編集にしたメモを作る */
function typed(steps) {
  const ops = [];
  let cur = '', t = 1000;
  for (const nx of steps) { ops.push(L.makeOp(cur, nx, (t += 1000))); cur = nx; }
  return { id: 'n', ops, text: cur };
}

test('どの版でも、最初から順に適用した結果と一致する(絵文字を含む乱数編集)', () => {
  const chars = ['あ', 'い', 'a', '\n', '😀', '🎉', ' '];
  let text = '';
  const n = { ops: [] };
  for (let i = 0; i < 1500; i++) {
    let b = text;
    const r = Math.random(), p = Math.floor(Math.random() * (b.length + 1));
    const c = [...Array(1 + Math.floor(Math.random() * 3))].map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    if (r < 0.55) b = b.slice(0, p) + c + b.slice(p);
    else if (r < 0.85) b = b.slice(0, p) + b.slice(p + 2);
    else b = b.slice(0, p) + c + b.slice(p + 3);
    if (b === text) continue;
    const op = L.makeOp(text, b, i);
    assert.strictEqual(L.applyOp(text, op), b);
    n.ops.push(op);
    text = b;
  }
  assert.strictEqual(L.textAt(n, n.ops.length), text);
  for (const k of [0, 1, 99, 100, 101, 250, 777, n.ops.length]) {
    let x = '';
    for (let j = 0; j < k; j++) x = L.applyOp(x, n.ops[j]);
    assert.strictEqual(L.textAt(n, k), x, 'rev ' + k);
  }
});

test('Markdown: 見出し・リスト・チェックリスト・引用・コード・リンク', () => {
  const out = L.md('# 見出し\n\n**太字** *斜体* `code`\n\n- [x] 完了\n  - 入れ子\n- [ ] 未完\n\n1. 一\n2. 二\n\n> 引用\n\n```\n<i>raw</i>\n```\n\n[ok](https://a.example/?q=1&r="x")\n\n---');
  for (const s of ['<h1>見出し</h1>', '<strong>太字</strong>', '<em>斜体</em>', '<code>code</code>', '<input type="checkbox" disabled checked>', '<ul><li>入れ子</li></ul>', '<ol><li>一</li><li>二</li></ol>', '<blockquote>', '<pre><code>&lt;i&gt;raw&lt;/i&gt;</code></pre>', 'rel="noopener noreferrer"', '<hr>']) {
    assert(out.includes(s), s);
  }
});

test('Markdown: 危険な入力は実行できる形にならない', () => {
  const out = L.md('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](https://a.example/" onmouseover="x)\n\n| <b>a</b> | [z](javascript:1) |\n|---|---|\n| <script>1</script> | `<b>` |');
  assert(!/<script|<img|<b>/i.test(out), out);
  assert(!/href="javascript/i.test(out), out);
  assert(!/" onmouseover=/.test(out), out);
});

test('Markdown: 表(配置・欠けたセル・\\|・表のあとの段落)', () => {
  const t = L.md('| 品目 | 数量 | 備考 |\n|:---|---:|:---:|\n| 牛乳 | 2 | **要冷蔵** |\n| 卵 | 10 | a \\| b |\n| 食パン | 1 |\n\n表のあとの段落');
  assert(t.includes('<th class="al-l">品目</th>') && t.includes('<th class="al-r">数量</th>') && t.includes('<th class="al-c">備考</th>'));
  assert(t.includes('<td class="al-c"><strong>要冷蔵</strong></td>'));
  assert(t.includes('a | b'));
  assert(t.includes('<td class="al-c"></td>'));
  assert(t.includes('<p>表のあとの段落</p>'));
  assert(L.md('a | b\n--- | ---\n1 | 2').includes('<td class="al-l">2</td>'));
  assert(!L.md('a | b\nただの文章').includes('<table'));
  assert(!L.md('a | b | c\n--|--').includes('<table'));
});

test('検索(最新の版): 大文字小文字を区別せず、記号は普通の文字として探す', () => {
  const n = typed(['# メモ\n', '# メモ\nMarkdown と [ ] と foo.bar']);
  assert.strictEqual(L.searchLatest([n], 'markdown', 10).total, 1);
  assert.strictEqual(L.searchLatest([n], '[ ]', 10).total, 1);
  assert.strictEqual(L.searchLatest([n], 'foo.bar', 10).total, 1);
  assert.strictEqual(L.searchLatest([n], 'fooXbar', 10).total, 0);
  assert.strictEqual(L.searchLatest([n], '.*', 10).total, 0);
});

test('検索(履歴すべて): 同時に2か所あれば2件、片方を消せばそちらだけ「消えた」', () => {
  let n = typed(['foo', 'foo ', 'foo b', 'foo bar', 'foo bar ', 'foo bar f', 'foo bar fo', 'foo bar foo']);
  assert.strictEqual(L.searchLatest([n], 'foo', 10).total, 2);
  let h = L.searchHistory([n], 'foo', 10);
  assert.strictEqual(h.total, 2);
  assert(h.res.every(x => x.b === n.ops.length));
  n = typed(['foo bar foo', 'bar foo']);
  h = L.searchHistory([n], 'foo', 10);
  assert.strictEqual(h.total, 2);
  assert.strictEqual(h.res.filter(x => x.b === 2).length, 1);
  assert.strictEqual(h.res.filter(x => x.b === 1).length, 1);
});

test('検索(履歴すべて): 検索語の途中を編集すると壊れ、手前を編集すると位置がずれるだけ', () => {
  let h = L.searchHistory([typed(['xxfoo', 'xxfXoo'])], 'foo', 10);
  assert.strictEqual(h.total, 1);
  assert.strictEqual(h.res[0].b, 1);
  h = L.searchHistory([typed(['xxfoo', 'Zxxfoo'])], 'foo', 10);
  assert.strictEqual(h.total, 1);
  assert.strictEqual(h.res[0].b, 2);
});

test('検索(履歴すべて): 全版で、追跡した箇所がその版の全文検索と一致する(乱数編集)', () => {
  const alpha = ['a', 'b', 'a', 'b', 'x', '\n', 'あ'];
  for (let round = 0; round < 25; round++) {
    const ops = [];
    let text = '';
    for (let i = 0; i < 300; i++) {
      let b = text;
      const p = Math.floor(Math.random() * (b.length + 1)), r = Math.random();
      const c = [...Array(1 + Math.floor(Math.random() * 3))].map(() => alpha[Math.floor(Math.random() * alpha.length)]).join('');
      if (r < 0.5) b = b.slice(0, p) + c + b.slice(p); else if (r < 0.8) b = b.slice(0, p) + b.slice(p + 2); else b = b.slice(0, p) + c + b.slice(p + 3);
      if (b === text) continue;
      ops.push(L.makeOp(text, b, i));
      text = b;
    }
    const nt = { id: 'z', ops, text };
    for (const q of ['ab', 'AB', 'xあ']) {
      L.searchHistory([nt], q, 5, (k, tx, alive) => {
        const want = L.matchRanges(tx, q).map(m => m.s + ':' + m.e).sort().join(',');
        const got = alive.map(m => m.s + ':' + m.e).sort().join(',');
        assert.strictEqual(got, want, 'q=' + q + ' rev ' + k);
      });
      const full = L.searchHistory([nt], q, 1e9);
      assert.strictEqual(full.res.filter(x => x.b === ops.length).length, L.searchLatest([nt], q, 1e9).total);
    }
  }
});

test('検索(履歴すべて): 2万版でも1秒以内', () => {
  const big = { id: 'b', ops: [], text: '' };
  let tx = '';
  for (let i = 0; i < 20000; i++) {
    const nx = tx + 'あいう' + (i % 50 === 0 ? 'KEY' : '');
    big.ops.push({ p: tx.length, d: '', i: nx.slice(tx.length), t: i });
    tx = nx;
  }
  big.text = tx;
  const t0 = Date.now();
  const r = L.searchHistory([big], 'KEY', 10);
  assert.strictEqual(r.total, 400);
  assert(Date.now() - t0 < 1000, '時間: ' + (Date.now() - t0) + 'ms');
});

test('ハイライト: 追加部分と元の文字にまたがる検索語も途切れずに囲む', () => {
  const ranges = L.matchRanges('あいうえお', 'いうえ');
  const html = L.markPieces('あい', 0, ranges) + '<ins>' + L.markPieces('うえ', 2, ranges) + '</ins>' + L.markPieces('お', 4, ranges);
  assert.strictEqual(html, 'あ<mark>い</mark><ins><mark>うえ</mark></ins>お');
});

test('diffLines: 行数は本文と同じで、タグと文字参照を戻すと「前+削除+追加+後」になる', () => {
  const alpha = ['a', 'b', '\n', '<', '&', 'あ', ' '];
  const unesc = h => h.replace(/<ins class="nl">↵<\/ins>/g, '').replace(/<\/?(ins|del|mark)>/g, '').replace(/↵(?=\n)/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  let text = '';
  for (let i = 0; i < 600; i++) {
    let b = text;
    const p = Math.floor(Math.random() * (b.length + 1)), r = Math.random();
    const c = [...Array(1 + Math.floor(Math.random() * 4))].map(() => alpha[Math.floor(Math.random() * alpha.length)]).join('');
    if (r < 0.5) b = b.slice(0, p) + c + b.slice(p); else if (r < 0.8) b = b.slice(0, p) + b.slice(p + 3); else b = b.slice(0, p) + c + b.slice(p + 2);
    if (b === text) continue;
    const op = L.makeOp(text, b, i);
    const ranges = L.matchRanges(b, 'ab');
    const lines = L.diffLines(b, op, ranges);
    assert.strictEqual(lines.length, b.split('\n').length, '行数 ' + JSON.stringify(b));
    assert.strictEqual(unesc(lines.join('\n')), b.slice(0, op.p) + op.d + op.i + b.slice(op.p + op.i.length), JSON.stringify([text, b]));
    assert(lines.every(l => !l.includes('\n') || /<del>[^<]*\n[^<]*<\/del>/.test(l)), '改行が残るのは削除部分の中だけ');
    text = b;
  }
});

test('diffLines: 追加した複数行・検索語・削除した改行の表示', () => {
  const before = 'a\nb', after = 'a\nX\nY\nb';
  const op = L.makeOp(before, after, 1);
  assert.deepStrictEqual(L.diffLines(after, op, []), ['a', '<ins>X</ins><ins class="nl">↵</ins>', '<ins>Y</ins><ins class="nl">↵</ins>', 'b']);
  // 改行だけを足した版でも、強調が1つ出る
  const nl = L.diffLines('a\n', L.makeOp('a', 'a\n', 1), []);
  assert.deepStrictEqual(nl, ['a<ins class="nl">↵</ins>', '']);
  // 行をまたいで消した版: 本文は2行、削除した文字列(改行を含む)は残った行の中に表示する
  const op2 = L.makeOp('a\nb\nc', 'a\nc', 2);
  const l2 = L.diffLines('a\nc', op2, []);
  assert.strictEqual(l2.length, 2);
  assert(l2[1].includes('<del>') && l2[1].includes('↵'));
  // 検索語の強調が追加部分と元の文字にまたがっても途切れない
  const t = 'あいうえお', o = L.makeOp('あいお', t, 1);
  assert.deepStrictEqual(L.diffLines(t, o, L.matchRanges(t, 'いうえ')), ['あ<mark>い</mark><ins><mark>うえ</mark></ins>お']);
});

test('Markdown: リストの中の字下げしたコードブロックと、空行をはさんだ番号の続き', () => {
  const out = L.md('1. 一つ目\n\n2. 二つ目\n\n   ```\n   npm install\n   a <b>\n   ```\n\n3. 三つ目\n\n   ```\n   npm start\n   ```\n\n通常の段落');
  assert.strictEqual((out.match(/<ol>/g) || []).length, 1, '番号が1つのリストにまとまる');
  assert(out.includes('<pre><code>npm install\na &lt;b&gt;</code></pre>'), out);
  assert(out.includes('<pre><code>npm start</code></pre>'));
  assert(!out.includes('```'));
  assert(out.includes('<p>通常の段落</p>'));
  assert(L.md('  ```\n  x\n  ```').includes('<pre><code>x</code></pre>'));
});

test('置換: 通常の文字列は記号もそのまま探し、大文字小文字・単語単位を切り替えられる', () => {
  const t = 'Foo foo FOO food a.b axb';
  assert.strictEqual(L.findAll(t, L.buildRe('foo', {})).length, 4);
  assert.strictEqual(L.findAll(t, L.buildRe('foo', { cs: true })).length, 2);
  assert.strictEqual(L.findAll(t, L.buildRe('foo', { word: true })).length, 3);
  assert.strictEqual(L.findAll(t, L.buildRe('a.b', {})).length, 1);
  assert.strictEqual(L.findAll(t, L.buildRe('a.b', { re: true })).length, 2);
  assert.strictEqual(L.buildRe('', {}), null);
  assert(L.buildRe('(', { re: true }).error);
  assert.strictEqual(L.findAll('abc', L.buildRe('x*', { re: true })).length, 0, '長さ0の一致は数えない');
});
test('置換: すべて置換(通常・正規表現の $1 / \\n / \\t / $$)と範囲', () => {
  let r = L.replaceAllText('a-b a-b', L.buildRe('-', {}), '$1\\n', false);
  assert.strictEqual(r.text, 'a$1\\nb a$1\\nb', '通常は記号もそのまま');
  r = L.replaceAllText('2024-10-07 と 2025-01-02', L.buildRe('(\\d+)-(\\d+)-(\\d+)', { re: true }), '$3/$2/$1', true);
  assert.strictEqual(r.text, '07/10/2024 と 02/01/2025');
  assert.strictEqual(r.count, 2);
  r = L.replaceAllText('a,b', L.buildRe(',', { re: true }), '\\n\\t$$', true);
  assert.strictEqual(r.text, 'a\n\t$b');
  r = L.replaceAllText('行1\n行2\n', L.buildRe('^行', { re: true }), '- ', true);
  assert.strictEqual(r.text, '- 1\n- 2\n', '^ は各行の先頭');
  r = L.replaceAllText('xaxbx', L.buildRe('x', {}), '', false);
  assert.deepStrictEqual([r.text, r.count, r.first, r.last], ['ab', 3, 0, 5]);
  assert.strictEqual(L.replaceAllText('abc', L.buildRe('z', {}), 'y', false).count, 0);
  // 変わった範囲だけを入れ替えても、全体を置換した結果と一致する
  const t = 'ああ foo いい foo うう', rr = L.replaceAllText(t, L.buildRe('foo', {}), 'BAR', false);
  assert.strictEqual(t.slice(0, rr.first) + rr.text.slice(rr.first, rr.text.length - (t.length - rr.last)) + t.slice(rr.last), rr.text);
});
test('置換: 次へ・前へは端で反対側に回り込む', () => {
  const re = L.buildRe('a', {}), t = 'a_a_a';
  assert.strictEqual(L.findFrom(t, re, 1, 1).s, 2);
  const w = L.findFrom(t, re, 5, 1);
  assert(w.wrapped && w.s === 0);
  assert.strictEqual(L.findFrom(t, re, 2, -1).s, 0);
  const w2 = L.findFrom(t, re, 0, -1);
  assert(w2.wrapped && w2.s === 4);
  assert.strictEqual(L.findFrom('xyz', re, 0, 1), null);
});

test('添付: 画像とファイルの記法が、表の中でも正しくHTMLになり、危険な入力は効かない', () => {
  const id = '0123456789abcdef', idp = 'fedcba9876543210.pdf';
  const out = L.md('| 図 | 資料 |\n|---|---|\n| ![図 *1*](attach:' + id + ') | [仕様書.pdf](attach:' + idp + ') と **太字** |');
  assert(out.includes('<td class="al-l"><img class="att-img" data-att="' + id + '" alt="図 *1*" loading="lazy"></td>'), out);
  assert(out.includes('<a class="att-file" href="#" data-att="' + idp + '" title="仕様書.pdf">仕様書.pdf</a> と <strong>太字</strong>'), out);
  assert(!out.includes('<em>'), '名前の中の * は書式にならない');
  const bad = L.md('![x" onerror="alert(1)](attach:' + id + ') [a](attach:../../etc/passwd) ![b](attach:' + id + 'x) ![c](attach:ABCDEF0123456789)');
  assert(!/onerror=/.test(bad.replace(/alt="[^"]*"/g, '')), bad);
  assert((bad.match(/<img/g) || []).length === 1, '形式に合うIDだけが画像になる');
  assert(!bad.includes('data-att="../'));
  assert.strictEqual(L.md('`![a](attach:' + id + ')`').includes('<img'), false, 'コード内は記法にならない');
});
test('添付: 記法の作成・一覧・画像の判定', () => {
  const id = '0123456789abcdef.png';
  assert.strictEqual(L.attachMarkup('a|b[c].png', id, true), '![a b c .png](attach:' + id + ')');
  assert.strictEqual(L.attachName('  '), 'ファイル');
  assert(L.isImageName('x.JPG') && !L.isImageName('x.pdf') && !L.isImageName('x.svg'));
  const refs = L.attachRefs('![写真](attach:' + id + ') と [資料](attach:fedcba9876543210.pdf) と ![写真](attach:' + id + ')');
  assert.deepStrictEqual(refs, [{ id, name: '写真', image: true }, { id: 'fedcba9876543210.pdf', name: '資料', image: false }]);
});
