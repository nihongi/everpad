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
/* ---------- 絵文字ショートコード(GitHub と同じ :smile: など) ----------
   一覧は emoji.js(gemoji。GitHub と同じ名前)。画面では <script> で読み込まれている(window.EVERPAD_EMOJI)。
   名前の前後が英数字のとき(12:100:3 など)と、一覧に無い名前は、そのまま文字で出す */
const EMOJI_LIST = typeof EVERPAD_EMOJI !== 'undefined' ? EVERPAD_EMOJI : (typeof require === 'function' ? require('./emoji') : []);
const EMOJI = new Map();
for (const [ch, names] of EMOJI_LIST) for (const n of names.split(' ')) if (!EMOJI.has(n)) EMOJI.set(n, ch);
const EMOJI_RE = /(?<![A-Za-z0-9]):([a-z0-9_+-]+):(?![A-Za-z0-9])/g;
const emojiHtml = s => s.replace(EMOJI_RE, (m, n) => (EMOJI.has(n) ? '<span class="emoji" title="' + m + '">' + EMOJI.get(n) + '</span>' : m));
const emojiText = s => s.replace(EMOJI_RE, (m, n) => EMOJI.get(n) || m);
/* 入力候補: q(: のあとに打った文字)で始まる名前を先に、次に q を途中に含む名前、次にタグが q で始まる絵文字。
   名前で合うものは短い名前を先に(:hea なら :heart:)、同じ長さは一覧の順(よく使う顔の絵文字が先)。[{ name, ch }] を max 個まで */
function emojiSuggest(q, max) {
  q = String(q || '').toLowerCase();
  max = max || 8;
  if (!q) return [];
  const exact = [], pre = [], mid = [], tag = [];
  for (const [ch, names, tags] of EMOJI_LIST) {
    let hit = false;
    for (const n of names.split(' ')) {
      if (n === q) exact.push({ name: n, ch: ch });
      else if (n.startsWith(q)) pre.push({ name: n, ch: ch });
      else if (n.indexOf(q) >= 0) mid.push({ name: n, ch: ch });
      else continue;
      hit = true;
    }
    if (!hit && tags && tags.split(' ').some(t => t.startsWith(q))) tag.push({ name: names.split(' ')[0], ch: ch });
  }
  const byLen = (a, b) => a.name.length - b.name.length;   // sort は安定なので、同じ長さは一覧の順のまま
  return exact.concat(pre.sort(byLen), mid.sort(byLen), tag).slice(0, max);
}
/* pos の直前が、絵文字の入力候補を出す形(: と名前の文字2つ以上)なら { from(: の位置), q }。
   : の前が英数字・:・/ のとき(12:30、http: など)は出さない。コードブロックの中でも出さない */
function emojiQueryAt(text, pos) {
  const before = text.slice(Math.max(0, pos - 64), pos);
  const m = /(^|[^A-Za-z0-9:/])(:([a-z0-9_+-]{2,}))$/.exec(before);
  if (!m) return null;
  const from = pos - m[2].length;
  if (inFenceAt(text, from)) return null;
  return { from: from, q: m[3] };
}

/* ---------- バックスラッシュのエスケープ(CommonMark と同じ) ----------
   \ のあとの ASCII の記号は、Markdown の記号として読まず、その文字のまま出す(\* → *)。$ は数式のところで扱う */
