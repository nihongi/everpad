/* 履歴・Markdown・検索のロジック(画面にもテストにも使う。Electronには依存しない)

   ---------- 履歴の基本ロジック ----------
   1回の編集 = {p: 位置, d: 消した文字列, i: 入れた文字列, t: 時刻(ms)}
   どの版でも、最初の空文字から順に適用すれば再現できる。 */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function applyOp(text, op) { return text.slice(0, op.p) + op.i + text.slice(op.p + op.d.length); }

function makeOp(a, b, t) {
  const min = Math.min(a.length, b.length);
  let p = 0;
  while (p < min && a[p] === b[p]) p++;
  if (p > 0) { const c = a.charCodeAt(p - 1); if (c >= 0xD800 && c <= 0xDBFF) p--; }
  let s = 0;
  while (s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (s > 0) { const c = a.charCodeAt(a.length - s); if (c >= 0xDC00 && c <= 0xDFFF) s--; }
  return { p: p, d: a.slice(p, a.length - s), i: b.slice(p, b.length - s), t: t };
}

/* 100版ごとに途中の状態を覚えておき、スライダーを動かしても素早く再現する */
function textAt(n, k) {
  const cp = n._cp || (n._cp = ['']);
  const target = Math.floor(k / 100);
  while (cp.length <= target) {
    const j = cp.length - 1;
    let t = cp[j];
    for (let r = j * 100; r < (j + 1) * 100; r++) t = applyOp(t, n.ops[r]);
    cp.push(t);
  }
  let t = cp[target];
  for (let r = target * 100; r < k; r++) t = applyOp(t, n.ops[r]);
  return t;
}

/* ---------- Markdown(簡易版) ---------- */
/* ---------- 数式(KaTeX) ----------
   画面では katex.min.js と mhchem が読み込まれている(window.katex)。読み込まれていないとき(テストなど)は LaTeX をそのまま出す。
   外部を参照するコマンド(\href・\includegraphics など)は trust: false で無効。誤りがあれば、元の LaTeX を赤字で出し、
   マウスを重ねると誤りの内容が出る。data-tex に元の LaTeX を持たせ、右クリックでコピーできるようにする。
   block: 段落の外の、独立した数式(<div>)。段落の中では <span> にする */
const MATH_OPTS = { throwOnError: true, trust: false, strict: 'ignore', output: 'html', maxExpand: 1000, maxSize: 50 };
function renderMath(tex, display, block) {
  const tag = block ? 'div' : 'span';
  const cls = 'math' + (display ? ' math-display' : '');
  const attr = ' data-tex="' + esc(tex) + '"';
  const K = typeof katex !== 'undefined' ? katex : null;
  if (!K) return '<' + tag + ' class="' + cls + ' math-src"' + attr + '>' + esc(tex) + '</' + tag + '>';
  try {
    return '<' + tag + ' class="' + cls + '"' + attr + '>' + K.renderToString(tex, Object.assign({ displayMode: !!display }, MATH_OPTS)) + '</' + tag + '>';
  } catch (e) {
    const msg = String((e && e.message) || e).replace(/^KaTeX parse error:\s*/, '');
    return '<' + tag + ' class="' + cls + ' math-error"' + attr + ' title="' + esc(msg) + '">' + esc(tex) + '</' + tag + '>';
  }
}
/* 文中の $…$ を探す。金額の $ を数式にしないよう、Pandoc と同じ規則にする:
   開きの $ の直後は空白でない。閉じの $ の直前は空白でなく、直後は数字でない */
function inlineDollars(s, keep) {
  let out = '', i = 0;
  for (;;) {
    const a = s.indexOf('$', i);
    if (a < 0) break;
    if (s[a + 1] === '$') { out += s.slice(i, a + 2); i = a + 2; continue; }   // 閉じの無い $$ は数式にしない
    if (a + 1 >= s.length || /\s/.test(s[a + 1])) { out += s.slice(i, a + 1); i = a + 1; continue; }
    let b = s.indexOf('$', a + 1), close = -1;
    while (b >= 0) { if (!/\s/.test(s[b - 1]) && !/\d/.test(s[b + 1] || '')) { close = b; break; } b = s.indexOf('$', b + 1); }
    if (close < 0) break;
    out += s.slice(i, a) + keep(s.slice(a + 1, close), false);
    i = close + 1;
  }
  return out + s.slice(i);
}
/* 段落の外の数式: $$ … $$ / \[ … \](1行でも、前後を区切りだけの行で囲んだ複数行でも)。{ tex, next } か null */
function mathBlock(lines, i) {
  const t = lines[i].trim();
  const pair = t.startsWith('$$') ? ['$$', '$$'] : t.startsWith('\\[') ? ['\\[', '\\]'] : null;
  if (!pair) return null;
  const [o, c] = pair;
  if (t.length >= o.length + c.length && t.endsWith(c) && t !== o) {
    const inner = t.slice(o.length, t.length - c.length);
    return inner.indexOf(o) < 0 && inner.trim() ? { tex: inner.trim(), next: i + 1 } : null;
  }
  for (let j = i + 1; j < lines.length; j++) {
    const u = lines[j].trim();
    if (u.endsWith(c)) return { tex: [t.slice(o.length)].concat(lines.slice(i + 1, j), [u.slice(0, u.length - c.length)]).join('\n').trim(), next: j + 1 };
  }
  return null;
}

/* 文中のコード表記(CommonMark と同じ): バッククォートを何個重ねても、同じ数のバッククォートで閉じるまでがコード。
   中にバッククォートを書くときは、外側を多く重ねる(`` `x` `` → `x`)。前後に空白が1つずつあれば取り除く。
   閉じる側が無いバッククォートは、ただの文字として残す */
function codeSpans(src, keep) {
  let out = '', i = 0;
  while (i < src.length) {
    const a = src.indexOf('`', i);
    if (a < 0) { out += src.slice(i); break; }
    out += src.slice(i, a);
    let n = 0; while (src[a + n] === '`') n++;
    let close = -1;
    for (let k = a + n; k < src.length;) {
      const j = src.indexOf('`', k);
      if (j < 0) break;
      let m = 0; while (src[j + m] === '`') m++;
      if (m === n) { close = j; break; }
      k = j + m;
    }
    if (close < 0) { out += src.slice(a, a + n); i = a + n; continue; }
    let c = src.slice(a + n, close);
    if (c.length >= 2 && c[0] === ' ' && c[c.length - 1] === ' ' && c.trim() !== '') c = c.slice(1, -1);
    out += keep(c);
    i = close + n;
  }
  return out;
}

function inline(src) {
  const codes = [];
  let s = codeSpans(src, c => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
  // 数式: \$ は区切りにしない(数式の外では $ の文字、数式の中では \$ に戻す)。ほかの書式の影響を受けないよう、先に退避する
  const maths = [];
  const keepMath = (tex, display) => { maths.push(renderMath(tex.replace(/\u0003/g, '\\$'), display, false)); return '\u0004' + (maths.length - 1) + '\u0004'; };
  s = s.replace(/\\\$/g, '\u0003');
  s = s.replace(/\\\((.+?)\\\)/g, (m, t) => keepMath(t, false));
  s = s.replace(/\\\[(.+?)\\\]/g, (m, t) => keepMath(t, true));
  s = s.replace(/\$\$(.+?)\$\$/g, (m, t) => keepMath(t, true));
  s = inlineDollars(s, keepMath);
  s = esc(s);
  // 添付: ![名前](attach:ID) は画像、[名前](attach:ID) はファイルへのリンク。ほかの書式の影響を受けないよう、いったん退避する
  const atts = [];
  const keep = h => { atts.push(h); return '\u0002' + (atts.length - 1) + '\u0002'; };
  s = s.replace(/!\[([^\]]*)\]\(attach:([0-9a-f]{16}(?:\.[a-z0-9]{1,8})?)\)/g, (m, alt, id) => keep('<img class="att-img" data-att="' + id + '" alt="' + alt + '" loading="lazy">'));
  s = s.replace(/\[([^\]]+)\]\(attach:([0-9a-f]{16}(?:\.[a-z0-9]{1,8})?)\)/g, (m, t, id) => keep('<a class="att-file" href="#" data-att="' + id + '" title="' + t + '">' + t + '</a>'));
  // 他のメモへのリンク。参照先の題名や、削除されているかは、画面に出すときに app.js が付ける
  s = s.replace(NOTE_LINK_RE, (m, t, id) => keep('<a class="note-link" href="#" data-note="' + id + '">' + t + '</a>'));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
  // それ以外のリンク: GitHub と同じく表示名をリンクの見た目で出す(<a> にはしない)。
  //   #見出し … 同じメモの中の見出しへ移動する(日本語の見出しも使える)
  //   相対パスなど([LICENSE](LICENSE)) … EverPad には開く先が無いので、クリックすると知らせる。
  //     「[重要](後で確認)」のような普通の文章を崩さないよう、行き先が URL やファイル名に使う半角の文字だけのときに限る
  const other = (t, u) => keep('<span class="link-other" data-target="' + u + '">' + t + '</span>');
  s = s.replace(/\[([^\]]+)\]\((#[^\s()]+)\)/g, (m, t, u) => other(t, u));
  s = s.replace(/\[([^\]]+)\]\(([A-Za-z0-9._~:/?#@!$&'*+,;=%-]+)\)/g, (m, t, u) => other(t, u));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => atts[+i]);
  s = s.replace(/\u0004(\d+)\u0004/g, (_, i) => maths[+i]).replace(/\u0003/g, '$');
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
}

/* コードブロック: 開始行の字下げ分を各行から取り除いて読む。読み終えた次の行番号と、HTMLを返す */
/* コードブロックの囲み(CommonMark と同じ): ``` か ~~~ を3つ以上並べた行で始め、同じ文字を同じ数以上並べただけの行で閉じる。
   中に ``` の行を書きたいときは、```` か ~~~ で囲む。閉じる行が無ければ最後までをコードとする */
const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})(.*)$/;
/* 囲みの開始の行か。バッククォートの囲みは、後ろにバッククォートがあれば囲みではない(```` ``` ```` は文中のコード表記) */
const FENCE_OPEN = { test: line => { const m = line.match(FENCE_OPEN_RE); return !!m && !(m[1][0] === '`' && m[2].indexOf('`') >= 0); } };
function fenceCloses(line, open) {
  const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  return !!m && m[1][0] === open[0] && m[1].length >= open.length;
}
function mdFence(lines, i) {
  const ind = lines[i].match(/^\s*/)[0].length;
  const open = lines[i].match(FENCE_OPEN_RE)[1];
  const buf = [];
  i++;
  while (i < lines.length && !fenceCloses(lines[i], open)) { buf.push(lines[i].replace(new RegExp('^\\s{0,' + ind + '}'), '')); i++; }
  return { next: i + 1, html: '<pre><code>' + esc(buf.join('\n')) + '</code></pre>' };
}

/* ---------- カーソル位置と選択の文字数(状態表示) ----------
   文字は、絵文字なども1文字と数える(サロゲートペアを1つに)。 */
const countChars = s => { let c = 0; for (const _ of s) c++; return c; };
/* 位置 pos(UTF-16 の位置)が何行目の何文字目か。行は改行で区切った行で、どちらも1から数える */
function cursorInfo(text, pos) {
  pos = Math.max(0, Math.min(text.length, pos | 0));
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) line++;
  const ls = text.lastIndexOf('\n', pos - 1) + 1;
  return { line: line, col: countChars(text.slice(ls, pos)) + 1 };
}
/* 選んだ文字列の文字数(改行は数えない)と行数(最後の改行だけで次の行に入ったときは数えない) */
function selectionInfo(s) {
  const nl = (s.match(/\n/g) || []).length;
  return { chars: countChars(s) - nl, lines: s ? nl + 1 - (s.length > 1 && s.endsWith('\n') ? 1 : 0) : 0 };
}

/* メモ全体の文字数・単語数・行数(Notepad++ の「要約」と同じ数え方)
   - 文字数: 改行を含まない(絵文字なども1文字)
   - 単語数: 空白・改行と半角の記号 \ . , ; : ! ? ( ) + - * / = [ ] { } & ~ " ' ` | @ $ % < > ^ 以外が続く部分を1語とする
     (全角の句読点は区切りにならないので、日本語の文は長いひと続きとして数えられる)
   - 行数: 改行で区切った行の数(空のメモは1行、最後が改行なら空の行も1行と数える) */
const WORD_RE = /[^ \t\\.,;:!?()+\r\n\-*/=\][{}&~"'`|@$%<>^]+/g;
function textStats(text) {
  const nl = (text.match(/\n/g) || []).length;
  return { chars: countChars(text) - nl, words: (text.match(WORD_RE) || []).length, lines: nl + 1 };
}

/* ---------- 選んだ行をまとめて引用・箇条書き・番号付き・コードブロックにする ----------
   対象は選択がかかっている行すべて(選択が無ければカーソルの行。選択の終わりが次の行の先頭ちょうどなら、その行は含めない)。
   すべての行がすでにその書式なら外す(切り替え式)。戻り値は { from, to, insert, selStart, selEnd }:
   text の from〜to を insert に置き換え、その後に selStart〜selEnd を選ぶ。 */
const FENCE = /^\s*```/;
function formatLines(text, selStart, selEnd, kind) {
  let end = selEnd;
  if (selEnd > selStart && text[selEnd - 1] === '\n') end = selEnd - 1;
  const from = text.lastIndexOf('\n', selStart - 1) + 1;
  let to = text.indexOf('\n', end); if (to < 0) to = text.length;
  const lines = text.slice(from, to).split('\n');
  const filled = lines.filter(l => l.trim() !== '');
  let out;
  if (kind === 'quote') {
    out = lines.every(l => l.startsWith('>')) ? lines.map(l => l.replace(/^> ?/, '')) : lines.map(l => (l === '' ? '>' : '> ' + l));
  } else if (kind === 'bullet') {
    const on = filled.length > 0 && filled.every(l => /^\s*[-*+] /.test(l));
    out = lines.map(l => (l.trim() === '' ? l : on ? l.replace(/^(\s*)[-*+] /, '$1') : l.replace(/^(\s*)(?:\d+[.)] )?/, '$1- ')));
  } else if (kind === 'numbered') {
    const on = filled.length > 0 && filled.every(l => /^\s*\d+[.)] /.test(l));
    let k = 0;
    out = lines.map(l => (l.trim() === '' ? l : on ? l.replace(/^(\s*)\d+[.)] /, '$1') : l.replace(/^(\s*)(?:[-*+] )?/, (m, sp) => sp + (++k) + '. ')));
  } else if (kind === 'code') {
    // 選んだ行の前後がコードブロックの囲みなら外す。選んだ行の最初と最後が囲みでも外す
    const prevS = from > 0 ? text.lastIndexOf('\n', from - 2) + 1 : -1;
    const nextE = to < text.length ? (text.indexOf('\n', to + 1) < 0 ? text.length : text.indexOf('\n', to + 1)) : -1;
    if (prevS >= 0 && nextE >= 0 && FENCE.test(text.slice(prevS, from - 1)) && /^\s*```\s*$/.test(text.slice(to + 1, nextE))) {
      const body = lines.join('\n');
      return { from: prevS, to: nextE, insert: body, selStart: prevS, selEnd: prevS + body.length };
    }
    if (lines.length >= 2 && FENCE.test(lines[0]) && /^\s*```\s*$/.test(lines[lines.length - 1])) out = lines.slice(1, -1);
    else out = ['```'].concat(lines, ['```']);
  } else return null;
  const insert = out.join('\n');
  return { from: from, to: to, insert: insert, selStart: from, selEnd: from + insert.length };
}

/* ---------- 他のメモへのリンク: [表示名](note:メモID) ----------
   メモID は変わらないので、参照先の題名や中身が変わってもリンクは切れない(メモの中の位置は指さない) */
const NOTE_LINK_RE = /\[([^\]]+)\]\(note:([A-Za-z0-9_-]{6,64})\)/g;
/* text の位置 pos にあるリンクの参照先のメモID(無ければ null)。編集画面の Ctrl+クリックで使う */
function noteLinkAt(text, pos) {
  const ls = text.lastIndexOf('\n', pos - 1) + 1;
  let le = text.indexOf('\n', pos); if (le < 0) le = text.length;
  const line = text.slice(ls, le);
  for (const m of line.matchAll(NOTE_LINK_RE)) {
    if (pos >= ls + m.index && pos <= ls + m.index + m[0].length) return m[2];
  }
  return null;
}
/* リンクを書くときの表示名(リンクの書き方を壊す [ ] と改行は空白にする) */
const linkText = title => String(title || '').replace(/[[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/* 最近見たメモの一覧: 開いたメモをいちばん上に移し、max 件までにする。{ id, title, t } の配列を返す */
function pushRecent(list, id, title, max) {
  return [{ id: id, title: title, t: Date.now() }].concat((list || []).filter(r => r && r.id !== id)).slice(0, max);
}

/* 見出しの文字から、GitHub と同じ規則で、ページ内リンク(#…)の名前を作る:
   小文字にし、文字・数字・空白・- ・_ 以外を取り除き、空白を - にする(日本語などの文字はそのまま) */
const headingSlug = text => String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');

/* メモの題名: 最初の空でない行(見出しなどの記号は除く)。無いときは ''(表示側で「無題のメモ」などを出す) */
const titleOf = text => {
  for (const ln of text.split('\n')) { const t = ln.replace(/^[#>\s\-*+]+/, '').trim(); if (t) return t.slice(0, 60); }
  return '';
};

/* ---------- 添付 ---------- */
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const isImageName = name => IMG_EXT.test(name || '');
/* 本文に書く記法。名前に使えない文字(記法を壊すもの)は取り除く */
function attachName(name) { return String(name || 'ファイル').replace(/[\[\]()|*_`<>\\\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ファイル'; }
function attachMarkup(name, fileId, image) { return (image ? '!' : '') + '[' + attachName(name) + '](attach:' + fileId + ')'; }
/* 本文で使っている添付の一覧(同じものは1つ) */
function attachRefs(text) {
  const out = [], seen = new Set();
  const re = /(!?)\[([^\]]*)\]\(attach:([0-9a-f]{16}(?:\.[a-z0-9]{1,8})?)\)/g;
  let m;
  while ((m = re.exec(text))) { if (seen.has(m[3])) continue; seen.add(m[3]); out.push({ id: m[3], name: m[2], image: m[1] === '!' }); }
  return out;
}

function mdList(lines, i, out) {
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const stack = [];
  let html = '';
  while (i < lines.length) {
    let m = lines[i].match(re);
    if (!m) {
      // 空行をはさんで続く、字下げしたコードブロックや次の項目は、同じリストの続きとして読む
      let j = i;
      while (j < lines.length && /^\s*$/.test(lines[j])) j++;
      if (!stack.length || j >= lines.length) break;
      if (/^\s+/.test(lines[j]) && FENCE_OPEN.test(lines[j])) { const f = mdFence(lines, j); html += f.html; i = f.next; continue; }
      // 項目より字下げした段落は、その項目の続き(GitHub と同じ)
      const lead = s => s.match(/^\s*/)[0].replace(/\t/g, '  ').length;
      if (lead(lines[j]) >= stack[stack.length - 1].ind + 2 && !re.test(lines[j])) {
        const buf = [];
        while (j < lines.length && /\S/.test(lines[j]) && !re.test(lines[j]) && lead(lines[j]) >= stack[stack.length - 1].ind + 2 && !FENCE_OPEN.test(lines[j])) { buf.push(lines[j].trim()); j++; }
        if (buf.length) { html += '<p>' + buf.map(inline).join('<br>') + '</p>'; i = j; continue; }
      }
      if (j > i && re.test(lines[j])) {
        const n = lines[j].match(re);
        const top = n[1].replace(/\t/g, '  ').length <= stack[0].ind;
        if (!top || (/\d/.test(n[2]) ? 'ol' : 'ul') === stack[0].tag) { i = j; continue; } // 種類が変わったら別のリスト
      }
      break;
    }
    const ind = m[1].replace(/\t/g, '  ').length;
    const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    while (stack.length && ind < stack[stack.length - 1].ind) html += '</li></' + stack.pop().tag + '>';
    if (stack.length && ind === stack[stack.length - 1].ind) html += '</li><li>';
    else {
      // 番号付きは、最初の項目に書いた番号から数える(4. から始めれば 4, 5, … と表示する)
      const start = tag === 'ol' ? parseInt(m[2], 10) : 1;
      html += '<' + tag + (start !== 1 ? ' start="' + start + '"' : '') + '><li>';
      stack.push({ ind: ind, tag: tag });
    }
    const t = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
    html += t ? '<input type="checkbox" disabled' + (t[1] !== ' ' ? ' checked' : '') + '> ' + inline(t[2]) : inline(m[3]);
    i++;
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  out.push(html);
  return i;
}

/* 表: 「| a | b |」の行の次に「|---|---|」の行がある形 */
function splitRow(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}
const isDelim = line => line.indexOf('|') >= 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

function md(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let i = 0;
  const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  while (i < lines.length) {
    const ln = lines[i];
    let m;
    // 数式のかたまり: ```math のコードブロック、$$ … $$、\[ … \]
    const mf = ln.match(/^\s*(`{3,}|~{3,})math\s*$/);
    if (mf) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !fenceCloses(lines[i], mf[1]); i++) buf.push(lines[i]);
      i++;
      out.push(renderMath(buf.join('\n'), true, true));
      continue;
    }
    const mb = mathBlock(lines, i);
    if (mb) { flush(); out.push(renderMath(mb.tex, true, true)); i = mb.next; continue; }
    if (FENCE_OPEN.test(ln)) {
      flush();
      const f = mdFence(lines, i);
      i = f.next;
      out.push(f.html);
      continue;
    }
    if (/^\s*$/.test(ln)) { flush(); i++; continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(ln)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + md(buf.join('\n')) + '</blockquote>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) { flush(); i = mdList(lines, i, out); continue; }
    if (ln.indexOf('|') >= 0 && i + 1 < lines.length && isDelim(lines[i + 1])) {
      const head = splitRow(ln), dl = splitRow(lines[i + 1]);
      if (head.length === dl.length) {
        flush();
        const al = dl.map(c => (/^:-+:$/.test(c) ? 'c' : /-:$/.test(c) ? 'r' : 'l'));
        const cls = k => ' class="al-' + al[k] + '"';
        const th = head.map((c, k) => '<th' + cls(k) + '>' + inline(c) + '</th>').join('');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
          const r = splitRow(lines[i]);
          rows.push('<tr>' + head.map((_, k) => '<td' + cls(k) + '>' + inline(r[k] || '') + '</td>').join('') + '</tr>');
          i++;
        }
        out.push('<div class="tblwrap"><table><thead><tr>' + th + '</tr></thead>' + (rows.length ? '<tbody>' + rows.join('') + '</tbody>' : '') + '</table></div>');
        continue;
      }
    }
    para.push(ln.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

/* ---------- 検索 ---------- */
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchRanges(text, q) {
  if (!q) return [];
  const re = new RegExp(escRe(q), 'gi'), out = [];
  let m;
  while ((m = re.exec(text))) { out.push({ s: m.index, e: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; }
  return out;
}

/* 範囲に重なる部分だけ <mark> で囲んだHTMLを返す(baseは str が全文の何文字目から始まるか) */
function markPieces(str, base, ranges) {
  let out = '', i = 0;
  for (const r of ranges) {
    const s = Math.max(r.s - base, i), e = Math.min(r.e - base, str.length);
    if (e <= s) continue;
    out += esc(str.slice(i, s)) + '<mark>' + esc(str.slice(s, e)) + '</mark>';
    i = e;
  }
  return out + esc(str.slice(i));
}

/* 履歴の「変更箇所」表示用: その版の本文を行ごとのHTMLにする(追加=<ins>、削除=<del>、検索語=<mark>)。
   行の数は本文の行数と同じ。削除された文字列の中の改行は、行を増やさず、その行の中に残す。
   追加・削除した改行には「↵」を付ける(本文にはない表示用の文字)。 */
function diffLines(text, op, ranges) {
  const toks = op
    ? [[text.slice(0, op.p), 'n', 0], [op.d, 'd', 0], [op.i, 'i', op.p], [text.slice(op.p + op.i.length), 'n', op.p + op.i.length]]
    : [[text, 'n', 0]];
  const lines = [];
  let cur = '';
  for (const [s, kind, base] of toks) {
    if (!s) continue;
    // 改行の追加・削除は「↵」で見えるようにする(色付きの本文だけでは、改行は目に見えない)
    if (kind === 'd') { cur += '<del>' + esc(s).replace(/\n/g, '↵\n') + '</del>'; continue; }
    let off = 0;
    const parts = s.split('\n');
    parts.forEach((piece, k) => {
      if (k > 0) { lines.push(cur); cur = ''; off += 1; }
      if (piece) { const h = markPieces(piece, base + off, ranges); cur += kind === 'i' ? '<ins>' + h + '</ins>' : h; }
      if (kind === 'i' && k < parts.length - 1) cur += '<ins class="nl">↵</ins>';
      off += piece.length;
    });
  }
  lines.push(cur);
  return lines;
}

function snippetOf(text, s, e) {
  const a = Math.max(0, s - 14), b = Math.min(text.length, e + 32);
  const f = x => esc(x.replace(/\s+/g, ' '));
  return (a > 0 ? '…' : '') + f(text.slice(a, s)) + '<mark>' + f(text.slice(s, e)) + '</mark>' + f(text.slice(e, b)) + (b < text.length ? '…' : '');
}

/* 最新の版だけを探す: 見つかった1か所ごとに1件 */
function searchLatest(notes, q, per) {
  const res = [];
  let total = 0;
  for (const n of notes) {
    const rs = matchRanges(n.text, q);
    total += rs.length;
    rs.slice(0, per).forEach(r => res.push({ id: n.id, s: r.s, e: r.e, snippet: snippetOf(n.text, r.s, r.e) }));
  }
  return { res: res, total: total };
}

/* 履歴すべてを探す: 検索語が見つかる「1か所」ごとに1件。
   その箇所が書かれた版(a)から、編集で壊されて消える直前の版(b)までを追いかける。
   編集のたびに、すでにある箇所は位置をずらして引き継ぎ、新しく生まれた箇所だけを編集まわりで探す。 */
function searchHistory(notes, q, per, probe) {
  const re = new RegExp(escRe(q), 'gi'), ql = q.length;
  const res = [];
  let total = 0;
  for (const n of notes) {
    const N = n.ops.length, found = [];
    let text = '', alive = [];
    for (let k = 1; k <= N; k++) {
      const op = n.ops[k - 1], dl = op.d.length, il = op.i.length, delta = il - dl;
      text = applyOp(text, op);
      const next = [];
      for (const m of alive) {
        if (m.e <= op.p) next.push(m);                                  // 編集より前: そのまま
        else if (m.s >= op.p + dl) { m.s += delta; m.e += delta; next.push(m); } // 編集より後: 位置だけずれる
        else { m.b = k - 1; m.removedAt = op.t; found.push(m); }        // 編集で壊れた
      }
      const lo = Math.max(0, op.p - (ql - 1)), hi = Math.min(text.length, op.p + il + (ql - 1));
      const seg = text.slice(lo, hi);
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(seg))) {
        if (!mm[0].length) { re.lastIndex++; continue; }
        const s = lo + mm.index, e = s + mm[0].length;
        if (!next.some(x => x.s < e && x.e > s)) next.push({ id: n.id, a: k, s: s, e: e, snippet: snippetOf(text, s, e) });
      }
      alive = next;
      if (probe) probe(k, text, alive);
    }
    for (const m of alive) { m.b = N; m.removedAt = 0; found.push(m); }
    found.sort((x, y) => y.a - x.a);
    total += found.length;
    found.slice(0, per).forEach(f => { f.addedAt = n.ops[f.a - 1].t; res.push(f); });
  }
  return { res: res, total: total };
}


/* ---------- 置換 ----------
   opts = { cs: 大文字小文字を区別, word: 単語単位, re: 正規表現 }。 */
const WORDCH = '0-9A-Za-z_\\u00C0-\\u024F\\u3040-\\u30FF\\u3400-\\u9FFF\\uFF10-\\uFF19\\uFF21-\\uFF3A\\uFF41-\\uFF5A\\uFF66-\\uFF9F';
/* 検索用の RegExp を作る。空の検索語は null、正規表現が正しくないときは { error } を返す */
function buildRe(q, opts) {
  opts = opts || {};
  if (!q) return null;
  let src = opts.re ? q : escRe(q);
  if (opts.word) src = '(?<![' + WORDCH + '])(?:' + src + ')(?![' + WORDCH + '])';
  try { return new RegExp(src, 'g' + (opts.cs ? '' : 'i') + (opts.re ? 'm' : '')); } catch (e) { return { error: String(e.message || e) }; }
}
/* 置換後の文字列を作る。正規表現のときだけ $1 / $& / \n / \t / \\ を使える */
function expandRepl(tpl, m, regex) {
  if (!regex) return tpl;
  let out = '';
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i], d = tpl[i + 1];
    if (c === '\\' && d === 'n') { out += '\n'; i++; }
    else if (c === '\\' && d === 't') { out += '\t'; i++; }
    else if (c === '\\' && d === '\\') { out += '\\'; i++; }
    else if (c === '$' && d === '$') { out += '$'; i++; }
    else if (c === '$' && d === '&') { out += m[0]; i++; }
    else if (c === '$' && d >= '0' && d <= '9') { const g = m[+d]; out += g == null ? '' : g; i++; }
    else out += c;
  }
  return out;
}
/* すべての一致(長さ0の一致は数えない) */
function findAll(text, re) {
  const out = [];
  if (!re || re.error) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length) out.push({ s: m.index, e: m.index + m[0].length, m });
    else re.lastIndex++;
  }
  return out;
}
/* from から dir(1=後ろ, -1=前)へ探す。端まで行って見つからなければ反対側から続け、wrapped を true にする */
function findFrom(text, re, from, dir) {
  const all = findAll(text, re);
  if (!all.length) return null;
  if (dir >= 0) {
    for (const x of all) if (x.s >= from) return { s: x.s, e: x.e, m: x.m, wrapped: false, index: all.indexOf(x), total: all.length };
    return { s: all[0].s, e: all[0].e, m: all[0].m, wrapped: true, index: 0, total: all.length };
  }
  for (let k = all.length - 1; k >= 0; k--) if (all[k].e <= from) return { s: all[k].s, e: all[k].e, m: all[k].m, wrapped: false, index: k, total: all.length };
  const l = all[all.length - 1];
  return { s: l.s, e: l.e, m: l.m, wrapped: true, index: all.length - 1, total: all.length };
}
/* すべて置換。{ text, count, first, last }(first〜last は変わった範囲の元の位置) */
function replaceAllText(text, re, tpl, regex) {
  const all = findAll(text, re);
  if (!all.length) return { text, count: 0, first: 0, last: 0 };
  let out = '', pos = 0;
  for (const x of all) { out += text.slice(pos, x.s) + expandRepl(tpl, x.m, regex); pos = x.e; }
  out += text.slice(pos);
  return { text: out, count: all.length, first: all[0].s, last: all[all.length - 1].e };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, applyOp, makeOp, textAt, inline, md, escRe, matchRanges, markPieces, diffLines, snippetOf, searchLatest, searchHistory, cursorInfo, selectionInfo, textStats, formatLines, noteLinkAt, linkText, pushRecent, headingSlug, titleOf, isImageName, attachName, attachMarkup, attachRefs, buildRe, expandRepl, findAll, findFrom, replaceAllText };
}
