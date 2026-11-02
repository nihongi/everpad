'use strict';
/* GitHub Flavored Markdown の書き方: 絵文字ショートコードと入力候補、バックスラッシュのエスケープ、URL の自動リンク、アラート、脚注 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../renderer/core');
const D = require('../docexport');

const BS = '\\';

test('絵文字: :名前: を絵文字にする。一覧に無い名前・前後が英数字・コードの中はそのまま', () => {
  assert.strictEqual(L.md(':smile:'), '<p><span class="emoji" title=":smile:">😄</span></p>');
  const h = L.md(':+1: :-1: 今日は:sunny:です');
  assert.match(h, /👍/);
  assert.match(h, /👎/);
  assert.match(h, /今日は<span class="emoji" title=":sunny:">☀️<\/span>です/);
  assert.strictEqual(L.md(':nope: 12:100:3 a:smile: :smile:b'), '<p>:nope: 12:100:3 a:smile: :smile:b</p>');
  assert.strictEqual(L.md('`:smile:`'), '<p><code>:smile:</code></p>');
  assert.match(L.md('```\n:smile:\n```'), /<pre><code>:smile:<\/code><\/pre>/);
  // 続けて書いても、それぞれ絵文字になる
  assert.strictEqual((L.md(':smile::smile:').match(/😄/g) || []).length, 2);
  // 太字やリンクの文字の中でも絵文字になる
  assert.match(L.md('**:tada:**'), /<strong><span class="emoji" title=":tada:">🎉<\/span><\/strong>/);
  assert.match(L.md('[:memo: 予定](note:20261021-120000-abcd)'), /<a class="note-link"[^>]*><span class="emoji" title=":memo:">📝<\/span> 予定<\/a>/);
});

test('絵文字: 題名は絵文字にし、脚注の参照とエスケープの \\ を外す', () => {
  assert.strictEqual(L.titleOf('# :memo: 買い物'), '📝 買い物');
  assert.strictEqual(L.titleOf('# 買い物[^1]\n\n[^1]: 注'), '買い物');
  assert.strictEqual(L.titleOf(BS + '*重要' + BS + '* のこと'), '*重要* のこと');
  assert.strictEqual(L.titleOf(BS + '# ハッシュ'), '# ハッシュ');
  assert.strictEqual(L.titleOf('`' + BS + '*` はそのまま'), BS + '* はそのまま');
});

test('絵文字の入力候補: 名前の先頭が合うものを先に、次に途中に含むもの、次にタグ。名前は短いものを先に、同じ長さは一覧の順', () => {
  const s = L.emojiSuggest('sm');
  assert.strictEqual(s.length, 8);
  assert.deepStrictEqual(s.slice(0, 3), [{ name: 'smile', ch: '😄' }, { name: 'smirk', ch: '😏' }, { name: 'smiley', ch: '😃' }]);
  assert.ok(s.every(x => x.name.startsWith('sm')));
  assert.deepStrictEqual(L.emojiSuggest('hea', 2), [{ name: 'heart', ch: '❤️' }, { name: 'hearts', ch: '♥️' }]);
  assert.deepStrictEqual(L.emojiSuggest('ta', 3).map(x => x.name), ['taco', 'taxi', 'tada']);
  // 完全に同じ名前がいちばん先
  assert.deepStrictEqual(L.emojiSuggest('tada', 3)[0], { name: 'tada', ch: '🎉' });
  assert.deepStrictEqual(L.emojiSuggest('+1'), [{ name: '+1', ch: '👍' }]);
  // 途中に含む名前(heart_eyes など)と、タグ(happy → smile など)
  assert.ok(L.emojiSuggest('eyes', 20).some(x => x.name === 'heart_eyes'));
  assert.ok(L.emojiSuggest('happy', 20).some(x => x.name === 'smile'));
  assert.deepStrictEqual(L.emojiSuggest('zzzzqq'), []);
  assert.deepStrictEqual(L.emojiSuggest(''), []);
});

test('絵文字の入力候補: : と名前の文字2つ以上のときだけ。前が英数字・:・/ のときと、コードブロックの中では出さない', () => {
  assert.deepStrictEqual(L.emojiQueryAt('今日は :sm', 7), { from: 4, q: 'sm' });
  assert.deepStrictEqual(L.emojiQueryAt(':ta', 3), { from: 0, q: 'ta' });
  assert.deepStrictEqual(L.emojiQueryAt('晴れ:su', 5), { from: 2, q: 'su' });
  assert.strictEqual(L.emojiQueryAt(':s', 2), null);          // 1文字では出さない
  assert.strictEqual(L.emojiQueryAt('12:30', 5), null);
  assert.strictEqual(L.emojiQueryAt('http://ab', 9), null);
  assert.strictEqual(L.emojiQueryAt('a:sm', 4), null);
  assert.strictEqual(L.emojiQueryAt(':smile:', 7), null);      // 閉じたら出さない
  assert.strictEqual(L.emojiQueryAt('```\n:sm', 7), null);
  assert.deepStrictEqual(L.emojiQueryAt(':sm here', 3), { from: 0, q: 'sm' });   // カーソルの前だけを見る
});

test('絵文字の一覧: emoji.js は gemoji と同じ(tools/make-emoji.js で作り直す)', async t => {
  let gemoji;
  try { ({ gemoji } = await import('gemoji')); } catch (e) { t.skip('gemoji がない'); return; }
  const list = require('../renderer/emoji');
  assert.deepStrictEqual(list, gemoji.map(g => [g.emoji, g.names.join(' '), g.tags.join(' ')]));
  const names = list.flatMap(r => r[1].split(' '));
  assert.strictEqual(new Set(names).size, names.length, '名前が重なっている');
  assert.ok(names.every(n => /^[a-z0-9_+-]+$/.test(n)));
  // ライセンスの文を付けている
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'emoji.js'), 'utf8'), /Copyright \(c\) 2014 Titus Wormer/);
});

test('エスケープ: \\ のあとの記号は、Markdown の記号として読まずにそのまま出す', () => {
  assert.strictEqual(L.md(BS + '*星' + BS + '*'), '<p>*星*</p>');
  assert.strictEqual(L.md(BS + '*' + BS + '*太字ではない' + BS + '*' + BS + '*'), '<p>**太字ではない**</p>');
  assert.strictEqual(L.md('a' + BS + '_b ' + BS + '~~c' + BS + '~~'), '<p>a_b ~~c~~</p>');
  assert.strictEqual(L.md(BS + '<b' + BS + '>'), '<p>&lt;b&gt;</p>');
  assert.strictEqual(L.md(BS + BS + '*x*'), '<p>' + BS + '<em>x</em></p>');           // \\ は \ の文字
  assert.strictEqual(L.md(BS + 'a ' + BS + 'あ C:' + BS + 'Users'), '<p>' + BS + 'a ' + BS + 'あ C:' + BS + 'Users</p>');   // 記号でなければ \ のまま
  assert.strictEqual(L.md(BS + ':smile:'), '<p>:smile:</p>');
  assert.strictEqual(L.md(BS + '[^1]\n\n[^1]: 注'), '<p>[^1]</p>');
  assert.strictEqual(L.md(BS + '[a](https://x.com)'), '<p>[a](<a href="https://x.com" target="_blank" rel="noopener noreferrer">https://x.com</a>)</p>');
  // 行の先頭の記号: 見出し・箇条書き・番号付き・引用にならない
  assert.strictEqual(L.md(BS + '# a\n' + BS + '- b\n1' + BS + '. c\n' + BS + '> d'), '<p># a<br>- b<br>1. c<br>&gt; d</p>');
  // コード表記の中と数式の中は、そのまま
  assert.strictEqual(L.md('`' + BS + '*`'), '<p><code>' + BS + '*</code></p>');
  assert.match(L.md('$a ' + BS + BS + ' b$'), /data-tex="a \\\\ b"/);
  // $ は今までどおり(\$ は $ の文字)
  assert.strictEqual(L.md('価格は ' + BS + '$5'), '<p>価格は $5</p>');
});

test('自動リンク: https://・http://・www. と <https://…> をリンクにする', () => {
  const a = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + (text || href) + '</a>';
  assert.strictEqual(L.md('https://example.com'), '<p>' + a('https://example.com') + '</p>');
  assert.strictEqual(L.md('www.example.com/a'), '<p>' + a('http://www.example.com/a', 'www.example.com/a') + '</p>');
  assert.strictEqual(L.md('<https://x.org/?a=1&b=2>'), '<p>' + a('https://x.org/?a=1&amp;b=2') + '</p>');
  // 日本語の文字・空白の手前で終わる。最後の句読点と、対になっていない ) は含めない
  assert.strictEqual(L.md('詳細はhttps://example.com/aを見て'), '<p>詳細は' + a('https://example.com/a') + 'を見て</p>');
  assert.strictEqual(L.md('https://example.com/path.'), '<p>' + a('https://example.com/path') + '.</p>');
  assert.strictEqual(L.md('(https://example.com/x)'), '<p>(' + a('https://example.com/x') + ')</p>');
  assert.strictEqual(L.md('https://en.wikipedia.org/wiki/A_(B)'), '<p>' + a('https://en.wikipedia.org/wiki/A_(B)') + '</p>');
  assert.strictEqual(L.md('https://example.com/?q=1&'), '<p>' + a('https://example.com/?q=1&amp;') + '</p>');
  assert.strictEqual(L.md('**https://example.com**'), '<p><strong>' + a('https://example.com') + '</strong></p>');
  // 単語の途中・リンクの中・コードの中はリンクにしない
  assert.strictEqual(L.md('xhttps://example.com'), '<p>xhttps://example.com</p>');
  assert.strictEqual(L.md('[https://a.com を見る](https://b.com)'), '<p><a href="https://b.com" target="_blank" rel="noopener noreferrer">https://a.com を見る</a></p>');
  assert.strictEqual(L.md('`https://example.com`'), '<p><code>https://example.com</code></p>');
  assert.strictEqual(L.md('https:// と www.'), '<p>https:// と www.</p>');
  // " や < はリンクに含めない(属性を壊さない)
  assert.strictEqual(L.md('https://example.com/"onmouseover="x'), '<p>' + a('https://example.com/') + '&quot;onmouseover=&quot;x</p>');
});

test('アラート: 引用の1行目が [!NOTE] などだけなら、種類と見出しの付いた引用にする', () => {
  L.setMdLang('ja');
  const h = L.md('> [!NOTE]\n> 知っておくこと\n> 2行目');
  assert.match(h, /^<blockquote class="alert alert-note" data-alert="note"><p class="alert-title"><svg class="alert-icon"[^>]*>.*<\/svg>注記<\/p><p>知っておくこと<br>2行目<\/p><\/blockquote>$/s);
  const kinds = { TIP: 'ヒント', IMPORTANT: '重要', WARNING: '警告', CAUTION: '注意' };
  for (const k in kinds) assert.match(L.md('> [!' + k + ']\n> x'), new RegExp('alert-' + k.toLowerCase() + '.*' + kinds[k] + '</p>', 's'));
  assert.match(L.md('> [!warning]\n> - a'), /alert-warning.*<ul><li>a<\/li><\/ul>/s);   // 大文字と小文字は区別しない
  L.setMdLang('en');
  assert.match(L.md('> [!CAUTION]\n> x'), /Caution<\/p>/);
  L.setMdLang('ja');
  // 1行目に他の文字があれば普通の引用
  assert.strictEqual(L.md('> [!NOTE] です'), '<blockquote><p>[!NOTE] です</p></blockquote>');
  assert.strictEqual(L.md('> [!OTHER]\n> x'), '<blockquote><p>[!OTHER]<br>x</p></blockquote>');
  // 編集とプレビューの位置合わせの行の範囲は、中の段落に付ける
  assert.match(L.md('> [!TIP]\n> 中身', { lines: true }), /<p data-line="1" data-end="2">中身<\/p>/);
});

test('脚注: 参照した順に番号を付け、注をメモの最後にまとめる', () => {
  L.setMdLang('ja');
  const h = L.md('本文[^b]と[^a]と[^b]。[^none]\n\n[^a]: 注A\n[^b]: 注B\n  続き\n\n  次の段落\n\n本文の続き');
  assert.match(h, /本文<sup class="fnref"><a href="#fn-1" id="fnref-1" data-fn="1">1<\/a><\/sup>と<sup class="fnref"><a href="#fn-2" id="fnref-2" data-fn="2">2<\/a><\/sup>と<sup class="fnref"><a href="#fn-1" id="fnref-1-2" data-fn="1">1<\/a><\/sup>。\[\^none\]/);
  assert.match(h, /<p>本文の続き<\/p>/);
  const fns = h.slice(h.indexOf('<section class="footnotes">'));
  assert.match(fns, /<li id="fn-1" data-fn="1"><p>注B<br>続き<\/p>\n<p>次の段落 <a href="#fnref-1" class="fnback" data-fnback="1" aria-label="本文に戻る" title="本文に戻る">↩︎<\/a><\/p><\/li>/);
  assert.match(fns, /<li id="fn-2" data-fn="2"><p>注A <a href="#fnref-2" class="fnback"/);
  // 定義の行は本文に出さない。参照の無い注は一覧に出さない
  assert.strictEqual(L.md('[^x]: 使わない注\n\n本文'), '<p>本文</p>');
  // 定義のすぐ次の行(空の行をはさまない普通の文)は、注の続き(GitHub と同じ)
  assert.match(L.md('a[^x]\n\n[^x]: 注の\n続き'), /<li id="fn-1" data-fn="1"><p>注の<br>続き /);
  assert.match(L.md('a[^x]\n\n[^x]: 注\n# 見出し'), /<h1>見出し<\/h1>/);   // 見出しなどは続きにしない
  // 名前の大文字と小文字は区別しない。コードブロックの中の定義は無視する
  assert.match(L.md('a[^Note]\n\n[^note]: 注'), /data-fn="1"/);
  assert.strictEqual(L.md('```\n[^1]: コード\n```\n本文[^1]'), '<pre><code>[^1]: コード</code></pre>\n<p>本文[^1]</p>');
  // 注の中の参照も番号になる
  assert.match(L.md('a[^1]\n\n[^1]: 注[^2]\n[^2]: 別の注'), /<li id="fn-2" data-fn="2"><p>別の注/);
  // 定義の行は空の行にするので、後ろの行の番号は変わらない
  assert.match(L.md('a[^1]\n[^1]: 注\n\nb', { lines: true }), /<p data-line="3" data-end="4">b<\/p>/);
  // 脚注のない文は今までと同じ
  assert.strictEqual(L.md(''), '');
});

test('書き出し: 脚注は Word の脚注と AsciiDoc の footnote、アラートは色付きの引用と AsciiDoc の注記', () => {
  L.setMdLang('ja');
  const src = '牛乳[^m]と卵[^e]。もう一度[^m]。\n\n> [!NOTE]\n> **特売**\n\n> [!WARNING]\n> - 割れやすい\n\n[^m]: [店](https://example.com) で。\n[^e]: 10個';
  const tree = D.bodyTree(L.md(src));
  assert.deepStrictEqual(tree.map(b => b.t), ['p', 'alert', 'alert', 'footnotes']);
  assert.deepStrictEqual(tree[1].title, [{ t: 'text', v: '注記' }]);
  assert.deepStrictEqual(tree[0].c.filter(x => x.t === 'fn').map(x => x.n), [1, 2, 1]);
  // 脚注の一覧から ↩ は除く
  assert.ok(!JSON.stringify(tree[3]).includes('↩'));

  const adoc = D.toAsciiDoc(tree, { title: 't' });
  assert.match(adoc, /:note-caption: 注記\n:warning-caption: 警告\n/);
  assert.match(adoc, /牛乳footnote:fn1\[link:\+\+https:\/\/example\.com\+\+\[店\] で。\]と卵footnote:\[10個\]。もう一度footnote:fn1\[\]。/);
  assert.match(adoc, /\[NOTE\]\n====\n\{empty\}\*\*特売\*\*\n====/);   // 行の先頭の * は、今までどおり {empty} を前に付ける
  assert.match(adoc, /\[WARNING\]\n====\n\* 割れやすい\n====/);
  // 英語の見出しなら、Asciidoctor の既定と同じなので書かない
  L.setMdLang('en');
  assert.ok(!/caption/.test(D.toAsciiDoc(D.bodyTree(L.md('> [!NOTE]\n> x')), {})));
  L.setMdLang('ja');

  const zip = D.toDocx(tree, { title: 't', lang: 'ja', date: 0 });
  const files = readZip(zip);
  const doc = files['word/document.xml'], notes = files['word/footnotes.xml'];
  assert.ok(notes, 'footnotes.xml がある');
  assert.deepStrictEqual(doc.match(/<w:footnoteReference w:id="\d+"\/>/g), ['<w:footnoteReference w:id="1"/>', '<w:footnoteReference w:id="2"/>']);
  assert.match(doc, /FootnoteReference"\/><\/w:rPr><w:t>1<\/w:t>/);   // 2回目の参照は番号の文字
  assert.match(notes, /<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"\/><\/w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteRef\/><\/w:r>.*店.*<\/w:footnote>/s);
  assert.match(notes, /<w:footnote w:type="separator" w:id="-1">/);
  assert.match(files['word/_rels/footnotes.xml.rels'], /Target="https:\/\/example\.com" TargetMode="External"/);
  assert.match(files['word/_rels/document.xml.rels'], /Type="[^"]*footnotes" Target="footnotes.xml"/);
  assert.match(files['[Content_Types].xml'], /footnotes\+xml/);
  assert.match(files['word/settings.xml'], /<w:footnotePr>/);
  assert.match(files['word/styles.xml'], /w:styleId="FootnoteText"/);
  // アラート: 見出しは種類の色の太字、左の線も種類の色
  assert.match(doc, /<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="0969DA"\/><\/w:pBdr>.*<w:b\/><w:bCs\/><w:color w:val="0969DA"\/><\/w:rPr><w:t xml:space="preserve">注記/s);
  assert.match(doc, /w:color="9A6700"/);
  // 脚注が無ければ、今までどおり footnotes.xml は作らない
  const plain = readZip(D.toDocx(D.bodyTree(L.md('本文')), { date: 0 }));
  assert.ok(!plain['word/footnotes.xml']);
  assert.ok(!/footnotes/.test(plain['word/_rels/document.xml.rels'] + plain['[Content_Types].xml'] + plain['word/settings.xml']));
});

test('Markdown の書き方: 新しい書き方の例が、説明どおりに表示される', () => {
  const HELP = require('../renderer/help-content');
  L.setMdLang('ja');
  const out = Object.fromEntries(HELP.ja.sections.filter(s => !s.noRender).map(s => [s.h, L.md(s.src)]));
  assert.match(out['記号をそのまま書く'], /\*星印\* で囲んでも/);
  assert.match(out['記号をそのまま書く'], /<br># 見出しになりません<br>1\. 番号付き/);
  assert.match(out['絵文字'], /☀️.*👍.*🎉/s);
  assert.match(out['URL をそのまま書く'], /<a href="https:\/\/www\.electronjs\.org\/"[^>]*>https:\/\/www\.electronjs\.org\/<\/a> を見て/);
  assert.match(out['URL をそのまま書く'], /<a href="https:\/\/www\.electronjs\.org\/docs"/);
  assert.match(out['アラート'], /alert-note.*注記.*alert-warning.*警告/s);
  assert.match(out['脚注'], /<sup class="fnref">.*<section class="footnotes">/s);
});

/* ZIP(無圧縮か deflate)を読んで、名前 → 文字列 */
function readZip(buf) {
  const zlib = require('zlib');
  const out = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8), size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
    const data = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    p += 30 + nlen + xlen + size;
  }
  return out;
}