const ESCAPE_RE = /\\([!"#%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

/* ---------- URL の自動リンク(GitHub と同じ) ----------
   本文に書いた https://… / http://… / www.… と、<https://…> をリンクにする。esc() のあとの文字に使う。
   URL に使える ASCII の文字が続くところまで(日本語の文字や空白の手前で終わる)。最後の . , : ; ! ? * _ ~ と、
   対になっていない ) は URL に含めない(「https://example.com.」の「.」など) */
const URL_CH = "(?:&amp;|[!#-%'-;=?-~])";
const AUTOLINK_RE = new RegExp('\u0007\\d+\u0007[^\u0006]*\u0006|&lt;(https?://' + URL_CH + '+?)&gt;|(?<![A-Za-z0-9/.@:+_-])((?:https?://|www\\.)[A-Za-z0-9]' + URL_CH + '*)', 'gi');
function trimUrl(u) {
  for (;;) {
    if (/[.,:!?*_~']$/.test(u) || (/;$/.test(u) && !/&amp;$/.test(u))) { u = u.slice(0, -1); continue; }
    if (/\)$/.test(u) && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) { u = u.slice(0, -1); continue; }
    return u;
  }
}
const aTag = (href, text) => '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';

/* ---------- アラート(GitHub と同じ > [!NOTE] など) ----------
   引用の1行目が [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION] だけなら、色と見出しの付いた注意書きにする。
   見出しの言葉は画面の言語(setMdLang)。AsciiDoc の注記と同じ5種類で、書き出しもそれに合わせる */
const ALERT_TITLES = {
  ja: { note: '注記', tip: 'ヒント', important: '重要', warning: '警告', caution: '注意' },
  en: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }
};
const ALERT_ICONS = {
  note: '<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.9v.1"/>',
  tip: '<path d="M8 1.75a4.25 4.25 0 0 0-2.5 7.7c.5.4.75.9.75 1.55h3.5c0-.65.25-1.15.75-1.55A4.25 4.25 0 0 0 8 1.75z"/><path d="M6.25 13h3.5M6.75 14.75h2.5"/>',
  important: '<path d="M2.25 2.75h11.5v8.5h-6.5l-3 2.5v-2.5h-2z"/><path d="M8 5v3M8 9.9v.1"/>',
  warning: '<path d="M8 1.9 14.75 13.75H1.25z"/><path d="M8 6v3.5M8 11.4v.1"/>',
  caution: '<path d="M5.3 1.75h5.4l3.55 3.55v5.4l-3.55 3.55H5.3l-3.55-3.55V5.3z"/><path d="M8 4.75v4M8 10.9v.1"/>'
};
const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const FN_BACK = { ja: '本文に戻る', en: 'Back to text' };
let MD_LANG = 'ja';
function setMdLang(lang) { MD_LANG = ALERT_TITLES[lang] ? lang : 'en'; }
function alertTitle(kind) {
  return '<p class="alert-title"><svg class="alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + ALERT_ICONS[kind] + '</svg>' + ALERT_TITLES[MD_LANG][kind] + '</p>';
}

/* ---------- 脚注(GitHub と同じ 本文[^1] と [^1]: 注の文) ----------
   注の定義は、行の先頭の [^名前]: から。続く行は、字下げした行と、空の行をはさまずに続く普通の文(段落の続き)。
   空の行のあとでも、字下げした行なら同じ注の続き(複数の段落)。定義の行は本文からは除き(空の行にして行番号は保つ)、
   最初に参照した順に番号を付けて、メモの最後に注の一覧を出す。参照の無い注は出さない。定義の無い [^名前] はそのまま文字で出す */
const FN_DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const BLOCK_START_RE = /^\s*(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d{1,9}[.)]\s|`{3,}|~{3,}|\$\$|\\\[|([-*_])(?:\s*\1){2,}\s*$)/;
let FN = null;   // md() の間だけ: { defs: Map(名前 → { lines, n, refs }), order: [注], count }
function footnoteDefs(lines) {
  const defs = new Map();
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (fence) { if (fenceCloses(ln, fence)) fence = null; continue; }
    if (FENCE_OPEN.test(ln)) { fence = ln.match(FENCE_OPEN_RE)[1]; continue; }
    const m = ln.match(FN_DEF_RE);
    if (!m) continue;
    const body = [m[2]];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (/^\s*$/.test(l)) {
        let k = j;
        while (k < lines.length && /^\s*$/.test(lines[k])) k++;
        if (k < lines.length && /^(?: {2,}|\t)/.test(lines[k])) { for (; j < k; j++) body.push(''); continue; }
        break;
      }
      if (/^(?: {2,}|\t)/.test(l)) { body.push(l.replace(/^(?: {1,4}|\t)/, '')); j++; continue; }
      if (body[body.length - 1].trim() !== '' && !FN_DEF_RE.test(l) && !BLOCK_START_RE.test(l)) { body.push(l); j++; continue; }
      break;
    }
    const key = esc(m[1]).toLowerCase();
    if (!defs.has(key)) defs.set(key, { lines: body, n: 0, refs: 0 });
    for (let k = i; k < j; k++) lines[k] = '';
    i = j - 1;
  }
  return { defs: defs, order: [], count: 0 };
}
/* 文中の [^名前](esc() のあとの文字)。定義があれば上付きの番号のリンク、無ければ null */
function footnoteRef(label) {
  const f = FN && FN.defs.get(label.toLowerCase());
  if (!f) return null;
  if (!f.n) { f.n = ++FN.count; FN.order.push(f); }
  f.refs++;
  return '<sup class="fnref"><a href="#fn-' + f.n + '" id="fnref-' + f.n + (f.refs > 1 ? '-' + f.refs : '') + '" data-fn="' + f.n + '">' + f.n + '</a></sup>';
}
function footnotesHtml() {
  const items = [];
  // 注の中で別の注を参照すると、一覧が伸びる
  for (let k = 0; k < FN.order.length; k++) {
    const f = FN.order[k];
    const back = '<a href="#fnref-' + f.n + '" class="fnback" data-fnback="' + f.n + '" aria-label="' + FN_BACK[MD_LANG] + '" title="' + FN_BACK[MD_LANG] + '">↩︎</a>';
    let body = mdBlocks(f.lines.slice(), -1);
    body = /<\/p>$/.test(body) ? body.replace(/<\/p>$/, ' ' + back + '</p>') : body + '<p>' + back + '</p>';
    items.push('<li id="fn-' + f.n + '" data-fn="' + f.n + '">' + body + '</li>');
  }
  return '\n<section class="footnotes"><ol>' + items.join('') + '</ol></section>';
}

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
/* Mermaid の図のかたまり。data-src に元の文を持たせ、図にするまで(図にできないときも)元の文をコードとして出す */
function diagramHtml(src) {
  return '<div class="diagram" data-src="' + esc(src) + '"><pre class="diagram-src"><code>' + esc(src) + '</code></pre></div>';
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
  // \* などのエスケープ: その文字のまま出す。ほかの書式に読まれないよう、最後まで退避する
  const escs = [];
  s = s.replace(ESCAPE_RE, (m, c) => { escs.push(c); return '\u0005' + (escs.length - 1) + '\u0005'; });
  s = esc(s);
  // 添付: ![名前](attach:ID) は画像、[名前](attach:ID) はファイルへのリンク。ほかの書式の影響を受けないよう、いったん退避する
  const atts = [];
  const keep = h => { atts.push(h); return '\u0002' + (atts.length - 1) + '\u0002'; };
  s = s.replace(/!\[([^\]]*)\]\(attach:([0-9a-f]{16}(?:\.[a-z0-9]{1,8})?)\)/g, (m, alt, id) => keep('<img class="att-img" data-att="' + id + '" alt="' + alt + '" loading="lazy">'));
  s = s.replace(/\[([^\]]+)\]\(attach:([0-9a-f]{16}(?:\.[a-z0-9]{1,8})?)\)/g, (m, t, id) => keep('<a class="att-file" href="#" data-att="' + id + '" title="' + t + '">' + emojiHtml(t) + '</a>'));
  // 他のメモへのリンク。参照先の題名や、削除されているかは、画面に出すときに app.js が付ける
  s = s.replace(NOTE_LINK_RE, (m, t, id) => keep('<a class="note-link" href="#" data-note="' + id + '">' + emojiHtml(t) + '</a>'));
  // 脚注の参照(定義のあるものだけ)
  s = s.replace(/\[\^([^\]\s]+)\]/g, (m, label) => { const r = footnoteRef(label); return r ? keep(r) : m; });
  // https:// のリンク。表示する文字には太字などが効くよう、開きのタグだけ退避し、閉じは \u0006 にしておく(自動リンクはこの間を飛ばす)
  const opens = [];
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => { opens.push('<a href="' + u + '" target="_blank" rel="noopener noreferrer">'); return '\u0007' + (opens.length - 1) + '\u0007' + t + '\u0006'; });
  // それ以外のリンク: GitHub と同じく表示名をリンクの見た目で出す(<a> にはしない)。
  //   #見出し … 同じメモの中の見出しへ移動する(日本語の見出しも使える)
  //   相対パスなど([LICENSE](LICENSE)) … EverPad には開く先が無いので、クリックすると知らせる。
  //     「[重要](後で確認)」のような普通の文章を崩さないよう、行き先が URL やファイル名に使う半角の文字だけのときに限る
  const other = (t, u) => keep('<span class="link-other" data-target="' + u + '">' + emojiHtml(t) + '</span>');
  s = s.replace(/\[([^\]]+)\]\((#[^\s()]+)\)/g, (m, t, u) => other(t, u));
  s = s.replace(/\[([^\]]+)\]\(([A-Za-z0-9._~:/?#@!$&'*+,;=%-]+)\)/g, (m, t, u) => other(t, u));
  // 本文に書いた URL(https://…・www.…・<https://…>)
  s = s.replace(AUTOLINK_RE, (m, angle, bare) => {
    if (angle) return keep(aTag(angle, angle));
    if (!bare) return m;
    const u = trimUrl(bare);
    if (!/^(?:https?:\/\/|www\.)[A-Za-z0-9]/i.test(u)) return m;
    return keep(aTag(/^www\./i.test(u) ? 'http://' + u : u, u)) + bare.slice(u.length);
  });
  s = s.replace(EMOJI_RE, (m, n) => (EMOJI.has(n) ? keep(emojiHtml(m)) : m));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => atts[+i]);
  s = s.replace(/\u0007(\d+)\u0007/g, (_, i) => opens[+i]).replace(/\u0006/g, '</a>');
  s = s.replace(/\u0004(\d+)\u0004/g, (_, i) => maths[+i]).replace(/\u0003/g, '$');
  s = s.replace(/\u0005(\d+)\u0005/g, (_, i) => esc(escs[+i]));
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

/* ---------- 選んだ文字を太字・斜体・取り消し線・コードにする ----------
   kind: bold(**) / italic(*) / strike(~~) / icode(`)。戻り値は formatLines と同じ形で、何もしないときは null。
   - 選択が複数行にまたがるときは、行ごとに、その行の選んだ部分だけを装飾する
   - 行頭の字下げ・箇条書きの記号・チェックボックス・> ・# と、前後の空白は、記号の外に残す
   - 空の行・コードブロック(囲みの行も)・区切り線・表の |---| の行は飛ばす。表の行はセルごとに装飾する
   - 選んだ部分がすべてすでにその装飾なら外す(記号まで含めて選んでも、内側だけを選んでも同じ)。
     そうでなければ装飾する。中にある同じ装飾は先に外し、すでに装飾されている部分はそのままにする
   - 装飾したあとは、記号の内側の文字を選んだままにする(続けて別の装飾もかけられる)。複数の部分なら、最初から最後までを選ぶ
   - 何も選んでいないときは、記号の組を入れてカーソルを真ん中に置く(空の組の真ん中なら、組を消す) */
const INLINE_MARKS = { bold: '**', italic: '*', strike: '~~', icode: '`' };
const BLOCK_PREFIX = /^(?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}(?:[ \t]+|$)))*[ \t]*/;
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const runBefore = (s, i, ch) => { let k = 0; while (i - k > 0 && s[i - k - 1] === ch) k++; return k; };
const runAfter = (s, i, ch) => { let k = 0; while (s[i + k] === ch) k++; return k; };
/* 記号の連なり n 個が、その装飾の記号として読めるか(*** は太字と斜体の両方) */
const inlineRunOk = (kind, n) => (kind === 'bold' ? n === 2 || n === 3 : kind === 'italic' ? n === 1 || n === 3 : kind === 'strike' ? n === 2 : n >= 1);
/* u の中に、その装飾の記号として読める連なりがあるか */
function hasInlineMark(u, kind) {
  const re = { bold: /\*+/g, italic: /\*+/g, strike: /~+/g }[kind];
  return (u.match(re) || []).some(r => inlineRunOk(kind, r.length));
}
/* u 全体がその装飾で囲まれていれば、記号を外した中身を返す。囲まれていなければ null */
function inlineInner(u, kind) {
  const ch = INLINE_MARKS[kind][0];
  const n = runAfter(u, 0, ch), m = runBefore(u, u.length, ch);
  if (!n || n !== m || n + m >= u.length || !inlineRunOk(kind, n)) return null;
  if (kind === 'icode') {
    let c = u.slice(n, u.length - n);
    if ((c.match(/`+/g) || []).some(r => r.length === n)) return null;
    if (c.length >= 2 && c[0] === ' ' && c[c.length - 1] === ' ' && c.trim()) c = c.slice(1, -1);
    return c;
  }
  const k = INLINE_MARKS[kind].length, c = u.slice(k, u.length - k);
  return hasInlineMark(c, kind) ? null : c;
}
/* u のすぐ外側(text の a の前と b の後)がその装飾の記号なら、外す記号の数。違えば 0 */
function inlineOuter(text, a, b, kind) {
  const ch = INLINE_MARKS[kind][0];
  const l = runBefore(text, a, ch), r = runAfter(text, b, ch);
  if (!l || l !== r || !inlineRunOk(kind, l)) return 0;
  return kind === 'icode' ? l : INLINE_MARKS[kind].length;
}
/* 装飾を付けた文字列 { s: 全体, at: 中身の始まり, len: 中身の長さ } */
function inlineWrap(u, kind) {
  if (kind === 'icode') {
    const n = Math.max(0, ...(u.match(/`+/g) || []).map(r => r.length)) + 1;
    const pad = u[0] === '`' || u[u.length - 1] === '`' ? ' ' : '';
    const f = '`'.repeat(n);
    return { s: f + pad + u + pad + f, at: n + pad.length, len: u.length };
  }
  // 中にある同じ装飾を外す(プレビューと同じ読み方で、装飾として表示されるものだけ)
  const c = kind === 'bold' ? u.replace(/\*\*([^*]+)\*\*/g, '$1')
    : kind === 'italic' ? u.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1$2')
      : u.replace(/~~([^~]+)~~/g, '$1');
  const mk = INLINE_MARKS[kind];
  return { s: mk + c + mk, at: mk.length, len: c.length };
}
/* 表の行か(md と同じく、「|」のある行の次が |---| の行なら見出しの行、その下に続く「|」のある行も表の行) */
function isTableRowAt(lines, k) {
  const bar = l => l != null && l.indexOf('|') >= 0;
  if (!bar(lines[k])) return false;
  if (lines[k + 1] != null && isDelim(lines[k + 1])) return true;
  for (let j = k - 1; j >= 1; j--) {
    if (isDelim(lines[j])) return bar(lines[j - 1]);
    if (!lines[j].trim() || !bar(lines[j])) return false;
  }
  return false;
}
function inlineFormat(text, selStart, selEnd, kind) {
  const mk = INLINE_MARKS[kind];
  if (!mk) return null;
  if (selStart === selEnd) {
    const s = selStart, ch = mk[0];
    if (runBefore(text, s, ch) === mk.length && runAfter(text, s, ch) === mk.length) {
      return { from: s - mk.length, to: s + mk.length, insert: '', selStart: s - mk.length, selEnd: s - mk.length };
    }
    return { from: s, to: s, insert: mk + mk, selStart: s + mk.length, selEnd: s + mk.length };
  }
  const end = text[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const from = text.lastIndexOf('\n', selStart - 1) + 1;
  let to = text.indexOf('\n', end); if (to < 0) to = text.length;
  const lines = text.split('\n');
  let li = text.slice(0, from).split('\n').length - 1;
  let open = fenceOpenAt(text, from);
  // 装飾する部分(units)を集める
  const units = [];
  for (let ls = from; ; li++) {
    let le = text.indexOf('\n', ls); if (le < 0) le = text.length;
    const line = text.slice(ls, le);
    if (open) { if (fenceCloses(line, open)) open = null; }
    else if (FENCE_OPEN.test(line)) open = line.match(FENCE_OPEN_RE)[1];
    else if (line.trim() && !HR_RE.test(line) && !isDelim(line)) {
      const a = Math.max(selStart, ls + line.match(BLOCK_PREFIX)[0].length), b = Math.min(end, le);
      const cells = [];
      if (isTableRowAt(lines, li)) {
        let cs = ls;
        for (let i = ls; i <= le; i++) {
          if (i === le || (text[i] === '|' && text[i - 1] !== '\\')) { cells.push([cs, i]); cs = i + 1; }
        }
      } else cells.push([ls, le]);
      for (const c of cells) {
        let ua = Math.max(a, c[0]), ub = Math.min(b, c[1]);
        while (ua < ub && /\s/.test(text[ua])) ua++;
        while (ub > ua && /\s/.test(text[ub - 1])) ub--;
        if (ua < ub) units.push({ a: ua, b: ub });
      }
    }
    if (le >= to) break;
    ls = le + 1;
  }
  if (!units.length) return null;
  for (const u of units) {
    u.inner = inlineInner(text.slice(u.a, u.b), kind);
    u.outer = u.inner == null ? inlineOuter(text, u.a, u.b, kind) : 0;
  }
  const off = units.every(u => u.inner != null || u.outer);
  // 置き換えを組み立てる。e: { a, b: 置き換える範囲, s: 新しい文字列, at, len: 新しい文字列の中で、選ぶ部分 }
  const edits = units.map(u => {
    const t = text.slice(u.a, u.b);
    if (off) return u.inner != null ? { a: u.a, b: u.b, s: u.inner, at: 0, len: u.inner.length } : { a: u.a - u.outer, b: u.b + u.outer, s: t, at: 0, len: t.length };
    if (u.inner != null || u.outer) return { a: u.a, b: u.b, s: t, at: 0, len: t.length };
    const w = inlineWrap(t, kind);
    return { a: u.a, b: u.b, s: w.s, at: w.at, len: w.len };
  });
  let out = '', pos = from;
  for (const e of edits) {
    out += text.slice(pos, e.a);
    e.start = from + out.length;
    out += e.s;
    pos = e.b;
  }
  out += text.slice(pos, to);
  const first = edits[0], last = edits[edits.length - 1];
  return edits.length === 1
    ? { from: from, to: to, insert: out, selStart: first.start + first.at, selEnd: first.start + first.at + first.len }
    : { from: from, to: to, insert: out, selStart: first.start, selEnd: last.start + last.s.length };
}

/* ---------- 改行と字下げ(自動インデント・箇条書きの続き・Tab) ----------
   どれも { from, to, insert, selStart, selEnd }(from〜to を insert に置き換え、選択を selStart〜selEnd にする)を返す。
   何もしないとき(ブラウザの普通の改行でよいとき)は null */

/* pos のある行が、コードブロック(``` か ~~~ の囲み)の中か。囲みの決まりはプレビューと同じ */
function inFenceAt(text, pos) { return !!fenceOpenAt(text, pos); }
/* pos のある行の時点で開いている囲みの記号(``` など)。囲みの外なら null */
function fenceOpenAt(text, pos) {
  const lines = text.slice(0, text.lastIndexOf('\n', pos - 1) + 1).split('\n');
  let open = null;
  for (const ln of lines) {
    if (open) { if (fenceCloses(ln, open)) open = null; }
    else if (FENCE_OPEN.test(ln)) open = ln.match(FENCE_OPEN_RE)[1];
  }
  return open;
}

/* 箇条書き・番号付き・チェックボックス・引用の記号。
   1:字下げ 2:記号(- * +) 3:記号の後の空白 4:チェックボックス 5:番号 6:. か ) 7:番号の後の空白 8:> の後の空白 */
const LIST_RE = /^([ \t]*)(?:([-*+])([ \t]+)(\[[ xX]\][ \t]+)?|(\d{1,9})([.)])([ \t]+)|>([ \t]?))/;

