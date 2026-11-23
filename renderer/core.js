/* 履歴・Markdown・検索のロジック(画面にもテストにも使う。Electronには依存しない)

   ---------- 履歴の基本ロジック ----------
   1回の編集 = {p: 位置, d: 消した文字列, i: 入れた文字列, t: 時刻(ms)}
   どの版でも、最初の空文字から順に適用すれば再現できる。 */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function applyOp(text, op) { return text.slice(0, op.p) + op.i + text.slice(op.p + op.d.length); }

/* 履歴を当て直すための本文。小さなかたまり(およそ CHUNK 文字)の配列で持つので、1回の編集の手間がかたまりの大きさ程度で済み、
   本文の長さに比例しない(1つの文字列のまま当て直すと、長い本文で編集の数×本文の長さの時間がかかる)。
   apply は applyOp と同じ結果になる(位置や消す範囲が本文の外に出るときも、文字列の slice と同じに扱う)。
   length と slice があるので、snippetOf などには文字列の代わりに渡せる。前の位置を覚えていて、近くの編集ほど速い */
const CHUNK = 2048;
class ChunkText {
  constructor(text) {
    text = text || '';
    this.c = [];
    for (let i = 0; i < text.length; i += CHUNK) this.c.push(text.slice(i, i + CHUNK));
    if (!this.c.length) this.c.push('');
    this.ci = 0; this.cs = 0; this.length = text.length;
  }
  // p を含むかたまりに移る(かたまりの終わりちょうどなら、そのかたまり)
  _seek(p) {
    const c = this.c;
    while (p < this.cs && this.ci > 0) { this.ci--; this.cs -= c[this.ci].length; }
    while (this.ci < c.length - 1 && p > this.cs + c[this.ci].length) { this.cs += c[this.ci].length; this.ci++; }
  }
  apply(p, dl, ins) {
    if (p > this.length) p = this.length;
    if (p + dl > this.length) dl = this.length - p;
    this._seek(p);
    const c = this.c, ci = this.ci, t = c[ci], local = p - this.cs;
    if (local + dl <= t.length) c[ci] = t.slice(0, local) + ins + t.slice(local + dl);
    else {
      let rem = dl - (t.length - local);
      while (rem > 0 && ci + 1 < c.length) {
        const nx = c[ci + 1];
        if (nx.length <= rem) { rem -= nx.length; c.splice(ci + 1, 1); } else { c[ci + 1] = nx.slice(rem); rem = 0; }
      }
      c[ci] = t.slice(0, local) + ins;
    }
    this.length += ins.length - dl;
    const s = c[ci];
    if (s.length > 2 * CHUNK) {
      const parts = [];
      for (let i = 0; i < s.length; i += CHUNK) parts.push(s.slice(i, i + CHUNK));
      c.splice(ci, 1, ...parts);
    } else if (s.length < CHUNK / 4 && c.length > 1) {
      // 小さくなったかたまりは隣とつなぐ(かたまりが増え続けて、移るのが遅くならないように)
      if (ci + 1 < c.length && s.length + c[ci + 1].length <= 2 * CHUNK) { c[ci] = s + c[ci + 1]; c.splice(ci + 1, 1); }
      else if (ci > 0 && s.length + c[ci - 1].length <= 2 * CHUNK) { this.ci--; this.cs -= c[ci - 1].length; c[ci - 1] += s; c.splice(ci, 1); }
    }
  }
  slice(lo, hi) {
    if (lo == null || lo < 0) lo = 0;
    if (hi == null || hi > this.length) hi = this.length;
    if (hi <= lo) return '';
    this._seek(lo);
    let out = '', i = this.ci, s = this.cs;
    while (i < this.c.length && s < hi) {
      const t = this.c[i];
      out += t.slice(Math.max(0, lo - s), Math.min(t.length, hi - s));
      s += t.length; i++;
    }
    return out;
  }
  toString() { return this.c.length === 1 ? this.c[0] : this.c.join(''); }
}

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

/* 第 k 版の本文。途中の版の本文(チェックポイント)を覚えておき、いちばん近い手前のものから当て直す。
   チェックポイントは、前のチェックポイントからの編集の量(1回につき 32 + 消した文字数 + 入れた文字数)が
   本文の長さに届いたところに置く(ただし 100版以上あける)。覚える本文の合計は履歴の大きさ程度に収まり、
   当て直す編集も本文の長さ程度で済むので、長い履歴でもスライダーを素早く動かせる。
   n._cp = { k: [版の番号…](小さい順), t: [その版の本文…] }。編集は後ろに足すだけなので、覚えた版は消さずに使える */
const CP_MIN = 100;
function textAt(n, k) {
  const cp = n._cp || (n._cp = { k: [0], t: [''] });
  let lo = 0, hi = cp.k.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cp.k[m] <= k) lo = m; else hi = m - 1; }
  if (cp.k[lo] === k) return cp.t[lo];
  const last = lo === cp.k.length - 1;
  const b = new ChunkText(cp.t[lo]);
  let from = cp.k[lo], cost = 0;
  for (let r = cp.k[lo]; r < k; r++) {
    const op = n.ops[r];
    b.apply(op.p, op.d.length, op.i);
    if (!last) continue;
    cost += 32 + op.d.length + op.i.length;
    if (r + 1 - from >= CP_MIN && cost >= b.length) { from = r + 1; cost = 0; cp.k.push(from); cp.t.push(b.toString()); }
  }
  return b.toString();
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

/* ---------- カーソル位置と選択の文字数(ステータスバー) ----------
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
/* 表の行か(md と同じく、「|」のある行の次が |---| の行なら見出しの行、その下に続く「|」のある行も表の行。
   見出しの行の上に続く「|」で始まる行も、見出しの行) */