/* Enter を押したとき。o: { indent: 自動インデント, list: 箇条書きを続ける, soft: Shift+Enter }
   - 箇条書きなどの行では、次の行に同じ記号を付ける(番号は1つ増やし、チェックは外す)。記号だけの行では記号を消して空の行にする。
     Shift+Enter では記号を付けず、項目の文字の位置まで字下げする。カーソルが記号より前なら、記号は付けない
   - それ以外は、行の先頭の半角スペースとタブを引き継ぐ(カーソルより前の分だけ)。全角スペースは引き継がない
   - 空白だけの行で改行すると、その行の空白を消して、次の行に同じ字下げを付ける(vim と同じ) */
function newlineEdit(text, s, e, o) {
  o = o || {};
  const ls = text.lastIndexOf('\n', s - 1) + 1;
  let le = text.indexOf('\n', s); if (le < 0) le = text.length;
  const line = text.slice(ls, le);
  const at = (ins, from, to) => {
    from = from == null ? s : from; to = to == null ? e : to;
    return { from: from, to: to, insert: ins, selStart: from + ins.length, selEnd: from + ins.length };
  };
  const m = o.list && !inFenceAt(text, s) ? line.match(LIST_RE) : null;
  if (m && s - ls >= m[0].length) {
    const ind = m[1];
    if (o.soft) return m[2] || m[5] ? at('\n' + ind + ' '.repeat(m[0].length - ind.length)) : (o.indent ? at('\n' + ind) : null);
    if (s === e && /^[ \t]*$/.test(line.slice(m[0].length))) return at('', ls, le);   // 記号だけの行: 箇条書きを終える
    const mark = m[2] ? m[2] + m[3] + (m[4] ? '[ ]' + m[4].slice(3) : '')
      : m[5] ? (Number(m[5]) + 1) + m[6] + m[7]
      : '>' + (m[8] || ' ');
    return at('\n' + ind + mark);
  }
  if (!o.indent) return null;
  if (s === e && line && /^[ \t]*$/.test(line)) return at('\n' + line, ls, le);       // 空白だけの行
  const keep = text.slice(ls, s).match(/^[ \t]*/)[0];
  return keep ? at('\n' + keep) : null;
}

/* 選んだ行をまとめて字下げする(outdent なら戻す)。行の決まりは書式と同じ(終わりが次の行の先頭ちょうどなら含めない)。
   字下げは空の行(空白だけの行)には付けない。戻すときは、行の先頭からスペース width 個まで、またはタブ1つを消す */
function indentEdit(text, s, e, width, outdent) {
  let end = e;
  if (e > s && text[e - 1] === '\n') end = e - 1;
  const from = text.lastIndexOf('\n', s - 1) + 1;
  let to = text.indexOf('\n', end); if (to < 0) to = text.length;
  const unit = ' '.repeat(width);
  const strip = new RegExp('^(?:\\t| {1,' + width + '})');
  const segs = [], out = [];
  let cur = from;
  for (const l of text.slice(from, to).split('\n')) {
    let add = 0, cut = 0, nl = l;
    if (outdent) { const mm = l.match(strip); if (mm) { cut = mm[0].length; nl = l.slice(cut); } }
    else if (!/^[ \t]*$/.test(l)) { add = width; nl = unit + l; }
    out.push(nl);
    segs.push({ start: cur, len: l.length, add: add, cut: cut });
    cur += l.length + 1;
  }
  if (!segs.some(g => g.add || g.cut)) return null;
  // 元の位置 p が、置き換えたあとでどこになるか。選択の始まりが行の先頭なら、字下げの前に置く(字下げも選んだままにする)
  const map = (p, keepAtStart) => {
    let d = 0;
    for (const g of segs) {
      if (p > g.start + g.len) { d += g.add - g.cut; continue; }
      if (p < g.start) break;
      const col = p - g.start;
      if (g.add) return p + d + (col === 0 && keepAtStart ? 0 : g.add);
      return p + d - Math.min(g.cut, col);
    }
    return p + d;
  };
  const sel = s !== e;
  return { from: from, to: to, insert: out.join('\n'), selStart: map(s, sel), selEnd: map(e, false) };
}

/* Tab / Shift+Tab を押したとき(width は字下げの幅: 2 か 4)。
   - Shift+Tab: 今の行(選んでいれば選んだ行)の字下げを1段戻す
   - 文字を選んでいる: 選んだ行をまとめて字下げする(選んだ文字は消さない)
   - 箇条書き・番号付きの行(コードブロックの外): 行の先頭を字下げして、1段深い入れ子にする
   - それ以外: カーソルの位置に、次の字下げの位置までスペースを入れる */