function isTableRowAt(lines, k) {
  const bar = l => l != null && l.indexOf('|') >= 0;
  const lead = l => l != null && l.trim()[0] === '|';
  if (!bar(lines[k])) return false;
  if (lines[k + 1] != null && isDelim(lines[k + 1])) return true;
  for (let j = k - 1; j >= 1; j--) {
    if (isDelim(lines[j])) { if (bar(lines[j - 1])) return true; break; }
    if (!lines[j].trim() || !bar(lines[j])) break;
  }
  if (!lead(lines[k])) return false;
  for (let j = k + 1; j + 1 < lines.length && bar(lines[j]); j++) {
    if (isDelim(lines[j + 1])) return true;
    if (!lead(lines[j])) return false;
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
function plainLine(s, keepLead) {
  const kept = [];
  const put = v => { kept.push(v); return '\u0001' + (kept.length - 1) + '\u0001'; };
  s = s.replace(/(`+)(.+?)\1/g, (m, f, c) => put(c.trim() || c))
    .replace(ESCAPE_RE, (m, c) => put(c))
    .replace(/\[\^[^\]\s]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1');
  if (!keepLead) s = s.replace(/^[#>\s\-*+]+/, '');
  return emojiText(s).replace(/\u0001(\d+)\u0001/g, (_, i) => kept[+i]).trim();
}
/* 題名: フロントマターに title があればそれ(装飾の記号は外す。先頭の # や - は題名の文字のまま)。
   無ければ、フロントマターより後ろの、最初の文字のある行 */
const titleOf = text => {
  const fm = frontMatter(text);
  const ft = fm ? fmTitle(fm) : '';
  if (ft) return ft.slice(0, 60);
  for (const ln of (fm ? text.slice(fm.next) : text).split('\n')) { const t = plainLine(ln); if (t) return t.slice(0, 60); }
  return '';
};

/* ---------- フロントマター(メモの先頭の、--- で囲んだ YAML) ----------
   Obsidian・Jekyll・Hugo・Pandoc などと同じ書き方。1行目がちょうど --- で、閉じの ---(か ...)までの行が、すべて
   「キー: 値」・字下げした行・- で始まる行(リストの項目)・空行・# のコメントで、キーが1つ以上あるときだけ、フロントマターとみなす
   (区切り線で始まる今までのメモを、誤って読まないため。キーには空白を含めない)。
   YAML のライブラリは使わず、読むのは tags だけ(ほかのキーは本文のまま残し、プレビューでは書いたとおりに出す)。
   tags の書き方: tags: [a, b]、tags: a, b、tags: の次の行から「  - a」の並び。引用符("a b" 'a')と、先頭の # は外す */
const FM_OPEN_RE = /^---[ \t]*\r?$/;
const FM_CLOSE_RE = /^(?:---|\.\.\.)[ \t]*\r?$/;
const FM_KEY_RE = /^([\p{L}\p{N}_][\p{L}\p{N}_.-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*\r?$/u;
const FM_MAX_LINES = 200;
const TAG_MAX = 100;    // 1つのタグの長さ(これより長いものは使わない)
const TAGS_MAX = 50;    // 1つのメモのタグの数
/* lines の先頭のフロントマターの行数(閉じの行まで)。無ければ 0 */
function frontMatterLines(lines) {
  if (!lines.length || !FM_OPEN_RE.test(lines[0])) return 0;
  let keys = 0;
  for (let i = 1; i < lines.length && i <= FM_MAX_LINES; i++) {
    const ln = lines[i];
    if (FM_CLOSE_RE.test(ln)) return keys ? i + 1 : 0;
    if (/^\s*$/.test(ln) || /^\s*#/.test(ln)) continue;
    if (FM_KEY_RE.test(ln)) { keys++; continue; }
    if (keys && (/^[ \t]+\S/.test(ln) || /^-(?:[ \t]|\r?$)/.test(ln))) continue;
    return 0;
  }
  return 0;
}
/* 値の文字(str。全文の base 文字目から)を、コンマで分けたタグにする(引用符の中のコンマでは分けない)。
   split が偽なら分けずに1つとして読む。返すのは { items: [{ name, s, e }], end }
   (s〜e は全文の中の、タグの文字の位置。end はコメントを除いた値の終わりの位置) */
function tagItems(str, base, split) {
  // コメント: 空白の後の # から後ろ(引用符の外)。ただし値の先頭と、コンマの直後の # は、タグの印として外すだけ
  // (YAML ではコメントだが、「#設計」のように書く人が多いので)
  let q = '', cut = str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && i > 0 && /[ \t]/.test(str[i - 1])) {
      const before = str.slice(0, i).trimEnd();
      if (before && !before.endsWith(',')) { cut = i; break; }
    }
  }
  str = str.slice(0, cut);
  const end = base + str.trimEnd().length;
  const pieces = [];
  let from = 0;
  q = '';
  for (let i = 0; i <= str.length; i++) {
    const c = str[i];
    if (q && i < str.length) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (i === str.length || (split && c === ',')) { pieces.push([from, i]); from = i + 1; }
  }
  const out = [];
  for (let [s, e] of pieces) {
    while (s < e && /\s/.test(str[s])) s++;
    while (e > s && /\s/.test(str[e - 1])) e--;
    if (e - s >= 2 && (str[s] === '"' || str[s] === "'") && str[e - 1] === str[s]) { s++; e--; }
    while (s < e && str[s] === '#') s++;
    const name = str.slice(s, e).trim();
    if (name && name.length <= TAG_MAX) out.push({ name: name, s: base + s, e: base + e });
  }
  return { items: out, end: end };
}
/* text の先頭のフロントマター。無ければ null。
   { lines: 行数(閉じの行まで), next: 本文が始まる位置, tags: [{ name, s, e }], tagsAt: カーソルを置く位置(tags の値の終わり。tags が無ければ -1),
     close: 閉じの行の始まりの位置, entries: [{ key, value }](プレビュー用) } */
function frontMatter(text) {
  text = String(text == null ? '' : text);
  if (!text.startsWith('---')) return null;
  const lines = text.split('\n');
  const n = frontMatterLines(lines);
  if (!n) return null;
  const starts = [];
  let p = 0;
  for (let i = 0; i < n; i++) { starts.push(p); p += lines[i].length + 1; }
  const next = Math.min(text.length, p);
  const fm = { lines: n, next: next, close: starts[n - 1], tags: [], tagsAt: -1, entries: [] };
  const seen = new Set();
  const addTags = list => { for (const t of list) { const k = tagKey(t.name); if (!seen.has(k) && fm.tags.length < TAGS_MAX) { seen.add(k); fm.tags.push(t); } } };
  for (let i = 1; i < n - 1; i++) {
    const ln = lines[i].replace(/\r$/, '');
    const m = ln.match(FM_KEY_RE);
    if (!m) continue;
    // このキーに続く行(字下げした行・- の行)
    let j = i + 1;
    while (j < n - 1 && !FM_KEY_RE.test(lines[j]) && !/^\s*#/.test(lines[j])) j++;
    const more = lines.slice(i + 1, j).map(x => x.replace(/\r$/, '')).filter(x => x.trim());
    const value = m[2] || '';
    fm.entries.push({ key: m[1], value: value, more: more, tags: m[1].toLowerCase() === 'tags' });
    if (m[1].toLowerCase() === 'tags' && fm.tagsAt < 0) {
      // 値の始まりの位置: キーの後の「:」と空白の次(キーには「:」を含まない)
      const c = ln.indexOf(':'), after = ln.slice(c + 1);
      const at = starts[i] + c + 1 + (after.length - after.trimStart().length);
      // カーソルを置く所: [ … ] なら ] の前、そうでなければ値の終わり(コメントの前)、並びなら最後の項目の終わり
      if (value[0] === '[') {
        const close = value.lastIndexOf(']');
        const r = tagItems(value.slice(1, close > 0 ? close : value.length), at + 1, true);
        addTags(r.items);
        fm.tagsAt = close > 0 ? at + close : r.end;
      } else if (value) {
        const r = tagItems(value, at, true);
        addTags(r.items);
        fm.tagsAt = r.end;
      } else {
        fm.tagsAt = starts[i] + ln.length;
        for (let k = i + 1; k < j; k++) {
          const im = lines[k].match(/^([ \t]*-[ \t]+)(.*?)[ \t]*\r?$/);
          if (!im) continue;
          const r = tagItems(im[2], starts[k] + im[1].length, false);
          addTags(r.items);
          fm.tagsAt = r.end;
        }
      }
    }
    i = j - 1;
  }
  return fm;
}
/* タグを比べるときの形: 全角・半角をそろえ(NFKC)、小文字にし、先頭の # を外す */
const tagKey = s => String(s).normalize('NFKC').replace(/^#+/, '').trim().toLowerCase();
/* メモのタグの名前(書いたとおり) */
const tagsOf = text => { const fm = frontMatter(text); return fm ? fm.tags.map(t => t.name) : []; };
/* ---------- フロントマターの値(YAML の書き方のうち、よく使うものだけ読む) ----------
   1つの値: "…"(\" \\ \n \t などのエスケープ)と '…'('' で ')は引用符を外す。引用符の無い値は、空白の後の # から後ろ(コメント)を除く
   (# で始まる値は、YAML では全体がコメントなので空)。引用符が閉じていなければ、引用符の無い値として読む */
function fmScalar(s) {
  s = String(s == null ? '' : s).trim();
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let out = '', i = 1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (q === '"' && c === '\\' && i + 1 < s.length) { const e = s[++i]; out += e === 'n' ? '\n' : e === 't' ? '\t' : e; continue; }
      if (c === q) { if (q === "'" && s[i + 1] === "'") { out += "'"; i++; continue; } break; }
      out += c;
    }
    if (i < s.length) return out;
  }
  if (s[0] === '#') return '';
  const c = s.search(/[ \t]#/);
  return (c >= 0 ? s.slice(0, c) : s).trim();
}
const FM_BLOCK_RE = /^[|>][+-]?[0-9]?[ \t]*(?:#.*)?$/;
const fmIsList = en => !en.value && en.more.length > 0 && en.more.every(x => /^\s*-(?:\s|$)/.test(x));
/* 並びの値: [a, "b, c"](引用符の外のコンマで分ける)か、次の行から「- a」と並べたもの。そうでなければ1つの値 */
function fmItems(en) {
  const v = en.value.trim();
  if (v[0] === '[') {
    const close = v.lastIndexOf(']'), body = v.slice(1, close > 0 ? close : v.length), out = [];
    let q = '', from = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (q && i < body.length) { if (c === q) q = ''; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (i === body.length || c === ',') { out.push(fmScalar(body.slice(from, i))); from = i + 1; }
    }
    return out.filter(x => x);
  }
  if (fmIsList(en)) return en.more.map(x => fmScalar(x.replace(/^\s*-\s*/, ''))).filter(x => x);
  const t = fmText(en);
  return t ? [t] : [];
}
/* 1つの文字としての値。| と > のブロック(次の行から字下げして書いたもの)、並び(コンマでつなぐ)、
   次の行に字下げして続けた値(空白でつなぐ)も読む */
function fmText(en) {
  const v = en.value.trim();
  if (FM_BLOCK_RE.test(v)) {
    const ind = Math.min(...en.more.map(x => x.match(/^\s*/)[0].length));
    const ls = en.more.map(x => x.slice(ind));
    return (v[0] === '|' ? ls.join('\n') : ls.join(' ')).trim();
  }
  if (v[0] === '[' || fmIsList(en)) return fmItems(en).join(', ');
  return [fmScalar(v)].concat(/^["']/.test(v) ? [] : en.more.map(x => x.trim())).filter(x => x).join(' ');
}
const fmGet = (fm, key) => fm.entries.find(en => en.key.toLowerCase() === key) || null;
const fmOne = s => plainLine(String(s).replace(/\s+/g, ' '), true);
/* フロントマターの title(題名に使う形: 空白をまとめ、装飾の記号を外す) */
const fmTitle = fm => { const en = fmGet(fm, 'title'); return en ? fmOne(fmText(en)).slice(0, 500) : ''; };
/* 書き出しに使う文書の情報: { title, author: [名前], date, keywords: [タグ] }。書いていないものは空 */
function docMeta(text) {
  const fm = frontMatter(text);
  if (!fm) return { title: '', author: [], date: '', keywords: [] };
  const au = fmGet(fm, 'author'), dt = fmGet(fm, 'date');
  return {
    title: fmTitle(fm),
    author: au ? fmItems(au).map(x => fmOne(x).slice(0, 200)).filter(x => x).slice(0, 20) : [],
    date: dt ? fmOne(fmText(dt)).slice(0, 100) : '',
    keywords: fm.tags.map(t => t.name)
  };
}
/* 印刷・PDF・HTML の本文の先頭に出す、題名・著者・日付(どれも無ければ '')。sep は著者の区切り */
function titleBlockHtml(meta, sep) {
  if (!meta || !(meta.title || meta.author.length || meta.date)) return '';
  return '<header class="doc-head">'
    + (meta.title ? '<h1 class="doc-title">' + esc(meta.title) + '</h1>' : '')
    + (meta.author.length ? '<p class="doc-author">' + esc(meta.author.join(sep || ', ')) + '</p>' : '')
    + (meta.date ? '<p class="doc-date">' + esc(meta.date) + '</p>' : '')
    + '</header>';
}
/* メモごとの表示・印刷の設定(フロントマターの toc・toc-depth・lang・papersize・orientation)。書いていない・読めない値は既定のまま。
   toc: true(yes・on も)なら目次を出す。toc-depth: 目次に入れる見出しの深さ(1〜6。既定は3)。lang: 文書の言語(ja・en-US など)。
   papersize: a4・a5・b5(JIS の B5)・letter・legal(a4paper の形も読む)。orientation: landscape なら横向き(EverPad だけのキー) */
const PAPERS = { a4: 'A4', a5: 'A5', b5: 'B5', letter: 'Letter', legal: 'Legal' };
const PAPER_MM = { A4: [210, 297], A5: [148, 210], B5: [182, 257], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
const LANG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,4}$/;
function docOpts(text) {
  const o = { toc: false, tocDepth: 3, lang: '', paper: '', landscape: false };
  const fm = frontMatter(text);
  if (!fm) return o;
  const one = key => { const en = fmGet(fm, key); return en ? fmText(en).replace(/\s+/g, ' ').trim() : ''; };
  o.toc = /^(?:true|yes|on)$/i.test(one('toc'));
  const d = one('toc-depth');
  if (/^[1-6]$/.test(d)) o.tocDepth = +d;
  const lg = one('lang').replace(/_/g, '-');
  if (LANG_RE.test(lg)) o.lang = lg;
  const p = one('papersize').toLowerCase().replace(/\s+/g, '').replace(/paper$/, '');
  if (Object.prototype.hasOwnProperty.call(PAPERS, p)) o.paper = PAPERS[p];
  o.landscape = /^landscape$/i.test(one('orientation'));
  return o;
}
/* 印刷・PDF・HTML の @page の size の値(用紙も向きも決めていなければ '')。用紙は mm で書く(CSS の B5 は ISO の大きさなので) */
function pageSizeCss(o) {
  if (!o || (!PAPER_MM[o.paper] && !o.landscape)) return '';
  if (!PAPER_MM[o.paper]) return 'landscape';
  const s = PAPER_MM[o.paper], wh = o.landscape ? [s[1], s[0]] : s;
  return wh[0] + 'mm ' + wh[1] + 'mm';
}
/* 目次の HTML。items: [{ level, id, html }](本文の順。見出しの中身は整形済みの HTML)。見出しが無ければ ''。
   字下げは、いちばん浅い見出しからの深さ(toc-1〜toc-6)で付ける */
function tocHtml(items, label) {
  if (!items || !items.length) return '';
  const min = Math.min(...items.map(x => x.level));
  return '<nav class="toc"><p class="toc-title">' + esc(label) + '</p><ul>'
    + items.map(x => '<li class="toc-' + (x.level - min + 1) + '"><a href="#' + esc(x.id) + '">' + x.html + '</a></li>').join('')
    + '</ul></nav>';
}
/* タグ want(tagKey の形)に当たるか: 同じ名前か、その下の階層(「仕事」なら「仕事/会議」も) */
const tagHit = (name, want) => { const k = tagKey(name); return k === want || k.startsWith(want + '/'); };
/* メモのタグ(名前の並び)が、探すタグ(tagKey の形の並び)をすべて持っているか */
const hasTags = (names, wants) => wants.every(w => (names || []).some(n => tagHit(n, w)));
/* 検索欄の文字を、タグ(tag:名前。空白を含むなら tag:"名前")と、そのほかの検索語に分ける。
   返すのは { text, tags: [tagKey の形], pre: 先頭の一致で探すタグ(tagKey の形。無ければ ''), any: タグを持つメモだけか }。
   - tag: の後ろが空(tag: だけ)なら、タグを持つメモをすべて探す(any)
   - typing が真のとき(検索欄で打っている途中)、欄の最後にあって後ろに空白が無い tag:名前 は、まだ打っている途中とみなし、
     その文字で始まるタグを探す(pre)。後ろに空白を打ったときと、引用符を閉じたときは、名前が同じタグ(とその下の階層)だけ */
const TAG_TOKEN_RE = /(^|\s)tag[:：](?:"([^"]*)("?)|([^\s"]*))(?=\s|$)/gi;
function parseQuery(q, typing) {
  q = String(q);
  const tags = [];
  let pre = '', any = false, found = false;
  const rest = q.replace(TAG_TOKEN_RE, (m, sp, quoted, closed, bare, at) => {
    found = true;
    const k = tagKey(quoted != null ? quoted : bare);
    if (!k) any = true;
    else if (typing && at + m.length === q.length && !closed) pre = k;
    else if (!tags.includes(k)) tags.push(k);
    return sp;
  });
  if (pre && tags.some(t => pre === t || pre.startsWith(t + '/'))) pre = '';   // もう同じタグで絞っている
  return found ? { text: rest.replace(/\s{2,}/g, ' ').trim(), tags: tags, pre: pre, any: any } : { text: q.trim(), tags: [], pre: '', any: false };
}
/* メモのタグ(名前の並び)が、検索の条件(parseQuery の tags・pre・any)に合うか */
const tagFilter = (names, pq) => {
  names = names || [];
  return hasTags(names, pq.tags) && (!pq.pre || names.some(n => tagKey(n).startsWith(pq.pre))) && (!pq.any || names.length > 0);
};
const hasTagQuery = pq => pq.tags.length > 0 || !!pq.pre || pq.any;
/* 検索欄の最後で打っている途中の tag:名前 ({ from: tag: の始まり, pre: tagKey の形の名前 })。無ければ null */
function tagTypingAt(q) {
  const m = /(^|\s)(tag[:：](?:"([^"]*)|([^\s"]*)))$/i.exec(String(q));
  return m ? { from: m.index + m[1].length, pre: tagKey(m[3] != null ? m[3] : m[4]) } : null;
}
/* タグの候補: notes([{ tags }])のタグのうち pre で始まるもの(skip の tagKey は除く)。
   名前が pre と同じものを先に、あとはメモの数の多い順、同じなら名前の順。[{ name, n }] */
function tagSuggest(notes, pre, skip, max) {
  const by = new Map();
  for (const nt of notes) {
    const seen = new Set();
    for (const name of nt.tags || []) {
      const k = tagKey(name);
      if (!k || seen.has(k) || !k.startsWith(pre) || (skip && skip.includes(k))) continue;
      seen.add(k);
      const c = by.get(k);
      if (c) c.n++; else by.set(k, { name: String(name).replace(/^#+/, '').trim(), n: 1, k: k });
    }
  }
  return [...by.values()]
    .sort((a, b) => (b.k === pre) - (a.k === pre) || b.n - a.n || a.k.localeCompare(b.k))
    .slice(0, max || 10).map(x => ({ name: x.name, n: x.n }));
}
/* 検索欄に入れる tag:名前(空白と " を含むなら囲む。" は外す) */
const tagToken = name => 'tag:' + (/[\s"]/.test(name) ? '"' + String(name).replace(/"/g, '') + '"' : name);
/* フロントマターを入れる(メニューの「フロントマター(タグ)を挿入」)。入れる場所は、カーソルの位置に関係なく、いつもメモの先頭。
   もうあるときは2つ目を入れず、tags の値の終わりにカーソルを置く(tags が無ければ、閉じの行の前に「tags: 」の行を入れる)。
   返すのは { text, caret } */
function frontMatterInsert(text) {
  text = String(text);
  const fm = frontMatter(text);
  if (fm && fm.tagsAt >= 0) return { text: text, caret: fm.tagsAt };
  if (fm) return { text: text.slice(0, fm.close) + 'tags: \n' + text.slice(fm.close), caret: fm.close + 'tags: '.length };
  const head = '---\ntags: \n---\n';
  return { text: head + (text && !/^\s*\n/.test(text) ? '\n' : '') + text, caret: '---\ntags: '.length };
}
/* プレビューに出すフロントマター: キーと値の並び。tags は札の形で、押すとそのタグを検索するボタン(app.js の searchTag) */
function frontMatterHtml(fm, attr) {
  const rows = fm.entries.map(en => {
    let v;
    if (en.tags) v = fm.tags.length ? fm.tags.map(t => '<button type="button" class="tag tag-link" data-tag="' + esc(t.name) + '">' + esc(t.name) + '</button>').join('') : '';
    // 値は引用符を外して出す。字下げした行に「キー: 値」を並べたもの(入れ子)などは、今までどおり行をコンマでつなぐ
    else if (!en.more.length || FM_BLOCK_RE.test(en.value.trim()) || en.value.trim()[0] === '[' || fmIsList(en)) v = esc(fmText(en));
    else v = esc([fmScalar(en.value)].concat(en.more.map(x => x.trim().replace(/^-[ \t]+/, ''))).filter(x => x).join(', '));
    return '<div class="fm-row' + (en.tags ? ' fm-tags' : '') + '"><span class="fm-k">' + esc(en.key) + '</span><span class="fm-v">' + v + '</span></div>';
  });
  return '<div class="fm"' + attr + '>' + rows.join('') + '</div>';
}

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

/* 項目の続き: 項目より字下げした行のかたまりを、lines[j] から集める。字下げを外した行(行の数は元と同じ)と、終わりの次の行を返す。
   空行をはさんでもよい。字下げの浅い行・リストの項目の行で終わる(コードブロックの中は、どの行も中身)。無ければ null */
function listCont(lines, j, need, col, re) {
  const lead = s => s.match(/^\s*/)[0].replace(/\t/g, '  ').length;
  const buf = [];
  let open = null, last = -1;
  for (let k = j; k < lines.length; k++) {
    const l = lines[k];
    if (open) { if (fenceCloses(l, open)) open = null; }
    else if (/\S/.test(l)) {
      if (lead(l) < need || re.test(l)) break;
      if (FENCE_OPEN.test(l)) open = l.match(FENCE_OPEN_RE)[1];
    } else { buf.push(''); continue; }
    const w = l.match(/^\s*/)[0].replace(/\t/g, '  ');
    buf.push(w.slice(Math.min(w.length, col)) + l.slice(l.match(/^\s*/)[0].length));
    last = k;
  }
  return last < j ? null : { lines: buf.slice(0, last - j + 1), next: last + 1 };
}
function mdList(lines, i, out, base) {
  const re = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const stack = [];
  let html = '';
  // 項目の開始のタグ。行の範囲を付けるときは、まず最初の行だけ付け、終わりは最後にまとめて足す。
  // 終わりは、次の区切り(次の項目の行、項目の中のかたまりの最初の行)かリストの終わり(行の範囲が重ならないように)
  const marks = [], starts = [];
  const li = () => { if (!(base >= 0)) return '<li>'; starts.push(marks.length); marks.push(base + i); return '<li data-line="' + (base + i) + '">'; };
  while (i < lines.length) {
    let m = lines[i].match(re);
    if (!m) {
      // 空行をはさんで続く、字下げしたかたまりや次の項目は、同じリストの続きとして読む
      let j = i;
      while (j < lines.length && /^\s*$/.test(lines[j])) j++;
      if (!stack.length || j >= lines.length) break;
      // 項目より字下げしたかたまり(段落・表・引用・注意書き・コードなど)は、その項目の中(GitHub と同じ)。
      // 字下げを外して、リストの外と同じに読む
      const top = stack[stack.length - 1];
      const c = re.test(lines[j]) ? null : listCont(lines, j, top.ind + 2, top.col, re);
      if (c) {
        if (base >= 0) marks.push(base + j);
        html += mdBlocks(c.lines, base < 0 ? -1 : base + j, '');
        i = c.next;
        continue;
      }
      if (/^\s+/.test(lines[j]) && FENCE_OPEN.test(lines[j])) { const f = mdFence(lines, j); html += f.html; i = f.next; continue; }
      if (j > i && re.test(lines[j])) {
        const n = lines[j].match(re);
        const top = n[1].replace(/\t/g, '  ').length <= stack[0].ind;
        if (!top || (/\d/.test(n[2]) ? 'ol' : 'ul') === stack[0].tag) { i = j; continue; } // 種類が変わったら別のリスト
      }
      break;
    }
    const ind = m[1].replace(/\t/g, '  ').length;
    const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    // 項目の文の始まりの列(続きのかたまりは、ここまでの字下げを外して読む)
    const gap = m[0].length - m[3].length - m[1].length - m[2].length;
    const col = ind + m[2].length + (gap > 4 || !m[3] ? 1 : gap);
    while (stack.length && ind < stack[stack.length - 1].ind) html += '</li></' + stack.pop().tag + '>';
    if (stack.length && ind === stack[stack.length - 1].ind) { html += '</li>' + li(); stack[stack.length - 1].col = col; }
    else {
      // 番号付きは、最初の項目に書いた番号から数える(4. から始めれば 4, 5, … と表示する)
      const start = tag === 'ol' ? parseInt(m[2], 10) : 1;
      html += '<' + tag + (start !== 1 ? ' start="' + start + '"' : '') + '>' + li();
      stack.push({ ind: ind, tag: tag, col: col });
    }
    const t = m[3].match(/^\[( |x|X)\]\s+(.*)$/);
    html += t ? '<input type="checkbox" disabled' + (t[1] !== ' ' ? ' checked' : '') + '> ' + inline(t[2]) : inline(m[3]);
    i++;
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  if (starts.length) {
    // 本文の文字は esc してあるので、この形のタグは項目の開始のタグだけ
    let k = 0;
    const last = base + Math.min(i, lines.length);
    html = html.replace(/<li data-line="(\d+)">/g, (m0, n) => { const x = starts[k++] + 1; return '<li data-line="' + n + '" data-end="' + (x < marks.length ? marks[x] : last) + '">'; });
  }
  out.push(html);
  return i;
}

/* 表: 「| a | b |」の行の次に「|---|---|」の行がある形。MultiMarkdown の書き方で、次のことができる:
   - 横の結合: セルの後ろに | を足す(「| 合計 || 180 |」の「合計」は2列)。空白の無い空のセルが、左のセルにつながる
   - 縦の結合: 「^^」だけのセルは、上のセルにつながる(同じ幅のときだけ。見出しと本文はまたがない)。文字にするなら \^^
   - 見出しの行を複数にする: 区切りの行の上に、空の行をはさまずに「|」で始まる行を続ける
   - 表題: 表のすぐ上か下の「[表題]」だけの行(「[表題][ラベル]」なら、ラベルでメモの中から表へ飛べる)。上と下の両方にあれば上 */
/* 行をセルに分ける(前後の空白はそのまま。\| は | にする) */
function splitRaw(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur); cur = ''; }
    else cur += s[i];
  }
  cells.push(cur);
  return cells;
}
const splitRow = line => splitRaw(line).map(c => c.trim());
const isDelim = line => line.indexOf('|') >= 0 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
/* セルだけの配置(DokuWiki と同じ): 中身の両側に空白が2つ以上なら中央('c')、左だけなら右寄せ('r')、右だけなら左寄せ('l')。
   それ以外('')は列の配置(区切りの行)。空のセルには付けない */
function cellAlign(raw) {
  if (!raw.trim()) return '';
  const l = /^[ \t]*/.exec(raw)[0].length >= 2, r = /[ \t]*$/.exec(raw)[0].length >= 2;
  return l && r ? 'c' : l ? 'r' : r ? 'l' : '';
}
/* 表題の行: { text, label } か null。「[…]」だけの行(脚注の [^1] は除く) */
function tableCaption(line) {
  const s = String(line == null ? '' : line).trim();
  if (s[0] !== '[' || s[s.length - 1] !== ']' || s[1] === '^') return null;
  const m = /^\[(.+?)\]\[([^\]]*)\]$/.exec(s);
  const text = (m ? m[1] : s.slice(1, -1)).trim();
  return text ? { text: text, label: m ? m[2].trim() : '' } : null;
}
/* 表のセルの結合を決める。rows は行ごとのセルの元の文(前後の空白を含む)、nh は見出しの行の数、n は列の数。
   { grid: 行×列ごとに、そこを覆うセル, anchors: セル(行の順、左から), byRow: 行ごとの、その行から始まるセル }。
   セルは { r, c, cs, rs, text }(左上の行・列、幅、高さ、前後の空白を除いた中身) */
function tableGrid(rows, nh, n) {
  const grid = rows.map(() => new Array(n).fill(null));
  const anchors = [], byRow = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    const segs = rows[r];
    // 横の結合: 空白の無い空のセル(「||」)は、左のセルにつながる(行の最初なら、ただの空のセル)
    const groups = [];
    for (let c = 0; c < n; c++) {
      const raw = c < segs.length ? segs[c] : null;
      if (raw === '' && groups.length) groups[groups.length - 1].cs++;
      else groups.push({ c: c, cs: 1, text: raw == null ? '' : raw.trim(), al: raw == null ? '' : cellAlign(raw) });
    }
    for (const g of groups) {
      // 縦の結合: 「^^」は、同じ幅で、同じ部分(見出し・本文)の真上のセルにつながる。つながらなければ文字のまま
      if (g.text === '^^' && r > 0 && (r < nh) === (r - 1 < nh)) {
        const up = grid[r - 1][g.c];
        if (up && up.c === g.c && up.cs === g.cs && up.r + up.rs === r) {
          up.rs++;
          for (let k = 0; k < g.cs; k++) grid[r][g.c + k] = up;
          continue;
        }
      }
      const a = { r: r, c: g.c, cs: g.cs, rs: 1, text: g.text, al: g.al };
      anchors.push(a);
      byRow[r].push(a);
      for (let k = 0; k < g.cs; k++) grid[r][g.c + k] = a;
    }
  }
  return { grid: grid, anchors: anchors, byRow: byRow };
}

/* Markdown を HTML にする。opts.lines が真なら、かたまりごとに元の文の行の範囲を data-line(最初の行)・data-end(終わりの次の行)で付ける
   (行は 0 から数える)。編集とプレビューを切り替えたときに、同じ場所を見せるために使う(syncAnchors)。
   付けるのは、段落・見出し・コード・数式・図・区切り線・リストの項目・表の行だけで、これらの行の範囲は重ならない。
   書き出しや印刷では付けない。
   先頭のフロントマターは、opts.fm が真なら(プレビューと履歴の表示)キーと値の並びにして出し、そうでなければ(印刷・書き出し)出さない。
   opts.slides が真なら、いちばん外側の区切り線(---・***・___)で本文をスライドに分ける(slidesHtml) */
function md(text, opts) {
  const all = String(text).replace(/\r\n?/g, '\n').split('\n');
  const skip = frontMatterLines(all);
  const lines = skip ? all.slice(skip) : all;
  const base = opts && opts.lines ? 0 : -1;
  const head = skip && opts && opts.fm ? frontMatterHtml(frontMatter(all.join('\n')), lineAttr(base, 0, skip)) : '';
  const prev = FN;
  FN = footnoteDefs(lines);
  try {
    let body;
    if (opts && opts.slides) body = slidesHtml(lines, base < 0 ? -1 : skip);
    else {
      const html = mdBlocks(lines, base < 0 ? -1 : skip);
      body = FN.order.length ? html + footnotesHtml() : html;
    }
    return head ? head + (body ? '\n' + body : '') : body;
  } finally { FN = prev; }
}
/* ---------- スライド ----------
   本文を、いちばん外側の区切り線で分けて、1枚ずつ <section class="slide"><div class="slide-in">…</div></section> にする
   (引用・リスト・コードの中の区切り線では分けない)。中身の無いスライドは出さない。脚注は最後のスライドに入れる。
   base が 0 以上なら、スライドに元の文の行の範囲を data-from(最初の行)・data-to(区切り線の行か、本文の終わり)で付ける
   (data-line とは別の名前にして、中のかたまりの行の範囲と重ねない) */
function slidesHtml(lines, base) {
  const cuts = [];
  const out = mdBlocks(lines, base, null, cuts);
  const bounds = [{ n: 0, line: -1 }].concat(cuts, [{ n: out.length, line: lines.length }]);
  const slides = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const html = out.slice(bounds[k].n, bounds[k + 1].n).join('\n');
    if (html) slides.push({ html: html, from: bounds[k].line + 1, to: bounds[k + 1].line });
  }
  if (FN.order.length) {
    if (!slides.length) slides.push({ html: '', from: 0, to: lines.length });
    slides[slides.length - 1].html += footnotesHtml();
  }
  return slides.map(s => '<section class="slide"' + (base < 0 ? '' : ' data-from="' + (base + s.from) + '" data-to="' + (base + s.to) + '"') + '><div class="slide-in">' + s.html + '</div></section>').join('\n');
}
/* プレビューをスライドの形にするメモか: フロントマターに marp: true(Marp と同じ書き方。yes・on も) */
function slidesOn(text) {
  const fm = frontMatter(text);
  const en = fm && fmGet(fm, 'marp');
  return !!en && /^(?:true|yes|on)$/i.test(fmText(en));
}
const lineAttr = (base, s, e) => (base < 0 ? '' : ' data-line="' + (base + s) + '" data-end="' + (base + e) + '"');
/* base: lines[0] が元の文の何行目か。負なら行の範囲を付けない。sep: かたまりの間に入れる文字(既定は改行。リストの項目の中は空)。
   cuts(配列)を渡すと、区切り線をスライドの切れ目として cuts に { n: その前までのかたまりの数, line: lines の中の行 } で入れ、
   つないだ文字ではなく、かたまりの HTML の配列を返す */
function mdBlocks(lines, base, sep, cuts) {
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
    // スライドに分けるとき(いちばん外側)は、HTML のコメント(<!-- … -->。Marp の指定や発表者のメモ)の行を出さない
    if (cuts && /^ {0,3}<!--/.test(ln)) {
      flush();
      const from = ln.indexOf('<!--') + 4;
      if (ln.indexOf('-->', from) < 0) { i++; while (i < lines.length && lines[i].indexOf('-->') < 0) i++; }
      i++;
      continue;
    }
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { flush(); i++; put('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>', at); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) {
      flush(); i++;
      // スライドに分けるとき(cuts を渡したとき。いちばん外側だけ)は、区切り線を出さずに、スライドの切れ目として覚える
      if (cuts) cuts.push({ n: out.length, line: at }); else put('<hr>', at);
      continue;
    }
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
      const dl = splitRow(lines[i + 1]);
      if (splitRaw(ln).length === dl.length) {
        // 見出しの行を足す: 段落の終わりの、「|」で始まる行。その上の「[…]」だけの行は表題
        let hs = i, cap = null, capAt = -1;
        if (para.length) {
          while (hs - 1 >= paraAt && lines[hs - 1].trim()[0] === '|') hs--;
          if (hs - 1 >= paraAt && (cap = tableCaption(lines[hs - 1]))) capAt = hs - 1;
          para = para.slice(0, Math.max(0, (capAt >= 0 ? capAt : hs) - paraAt));
        }
        flush();
        const n = dl.length;
        const al = dl.map(c => (/^:-+:$/.test(c) ? 'c' : /-:$/.test(c) ? 'r' : 'l'));
        const heads = [];
        for (let k = hs; k <= i; k++) heads.push(k);
        i += 2;
        // 本文の行: 「|」のある行(表題の「[…]」だけの行は除く)。すぐ下の「[…]」だけの行は、上に表題が無ければ表題
        const body = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0 && !(lines[i].trim()[0] !== '|' && tableCaption(lines[i]))) body.push(i++);
        if (!cap && i < lines.length && (cap = tableCaption(lines[i]))) capAt = i++;
        const rowLines = heads.concat(body);
        const g = tableGrid(rowLines.map(k => splitRaw(lines[k])), heads.length, n);
        // セルだけの配置(列と違うもの)は、data-al にも書く(書き出しで列の配置と分けるため)
        const own = a => (a.al && a.al !== al[a.c] ? a.al : '');
        const cell = (a, tag) => '<' + tag + ' class="al-' + (own(a) || al[a.c]) + '"' + (own(a) ? ' data-al="' + own(a) + '"' : '') + (a.cs > 1 ? ' colspan="' + a.cs + '"' : '') + (a.rs > 1 ? ' rowspan="' + a.rs + '"' : '')
          + (base < 0 ? '' : ' data-col="' + a.c + '"') + '>' + inline(a.text) + '</' + tag + '>';
        // 行の範囲: 最後の見出しの行は、区切りの行まで
        const tr = r => '<tr' + lineAttr(base, rowLines[r], rowLines[r] + (r === heads.length - 1 ? 2 : 1)) + '>' + g.byRow[r].map(a => cell(a, r < heads.length ? 'th' : 'td')).join('') + '</tr>';
        const trs = (s, e) => { let h = ''; for (let r = s; r < e; r++) h += tr(r); return h; };
        out.push('<div class="tblwrap"><table' + (cap && cap.label ? ' data-label="' + esc(cap.label) + '"' : '') + '>'
          + (cap ? '<caption' + lineAttr(base, capAt, capAt + 1) + '>' + inline(cap.text) + '</caption>' : '')
          + '<thead>' + trs(0, heads.length) + '</thead>' + (body.length ? '<tbody>' + trs(heads.length, rowLines.length) + '</tbody>' : '') + '</table></div>');
        continue;
      }
    }
    if (!para.length) paraAt = i;
    para.push(ln.trim());
    i++;
  }
  flush();
  if (cuts) return out;
  return out.join(sep == null ? '\n' : sep);
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

/* メモの検索で当てない所: 先頭のフロントマターの --- の行と、キーの名前(行の始めから「:」まで。「tags:」「title:」など)。
   値(タグの名前・題名など)には当てる。[{ s, e }] */
function fmKeySpans(text) {
  text = String(text == null ? '' : text);
  if (!text.startsWith('---')) return [];
  const lines = text.split('\n', FM_MAX_LINES + 2);
  const n = frontMatterLines(lines);
  if (!n) return [];
  const out = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    const ln = lines[i];
    if (i === 0 || i === n - 1) out.push({ s: p, e: p + ln.length });
    else if (FM_KEY_RE.test(ln)) out.push({ s: p, e: p + ln.indexOf(':') + 1 });
    p += ln.length + 1;
  }
  return out;
}
/* s〜e が、どれかの範囲の中にすっかり入るか(キーの名前と値にまたがる一致には当てる) */
const inSpans = (spans, s, e) => spans.some(k => s >= k.s && e <= k.e);
/* メモの検索の一致(フロントマターのキーの名前と --- の行の中の一致は除く) */
function searchRanges(text, q) {
  const rs = matchRanges(text, q);
  if (!rs.length) return rs;
  const sp = fmKeySpans(text);
  return sp.length ? rs.filter(r => !inSpans(sp, r.s, r.e)) : rs;
}

/* 最新の版だけを探す: 1つのメモに1件(最初の箇所の前後の文と、見つかった箇所の数 n)。total は箇所の数の合計 */
function searchLatest(notes, q) {
  const res = [];
  let total = 0;
  for (const n of notes) {
    const rs = searchRanges(n.text, q);
    if (!rs.length) continue;
    total += rs.length;
    res.push({ id: n.id, s: rs[0].s, e: rs[0].e, n: rs.length, snippet: snippetOf(n.text, rs[0].s, rs[0].e) });
  }
  return { res: res, total: total };
}

/* 履歴すべてを探す: 検索語が見つかる「1か所」ごとに1件。
   その箇所が書かれた版(a)から、編集で壊されて消える直前の版(b)までを追いかける。
   編集のたびに、すでにある箇所は位置をずらして引き継ぎ、新しく生まれた箇所だけを編集まわりで探す。
   最後の版(b)でフロントマターのキーの名前か --- の行の中にある箇所は、結果に入れない(searchRanges と同じ) */
function searchHistory(notes, q, per, probe) {
  const re = new RegExp(escRe(q), 'gi'), ql = q.length;
  const res = [];
  let total = 0;
  for (const n of notes) {
    const N = n.ops.length, found = [];
    const text = new ChunkText('');   // 当て直している本文(長い履歴でも速いように、かたまりで持つ)
    let alive = [];
    for (let k = 1; k <= N; k++) {
      const op = n.ops[k - 1], dl = op.d.length, il = op.i.length, delta = il - dl;
      let sp = null;   // 編集の前の本文の、キーの名前の範囲(壊れた箇所があるときだけ求める)
      const next = [];
      for (const m of alive) {
        if (m.e <= op.p) next.push(m);                                  // 編集より前: そのまま
        else if (m.s >= op.p + dl) { m.s += delta; m.e += delta; next.push(m); } // 編集より後: 位置だけずれる
        else {                                                          // 編集で壊れた
          m.b = k - 1; m.removedAt = op.t;
          if (!sp) sp = fmKeySpans(text.toString());
          if (!inSpans(sp, m.s, m.e)) found.push(m);
        }
      }
      text.apply(op.p, dl, op.i);
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
      if (probe) probe(k, text.toString(), alive);
    }
    const spN = alive.length ? fmKeySpans(text.toString()) : [];
    for (const m of alive) { m.b = N; m.removedAt = 0; if (!inSpans(spN, m.s, m.e)) found.push(m); }
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
  const text = new ChunkText('');   // 当て直している本文(かたまりで持つ)
  let alive = [], k = 0;
  const c = { counts, done: N === 0, step };
  function step(limit) {
    const end = Math.min(N, k + Math.max(1, limit));
    while (k < end) {
      const op = ops[k++], dl = op.d.length, il = op.i.length, delta = il - dl;
      text.apply(op.p, dl, op.i);
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
/* 元の文の line 行目を含む表(md と同じ読み方。引用の中の表も。表題の行は含まない)。
   { heads(見出しの行), head(最後の見出しの行), delim(区切りの行), rows(本文の行), cols, align, caption(表題の行。無ければ -1),
     first, last(表題も含めた、表の最初と最後の行) } か null */
function tableAt(text, line) {
  const html = md(text, { lines: true });
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    const th = /<thead>([\s\S]*?)<\/thead>/.exec(m[1]);
    if (!th) continue;
    const heads = [], rows = [];
    th[1].replace(/<tr data-line="(\d+)"/g, (x, n) => { heads.push(+n); return x; });
    m[1].slice(th.index + th[0].length).replace(/<tr data-line="(\d+)"/g, (x, n) => { rows.push(+n); return x; });
    if (!heads.length) continue;
    const head = heads[heads.length - 1];
    const last = rows.length ? rows[rows.length - 1] : head + 1;
    if (line < heads[0] || line > last) continue;
    const cap = /^<caption data-line="(\d+)"/.exec(m[1]);
    const caption = cap ? +cap[1] : -1;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const d = tableRowParse(lines[head + 1]);
    const align = d.segs.map(s => { const t = s.trim(); return /^:-+:$/.test(t) ? 'c' : /-:$/.test(t) ? 'r' : /^:/.test(t) ? 'l' : ''; });
    return { heads: heads, head: head, delim: head + 1, rows: rows, cols: d.segs.length, align: align, caption: caption,
      first: caption >= 0 ? Math.min(caption, heads[0]) : heads[0], last: Math.max(caption, last) };
  }
  return null;
}
/* 表のセルの中身(元の文のまま)。row は元の文の行(見出しの行か本文の行) */
function tableCell(text, row, col) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const r = tableRowParse(lines[row] || '');
  return r.segs[col] != null ? segText(r.segs[col]) : '';
}
/* 元の文の row 行目・col 列目のセルを含む表と、その結合。{ t, lines, rl(見出し・本文の行の番号), parsed(行の番号 → tableRowParse), g(tableGrid), ri(rl の中の番号), a(そこを覆うセル) } か null */
function tablePrep(text, row, col) {
  const t = tableAt(text, row);
  if (!t) return null;
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const rl = t.heads.concat(t.rows);
  const parsed = {};
  for (const i of rl.concat([t.delim])) parsed[i] = tableRowParse(lines[i]);
  const g = tableGrid(rl.map(i => parsed[i].segs), t.heads.length, t.cols);
  const ri = rl.indexOf(row === t.delim ? t.head : row);
  const c = Math.max(0, Math.min(t.cols - 1, col | 0));
  return { t: t, lines: lines, rl: rl, parsed: parsed, g: g, ri: ri, c: c, a: g.grid[ri][c] };
}
/* セル a と結合できる右・下のセル(高さ・幅が同じで、見出しと本文をまたがないもの): { right, down }(無ければ null) */
function tableNeighbors(g, nh, n, a) {
  let right = null, down = null;
  if (a.c + a.cs < n) { const b = g.grid[a.r][a.c + a.cs]; if (b && b.r === a.r && b.rs === a.rs) right = b; }
  const rb = a.r + a.rs;
  if (rb < g.grid.length && (rb < nh) === (a.r < nh)) { const b = g.grid[rb][a.c]; if (b && b.r === rb && b.c === a.c && b.cs === a.cs) down = b; }
  return { right: right, down: down };
}
/* セル(row, col)を覆う、結合したセルの左上: { row, col } か null */
function tableAnchor(text, row, col) {
  const p = tablePrep(text, row, col);
  return p ? { row: p.rl[p.a.r], col: p.a.c } : null;
}
/* セル(row, col)で、結合の操作ができるか: { right(右のセルと結合), down(下のセルと結合), merged(結合を解除) } か null */
function tableSpan(text, row, col) {
  const p = tablePrep(text, row, col);
  if (!p) return null;
  const s = tableNeighbors(p.g, p.t.heads.length, p.t.cols, p.a);
  return { right: !!s.right, down: !!s.down, merged: p.a.cs > 1 || p.a.rs > 1 };
}
/* セルを移る。dx: 次(1)・前(-1)のセル(行の終わりで次の行へ)、dy: 下(1)・上(-1)のセル。結合したセルは1つとして数える。
   { row, col }、最後のセルの次なら { append: true }、移れなければ null */
function tableNav(text, row, col, dx, dy) {
  const p = tablePrep(text, row, col);
  if (!p) return null;
  const a = p.a, pos = x => ({ row: p.rl[x.r], col: x.c });
  if (dy) {
    const r = dy > 0 ? a.r + a.rs : a.r - 1;
    return r >= 0 && r < p.rl.length ? pos(p.g.grid[r][a.c]) : null;
  }
  const k = p.g.anchors.indexOf(a) + (dx > 0 ? 1 : -1);
  if (k >= p.g.anchors.length) return { append: true };
  return k >= 0 ? pos(p.g.anchors[k]) : null;
}
/* 表を編集する。row は元の文の行(見出しの行・区切りの行・本文の行)、col は列(0から)。結合したセルの中なら、そのセル(左上)に対して行う。
   action: rowAbove / rowBelow / rowDelete / colLeft / colRight / colDelete / alignLeft / alignCenter / alignRight / alignNone / delete /
   mergeRight / mergeDown / unmerge / cell(arg: 中身)。
   行・列を結合したセルの内側に足すと結合が広がり、結合したセルの一部を消すと縮む(左上を消したときは、中身を隣に移す)。
   見出しの行の上・間に行を足すと、見出しの行が増える。見出しの行が1つなら、それは消せない。
   { text, row, col }(編集のあとにカーソルを置くセル。表を消したときは row が表のあった行、col は -1)か、できないときは null */
function tableEdit(text, row, col, action, arg) {
  const p = tablePrep(text, row, col);
  if (!p) return null;
  const { t, lines, rl, parsed, g, ri, a } = p;
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const n = t.cols, nh = t.heads.length;
  col = p.c;
  if (row === t.delim) row = t.head;
  const isHead = ri < nh;
  const all = rl.concat([t.delim]);
  // セルが足りない行は、空のセルで補う(区切りの行は ---)
  const pad = (r, i) => { while (r.segs.length < n) r.segs.push(i === t.delim ? ' --- ' : '  '); };
  const out = (r, c) => ({ text: lines.join('\n').replace(/\n/g, nl), row: r, col: c });
  const at = r => { const x = parsed[rl[r]]; pad(x, rl[r]); return x; };   // 行(rl の番号)のセルを書き換える準備
  const put = r => { lines[rl[r]] = tableRowBuild(parsed[rl[r]]); };
  const marker = (segs, k) => k > 0 && segs[k] === '';                     // 横の結合の続き(「||」)
  const blank = seg => (seg === '' ? '  ' : seg);                          // 行の最初の「||」(ただの空のセル)を、空白のあるセルに
  const hp = parsed[t.head];
  // 新しい行: 見出しの行と同じ書き方(両端の | と引用の >)。見出しに足す行と、1列の表は両端に | が要る
  const newRow = (segs, head) => tableRowBuild({ pre: hp.pre, lead: hp.lead || n === 1 || head, segs: segs, trail: hp.trail || n === 1 || head, tail: '' });
  if (action === 'cell') {
    const r = at(a.r);
    r.segs[a.c] = segSet(r.segs[a.c], cellEscape(arg == null ? '' : arg));
    put(a.r);
    return out(rl[a.r], a.c);
  }
  if (action === 'rowAbove' || action === 'rowBelow') {
    // 新しい行を入れる位置(rl の番号。そこにあった行が下にずれる)。最後の見出しの行の下は、本文の最初
    const pos = action === 'rowAbove' ? ri : (ri === nh - 1 ? nh : ri + 1);
    const head = pos < nh;
    const segs = Array.from({ length: n }, () => '  ');
    // 上から続く縦の結合の内側に入れるときは、その結合を広げる
    if (pos > 0 && pos < rl.length && (pos < nh) === (pos - 1 < nh)) {
      for (let c = 0; c < n; c++) {
        const x = g.grid[pos][c];
        if (x && x.r < pos && x.c === c) { segs[c] = ' ^^ '; for (let k = 1; k < x.cs; k++) segs[c + k] = ''; }
      }
    }
    const line = pos < rl.length ? rl[pos] : (rl.length > nh ? rl[rl.length - 1] + 1 : t.delim + 1);
    lines.splice(line, 0, newRow(segs, head));
    const c = segs[col] === '  ' ? col : Math.max(0, segs.indexOf('  '));
    return out(line, c);
  }
  if (action === 'rowDelete') {
    if (isHead && nh <= 1) return null;
    // この行から下へ結合しているセルは、中身を下の行に移す
    for (const x of g.byRow[ri]) if (x.rs > 1) { const q = at(ri + 1); q.segs[x.c] = blank(at(ri).segs[x.c]); put(ri + 1); }
    // 最後の見出しの行を消すときは、上の見出しの行が区切りの行の上に来るので、セルの数を区切りの行に合わせる
    if (ri === nh - 1) { const q = at(ri - 1); q.segs.length = n; put(ri - 1); }
    lines.splice(row, 1);
    let next;
    if (isHead) next = ri === nh - 1 ? rl[ri - 1] : row;
    else next = ri + 1 < rl.length ? row : ri - 1 >= nh ? rl[ri - 1] : t.head;
    return out(next, col);
  }
  if (action === 'colLeft' || action === 'colRight' || action === 'colDelete') {
    if (action === 'colDelete' && n <= 1) return null;
    // 右に足すときは、結合したセルの右に
    const pos = action === 'colRight' ? a.c + a.cs : action === 'colLeft' ? a.c : col;
    for (const i of all) {
      const r = parsed[i];
      pad(r, i);
      if (action === 'colDelete') {
        if (i !== t.delim && !marker(r.segs, col) && marker(r.segs, col + 1)) r.segs[col + 1] = blank(r.segs[col]);
        r.segs.splice(col, 1);
      } else r.segs.splice(pos, 0, i === t.delim ? ' --- ' : marker(r.segs, pos) ? '' : '  ');
      // 先頭の | の無い行で、最初の列を消して空になったときは、そのまま(区切りは残る)
      lines[i] = tableRowBuild(r);
    }
    return out(row, action === 'colDelete' ? Math.min(col, n - 2) : pos);
  }
  if (/^align(Left|Center|Right|None)$/.test(action)) {
    const d = parsed[t.delim];
    pad(d, t.delim);
    const seg = d.segs[col];
    const dashes = Math.max(3, (seg.match(/-/g) || []).length);
    const s0 = /^\s*/.exec(seg)[0], s1 = /\s*$/.exec(seg)[0];
    const v = action === 'alignLeft' ? ':' + '-'.repeat(dashes) : action === 'alignCenter' ? ':' + '-'.repeat(dashes) + ':' : action === 'alignRight' ? '-'.repeat(dashes) + ':' : '-'.repeat(dashes);
    d.segs[col] = s0 + v + s1;
    lines[t.delim] = tableRowBuild(d);
    return out(row, col);
  }
  if (action === 'delete') {
    const first = t.first;
    lines.splice(first, t.last - first + 1);
    // 前後が空の行なら、空の行を1つにする
    if (first > 0 && lines[first - 1] === '' && lines[first] === '') lines.splice(first, 1);
    return out(first, -1);
  }
  if (action === 'unmerge') {
    if (a.cs === 1 && a.rs === 1) return null;
    for (let r = a.r; r < a.r + a.rs; r++) {
      const x = at(r);
      for (let c = a.c; c < a.c + a.cs; c++) x.segs[c] = r === a.r && c === a.c ? blank(x.segs[c]) : '  ';
      put(r);
    }
    return out(rl[a.r], a.c);
  }
  if (action === 'mergeRight' || action === 'mergeDown') {
    const s = tableNeighbors(g, nh, n, a);
    const b = action === 'mergeRight' ? s.right : s.down;
    if (!b) return null;
    // 結合される側の中身は、こちらの中身の後ろに足す(消さない)
    const xa = at(a.r), bt = segText(at(b.r).segs[b.c]), atx = segText(xa.segs[a.c]);
    let v = atx && bt ? atx + ' ' + bt : atx || bt;
    if (v === '^^') v = '\\^^';
    xa.segs[a.c] = v === atx ? blank(xa.segs[a.c]) : segSet(blank(xa.segs[a.c]), v);
    put(a.r);
    if (action === 'mergeRight') {
      for (let r = a.r; r < a.r + a.rs; r++) { const x = at(r); for (let c = b.c; c < b.c + b.cs; c++) x.segs[c] = ''; put(r); }
    } else {
      const x = at(b.r);
      x.segs[b.c] = ' ^^ ';
      put(b.r);
    }
    return out(rl[a.r], a.c);
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
  if (t) return t.last;
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

/* ---------- 図(Mermaid)の挿入と編集(図エディタ) ----------
   図のかたまりは ```mermaid(~~~mermaid も)のコードブロック。範囲は md が付けた行の範囲(blockRanges の 'diagram')で知る */
/* 図の文を整える: 改行を \n に、前の空の行と終わりの空白を取る(1行目の字下げは残す) */
const diagramNorm = src => String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
/* 囲みの記号: ch(` か ~)を、図の文の中にある同じ文字の並び(行の頭)より長く。最短は min */
function diagramFence(src, ch, min) {
  let n = Math.max(3, min || 0);
  const re = ch === '~' ? /^\s*(~{3,})/gm : /^\s*(`{3,})/gm;
  for (const m of String(src).matchAll(re)) n = Math.max(n, m[1].length + 1);
  return (ch === '~' ? '~' : '`').repeat(n);
}
/* 元の文の line 行目を含む図のかたまり: { line, end(閉じの行の次。閉じが無ければ最後の行の次), pre(引用の > や字下げ), fence, closed, src } か null */
function diagramBlock(text, line) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const b = blockRanges(src).find(x => x.kind === 'diagram' && line >= x.s && line < x.e);
  if (!b) return null;
  const lines = src.split('\n');
  const first = lines[b.s] || '';
  const pre = /^((?:[ \t]*>[ \t]?)*[ \t]*)/.exec(first)[1];
  const ws = /^[ \t]*$/.test(pre);
  const strip = l => (l.startsWith(pre) ? l.slice(pre.length) : ws ? l.replace(new RegExp('^[ \\t]{0,' + pre.length + '}'), '') : l.replace(/^(?:[ \t]*>[ \t]?)*/, ''));
  const body = lines.slice(b.s, b.e).map(strip);
  const f = /^(`{3,}|~{3,})mermaid\s*$/.exec(body[0].trim());
  if (!f) return null;
  const closed = body.length > 1 && fenceCloses(body[body.length - 1], f[1]);
  return { line: b.s, end: b.e, pre: pre, fence: f[1], closed: closed, src: body.slice(1, closed ? -1 : body.length).join('\n') };
}
/* 図の文 src を、囲みの行と合わせた行の並びにする(pre は各行の頭に付ける。空の行では終わりの空白を付けない) */
function diagramLines(src, fence, pre) {
  const t = diagramNorm(src);
  const ch = fence ? fence[0] : '`';
  const f = diagramFence(t, ch, fence ? fence.length : 3);
  const p = pre || '';
  return [f + 'mermaid'].concat(t ? t.split('\n') : [], [f]).map(l => (l === '' ? p.replace(/[ \t]+$/, '') : p + l));
}
/* 図のかたまり b(diagramBlock の結果)の中身を src にする。囲みの記号と引用の > はそのまま。{ text, line, end } */
function diagramReplace(text, b, src) {
  const nl = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const block = diagramLines(src, b.fence, b.pre);
  lines.splice(b.line, b.end - b.line, ...block);
  return { text: lines.join(nl), line: b.line, end: b.line + block.length };
}
/* 図を、元の文の after 行目の次に、新しいかたまりとして入れる(blockInsert)。{ text, line, end } */
function diagramInsert(text, after, src) {
  const block = diagramLines(src);
  const r = blockInsert(text, after, block);
  return { text: r.text, line: r.at, end: r.at + block.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { tableCaption, tableGrid, tableAnchor, tableSpan, tableNav, splitRow, diagramNorm, diagramFence, diagramBlock, diagramLines, diagramReplace, diagramInsert, inlineMathSpans, blockRanges, mathBlockParts, mathAt, mathInBlock, mathInline, mathInsert, mathReplace, emptyBraceAt, blockInsert, tableRowParse, tableRowBuild, tableAt, tableCell, tableEdit, tableInsert, tableInsertAfter, tableCaret, tableCellPos, caretFromRendered, cellEscape, chunkLines, historyCounter, joinPieces, pieceSpans, emojiSuggest, emojiQueryAt, setMdLang, newlineEdit, indentEdit, tabEdit, inFenceAt, changeEnd, macKeys, esc, applyOp, ChunkText, makeOp, textAt, inline, md, slidesOn, lineToY, yToLine, anchorAt, escRe, matchRanges, markPieces, diffLines, snippetOf, searchLatest, searchHistory, cursorInfo, selectionInfo, textStats, formatLines, inlineFormat, noteLinkAt, linkText, pushRecent, headingSlug, titleOf, frontMatter, frontMatterLines, frontMatterInsert, tagsOf, fmScalar, fmItems, fmText, docMeta, titleBlockHtml, docOpts, pageSizeCss, tocHtml, tagKey, tagHit, hasTags, parseQuery, tagFilter, hasTagQuery, tagTypingAt, tagSuggest, tagToken, fmKeySpans, searchRanges, isImageName, attachName, attachMarkup, attachRefs, removeAttachRefs, buildRe, expandRepl, findAll, findFrom, replaceAllText };
}