function tabEdit(text, s, e, width, shift) {
  if (shift || s !== e) return indentEdit(text, s, e, width, !!shift);
  const ls = text.lastIndexOf('\n', s - 1) + 1;
  let le = text.indexOf('\n', s); if (le < 0) le = text.length;
  const m = text.slice(ls, le).match(LIST_RE);
  if (m && (m[2] || m[5]) && !inFenceAt(text, s)) return indentEdit(text, s, e, width, false);
  let col = 0;
  for (const ch of text.slice(ls, s)) col = ch === '\t' ? col + width - (col % width) : col + 1;
  const ins = ' '.repeat(width - (col % width));
  return { from: s, to: s, insert: ins, selStart: s + ins.length, selEnd: s + ins.length };
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
/* 履歴の1回の編集で、変更し終えた位置(その版の本文の中の位置)。
   追加なら追加し終えた位置(その編集のすぐあとのカーソルの位置)、削除だけなら削除した位置 */
function changeEnd(op) {
  return op ? op.p + (op.i ? op.i.length : 0) : 0;
}

/* 文中のショートカットキーを Mac の書き方にする(Ctrl+Shift+U → ⇧⌘U、Ctrl+K → ⌘K、Ctrl+クリック → ⌘+クリック) */
function macKeys(s) {
  return String(s)
    .replace(/Ctrl\+Shift\+/g, '⇧⌘')
    .replace(/Ctrl\+(?=click|クリック)/g, '⌘+')
    .replace(/Ctrl\+/g, '⌘');
}

function pushRecent(list, id, title, max) {
  return [{ id: id, title: title, t: Date.now() }].concat((list || []).filter(r => r && r.id !== id)).slice(0, max);
}

/* 見出しの文字から、GitHub と同じ規則で、ページ内リンク(#…)の名前を作る:
   小文字にし、文字・数字・空白・- ・_ 以外を取り除き、空白を - にする(日本語などの文字はそのまま) */
const headingSlug = text => String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');

/* メモの題名: 最初の空でない行(見出しなどの記号は除く)。無いときは ''(表示側で「無題のメモ」などを出す) */
/* 題名: 最初の文字のある行。装飾の記号(**・*・~~・`)は、プレビューと同じ読み方で外す(「# **買い物**」は「買い物」)。
   エスケープ(\*)はその文字に、絵文字ショートコードは絵文字にし、脚注の参照([^1])は除く */
function plainLine(s) {
  const kept = [];
  const put = v => { kept.push(v); return '\u0001' + (kept.length - 1) + '\u0001'; };
  s = s.replace(/(`+)(.+?)\1/g, (m, f, c) => put(c.trim() || c))
    .replace(ESCAPE_RE, (m, c) => put(c))
    .replace(/\[\^[^\]\s]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^[#>\s\-*+]+/, '');
  return emojiText(s).replace(/\u0001(\d+)\u0001/g, (_, i) => kept[+i]).trim();
}
const titleOf = text => {
  for (const ln of text.split('\n')) { const t = plainLine(ln); if (t) return t.slice(0, 60); }
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

/* 本文から、ある添付へのリンク(![名前](attach:ID) と [名前](attach:ID))をすべて消す。
   リンクを消して空になった行(空白や箇条書きの記号だけが残る行)は、行ごと消す。{ text, count } を返す */
function removeAttachRefs(text, fileId) {
  const re = new RegExp('!?\\[[^\\]\\n]*\\]\\(attach:' + escRe(fileId) + '\\)', 'g');
  let count = 0;
  const out = [];
  for (const line of text.split('\n')) {
    const n = (line.match(re) || []).length;
    if (!n) { out.push(line); continue; }
    count += n;
    const rest = line.replace(re, '');
    if (/^[ \t]*(?:[-*+]|\d{1,9}[.)]|>)?(?:[ \t]+\[[ xX]\])?[ \t]*$/.test(rest)) continue;
    out.push(rest);
  }
  return { text: count ? out.join('\n') : text, count: count };
}

function mdList(lines, i, out, base) {
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const stack = [];
  let html = '';
  // 項目の開始のタグ。行の範囲を付けるときは、まず最初の行だけ付け、終わり(次の項目の行かリストの終わり)は最後にまとめて足す
  const starts = [];
  const li = () => { if (!(base >= 0)) return '<li>'; starts.push(base + i); return '<li data-line="' + (base + i) + '">'; };
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
    if (stack.length && ind === stack[stack.length - 1].ind) html += '</li>' + li();
    else {
      // 番号付きは、最初の項目に書いた番号から数える(4. から始めれば 4, 5, … と表示する)
      const start = tag === 'ol' ? parseInt(m[2], 10) : 1;
      html += '<' + tag + (start !== 1 ? ' start="' + start + '"' : '') + '>' + li();
      stack.push({ ind: ind, tag: tag });
    }
    const t = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
    html += t ? '<input type="checkbox" disabled' + (t[1] !== ' ' ? ' checked' : '') + '> ' + inline(t[2]) : inline(m[3]);
    i++;
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  if (starts.length) {
    // 本文の文字は esc してあるので、この形のタグは項目の開始のタグだけ
    let k = 0;
    const ends = starts.slice(1).concat(base + Math.min(i, lines.length));
    html = html.replace(/<li data-line="(\d+)">/g, (m0, n) => '<li data-line="' + n + '" data-end="' + ends[k++] + '">');
  }
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

/* Markdown を HTML にする。opts.lines が真なら、かたまりごとに元の文の行の範囲を data-line(最初の行)・data-end(終わりの次の行)で付ける
   (行は 0 から数える)。編集とプレビューを切り替えたときに、同じ場所を見せるために使う(syncAnchors)。
   付けるのは、段落・見出し・コード・数式・図・区切り線・リストの項目・表の行だけで、これらの行の範囲は重ならない。
   書き出しや印刷では付けない */
function md(text, opts) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const prev = FN;
  FN = footnoteDefs(lines);
  try {
    const html = mdBlocks(lines, opts && opts.lines ? 0 : -1);
    return FN.order.length ? html + footnotesHtml() : html;
  } finally { FN = prev; }
}
const lineAttr = (base, s, e) => (base < 0 ? '' : ' data-line="' + (base + s) + '" data-end="' + (base + e) + '"');
/* base: lines[0] が元の文の何行目か。負なら行の範囲を付けない */
function mdBlocks(lines, base) {
  const out = [];
  let para = [], paraAt = 0;
  let i = 0;
  // かたまりの最初のタグに行の範囲を付けて出す
  const put = (html, s) => { out.push(base < 0 ? html : html.replace(/^<([a-z][a-z0-9]*)/i, (m) => m + lineAttr(base, s, Math.min(i, lines.length)))); };
  const flush = () => { if (para.length) { const s = paraAt; out.push('<p' + lineAttr(base, s, s + para.length) + '>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  while (i < lines.length) {
    const ln = lines[i];
    const at = i;
    let m;
    // 数式のかたまり: ```math のコードブロック、$$ … $$、\[ … \]
    const mf = ln.match(/^\s*(`{3,}|~{3,})math\s*$/);
    if (mf) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !fenceCloses(lines[i], mf[1]); i++) buf.push(lines[i]);
      i++;
      put(renderMath(buf.join('\n'), true, true), at);
      continue;
    }
    const mb = mathBlock(lines, i);
    if (mb) { flush(); i = mb.next; put(renderMath(mb.tex, true, true), at); continue; }
    // Mermaid の図: ```mermaid のコードブロック。ここでは元の文を出し、画面側(diagram.js)があとで図に置き換える
    const mm = ln.match(/^\s*(`{3,}|~{3,})mermaid\s*$/);
    if (mm) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !fenceCloses(lines[i], mm[1]); i++) buf.push(lines[i]);
      i++;
      put(diagramHtml(buf.join('\n')), at);
      continue;
    }
    if (FENCE_OPEN.test(ln)) {
      flush();
      const f = mdFence(lines, i);
      i = f.next;
      put(f.html, at);
      continue;
    }
    if (/^\s*$/.test(ln)) { flush(); i++; continue; }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); i++; put('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>', at); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); i++; put('<hr>', at); continue; }
    if (/^>\s?/.test(ln)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      const am = buf[0].match(ALERT_RE);
      if (am) {
        const k = am[1].toLowerCase();
        out.push('<blockquote class="alert alert-' + k + '" data-alert="' + k + '">' + alertTitle(k) + mdBlocks(buf.slice(1), base < 0 ? -1 : base + at + 1) + '</blockquote>');
      } else out.push('<blockquote>' + mdBlocks(buf, base < 0 ? -1 : base + at) + '</blockquote>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) { flush(); i = mdList(lines, i, out, base); continue; }
    if (ln.indexOf('|') >= 0 && i + 1 < lines.length && isDelim(lines[i + 1])) {
      const head = splitRow(ln), dl = splitRow(lines[i + 1]);
      if (head.length === dl.length) {
        flush();
        const al = dl.map(c => (/^:-+:$/.test(c) ? 'c' : /-:$/.test(c) ? 'r' : 'l'));
        const cls = k => ' class="al-' + al[k] + '"';
        const th = head.map((c, k) => '<th' + cls(k) + '>' + inline(c) + '</th>').join('');
        const headAt = i;
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
          const r = splitRow(lines[i]);
          rows.push('<tr' + lineAttr(base, i, i + 1) + '>' + head.map((_, k) => '<td' + cls(k) + '>' + inline(r[k] || '') + '</td>').join('') + '</tr>');
          i++;
        }
        out.push('<div class="tblwrap"><table><thead><tr' + lineAttr(base, headAt, headAt + 2) + '>' + th + '</tr></thead>' + (rows.length ? '<tbody>' + rows.join('') + '</tbody>' : '') + '</table></div>');
        continue;
      }
    }
    if (!para.length) paraAt = i;
    para.push(ln.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

/* ---------- 表示を切り替えたときの位置合わせ ----------
   anchors は、表示の中のかたまりを上から順に並べたもの: { s, e, top, bottom }。
   s〜e(e は終わりの次)が元の文の行、top〜bottom が表示の中の縦の位置(px)。行の範囲どうし、縦の位置どうしは重ならない。
   かたまりの中は、高さの割合で行を割り振る。かたまりの間(空行など)は、前のかたまりの下と次のかたまりの上の間で割り振る。
   行は小数(3.5 なら 4 行目の途中)。 */
function lineToY(anchors, line) {
  let prev = null, next = null;
  for (const a of anchors) {
    if (a.s <= line && line < a.e) return a.top + (a.bottom - a.top) * (line - a.s) / (a.e - a.s);
    if (a.e <= line && (!prev || a.e >= prev.e)) prev = a;
    if (a.s > line && (!next || a.s < next.s)) next = a;
  }
  if (prev && next) return prev.bottom + (next.top - prev.bottom) * (line - prev.e) / Math.max(1, next.s - prev.e);
  return prev ? prev.bottom : next ? next.top : 0;
}
function yToLine(anchors, y) {
  let hit = null, prev = null, next = null;
  for (const a of anchors) {
    if (a.top <= y && y < a.bottom && (!hit || a.top >= hit.top)) hit = a;
    if (a.bottom <= y && (!prev || a.bottom >= prev.bottom)) prev = a;
    if (a.top > y && (!next || a.top < next.top)) next = a;
  }
  if (hit) return hit.s + (hit.e - hit.s) * (y - hit.top) / (hit.bottom - hit.top);
  if (prev && next) return prev.e + (next.s - prev.e) * (y - prev.bottom) / Math.max(1, next.top - prev.bottom);
  return prev ? prev.e : next ? next.s : 0;
}
/* 行の範囲に入るかたまり(無ければ、そのあとの最初のかたまり、それも無ければ最後のかたまり)。目印を光らせる先 */
function anchorAt(anchors, line) {
  let after = null;
  for (const a of anchors) {
    if (a.s <= line && line < a.e) return a;
    if (!after && a.s > line) after = a;
  }
  return after || anchors[anchors.length - 1] || null;
}

/* ---------- 検索 ---------- */
const escRe =s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/* ---------- 履歴の変更箇所の表示を、かたまりに分ける ----------
   lines は diffLines が返す行ごとの HTML。およそ size 行ずつに分け、[始まり, 終わり) の組の配列を返す。
   画面側は、かたまりごとに content-visibility: auto を付ける。画面の外のかたまりは描画と、読み上げ用の情報の計算を省くので、
   何千行もあるメモでも止まらない(行ごとの要素が数千あると、読み上げの仕組みが動いているときに10秒ほど止まることがあった)。
   かたまりの最後が空の行(または改行で終わる行)だと、折り返しの表示でその行が見えなくなるので、そこでは切らずに次の行まで含める */
function chunkLines(lines, size) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (i + 1 - s < size) continue;
    const visible = String(lines[i]).replace(/(<[^>]*>)+$/, '');
    if (visible && !visible.endsWith('\n')) { out.push([s, i + 1]); s = i + 1; }
  }
  out.push([s, lines.length]);
  return out;
}

/* ---------- 履歴表示の検索: 版ごとの検索語の数 ----------
   タイムスライダーに、検索語がある版の範囲を帯で示すのに使う。re は buildRe(q, { cs, word }) で作ったもの
   (正規表現は使わない。一致の長さが検索語と同じ ql なので、編集した箇所の近くだけを調べ直せばよい。searchHistory と同じ考え方)。
   単語単位では一致のすぐ外の1文字も見るので、編集と接している一致も調べ直し、調べる範囲の外側に1文字ずつ余分に付ける。
   長い履歴でも画面を止めないよう、counter.step(limit) で limit 個ずつ進める。終わると true を返す。
   counter.counts[k] が第 k 版(0 は空の版)の数 */
function historyCounter(ops, re, ql) {
  const N = ops.length, counts = new Uint32Array(N + 1);
  let text = '', alive = [], k = 0;
  const c = { counts, done: N === 0, step };
  function step(limit) {
    const end = Math.min(N, k + Math.max(1, limit));
    while (k < end) {
      const op = ops[k++], dl = op.d.length, il = op.i.length, delta = il - dl;
      text = applyOp(text, op);
      const next = [];
      for (const m of alive) {
        if (m.e < op.p) next.push(m);                                          // 編集より前(接していない): そのまま
        else if (m.s > op.p + dl) { m.s += delta; m.e += delta; next.push(m); } // 編集より後: 位置だけずれる
      }
      const lo = Math.max(0, op.p - ql - 1), hi = Math.min(text.length, op.p + il + ql + 1);
      const seg = text.slice(lo, hi);
      re.lastIndex = lo > 0 ? 1 : 0;   // 先頭の1文字は、単語単位の判定のために付けただけ
      let mm;
      while ((mm = re.exec(seg))) {
        if (!mm[0].length) { re.lastIndex++; continue; }
        const s = lo + mm.index, e = s + mm[0].length;
        if (hi < text.length && e === hi) continue;   // 最後の1文字も同じ
        if (!next.some(x => x.s < e && x.e > s)) next.push({ s, e });
      }
      alive = next;
      counts[k] = alive.length;
    }
    c.done = k >= N;
    return c.done;
  }
  return c;
}

/* ---------- プレビューの中の検索 ----------
   プレビューの文字は、たくさんの文字のかたまり(DOM の文字ノード)に分かれている。
   pieces は [{ text, block }](block は段落・項目などの入れ物。同じ入れ物の文字は続けてつなぐ)、または { br: true }(改行)。
   入れ物が変わるところと改行には \n を入れて、1つの文字列にする(検索がかたまりをまたいで一致しないように)。
   at[i] は pieces[i] の文字が text の中で始まる位置(改行は -1) */
function joinPieces(pieces) {
  let text = '', prev = null;
  const at = [];
  for (const p of pieces) {
    if (p.br) { text += '\n'; at.push(-1); prev = null; continue; }
    if (text && prev !== p.block && text[text.length - 1] !== '\n') text += '\n';
    at.push(text.length);
    text += p.text;
    prev = p.block;
  }
  return { text, at };
}
/* 一致した範囲 hits([{ s, e }]、前から順に並んだもの)が、どのかたまりのどこからどこまでか。
   1つごとに { a: { i, off }, b: { i, off } }(かたまりの文字に掛からないときは null)。前から1回なぞるだけで求める */
function pieceSpans(pieces, at, hits) {
  const idx = [];
  for (let i = 0; i < pieces.length; i++) if (at[i] >= 0) idx.push(i);
  const out = [];
  let k = 0;
  for (const h of hits) {
    while (k < idx.length && at[idx[k]] + pieces[idx[k]].text.length <= h.s) k++;
    let a = null, b = null;
    for (let j = k; j < idx.length && at[idx[j]] < h.e; j++) {
      const i = idx[j], st = at[i], len = pieces[i].text.length;
      if (!a) a = { i, off: Math.max(0, h.s - st) };
      b = { i, off: Math.min(len, h.e - st) };
    }
    out.push(a && b && (a.i < b.i || a.off < b.off) ? { a, b } : null);
  }
  return out;
}

/* ---------- 表の編集(プレビューと「テキスト」表示で使う) ----------
   表の行の元の文を、書いたままの区切り(| の前後の空白、両端の | の有無)を残して読み書きする。
   書き換えるのはその表の行だけで、表の外は変えない。 */
/* 表の1行を読む: { pre(引用の > と行頭の空白), lead(先頭の |), segs(| で区切った生の文字の並び), trail(末尾の |), tail(末尾の空白) }。
   \ の後ろの文字はエスケープとして区切りにしない */
function tableRowParse(line) {
  const m = /^((?:\s*>\s?)*\s*)/.exec(line);
  const pre = m[1];
  let body = line.slice(pre.length);
  const tm = /\s*$/.exec(body);
  const tail = tm[0];
  body = body.slice(0, body.length - tail.length);
  const lead = body[0] === '|';
  if (lead) body = body.slice(1);
  const segs = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && i + 1 < body.length) { cur += body[i] + body[i + 1]; i++; }
    else if (body[i] === '|') { segs.push(cur); cur = ''; }
    else cur += body[i];
  }
  let trail = false;
  if (cur === '' && segs.length && (body.length > 0 && body[body.length - 1] === '|')) trail = true;
  else segs.push(cur);
  if (!segs.length) segs.push('');
  return { pre, lead, segs, trail, tail };
}
function tableRowBuild(r) {
  // 端の | の無い行で、端のセルが空になったときは | を付ける(付けないと、空のセルが端の | と読まれて列が減る)
  const lead = r.lead || (r.segs.length > 1 && !r.segs[0].trim());
  const trail = r.trail || (r.segs.length > 1 && !r.segs[r.segs.length - 1].trim());
  return r.pre + (lead ? '|' : '') + r.segs.join('|') + (trail ? '|' : '') + r.tail;
}
/* セルの生の文字から、前後の空白を除いた中身 */
const segText = s => s.trim();
/* 中身を入れ替える(前後の空白はそのまま。空のセルなら前後に1つずつ空白を付ける) */
function segSet(seg, v) {
  if (!seg.trim()) return ' ' + v + ' ';
  const a = /^\s*/.exec(seg)[0], b = /\s*$/.exec(seg)[0];
  return a + v + b;
}
/* セルに書く文字: | をエスケープし、改行は空白にする */
function cellEscape(v) {
  let out = '';
  const s = String(v).replace(/\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { out += s[i] + s[i + 1]; i++; }
    else if (s[i] === '|') out += '\\|';
    else out += s[i];
  }
  return out;
}
/* 元の文の line 行目を含む表(md と同じ読み方。引用の中の表も)。{ head(見出しの行), delim(区切りの行), rows(本文の行), cols, align } か null */
function tableAt(text, line) {
  const html = md(text, { lines: true });
  const re = /<table><thead><tr data-line="(\d+)"[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    const head = +m[1];
    const rows = [];
    m[2].replace(/<tr data-line="(\d+)"/g, (x, n) => { rows.push(+n); return x; });
    const last = rows.length ? rows[rows.length - 1] : head + 1;
    if (line < head || line > last) continue;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const d = tableRowParse(lines[head + 1]);
    const align = d.segs.map(s => { const t = s.trim(); return /^:-+:$/.test(t) ? 'c' : /-:$/.test(t) ? 'r' : /^:/.test(t) ? 'l' : ''; });
    return { head: head, delim: head + 1, rows: rows, cols: d.segs.length, align: align };
  }
  return null;
}
/* 表のセルの中身(元の文のまま)。row は元の文の行(見出しの行か本文の行) */
function tableCell(text, row, col) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const r = tableRowParse(lines[row] || '');
  return r.segs[col] != null ? segText(r.segs[col]) : '';
}
/* 表を編集する。row は元の文の行(見出しの行・区切りの行・本文の行)、col は列(0から)。
   action: rowAbove / rowBelow / rowDelete / colLeft / colRight / colDelete / alignLeft / alignCenter / alignRight / alignNone / delete / cell(arg: 中身)。
   { text, row, col }(編集のあとにカーソルを置くセル。表を消したときは row が表のあった行、col は -1)か、できないときは null */
function tableEdit(text, row, col, action, arg) {
  const t = tableAt(text, row);
  if (!t) return null;
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const all = [t.head, t.delim].concat(t.rows);
  const n = t.cols;
  col = Math.max(0, Math.min(n - 1, col | 0));
  const isHead = row === t.head || row === t.delim;
  if (row === t.delim) row = t.head;
  const parsed = {};
  for (const i of all) parsed[i] = tableRowParse(lines[i]);
  // セルが足りない行は、空のセルで補う(区切りの行は ---)
  const pad = (r, i) => { while (r.segs.length < n) r.segs.push(i === t.delim ? ' --- ' : '  '); };
  const out = (r, c) => ({ text: lines.join('\n').replace(/\n/g, nl), row: r, col: c });
  const hp = parsed[t.head];
  // 新しい行: 見出しの行と同じ書き方(両端の | と引用の >)で、空のセル。1列の表は両端に | が要る
  const newRow = () => tableRowBuild({ pre: hp.pre, lead: hp.lead || n === 1, segs: Array.from({ length: n }, () => '  '), trail: hp.trail || n === 1, tail: '' });
  if (action === 'cell') {
    const r = parsed[row];
    pad(r, row);
    r.segs[col] = segSet(r.segs[col], cellEscape(arg == null ? '' : arg));
    lines[row] = tableRowBuild(r);
    return out(row, col);
  }
  if (action === 'rowAbove' || action === 'rowBelow') {
    if (action === 'rowAbove' && isHead) return null;
    const at = action === 'rowAbove' ? row : (isHead ? t.delim + 1 : row + 1);
    lines.splice(at, 0, newRow());
    return out(at, col);
  }
  if (action === 'rowDelete') {
    if (isHead) return null;
    lines.splice(row, 1);
    const k = t.rows.indexOf(row);
    const next = k + 1 < t.rows.length ? row : k > 0 ? t.rows[k - 1] : t.head;
    return out(next, col);
  }
  if (action === 'colLeft' || action === 'colRight' || action === 'colDelete') {
    if (action === 'colDelete' && n <= 1) return null;
    const at = action === 'colRight' ? col + 1 : col;
    for (const i of all) {
      const r = parsed[i];
      pad(r, i);
      if (action === 'colDelete') r.segs.splice(col, 1);
      else r.segs.splice(at, 0, i === t.delim ? ' --- ' : '  ');
      // 先頭の | の無い行で、最初の列を消して空になったときは、そのまま(区切りは残る)
      lines[i] = tableRowBuild(r);
    }
    return out(row, action === 'colDelete' ? Math.min(col, n - 2) : at);
  }
  if (/^align(Left|Center|Right|None)$/.test(action)) {
    const d = parsed[t.delim];
    pad(d, t.delim);
    const seg = d.segs[col];
    const dashes = Math.max(3, (seg.match(/-/g) || []).length);
    const a = /^\s*/.exec(seg)[0], b = /\s*$/.exec(seg)[0];
    const v = action === 'alignLeft' ? ':' + '-'.repeat(dashes) : action === 'alignCenter' ? ':' + '-'.repeat(dashes) + ':' : action === 'alignRight' ? '-'.repeat(dashes) + ':' : '-'.repeat(dashes);
    d.segs[col] = a + v + b;
    lines[t.delim] = tableRowBuild(d);
    return out(row, col);
  }
  if (action === 'delete') {
    const first = t.head, last = all[all.length - 1];
    lines.splice(first, last - first + 1);
    // 前後が空の行なら、空の行を1つにする
    if (first > 0 && lines[first - 1] === '' && lines[first] === '') lines.splice(first, 1);
    return out(first, -1);
  }
  return null;
}

/* 空の表(見出しの行 + 3行、3列)を、元の文の after 行目の次に入れる(after が負なら先頭、最後の行以上なら最後)。
   前後が文の行なら空の行をはさむ(表が段落とつながらないように)。after 行目が空の行なら、その行に入れる。
   { text, row(見出しの行), col: 0 } */
const TABLE_NEW = ['|  |  |  |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |', '|  |  |  |'];
function tableInsert(text, after) {
  const r = blockInsert(text, after, TABLE_NEW);
  return { text: r.text, row: r.at, col: 0 };
}
/* かたまり(行の並び)を、元の文の after 行目の次に入れる。決まりは tableInsert と同じ。{ text, at(かたまりの最初の行) } */
function blockInsert(text, after, blockLines) {
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (lines.length === 1 && lines[0] === '') return { text: blockLines.join(nl), at: 0 };
  let k;
  if (after >= lines.length - 1) {
    // 最後: 終わりの空の行は1つにまとめて、その後ろに
    while (lines.length > 1 && lines[lines.length - 1].trim() === '' && lines[lines.length - 2].trim() === '') lines.pop();
    k = lines[lines.length - 1].trim() === '' ? lines.length - 1 : lines.length;
    if (k === lines.length - 1) lines.splice(k, 1);
  } else if (after >= 0 && lines[after].trim() === '') { k = after; lines.splice(k, 1); }
  else k = Math.max(0, after + 1);
  const block = blockLines.slice();
  if (k > 0 && lines[k - 1].trim() !== '') block.unshift('');
  if (k < lines.length && lines[k].trim() !== '') block.push('');
  lines.splice(k, 0, ...block);
  return { text: lines.join(nl), at: k + (block[0] === '' && blockLines[0] !== '' ? 1 : 0) };
}

/* ---------- 数式の挿入と編集(数式エディタ) ----------
   文中の数式: $…$、\(…\)、$$…$$(文中)、\[…\](文中)。独立した数式のかたまり: $$ / \[ の行、```math のコードブロック。
   読み方は md・inline と同じ(コード表記の中は数式ではない、\$ は区切りにしない) */
/* 1行の中の文中の数式の位置: [{ s, e(区切りを含む), o, c(区切り), tex, display }] */
function inlineMathSpans(line) {
  const src = String(line);
  let m = src;
  const mask = (a, b, ch) => { m = m.slice(0, a) + (ch || '\u0001').repeat(b - a) + m.slice(b); };
  // コード表記(バッククォートの組)を消す。読み方は codeSpans と同じ
  for (let i = 0; i < src.length;) {
    const a = src.indexOf('`', i);
    if (a < 0) break;
    let n = 0; while (src[a + n] === '`') n++;
    let close = -1;
    for (let k = a + n; k < src.length;) {
      const j = src.indexOf('`', k);
      if (j < 0) break;
      let q = 0; while (src[j + q] === '`') q++;
      if (q === n) { close = j; break; }
      k = j + q;
    }
    if (close < 0) { i = a + n; continue; }
    mask(a, close + n);
    i = close + n;
  }
  m = m.replace(/\\\$/g, '\u0003\u0003');
  const out = [];
  const take = (re, o, c, display) => {
    re.lastIndex = 0;
    let x;
    const found = [];
    while ((x = re.exec(m))) found.push([x.index, x.index + x[0].length]);
    for (const [a, b] of found) { out.push({ s: a, e: b, o: o, c: c, tex: src.slice(a + o.length, b - c.length), display: display }); mask(a, b, '\u0004'); }
  };
  take(/\\\((.+?)\\\)/g, '\\(', '\\)', false);
  take(/\\\[(.+?)\\\]/g, '\\[', '\\]', true);
  take(/\$\$(.+?)\$\$/g, '$$', '$$', true);
  // $…$ は inlineDollars と同じ決まり
  for (let i = 0; ;) {
    const a = m.indexOf('$', i);
    if (a < 0) break;
    if (m[a + 1] === '$') { i = a + 2; continue; }
    if (a + 1 >= m.length || /\s/.test(m[a + 1])) { i = a + 1; continue; }
    let b = m.indexOf('$', a + 1), close = -1;
    while (b >= 0) { if (!/\s/.test(m[b - 1]) && !/\d/.test(m[b + 1] || '')) { close = b; break; } b = m.indexOf('$', b + 1); }
    if (close < 0) break;
    out.push({ s: a, e: close + 1, o: '$', c: '$', tex: src.slice(a + 1, close), display: false });
    i = close + 1;
  }
  return out.sort((x, y) => x.s - y.s);
}
/* 元の文のかたまり(数式・コード・図)の行の範囲: [{ kind: 'math'|'code'|'diagram', s, e }] */
function blockRanges(text) {
  const html = md(String(text), { lines: true });
  const out = [];
  const re = /<(pre|div)\b([^>]*)>/g;
  let x;
  while ((x = re.exec(html))) {
    const r = /data-line="(\d+)" data-end="(\d+)"/.exec(x[2]);
    if (!r) continue;
    const kind = x[1] === 'pre' ? 'code' : /class="math\b/.test(x[2]) ? 'math' : /class="diagram\b/.test(x[2]) ? 'diagram' : '';
    if (kind) out.push({ kind: kind, s: +r[1], e: +r[2] });
  }
  return out;
}
/* 数式のかたまり(lines の s〜e 行)の中身と区切り: { pre(引用の > など), open, close, single(1行か), tex } */
function mathBlockParts(lines, s, e) {
  const first = lines[s] || '';
  const pre = /^((?:\s*>\s?)*\s*)/.exec(first)[1];
  const strip = l => (l.startsWith(pre) ? l.slice(pre.length) : l.replace(/^(?:\s*>\s?)*\s*/, ''));
  const body = lines.slice(s, e).map(strip);
  const t = body[0].trim();
  const f = /^(`{3,}|~{3,})math\s*$/.exec(t);
  if (f) return { pre: pre, open: f[1] + 'math', close: f[1], single: false, tex: body.slice(1, body.length - (e - s > 1 && /^(`{3,}|~{3,})\s*$/.test(body[body.length - 1].trim()) ? 1 : 0)).join('\n') };
  const o = t.startsWith('\\[') ? '\\[' : '$$', c = o === '$$' ? '$$' : '\\]';
  if (e - s === 1) return { pre: pre, open: o, close: c, single: true, tex: t.slice(o.length, t.length - c.length).trim() };
  const inner = [body[0].trim().slice(o.length)].concat(body.slice(1, -1), [body[body.length - 1].trim().slice(0, -c.length)]);
  return { pre: pre, open: o, close: c, single: false, tex: inner.join('\n').trim() };
}
/* 元の文の位置 pos にある数式: { s, e(元の文の位置。かたまりなら行の頭から行の終わりまで), tex, display, block, o, c } か null */
function mathAt(text, pos) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const line = src.slice(0, pos).split('\n').length - 1;
  const starts = [];
  let acc = 0;
  for (const l of lines) { starts.push(acc); acc += l.length + 1; }
  for (const b of blockRanges(src)) {
    if (line < b.s || line >= b.e) continue;
    if (b.kind !== 'math') return null;
    const p = mathBlockParts(lines, b.s, b.e);
    return { s: starts[b.s], e: starts[b.e - 1] + lines[b.e - 1].length, tex: p.tex, display: true, block: true, line: b.s, end: b.e };
  }
  const off = pos - starts[line];
  const sp = inlineMathSpans(lines[line]).find(x => off >= x.s && off <= x.e);
  return sp ? { s: starts[line] + sp.s, e: starts[line] + sp.e, tex: sp.tex, display: sp.display, block: false, o: sp.o, c: sp.c } : null;
}
/* プレビューの数式(かたまり el の k 番目の文中の数式で、中身が tex)の元の文の位置。lines の s〜e 行から探す */
function mathInBlock(text, s, e, k, tex) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  let acc = 0;
  const starts = [];
  for (const l of lines) { starts.push(acc); acc += l.length + 1; }
  const all = [];
  for (let i = s; i < e && i < lines.length; i++) for (const sp of inlineMathSpans(lines[i])) all.push(Object.assign({}, sp, { s: starts[i] + sp.s, e: starts[i] + sp.e }));
  const norm = t => String(t).replace(/\s+/g, ' ').trim();
  const hit = all[k] && norm(all[k].tex) === norm(tex) ? all[k] : all.find(x => norm(x.tex) === norm(tex));
  return hit ? { s: hit.s, e: hit.e, tex: hit.tex, display: hit.display, block: false, o: hit.o, c: hit.c } : null;
}
/* 文中に入れる数式の書き方。$…$ にするが、閉じの後ろが数字のとき(読めなくなる)は \(…\) */
function mathInline(tex, next) {
  const t = String(tex).replace(/\s*\n\s*/g, ' ').trim();
  return /\d/.test(next || '') ? '\\(' + t + '\\)' : '$' + t + '$';
}
/* 数式の挿入: 文中なら選んだ範囲を置き換え、独立した行なら blockInsert(カーソルの行の次)。{ text, sel(中身の始まり), selEnd } */
function mathInsert(text, selStart, selEnd, tex, display, after) {
  const src = String(text);
  if (!display) {
    const v = mathInline(tex, src[selEnd]);
    const o = v[0] === '$' ? 1 : 2;
    return { text: src.slice(0, selStart) + v + src.slice(selEnd), sel: selStart + o, selEnd: selStart + v.length - o };
  }
  const t = String(tex).trim();
  const r = blockInsert(src, after == null ? src.slice(0, selStart).split('\n').length - 1 : after, ['$$'].concat(t.split('\n'), ['$$']));
  const lines = r.text.replace(/\r\n?/g, '\n').split('\n');
  let p = 0;
  for (let i = 0; i <= r.at; i++) p += lines[i].length + 1;
  return { text: r.text, sel: p, selEnd: p + t.length };
}
/* 数式 at(mathAt・mathInBlock の結果)を tex に置き換える。区切りの書き方(引用の > も)はできるだけ残す */
function mathReplace(text, at, tex, display) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const t = String(tex).trim();
  let v;
  if (at.block) {
    const lines = src.split('\n');
    const p = mathBlockParts(lines, at.line, at.end);
    if (!display) v = p.pre + mathInline(t, '');
    else if (p.single && t.indexOf('\n') < 0) v = p.pre + p.open + t + p.close;
    else v = [p.open].concat(t.split('\n'), [p.close]).map(l => p.pre + l).join('\n');
  } else if (display === at.display) v = at.o + (at.o === '$' ? t.replace(/\s*\n\s*/g, ' ') : t.replace(/\s*\n\s*/g, ' ')) + at.c;
  else v = display ? '$$' + t.replace(/\s*\n\s*/g, ' ') + '$$' : mathInline(t, src[at.e]);
  return { text: src.slice(0, at.s) + v + src.slice(at.e), s: at.s, e: at.s + v.length };
}
/* 数式エディタ: pos の後ろ(back なら前)の空の {} の中の位置。無ければ -1(端まで行ったら反対の端から探す) */
function emptyBraceAt(text, pos, back) {
  const s = String(text);
  const all = [];
  for (let i = s.indexOf('{}'); i >= 0; i = s.indexOf('{}', i + 1)) all.push(i + 1);
  if (!all.length) return -1;
  if (back) { const b = all.filter(i => i < pos); return b.length ? b[b.length - 1] : all[all.length - 1]; }
  const f = all.find(i => i > pos);
  return f != null ? f : all[0];
}
/* 「テキスト」表示で表を入れる行: カーソルが表の中なら表の後ろ、コード・数式・図のかたまりの中ならその後ろ、それ以外はカーソルの行の次 */
function tableInsertAfter(text, pos) {
  const src = String(text);
  const line = src.slice(0, pos).split('\n').length - 1;
  const t = tableAt(src, line);
  if (t) return t.rows.length ? t.rows[t.rows.length - 1] : t.delim;
  const html = md(src, { lines: true });
  const re = /<(pre|div)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = m[2], r = /data-line="(\d+)" data-end="(\d+)"/.exec(a);
    if (!r || (m[1] === 'div' && !/class="(?:math|diagram)\b/.test(a))) continue;
    if (line >= +r[1] && line < +r[2]) return +r[2] - 1;
  }
  return line;
}

/* 元の文の位置 pos(カーソル)がある表のセル: { row(元の文の行), col } か、表の中でなければ null。区切りの行は見出しの行として扱う */
function tableCaret(text, pos) {
  const src = String(text);
  const row = src.slice(0, pos).split('\n').length - 1;
  const t = tableAt(src, row);
  if (!t) return null;
  const ls = src.lastIndexOf('\n', pos - 1) + 1;
  const line = src.slice(ls, src.indexOf('\n', ls) < 0 ? src.length : src.indexOf('\n', ls));
  const r = tableRowParse(line);
  let k = r.pre.length + (r.lead ? 1 : 0), col = 0;
  for (let i = 0; i < r.segs.length - 1; i++) {
    k += r.segs[i].length;
    if (pos - ls > k) col = i + 1;
    k++;
  }
  return { row: row === t.delim ? t.head : row, col: Math.min(t.cols - 1, col) };
}
/* 表のセルの中身の始まりの位置(空のセルなら、その真ん中)。セルが無ければ行の終わり */
function tableCellPos(text, row, col) {
  const src = String(text), lines = src.split('\n');
  let ls = 0;
  for (let i = 0; i < row && i < lines.length; i++) ls += lines[i].length + 1;
  const line = lines[row] || '';
  const r = tableRowParse(line);
  if (col >= r.segs.length) return ls + line.length;
  let k = r.pre.length + (r.lead ? 1 : 0);
  for (let i = 0; i < col; i++) k += r.segs[i].length + 1;
  const seg = r.segs[col];
  return ls + k + (seg.trim() ? /^\s*/.exec(seg)[0].length : Math.min(1, seg.length));
}
/* プレビューでクリックした場所に当たる、元の文の位置。before はクリックした場所より前の表示の文字、total は表示の文字の数。
   表示の文字の終わりの数文字を元の文で探し、表示の割合から見た位置にいちばん近いものを選ぶ。
   前に何も無ければ、見出しやリストの記号のあと */
function caretFromRendered(src, before, total) {
  src = String(src);
  const prefix = /^((?:\s*>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)/.exec(src)[1].length;
  const b = String(before || '');
  if (!b.trim()) return prefix;
  if (!total || b.length >= total) return src.length;
  const guess = prefix + Math.round((src.length - prefix) * b.length / total);
  for (let k = Math.min(12, b.length); k >= 1; k--) {
    const key = b.slice(-k);
    let best = -1, bd = Infinity;
    for (let i = src.indexOf(key); i >= 0; i = src.indexOf(key, i + 1)) { const d = Math.abs(i + k - guess); if (d < bd) { bd = d; best = i + k; } }
    if (best >= 0) return best;
  }
  return Math.min(src.length, guess);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { inlineMathSpans, blockRanges, mathBlockParts, mathAt, mathInBlock, mathInline, mathInsert, mathReplace, emptyBraceAt, blockInsert, tableRowParse, tableRowBuild, tableAt, tableCell, tableEdit, tableInsert, tableInsertAfter, tableCaret, tableCellPos, caretFromRendered, cellEscape, chunkLines, historyCounter, joinPieces, pieceSpans, emojiSuggest, emojiQueryAt, setMdLang, newlineEdit, indentEdit, tabEdit, inFenceAt, changeEnd, macKeys, esc, applyOp, makeOp, textAt, inline, md, lineToY, yToLine, anchorAt, escRe, matchRanges, markPieces, diffLines, snippetOf, searchLatest, searchHistory, cursorInfo, selectionInfo, textStats, formatLines, inlineFormat, noteLinkAt, linkText, pushRecent, headingSlug, titleOf, isImageName, attachName, attachMarkup, attachRefs, removeAttachRefs, buildRe, expandRepl, findAll, findFrom, replaceAllText };
}
