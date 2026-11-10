'use strict';
/* 文書の形式で書き出す: AsciiDoc(.adoc)、Word(.docx)、LaTeX(.tex)。
   本文は画面側(renderer)で整形した HTML を受け取る(HTML・MHTML の書き出しと同じもの。ただし数式は中身を空にして、
   data-tex に LaTeX、data-mml に KaTeX の MathML を持たせ、画像は data-att にファイル ID、data-w・data-h に大きさを持たせる。
   Mermaid の図は中身を空にして、data-src に元の文、Word と LaTeX のときは data-png に図の PNG(base64)と data-w・data-h を持たせる)。
   それを見出し・段落・リストなどの構造(ブロックと文中の要素の木)にしてから、それぞれの形式に書く。
   - AsciiDoc: テキストなので、画像はファイルの外(同じ場所のフォルダー)に置いて参照する。数式は latexmath で LaTeX のまま入れる。
     図は [mermaid] のブロックで元の文のまま入れる(Asciidoctor Diagram があれば図になる)
   - Word: ZIP に XML をまとめる(ziplite.js)。数式は MathML を Word の数式(OMML)に変換し、Word で編集できるようにする。
     図は PNG の画像にする(PNG が無いときは元の文をコードとして入れる)
   - LaTeX: LuaLaTeX でコンパイルする .tex。数式は LaTeX のまま入れる。画像と図の PNG は、同じ場所のフォルダーに置いて参照する
   Electron なしでテストできるよう、ファイルの読み書きはしない(main.js が行う)。 */
const { writeZip } = require('./ziplite');

/* ---------- HTML・MathML を読む(EverPad が作るものを読めればよい、小さな読み取り) ---------- */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'source', 'embed', 'param', 'track']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decode(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] !== '#') return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}
/* 文字列 → 木。要素は { tag, attrs, children }、文字は { text } */
function parseMarkup(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
    } else if (m[2]) {
      const el = { tag: m[2].toLowerCase(), attrs: {}, children: [] };
      for (const a of (m[3] || '').matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        el.attrs[a[1].toLowerCase()] = decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : '');
      }
      top.children.push(el);
      if (!m[4] && !VOID.has(el.tag)) stack.push(el);
    } else if (m[5] != null) top.children.push({ text: decode(m[5]) });
    else if (m[0] === '<') top.children.push({ text: '<' });
  }
  return root;
}
const textOf = n => (n.text != null ? n.text : (n.children || []).map(textOf).join(''));
const hasClass = (n, c) => (' ' + (n.attrs && n.attrs.class || '') + ' ').indexOf(' ' + c + ' ') >= 0;

/* ---------- 本文の HTML → 構造 ----------
   ブロック: { t:'p', c } { t:'h', level, c } { t:'pre', text } { t:'math', tex, mml, error } { t:'hr' } { t:'diagram', src, png, w, h }
             { t:'quote', c:[ブロック] } { t:'list', ordered, start, items:[{ check: null|true|false, c:[ブロック] }] }
             { t:'table', align:['l'|'c'|'r'], head:[セル], rows:[[セル]] }(セルは文中の要素の配列)
             { t:'alert', kind:'note'|'tip'|'important'|'warning'|'caution', title:[文中], c:[ブロック] }
             { t:'footnotes', items:[{ n, c:[ブロック] }] }(脚注の一覧。本文の最後に1つ)
   文中: { t:'text', v } { t:'br' } { t:'b'|'i'|'s', c } { t:'code', v } { t:'a', href, c }
         { t:'img', file, alt, w, h } { t:'math', tex, mml, error, display } { t:'fn', n }(脚注の参照) */
const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];
const HEADING = /^h([1-6])$/;
function mathNode(n, display) {
  return { t: 'math', tex: n.attrs['data-tex'] || '', mml: n.attrs['data-mml'] || '', error: hasClass(n, 'math-error'), display: !!display };
}
function diagramNode(n) {
  const png = n.attrs['data-png'] || '';
  return { t: 'diagram', src: n.attrs['data-src'] || '', png: /^[A-Za-z0-9+/]+={0,2}$/.test(png) ? png : '', w: +n.attrs['data-w'] || 0, h: +n.attrs['data-h'] || 0 };
}
function inlinesOf(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.text != null) { if (n.text) out.push({ t: 'text', v: n.text.replace(/\r?\n/g, ' ') }); continue; }
    const tag = n.tag;
    if (hasClass(n, 'math')) out.push(mathNode(n, hasClass(n, 'math-display')));
    else if (tag === 'sup' && hasClass(n, 'fnref')) {
      const a = n.children.find(x => x.tag === 'a' && x.attrs['data-fn']);
      if (a) out.push({ t: 'fn', n: +a.attrs['data-fn'] }); else out.push(...inlinesOf(n.children));
    } else if ((tag === 'a' && hasClass(n, 'fnback')) || tag === 'svg') { /* 脚注の「本文に戻る」とアラートの絵は書き出さない */ }
    else if (tag === 'br') out.push({ t: 'br' });
    else if (tag === 'strong' || tag === 'b') out.push({ t: 'b', c: inlinesOf(n.children) });
    else if (tag === 'em' || tag === 'i') out.push({ t: 'i', c: inlinesOf(n.children) });
    else if (tag === 'del' || tag === 's') out.push({ t: 's', c: inlinesOf(n.children) });
    else if (tag === 'code') out.push({ t: 'code', v: textOf(n) });
    else if (tag === 'a') {
      const href = n.attrs.href || '';
      if (/^https?:\/\//i.test(href)) out.push({ t: 'a', href: href, c: inlinesOf(n.children) });
      else out.push(...inlinesOf(n.children));
    } else if (tag === 'img') {
      const file = n.attrs['data-att'] || '';
      if (/^[0-9a-f]{16}\.[a-z0-9]{1,8}$/.test(file)) out.push({ t: 'img', file: file, alt: n.attrs.alt || '', w: +n.attrs['data-w'] || 0, h: +n.attrs['data-h'] || 0 });
    } else if (tag === 'input') out.push({ t: 'check', on: 'checked' in n.attrs });
    else out.push(...inlinesOf(n.children));
  }
  return out;
}
const blank = c => c.every(x => x.t === 'text' && !x.v.trim());
/* 文中の要素の並びを段落にする。文中の $$…$$(独立した行の数式)は、段落を分けて数式のブロックにする */
function pushParagraphs(c, out) {
  let cur = [];
  const flush = () => {
    while (cur.length && (cur[0].t === 'br' || (cur[0].t === 'text' && !cur[0].v.trim()))) cur.shift();
    while (cur.length && (cur[cur.length - 1].t === 'br' || (cur[cur.length - 1].t === 'text' && !cur[cur.length - 1].v.trim()))) cur.pop();
    if (cur.length) {
      if (cur[0].t === 'text') cur[0] = { t: 'text', v: cur[0].v.replace(/^\s+/, '') };
      const l = cur.length - 1;
      if (cur[l].t === 'text') cur[l] = { t: 'text', v: cur[l].v.replace(/\s+$/, '') };
      out.push({ t: 'p', c: cur });
    }
    cur = [];
  };
  for (const x of c) {
    if (x.t === 'math' && x.display) { flush(); out.push({ t: 'math', tex: x.tex, mml: x.mml, error: x.error }); } else cur.push(x);
  }
  flush();
}
function blocksOf(nodes) {
  const out = [];
  let pending = [];
  const flush = () => { if (pending.length) { const c = inlinesOf(pending); if (!blank(c)) pushParagraphs(c, out); pending = []; } };
  for (const n of nodes) {
    if (n.text != null) { pending.push(n); continue; }
    const tag = n.tag;
    let h;
    if (tag === 'p') { flush(); pushParagraphs(inlinesOf(n.children), out); }
    else if ((h = HEADING.exec(tag))) { flush(); out.push({ t: 'h', level: +h[1], c: inlinesOf(n.children).filter(x => x.t !== 'check') }); }
    else if (tag === 'pre') { flush(); out.push({ t: 'pre', text: textOf(n) }); }
    else if (tag === 'hr') { flush(); out.push({ t: 'hr' }); }
    else if (tag === 'blockquote' && hasClass(n, 'alert') && ALERT_KINDS.indexOf(n.attrs['data-alert']) >= 0) {
      flush();
      const kids = n.children.filter(x => !(x.text != null && !x.text.trim()));
      const head = kids[0] && kids[0].tag === 'p' && hasClass(kids[0], 'alert-title') ? kids.shift() : null;
      out.push({ t: 'alert', kind: n.attrs['data-alert'], title: head ? inlinesOf(head.children) : [], c: blocksOf(kids) });
    } else if (tag === 'blockquote') { flush(); out.push({ t: 'quote', c: blocksOf(n.children) }); }
    else if (tag === 'section' && hasClass(n, 'footnotes')) {
      flush();
      const items = [];
      const walk = x => { for (const c of x.children || []) { if (c.tag === 'li' && c.attrs['data-fn']) items.push({ n: +c.attrs['data-fn'], c: blocksOf(c.children) }); else if (c.tag) walk(c); } };
      walk(n);
      if (items.length) out.push({ t: 'footnotes', items: items });
    }
    else if (tag === 'ul' || tag === 'ol') { flush(); out.push(listOf(n)); }
    else if (tag === 'table') { flush(); out.push(tableOf(n)); }
    else if (tag === 'div' && hasClass(n, 'diagram')) { flush(); out.push(diagramNode(n)); }
    else if (tag === 'div' && hasClass(n, 'math')) { flush(); const m = mathNode(n, true); out.push({ t: 'math', tex: m.tex, mml: m.mml, error: m.error }); }
    else if (tag === 'div') { flush(); out.push(...blocksOf(n.children)); }
    else pending.push(n);
  }
  flush();
  return out;
}
function listOf(n) {
  const items = [];
  for (const li of n.children) {
    if (li.tag !== 'li') continue;
    let check = null;
    const kids = li.children.slice();
    const k = kids.findIndex(x => x.tag === 'input');
    if (k >= 0 && kids.slice(0, k).every(x => x.text != null && !x.text.trim())) {
      check = 'checked' in kids[k].attrs;
      kids.splice(0, k + 1);
      if (kids[0] && kids[0].text != null) kids[0] = { text: kids[0].text.replace(/^ /, '') };
    }
    items.push({ check: check, c: blocksOf(kids) });
  }
  const ordered = n.tag === 'ol';
  return { t: 'list', ordered: ordered, start: ordered ? Math.max(0, parseInt(n.attrs.start, 10) || 1) : 1, items: items };
}
function tableOf(n) {
  const rows = [];
  const walk = x => { for (const c of x.children || []) { if (c.tag === 'tr') rows.push(c); else if (c.tag) walk(c); } };
  walk(n);
  const cells = tr => tr.children.filter(c => c.tag === 'th' || c.tag === 'td');
  const first = rows.length ? cells(rows[0]) : [];
  const align = first.map(c => (hasClass(c, 'al-c') ? 'c' : hasClass(c, 'al-r') ? 'r' : 'l'));
  const toCells = tr => { const cs = cells(tr).map(c => inlinesOf(c.children)); while (cs.length < align.length) cs.push([]); return cs.slice(0, align.length); };
  return { t: 'table', align: align, head: rows.length ? toCells(rows[0]) : [], rows: rows.slice(1).map(toCells) };
}
function bodyTree(bodyHtml) { return blocksOf(parseMarkup(String(bodyHtml)).children); }

/* 構造の中の画像(ファイル ID の一覧、同じものは1つ) */
function treeImages(blocks) {
  const ids = [];
  const visit = x => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    if (x.t === 'img' && ids.indexOf(x.file) < 0) ids.push(x.file);
    for (const k of ['c', 'items', 'head', 'rows', 'title']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  return ids;
}
function treeHasMath(blocks) {
  let found = false;
  const visit = x => {
    if (found || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (x.t === 'math') { found = true; return; }
    for (const k of ['c', 'items', 'head', 'rows', 'title']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  return found;
}

/* ---------- AsciiDoc ----------
   書式は、日本語の文の途中でも効く「2つ重ねる」書き方(**太字**、__斜体__、``コード``)にする。
   AsciiDoc の記号として読まれうる文字を含む文は pass:c[…] で囲み、そのまま表示させる。
   行の先頭がリストや見出しなどの記号に見えるときは {empty}(何も出さない属性)を前に付ける。 */
const ADOC_RISKY = /[*_`#^~+[\]{}<>\\|']|:\/\/|--|\.\.\.|->|=>|<-|<=|\((?:C|R|TM)\)|::|;;/;
const ADOC_RISKY_LINK = /[,="]/;
function adocPass(v) {
  // 最後が \ だと閉じ括弧を打ち消してしまうので、最後の \ は {backslash} にする
  const m = /\\+$/.exec(v);
  const body = m ? v.slice(0, m.index) : v;
  return (body ? 'pass:c[' + body.replace(/]/g, '\\]') + ']' : '') + (m ? '{backslash}'.repeat(m[0].length) : '');
}
function adocText(v, ctx) {
  v = v.replace(/\r?\n/g, ' ');
  if (!v) return '';
  return ADOC_RISKY.test(v) || (ctx.link && ADOC_RISKY_LINK.test(v)) ? adocPass(v) : v;
}
const adocAttr = v => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/]/g, '\\]').replace(/\r?\n/g, ' ') + '"';
/* 文中の数式。latexmath:[…] の中でも +…+ がパススルーとして読まれて + が消えるので、$$…$$ で囲んで LaTeX をそのまま渡す
   ($$ のパススルーは先に取り出されるので、中の ] や + を気にしなくてよい) */
const texArg = t => '$$' + String(t).replace(/\$\$/g, '$ $') + '$$';
function adocInline(nodes, ctx) {
  let s = '';
  for (const x of nodes) {
    if (x.t === 'text') s += adocText(x.v, ctx);
    else if (x.t === 'br') s += ctx.oneLine ? ' ' : ' +\n';
    else if (x.t === 'b') { const v = adocInline(x.c, ctx); if (v) s += '**' + v + '**'; }
    else if (x.t === 'i') { const v = adocInline(x.c, ctx); if (v) s += '__' + v + '__'; }
    else if (x.t === 's') { const v = adocInline(x.c, ctx); if (v) s += '[.line-through]##' + v + '##'; }
    else if (x.t === 'code') { if (x.v) s += '``' + adocPass(x.v) + '``'; }
    else if (x.t === 'a') s += 'link:++' + x.href.replace(/\+\+/g, '%2B%2B') + '++[' + (adocInline(x.c, Object.assign({}, ctx, { link: true })) || adocPass(x.href)) + ']';
    else if (x.t === 'img') s += 'image:' + x.file + '[' + adocAttr(x.alt) + ']';
    else if (x.t === 'math') s += 'latexmath:[' + texArg(x.tex) + ']';
    else if (x.t === 'fn') s += adocFootnote(x.n, ctx);
  }
  return s;
}
/* 脚注: 最初の参照の場所に footnote:[注の文] を書く。2回以上参照する注は footnote:fn番号[注の文] にして、2回目からは footnote:fn番号[]。
   AsciiDoc の脚注は文中の文だけなので、注の段落などは空白でつなぐ。注の中の参照は、上付きの番号にする */
function adocFootnote(n, ctx) {
  const f = ctx.notes && ctx.notes.get(n);
  if (!f || ctx.inNote) return '^' + n + '^';
  if (f.used++) return 'footnote:fn' + n + '[]';
  const sub = Object.assign({}, ctx, { oneLine: true, inNote: true, link: false });
  const text = f.c.map(b => adocNoteText(b, sub)).filter(Boolean).join(' ');
  return 'footnote:' + (f.refs > 1 ? 'fn' + n : '') + '[' + text + ']';
}
function adocNoteText(b, ctx) {
  if (b.t === 'p' || b.t === 'h') return adocInline(b.c, ctx);
  if (b.t === 'pre') return b.text ? '``' + adocPass(b.text.replace(/\n/g, ' ')) + '``' : '';
  if (b.t === 'math') return 'latexmath:[' + texArg(b.tex) + ']';
  if (b.t === 'list') return b.items.map(it => it.c.map(x => adocNoteText(x, ctx)).filter(Boolean).join(' ')).filter(Boolean).join('; ');
  if (b.t === 'quote' || b.t === 'alert') return b.c.map(x => adocNoteText(x, ctx)).filter(Boolean).join(' ');
  return '';
}
// 行の先頭が AsciiDoc の記号(見出し・リスト・ブロックの区切り・属性・注記など)に見えるか
const ADOC_LINE_START = /^(?:[=.*\-+:|>[/'"_`#~^<({\s]|\d+[.)]\s|[A-Za-z][.)]\s|[ivxIVX]+\)\s|(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):)/;
const adocLines = s => s.split('\n').map(l => (!l ? '{empty}' : ADOC_LINE_START.test(l) ? '{empty}' + l : l)).join('\n');
function adocParagraph(c, ctx) {
  const only = c.filter(x => !(x.t === 'text' && !x.v.trim()));
  if (only.length === 1 && only[0].t === 'img' && !ctx.inItem) return 'image::' + only[0].file + '[' + adocAttr(only[0].alt) + ']';
  return adocLines(adocInline(c, ctx));
}
function adocBlocks(blocks, ctx) {
  const parts = [];
  let prev = null;
  for (const b of blocks) {
    if (prev && prev.t === 'list' && b.t === 'list') parts.push('//-');
    parts.push(adocBlock(b, ctx));
    prev = b;
  }
  return parts.filter(s => s !== '').join('\n\n');
}
function adocDelimited(ch, min, body) {
  let n = min;
  for (const l of body.split('\n')) if (new RegExp('^\\' + ch + '{' + n + ',}$').test(l)) n = l.length + 1;
  const d = ch.repeat(n);
  return d + '\n' + body + '\n' + d;
}
function adocBlock(b, ctx) {
  if (b.t === 'p') return adocParagraph(b.c, ctx);
  if (b.t === 'h') return '='.repeat(Math.min(6, b.level + ctx.shift)) + ' ' + (adocInline(b.c, Object.assign({}, ctx, { oneLine: true })) || '{empty}');
  if (b.t === 'pre') return (/<\d+>\s*$/m.test(b.text) ? '[subs=-callouts]\n' : '') + adocDelimited('-', 4, b.text);
  if (b.t === 'math') return '[latexmath]\n' + adocDelimited('+', 4, b.tex);
  if (b.t === 'diagram') return '[mermaid]\n' + adocDelimited('.', 4, b.src);
  if (b.t === 'hr') return "'''";
  if (b.t === 'quote') { const q = ctx.quote || 0; return adocDelimited('_', 4 + q, adocBlocks(b.c, Object.assign({}, ctx, { quote: q + 1, inItem: false }))); }
  // アラートは AsciiDoc の注記(同じ5種類)。見出しの言葉は、文書の頭の :note-caption: など(toAsciiDoc)
  if (b.t === 'alert') { const q = ctx.alert || 0; return '[' + b.kind.toUpperCase() + ']\n' + adocDelimited('=', 4 + q, adocBlocks(b.c, Object.assign({}, ctx, { alert: q + 1, inItem: false })) || '{empty}'); }
  if (b.t === 'list') return adocList(b, ctx);
  if (b.t === 'table') return adocTable(b, ctx);
  return '';
}
function adocList(b, ctx) {
  const depth = Object.assign({ ul: 0, ol: 0 }, ctx.depth);
  const key = b.ordered ? 'ol' : 'ul';
  depth[key]++;
  const mark = (b.ordered ? '.' : '*').repeat(depth[key]);
  const sub = Object.assign({}, ctx, { depth: depth, inItem: true });
  const lines = [];
  if (b.ordered && b.start !== 1) lines.push('[start=' + b.start + ']');
  for (const it of b.items) {
    const c = it.c.slice();
    let head = mark + ' ' + (it.check === true ? '[x] ' : it.check === false ? '[ ] ' : '');
    if (c[0] && c[0].t === 'p') head += adocParagraph(c.shift().c, sub);
    else head += '{empty}';
    let s = head;
    for (const blk of c) s += blk.t === 'list' ? '\n' + adocList(blk, sub) : '\n+\n' + adocBlock(blk, sub);
    lines.push(s);
  }
  return lines.join('\n');
}
function adocTable(b, ctx) {
  const cctx = Object.assign({}, ctx, { inItem: true });
  const cell = c => '|' + adocInline(c, cctx).replace(/\|/g, '\\|');
  const cols = b.align.map(a => (a === 'c' ? '^' : a === 'r' ? '>' : '<')).join(',');
  const rows = [b.head.map(cell).join(' '), ''].concat(b.rows.map(r => r.map(cell).join(' ')));
  return '[cols="' + cols + '",options="header"]\n|===\n' + rows.join('\n') + '\n|===';
}
/* 脚注の一覧(番号 → { c, refs: 参照の数, used }) */
function adocNotes(blocks) {
  const notes = new Map();
  const list = blocks.find(b => b.t === 'footnotes');
  if (!list) return notes;
  for (const it of list.items) notes.set(it.n, { c: it.c, refs: 0, used: 0 });
  const visit = x => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object' || x.t === 'footnotes') return;
    if (x.t === 'fn' && notes.has(x.n)) notes.get(x.n).refs++;
    for (const k of ['c', 'items', 'head', 'rows', 'title']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  return notes;
}
/* o: { title, imagesDir(画像を置くフォルダーの名前。画像が無ければ不要) } */
function toAsciiDoc(blocks, o) {
  o = o || {};
  let body = blocks.slice(), title = String(o.title || ''), shift = 1;
  // 大見出し(#)が先頭に1つだけなら、それを文書の題名にして、## 以下を1段ずつ上げる
  const h1 = body.filter(b => b.t === 'h' && b.level === 1);
  const ctx = { shift: 1, notes: adocNotes(blocks) };
  let titleText;
  if (h1.length === 1 && body[0] === h1[0]) {
    titleText = adocInline(body.shift().c, Object.assign({}, ctx, { oneLine: true }));
    shift = 0;
  } else titleText = adocText(title, {});
  ctx.shift = shift;
  const head = ['= ' + (titleText || '{empty}')];
  if (treeHasMath(blocks)) head.push(':stem: latexmath');
  if (o.imagesDir && treeImages(blocks).length) head.push(':imagesdir: ' + o.imagesDir);
  // アラートの見出しの言葉(日本語の画面なら「注記」など)。Asciidoctor の既定(英語)と違うときだけ書く
  const captions = {};
  const visit = x => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    if (x.t === 'alert' && !(x.kind in captions)) captions[x.kind] = x.title.filter(y => y.t === 'text').map(y => y.v).join('').trim();
    for (const k of ['c', 'items']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  for (const k of ALERT_KINDS) {
    const v = captions[k];
    if (v && v !== k[0].toUpperCase() + k.slice(1)) head.push(':' + k + '-caption: ' + v.replace(/[\r\n]+/g, ' '));
  }
  const text = adocBlocks(body, ctx);
  return head.join('\n') + '\n' + (text ? '\n' + text + '\n' : '');
}

/* ---------- LaTeX ----------
   LuaLaTeX でコンパイルする .tex にする(日本語を含むときは ltjsarticle、含まないときは article)。
   数式は LaTeX のまま入れる。KaTeX にだけある書き方(\R など)は、使っているものだけ前置きで定義する。
   画像と図(PNG)は、同じ場所のフォルダーに置いて \graphicspath で参照する(ファイルは main.js が書く)。
   前置きには、使っている機能のパッケージだけを入れる。 */
const TEX_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '%': '\\%', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '`': '\\textasciigrave{}', '\u00a0': '~' };
const TEX_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
/* 本文の文字。-- や '' などが合字(– や ”)にならないよう、同じ文字の間に \kern0pt を入れる */
const texEsc = v => String(v).replace(TEX_CTRL, '').replace(/[\\{}$&%#_~^`\u00a0]/g, c => TEX_ESC[c]).replace(/([-'<>,])(?=\1)/g, '$1\\kern0pt ');
/* コードの文字。引用符は曲げず、2つ以上続く空白はそのまま残す */
const texCode = v => texEsc(String(v).replace(/\r?\n/g, ' ')).replace(/'/g, '\\textquotesingle{}').replace(/"/g, '\\textquotedbl{}').replace(/ {2,}/g, m => '\\ '.repeat(m.length));
/* URL(\href・\url の中)。# と % はエスケープし、中で困る文字は %XX にする(脚注などの引数の中でも使えるように) */
const texUrl = u => String(u).replace(/[\\{}~^|"<>\s`]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).replace(/[#%]/g, '\\$&');
/* KaTeX にだけある命令 → LaTeX での定義(引数の数、中身)。数式で使っているものだけを前置きに書く */
const TEX_MACROS = {
  N: [0, '\\mathbb{N}'], R: [0, '\\mathbb{R}'], Z: [0, '\\mathbb{Z}'], natnums: [0, '\\mathbb{N}'], reals: [0, '\\mathbb{R}'], Reals: [0, '\\mathbb{R}'],
  cnums: [0, '\\mathbb{C}'], Complex: [0, '\\mathbb{C}'], alef: [0, '\\aleph'], alefsym: [0, '\\aleph'], bull: [0, '\\bullet'], clubs: [0, '\\clubsuit'],
  diamonds: [0, '\\diamondsuit'], hearts: [0, '\\heartsuit'], spades: [0, '\\spadesuit'], Dagger: [0, '\\ddagger'], exist: [0, '\\exists'], image: [0, '\\Im'],
  real: [0, '\\Re'], infin: [0, '\\infty'], isin: [0, '\\in'], plusmn: [0, '\\pm'], sdot: [0, '\\cdot'], sect: [0, '\\S'], weierp: [0, '\\wp'], thetasym: [0, '\\vartheta'],
  sub: [0, '\\subset'], sube: [0, '\\subseteq'], supe: [0, '\\supseteq'], lang: [0, '\\langle'], rang: [0, '\\rangle'],
  harr: [0, '\\leftrightarrow'], hArr: [0, '\\Leftrightarrow'], Harr: [0, '\\Leftrightarrow'], lrarr: [0, '\\leftrightarrow'], lrArr: [0, '\\Leftrightarrow'], Lrarr: [0, '\\Leftrightarrow'],
  larr: [0, '\\leftarrow'], lArr: [0, '\\Leftarrow'], Larr: [0, '\\Leftarrow'], rarr: [0, '\\rightarrow'], rArr: [0, '\\Rightarrow'], Rarr: [0, '\\Rightarrow'],
  uarr: [0, '\\uparrow'], uArr: [0, '\\Uparrow'], Uarr: [0, '\\Uparrow'], darr: [0, '\\downarrow'], dArr: [0, '\\Downarrow'], Darr: [0, '\\Downarrow'],
  Alpha: [0, '\\mathrm{A}'], Beta: [0, '\\mathrm{B}'], Epsilon: [0, '\\mathrm{E}'], Zeta: [0, '\\mathrm{Z}'], Eta: [0, '\\mathrm{H}'], Iota: [0, '\\mathrm{I}'],
  Kappa: [0, '\\mathrm{K}'], Mu: [0, '\\mathrm{M}'], Nu: [0, '\\mathrm{N}'], Omicron: [0, '\\mathrm{O}'], Rho: [0, '\\mathrm{P}'], Tau: [0, '\\mathrm{T}'], Chi: [0, '\\mathrm{X}'],
  omicron: [0, 'o'], notni: [0, '\\not\\ni'], gt: [0, '>'], lt: [0, '<'], lparen: [0, '('], rparen: [0, ')'],
  argmin: [0, '\\operatorname*{arg\\,min}'], argmax: [0, '\\operatorname*{arg\\,max}'], plim: [0, '\\operatorname*{plim}'],
  bold: [1, '\\mathbf{#1}'], Bbb: [1, '\\mathbb{#1}'],
  blue: [1, '\\textcolor[HTML]{6495ED}{#1}'], orange: [1, '\\textcolor[HTML]{FFA500}{#1}'], pink: [1, '\\textcolor[HTML]{FF00AF}{#1}'], red: [1, '\\textcolor[HTML]{DF0030}{#1}'],
  green: [1, '\\textcolor[HTML]{28AE7B}{#1}'], gray: [1, '\\textcolor{gray}{#1}'], purple: [1, '\\textcolor[HTML]{9D38BD}{#1}']
};
/* 数式で使っていれば読み込むパッケージ */
const TEX_MATH_PKGS = [
  ['[version=4]{mhchem}', /\\(?:ce|pu)(?![A-Za-z])/], ['{cancel}', /\\(?:b|x)?cancel(?:to)?(?![A-Za-z])/], ['{bm}', /\\bm(?![A-Za-z])/],
  ['{mathrsfs}', /\\mathscr(?![A-Za-z])/], ['{braket}', /\\(?:bra|ket|braket|Bra|Ket|Braket|set|Set)(?![A-Za-z])/],
  ['{stmaryrd}', /\\(?:llbracket|rrbracket|mapsfrom)(?![A-Za-z])/], ['{amscd}', /\\begin\{CD\}/]
];
const TEX_ALERT_COLORS = { note: '0969DA', tip: '1A7F37', important: '8250DF', warning: '9A6700', caution: 'CF222E' };
const TEX_HEADS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const TEX_DISPLAY_ENV = /^\s*\\begin\{(equation|align|alignat|gather|multline|flalign)(\*?)\}[\s\S]*\\end\{\1\2\}\s*$/;
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
/* 数式に直接書いたギリシャ文字や記号(KaTeX では使える)→ LaTeX の命令。LaTeX の数式のフォントには無いので */
const TEX_UNI = (() => {
  const m = {};
  // α〜ω(U+03B1〜)。φ・ε は LaTeX では \varphi・\varepsilon の形
  'alpha beta gamma delta varepsilon zeta eta theta iota kappa lambda mu nu xi o pi rho varsigma sigma tau upsilon varphi chi psi omega'.split(' ')
    .forEach((n, k) => { m[String.fromCharCode(0x3b1 + k)] = n === 'o' ? 'o' : '\\' + n; });
  // Α〜Ω(U+0391〜)。ラテン文字と同じ形のものは \mathrm{…}
  'A B Gamma Delta E Z H Theta I K Lambda M N Xi O Pi P - Sigma T Upsilon Phi X Psi Omega'.split(' ')
    .forEach((n, k) => { if (n !== '-') m[String.fromCharCode(0x391 + k)] = n.length > 1 ? '\\' + n : '\\mathrm{' + n + '}'; });
  Object.assign(m, {
    'ϑ': '\\vartheta', 'ϕ': '\\phi', 'ϵ': '\\epsilon', 'ϖ': '\\varpi', 'ϱ': '\\varrho',
    '≤': '\\leq', '≥': '\\geq', '≦': '\\leqq', '≧': '\\geqq', '≠': '\\neq', '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '·': '\\cdot', '⋅': '\\cdot', '∘': '\\circ',
    '∞': '\\infty', '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '↦': '\\mapsto',
    '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset',
    '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint', '∂': '\\partial', '∇': '\\nabla', '√': '\\surd', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee',
    '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '≃': '\\simeq', '≅': '\\cong', '∝': '\\propto', '⊥': '\\perp', '∥': '\\parallel', '∠': '\\angle', '⊕': '\\oplus', '⊗': '\\otimes',
    '…': '\\ldots', '⋯': '\\cdots', '′': "'", '″': "''", '−': '-', '∗': '\\ast', 'ℓ': '\\ell', 'ℏ': '\\hbar', '°': '^{\\circ}',
    'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}'
  });
  return m;
})();
/* 文字の部分(\text{…} など)と化学式(\ce{…})の中はそのままにして、それ以外の TEX_UNI の文字を命令にする */
function texMathUni(t) {
  let out = '', keep = 0, i = 0;
  const stack = [];
  while (i < t.length) {
    const ch = t[i];
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(t.slice(i)) || ['\\'];
      out += m[0]; i += m[0].length;
      if (/^\\(?:text(?:rm|bf|it|sf|tt|normal|up)?|mbox|hbox|ce|pu)$/.test(m[0]) && t[i] === '{') { stack.push(true); keep++; out += '{'; i++; }
      continue;
    }
    if (ch === '{') stack.push(false);
    else if (ch === '}' && stack.length && stack.pop()) keep--;
    const cmd = keep ? null : TEX_UNI[ch];
    out += cmd == null ? ch : /^\\[A-Za-z]+$/.test(cmd) && /[A-Za-z]/.test(t[i + 1] || '') ? cmd + ' ' : cmd;
    i++;
  }
  return out;
}
/* 数式の中身。KaTeX の \empty は ∅ だが、LaTeX の \empty は「空」なので \emptyset にする。数式の中の空行は取る(LaTeX では誤りになる) */
function texMath(tex, X) {
  let t = texMathUni(String(tex).replace(TEX_CTRL, '').replace(/\\empty(?![A-Za-z])/g, '\\emptyset').replace(/\n[ \t]*(?=\n)/g, '').replace(/\n{2,}/g, '\n'));
  X.math.push(t);
  // % で始まるコメントがあれば、閉じる記号がコメントにならないよう改行する
  if (/(^|[^\\])(\\\\)*%/.test(t)) t += '\n';
  return t;
}
function texInlineMath(x, ctx, X) {
  if (x.error) return '\\texttt{' + texCode('$' + x.tex + '$') + '}';
  const m = '\\(' + (x.display ? '\\displaystyle ' : '') + texMath(x.tex, X) + '\\)';
  return ctx.heading ? '\\texorpdfstring{' + m + '}{' + texEsc(x.tex) + '}' : m;
}
function texImage(file, w, X) {
  const name = X.images[file];
  if (!name) return null;
  X.img = true;
  return '\\EPimage{' + (w > 0 ? Math.round(w * 0.75) + 'bp' : '\\linewidth') + '}{' + name + '}';
}
function texInline(nodes, ctx, X) {
  let s = '';
  for (const x of nodes) {
    if (x.t === 'text') s += texEsc(x.v);
    else if (x.t === 'br') s += ctx.oneLine ? ' ' : '\\newline\n';
    else if (x.t === 'b' || x.t === 'i' || x.t === 's') {
      const v = texInline(x.c, ctx, X);
      if (!v) continue;
      if (x.t === 's') X.strike = true;
      s += (x.t === 'b' ? '\\textbf{' : x.t === 'i' ? '\\textit{' : '\\strikeThrough{') + v + '}';
    } else if (x.t === 'code') { if (x.v) s += '\\texttt{' + texCode(x.v) + '}'; }
    else if (x.t === 'a') {
      const inner = texInline(x.c, Object.assign({}, ctx, { oneLine: true }), X);
      // URL をそのまま見せるリンクは \url(長くても折り返せる)。ただし %XX にした文字があると、それが見えてしまうので \href
      const plain = !inner || (x.c.length === 1 && x.c[0].t === 'text' && x.c[0].v === x.href);
      const url = texUrl(x.href);
      s += plain && !/[\\{}~^|"<>\s`]/.test(x.href) ? '\\url{' + url + '}' : '\\href{' + url + '}{' + (plain ? texEsc(x.href) : inner) + '}';
    } else if (x.t === 'img') s += texImage(x.file, x.w, X) || texEsc('[' + (x.alt || x.file) + ']');
    else if (x.t === 'math') s += texInlineMath(x, ctx, X);
    else if (x.t === 'fn') s += texFootnote(x.n, ctx, X);
    else if (x.t === 'check') { X.symbols = true; s += x.on ? '\\(\\boxtimes\\)' : '\\(\\square\\)'; }
  }
  return s;
}
/* 脚注: 本文での最初の参照の場所に \footnote{注の文} を書き、2回目からは \footref(番号は LaTeX が付ける)。
   題名の中の参照は \thanks。注の中の参照は、その注が本文でも参照されていれば \footref、そうでなければ注の文を ( ) で入れる */
function texFootnote(n, ctx, X) {
  const f = X.notes.get(n);
  if (!f) return '';
  const sub = { inArg: true, inNote: true, nested: true, shift: ctx.shift, depth: ctx.depth };
  const text = () => { f.open = true; const v = texBlocks(f.c, sub, X); f.open = false; return v; };
  if (ctx.title) return f.open ? '' : '\\thanks{' + text() + '}';
  if (ctx.inNote) return f.main ? '\\footref{EPfn' + n + '}' : f.open ? '' : ' (' + text() + ')';
  if (f.used++) return '\\footref{EPfn' + n + '}';
  return '\\footnote{' + (f.main + f.nested > 1 ? '\\label{EPfn' + n + '}' : '') + text() + '}';
}
/* 引数の中(脚注・表のセル)では verbatim が使えないので、コードは1行ずつ \texttt にする(空白はすべて残す) */
const texArgCode = text => '\\noindent' + text.replace(/\n$/, '').split('\n').map(l => '\\texttt{' + texCode(l.replace(/ /g, '')).replace(//g, '\\ ') + '}').join('\\newline\n');
function texCodeBlock(text, ctx, X) {
  text = String(text).replace(TEX_CTRL, '').replace(/\n$/, '');
  if (ctx.inArg || /\\end\{EPcode\}/.test(text)) return texArgCode(text);
  X.code = true;
  return '\\begin{EPcode}\n' + text + '\n\\end{EPcode}';
}
function texBlocks(blocks, ctx, X) {
  return blocks.map(b => texBlock(b, ctx, X)).filter(s => s !== '').join('\n\n');
}
function texBlock(b, ctx, X) {
  if (b.t === 'p') {
    const only = b.c.filter(x => !(x.t === 'text' && !x.v.trim()));
    if (only.length === 1 && only[0].t === 'img' && !ctx.inItem) {
      const im = texImage(only[0].file, only[0].w, X);
      if (im) return ctx.inArg ? im : '\\begin{center}\n' + im + '\n\\end{center}';
    }
    return texInline(b.c, ctx, X);
  }
  if (b.t === 'h') {
    const hctx = Object.assign({}, ctx, { oneLine: true, heading: true });
    const text = texInline(b.c, hctx, X);
    if (ctx.inArg) return text ? '\\textbf{' + text + '}' : '';
    const cmd = TEX_HEADS[Math.min(TEX_HEADS.length, Math.max(1, b.level + ctx.shift - 1)) - 1];
    // 脚注のある見出しは、目次としおり用に脚注を除いた見出しを [ ] に書く
    const short = b.c.some(x => x.t === 'fn') ? '[{' + texInline(b.c.filter(x => x.t !== 'fn'), hctx, X) + '}]' : '';
    return '\\' + cmd + short + '{' + text + '}';
  }
  if (b.t === 'pre') return texCodeBlock(b.text, ctx, X);
  if (b.t === 'math') {
    if (b.error) return texCodeBlock('$$\n' + b.tex + '\n$$', ctx, X);
    const t = texMath(b.tex, X);
    return TEX_DISPLAY_ENV.test(t) ? t.trim() : '\\[\n' + t.trim() + '\n\\]';
  }
  if (b.t === 'diagram') {
    const im = b.texFile && texImage(b.texFile, b.w, X);
    if (im) return ctx.inArg ? im : '\\begin{center}\n' + im + '\n\\end{center}';
    return texCodeBlock(b.src, ctx, X);
  }
  if (b.t === 'hr') return '\\noindent\\rule{\\linewidth}{0.4pt}';
  if (b.t === 'quote') { const v = texBlocks(b.c, Object.assign({}, ctx, { inItem: false, nested: true }), X); return v ? '\\begin{quote}\n' + v + '\n\\end{quote}' : ''; }
  if (b.t === 'alert') {
    X.alerts.add(b.kind);
    const title = texInline(b.title, Object.assign({}, ctx, { oneLine: true }), X);
    return '\\begin{EPalert}{EP' + b.kind + '}{' + title + '}\n' + (texBlocks(b.c, Object.assign({}, ctx, { inItem: false, nested: true }), X) || '\\mbox{}') + '\n\\end{EPalert}';
  }
  if (b.t === 'list') return texList(b, ctx, X);
  if (b.t === 'table') return texTable(b, ctx, X);
  return '';
}
function texList(b, ctx, X) {
  const depth = (ctx.depth || 0) + 1;
  X.depth = Math.max(X.depth, depth);
  const sub = Object.assign({}, ctx, { depth: depth, inItem: true, nested: true });
  const env = b.ordered ? 'enumerate' : 'itemize';
  let opt = '';
  if (b.ordered && b.start !== 1) { X.enumitem = true; opt = '[start=' + b.start + ']'; }
  const items = b.items.map(it => {
    let body = texBlocks(it.c, sub, X);
    if (it.check != null) X.symbols = true;
    const mark = it.check === true ? '[\\(\\boxtimes\\)]' : it.check === false ? '[\\(\\square\\)]' : '';
    // \item の後ろが [ で始まると、印の指定として読まれるので {} を挟む
    if (!mark && body[0] === '[') body = '{}' + body;
    return '\\item' + mark + (body ? ' ' + body : '');
  });
  if (!items.length) return '';
  return '\\begin{' + env + '}' + opt + '\n' + items.join('\n') + '\n\\end{' + env + '}';
}
/* 文字の幅のおおよそ(全角は2) */
const texWidth = s => { let n = 0; for (const ch of s) n += CJK.test(ch) ? 2 : 1; return n; };
const inlineText = c => c.map(x => (x.t === 'text' ? x.v : x.t === 'code' ? x.v : x.t === 'math' ? x.tex : x.c ? inlineText(x.c) : x.t === 'img' ? 'xxxxxxxxxx' : x.t === 'br' ? '\n' : '')).join('');
/* 表: 文が長い列や、セルの中に改行がある表は、幅を決めた列(p)にして折り返す。
   本文の表は longtable(ページをまたげる)、リスト・引用などの中の表は tabular */
function texTable(b, ctx, X) {
  const n = b.align.length;
  if (!n) return '';
  X.table = true;
  const all = [b.head].concat(b.rows);
  const longest = all.reduce((m, r) => m.map((w, j) => Math.max(w, ...inlineText(r[j] || []).split('\n').map(texWidth))), b.align.map(() => 0));
  const wrap = all.some(r => r.some(c => c.some(x => x.t === 'br'))) || longest.reduce((a, w) => a + w + 3, 0) > 80;
  const total = longest.reduce((a, w) => a + Math.max(4, w), 0);
  const spec = b.align.map((a, j) => {
    if (!wrap) return a === 'c' ? 'c' : a === 'r' ? 'r' : 'l';
    const share = (Math.max(4, longest[j]) / total).toFixed(3);
    return '>{' + (a === 'c' ? '\\centering' : a === 'r' ? '\\raggedleft' : '\\raggedright') + '\\arraybackslash}p{\\dimexpr' + share + '\\linewidth-2\\tabcolsep\\relax}';
  }).join('');
  const cctx = Object.assign({}, ctx, { inArg: true, inItem: true, oneLine: !wrap });
  const row = (r, head) => r.map(c => { const v = texInline(c, cctx, X); return head && v ? '\\textbf{' + v + '}' : v; }).join(' & ') + ' \\tabularnewline';
  const long = !ctx.nested;
  const env = long ? 'longtable' : 'tabular';
  const lines = ['\\begin{' + env + '}{' + spec + '}', '\\toprule', row(b.head, true), '\\midrule'];
  if (long) lines.push('\\endhead');
  for (const r of b.rows) lines.push(row(r, false));
  lines.push('\\bottomrule', '\\end{' + env + '}');
  return long ? lines.join('\n') : '\\begin{center}\n' + lines.join('\n') + '\n\\end{center}';
}
/* 図に、書き出す PNG のファイル名を付ける(図の順に everpad-diagram-1.png …)。名前と PNG の一覧を返す(main.js が書く) */
function texDiagrams(blocks) {
  const out = [];
  const visit = x => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    if (x.t === 'diagram' && x.png) { x.texFile = 'everpad-diagram-' + (out.length + 1) + '.png'; out.push({ file: x.texFile, png: x.png }); }
    for (const k of ['c', 'items']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  return out;
}
/* 画像のフォルダーの名前(LaTeX で困る文字は _ にする) */
const texImagesDir = base => String(base).replace(/[^\p{L}\p{N}._-]/gu, '_') + '_images';
/* LuaLaTeX がそのまま読める画像(これ以外は PNG にしてから置く) */
const texImageOk = f => /\.(png|jpe?g|pdf)$/i.test(f);
/* o: { title, imagesDir, images: { 添付のファイル名: フォルダーの中の名前 }, paper: 'A4'|'Letter', lang, generator } */
function toLatex(blocks, o) {
  o = o || {};
  const diagrams = texDiagrams(blocks);
  const images = Object.assign({}, o.images || {});
  for (const d of diagrams) images[d.file] = d.file;
  const X = { images: o.imagesDir ? images : {}, notes: new Map(), math: [], alerts: new Set(), depth: 0 };
  // 大見出し(#)が先頭に1つだけなら、それを文書の題名にして、## を \section にする
  let body = blocks.slice(), shift = 1, head = null;
  const h1 = body.filter(b => b.t === 'h' && b.level === 1);
  if (h1.length === 1 && body[0] === h1[0]) { head = body.shift(); shift = 0; }
  // 脚注ごとに、本文からの参照(main)と、ほかの注からの参照(nested)を数える
  const list = blocks.find(b => b.t === 'footnotes');
  if (list) {
    for (const it of list.items) X.notes.set(it.n, { c: it.c, main: 0, nested: 0, used: 0, open: false });
    const count = key => {
      const visit = x => {
        if (Array.isArray(x)) { x.forEach(visit); return; }
        if (!x || typeof x !== 'object' || x.t === 'footnotes') return;
        if (x.t === 'fn' && X.notes.has(x.n)) X.notes.get(x.n)[key]++;
        for (const k of ['c', 'items', 'head', 'rows', 'title']) if (x[k]) visit(x[k]);
      };
      return visit;
    };
    count('main')(body);
    list.items.forEach(it => count('nested')(it.c));
  }
  const title = head ? texInline(head.c, { oneLine: true, heading: true, title: true }, X) : texEsc(String(o.title || '').replace(/[\r\n]+/g, ' '));
  const text = texBlocks(body, { shift: shift, depth: 0 }, X);

  const ja = CJK.test(JSON.stringify(blocks, (k, v) => (k === 'png' ? undefined : v)) + (o.title || ''));
  const jaComment = o.lang === 'ja';
  const pre = [
    '% !TEX program = lualatex',
    jaComment ? '% ' + (o.generator || 'EverPad') + ' で書き出しました。LuaLaTeX でコンパイルしてください(例: lualatex ファイル名.tex)。'
      : '% Exported from ' + (o.generator || 'EverPad') + '. Compile with LuaLaTeX (for example: lualatex file.tex).',
    '\\documentclass[' + (o.paper === 'Letter' ? 'letterpaper' : 'a4paper') + ']{' + (ja ? 'ltjsarticle' : 'article') + '}'
  ];
  const math = X.math.join('\n');
  if (X.math.length) pre.push('\\usepackage{mathtools}');
  if (X.math.length || X.symbols) pre.push('\\usepackage{amssymb}');
  for (const [pkg, re] of TEX_MATH_PKGS) if (re.test(math)) pre.push('\\usepackage' + pkg);
  if (X.alerts.size || /\\(?:color|textcolor|colorbox|fcolorbox|blue|orange|pink|red|green|gray|purple)(?![A-Za-z])/.test(math)) pre.push('\\usepackage{xcolor}');
  if (X.strike) pre.push('\\usepackage{lua-ul}');
  if (X.img) pre.push('\\usepackage{graphicx}', '\\graphicspath{{' + o.imagesDir + '/}}', '\\newlength{\\EPw}',
    jaComment ? '% 画像: 元の大きさ(1px = 0.75bp)で、本文の幅とページの高さに収める' : '% Images: original size (1px = 0.75bp), fitted to the text width and page height',
    '\\newcommand{\\EPimage}[2]{\\setlength{\\EPw}{#1}\\ifdim\\EPw>\\linewidth\\setlength{\\EPw}{\\linewidth}\\fi\\includegraphics[width=\\EPw,height=0.9\\textheight,keepaspectratio]{#2}}');
  if (X.code) pre.push('\\usepackage{fvextra}', '\\DefineVerbatimEnvironment{EPcode}{Verbatim}{breaklines,breakanywhere,tabsize=4}');
  if (X.alerts.size) {
    pre.push('\\usepackage{tcolorbox}', '\\tcbuselibrary{skins,breakable}');
    for (const k of ALERT_KINDS) if (X.alerts.has(k)) pre.push('\\definecolor{EP' + k + '}{HTML}{' + TEX_ALERT_COLORS[k] + '}');
    pre.push('\\newtcolorbox{EPalert}[2]{breakable,enhanced,sharp corners,boxrule=0pt,leftrule=3pt,colframe=#1,colback=white,before upper={{\\color{#1}\\bfseries #2}\\par}}');
  }
  if (X.table) pre.push('\\usepackage{array,longtable,booktabs}');
  if (X.enumitem || X.depth > 4) pre.push('\\usepackage{enumitem}');
  if (X.depth > 4) pre.push('\\setlistdepth{9}', '\\renewlist{itemize}{itemize}{9}', '\\setlist[itemize]{label=\\textbullet}', '\\renewlist{enumerate}{enumerate}{9}', '\\setlist[enumerate]{label=\\arabic*.}');
  const macros = Object.keys(TEX_MACROS).filter(k => new RegExp('\\\\' + k + '(?![A-Za-z])').test(math));
  for (const k of macros) pre.push('\\providecommand{\\' + k + '}' + (TEX_MACROS[k][0] ? '[' + TEX_MACROS[k][0] + ']' : '') + '{' + TEX_MACROS[k][1] + '}');
  pre.push('\\usepackage[colorlinks,linkcolor=black,urlcolor=blue]{hyperref}');
  pre.push('\\setcounter{secnumdepth}{0}');
  if (title) pre.push('\\title{' + title + '}', '\\author{}', '\\date{}');
  const doc = ['\\begin{document}'];
  if (title) doc.push('\\maketitle');
  if (text) doc.push('', text, '');
  doc.push('\\end{document}');
  return pre.join('\n') + '\n\n' + doc.join('\n') + '\n';
}

/* ---------- MathML → Word の数式(OMML) ---------- */
const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ZWSP = '\u200B';
const NARY = new Set(['∑', '∏', '∐', '⋂', '⋃', '⨀', '⨁', '⨂', '⨄', '⨆', '⋀', '⋁', '∫', '∬', '∭', '∮', '∯', '∰', '∱', '∲', '∳', '⨌']);
const ACCENTS = { '^': '\u0302', 'ˆ': '\u0302', '\u0302': '\u0302', 'ˉ': '\u0305', '¯': '\u0305', '⃗': '\u20D7', '→': '\u20D7', '←': '\u20D6', '˙': '\u0307', '¨': '\u0308', '~': '\u0303', '˜': '\u0303', 'ˇ': '\u030C', '´': '\u0301', '`': '\u0300', '˘': '\u0306', '˚': '\u030A', '⃛': '\u20DB' };
const COLORS = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', cyan: '00FFFF', magenta: 'FF00FF', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080', brown: 'A52A2A', pink: 'FFC0CB', navy: '000080', teal: '008080', olive: '808000', maroon: '800000', lime: '00FF00', violet: 'EE82EE' };
function colorHex(c) {
  c = String(c || '').trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{6})$/.exec(c))) return m[1].toUpperCase();
  if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c))) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  return COLORS[c] || null;
}
const VARIANT = {
  normal: { sty: 'p' }, bold: { sty: 'b' }, italic: { sty: 'i' }, 'bold-italic': { sty: 'bi' },
  'double-struck': { scr: 'double-struck', sty: 'p' }, script: { scr: 'script', sty: 'p' }, 'bold-script': { scr: 'script', sty: 'b' },
  fraktur: { scr: 'fraktur', sty: 'p' }, 'bold-fraktur': { scr: 'fraktur', sty: 'b' },
  'sans-serif': { scr: 'sans-serif', sty: 'p' }, 'bold-sans-serif': { scr: 'sans-serif', sty: 'b' }, 'sans-serif-italic': { scr: 'sans-serif', sty: 'i' },
  monospace: { scr: 'monospace', sty: 'p' }
};
const kids = n => (n.children || []).filter(c => c.tag || (c.text && c.text.trim()));
const cleanMath = s => String(s).replace(/[\u2061-\u2064]/g, '');
function mRun(text, props, ctx) {
  text = cleanMath(text);
  if (!text) return '';
  let mr = '';
  if (props.nor) mr += '<m:nor/>';
  if (props.scr) mr += '<m:scr m:val="' + props.scr + '"/>';
  if (props.sty) mr += '<m:sty m:val="' + props.sty + '"/>';
  const color = ctx.color ? '<w:color w:val="' + ctx.color + '"/>' : '';
  return '<m:r>' + (mr ? '<m:rPr>' + mr + '</m:rPr>' : '') + '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>' + color + '</w:rPr><m:t xml:space="preserve">' + xesc(text) + '</m:t></m:r>';
}
const arg = s => s || '<m:r><m:t>' + ZWSP + '</m:t></m:r>';
const isEmptyMml = n => !n || (n.text != null ? !cleanMath(n.text).trim() : n.tag !== 'mspace' && n.tag !== 'mphantom' && kids(n).every(isEmptyMml));
// 1つだけの子を持つ mrow などをはがす
function unwrap(n) {
  while (n && (n.tag === 'mrow' || n.tag === 'mstyle' || n.tag === 'mpadded') && kids(n).length === 1) n = kids(n)[0];
  return n;
}
const naryChar = n => { const u = unwrap(n); return u && u.tag === 'mo' && NARY.has(textOf(u).trim()) ? textOf(u).trim() : null; };
const SCRIPTS = { msub: 1, msup: 1, msubsup: 1, munder: 1, mover: 1, munderover: 1 };
// 関数名(sin・lim など)の後ろの「関数の適用」(U+2061)で終わるか
function endsWithApply(n) {
  if (!n) return false;
  if (n.tag === 'mo') return textOf(n) === '\u2061';
  if (n.tag === 'mrow') { const k = kids(n); return k.length > 0 && endsWithApply(k[k.length - 1]); }
  if (SCRIPTS[n.tag]) return endsWithApply(kids(n)[0]);
  return false;
}
function naryXml(chr, under, sub, sup, e) {
  return '<m:nary><m:naryPr><m:chr m:val="' + xesc(chr) + '"/><m:limLoc m:val="' + (under ? 'undOvr' : 'subSup') + '"/>'
    + (sub ? '' : '<m:subHide m:val="1"/>') + (sup ? '' : '<m:supHide m:val="1"/>') + '</m:naryPr>'
    + '<m:sub>' + sub + '</m:sub><m:sup>' + sup + '</m:sup><m:e>' + arg(e) + '</m:e></m:nary>';
}
/* 大型演算子(∑ ∫ など)なら n-ary にする。e は演算子の後ろに続くもの */
function tryNary(n, e, ctx) {
  const chr = naryChar(n);
  if (chr && !SCRIPTS[n.tag]) return naryXml(chr, true, '', '', e);
  if (!SCRIPTS[n.tag] || !naryChar(kids(n)[0])) return null;
  const k = kids(n), c = naryChar(k[0]);
  const t = n.tag, under = t[1] === 'u' || t.startsWith('mover');
  const sub = t === 'msub' || t === 'msubsup' || t === 'munder' || t === 'munderover' ? mml(k[1], ctx) : '';
  const sup = t === 'msup' ? mml(k[1], ctx) : t === 'mover' ? mml(k[1], ctx) : t === 'msubsup' || t === 'munderover' ? mml(k[2], ctx) : '';
  return naryXml(c, under, sub, sup, e);
}
/* 子の並び(mrow の中身)。囲み(\left \right)・大型演算子・関数をまとめる */
function mmlSeq(list, ctx) {
  list = list.filter(c => c.tag || (c.text && c.text.trim()));
  if (!list.length) return '';
  const isFence = c => c && c.tag === 'mo' && c.attrs.fence === 'true';
  const f0 = isFence(list[0]), f1 = list.length > 1 && isFence(list[list.length - 1]);
  if (f0 || f1) {
    const beg = f0 ? cleanMath(textOf(list[0])) : '', end = f1 ? cleanMath(textOf(list[list.length - 1])) : '';
    const inner = list.slice(f0 ? 1 : 0, f1 ? -1 : undefined);
    return '<m:d><m:dPr><m:begChr m:val="' + xesc(beg) + '"/><m:endChr m:val="' + xesc(end) + '"/></m:dPr><m:e>' + arg(mmlSeq(inner, ctx)) + '</m:e></m:d>';
  }
  let s = '';
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const nary = naryChar(n) || (SCRIPTS[n.tag] && naryChar(kids(n)[0]));
    if (nary) { s += tryNary(n, mmlSeq(list.slice(i + 1), ctx), ctx); break; }
    // 空の {} の後ろの記号(aligned の &= など)は、前に文字があるものとして間隔を空ける
    if (n.tag === 'mrow' && !kids(n).length) { if (list[i + 1] && list[i + 1].tag === 'mo') s += arg(''); continue; }
    // 関数(sin x、lim など): 関数名と、その後ろに続くもの(見た目は同じなので、残りをまとめて引数にする)
    const next = list[i + 1];
    const apply = next && next.tag === 'mo' && textOf(next) === '\u2061';
    if (apply || (SCRIPTS[n.tag] && endsWithApply(n) && next)) {
      const e = mmlSeq(list.slice(i + (apply ? 2 : 1)), ctx);
      s += e ? '<m:func><m:fName>' + mml(n, ctx) + '</m:fName><m:e>' + e + '</m:e></m:func>' : mml(n, ctx);
      break;
    }
    s += mml(n, ctx);
  }
  return s;
}
function spaceFor(width) {
  const m = /^(-?[\d.]+)em$/.exec(String(width || '').trim());
  const w = m ? parseFloat(m[1]) : 0;
  return w >= 1.9 ? '\u2003\u2003' : w >= 0.9 ? '\u2003' : w >= 0.4 ? '\u2002' : w >= 0.3 ? '\u2004' : w >= 0.25 ? '\u2005' : w > 0.1 ? '\u2009' : '';
}
function mml(n, ctx) {
  if (!n) return '';
  if (n.text != null) return mRun(n.text, {}, ctx);
  const k = kids(n);
  const a = n.attrs || {};
  switch (n.tag) {
    case 'math': case 'semantics': case 'mrow': case 'mtd': case 'mlabeledtr': case 'mmultiscripts':
      return mmlSeq(n.tag === 'semantics' ? k.slice(0, 1) : k, ctx);
    case 'annotation': case 'annotation-xml': case 'none': case 'mprescripts': return '';
    case 'mstyle': {
      const c = a.mathcolor ? colorHex(a.mathcolor) : null;
      return mmlSeq(k, c ? Object.assign({}, ctx, { color: c }) : ctx);
    }
    case 'mi': {
      const t = cleanMath(textOf(n));
      const v = VARIANT[a.mathvariant] || ([...t].length > 1 ? VARIANT.normal : {});
      return mRun(t, v, ctx);
    }
    // 数字は立体(指定しないと、日本語の文書では斜めの字になることがある)
    case 'mn': return mRun(textOf(n), { sty: a.mathvariant === 'bold' ? 'b' : 'p' }, ctx);
    case 'mo': {
      if (k.some(c => c.tag)) return mmlSeq(k, ctx);
      const t = textOf(n);
      return mRun(t, /[A-Za-z]/.test(t) ? { sty: 'p' } : {}, ctx);
    }
    case 'mtext': case 'ms': return mRun(textOf(n), { nor: true }, ctx);
    case 'mspace': { const sp = spaceFor(a.width); return sp ? mRun(sp, {}, ctx) : ''; }
    case 'mfrac':
      return '<m:f>' + (/^0(?:\.0*)?(?:px|em|pt)?$/.test(a.linethickness || '') ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : '')
        + '<m:num>' + arg(mml(k[0], ctx)) + '</m:num><m:den>' + arg(mml(k[1], ctx)) + '</m:den></m:f>';
    case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + arg(mmlSeq(k, ctx)) + '</m:e></m:rad>';
    case 'mroot': return '<m:rad><m:deg>' + mml(k[1], ctx) + '</m:deg><m:e>' + arg(mml(k[0], ctx)) + '</m:e></m:rad>';
    case 'msub': case 'msup': case 'msubsup': {
      const nary = tryNary(n, '', ctx);
      if (nary) return nary;
      const base = arg(mml(k[0], ctx));
      const s1 = isEmptyMml(k[1]) ? '' : mml(k[1], ctx), s2 = n.tag === 'msubsup' && !isEmptyMml(k[2]) ? mml(k[2], ctx) : '';
      if (n.tag === 'msub') return s1 ? '<m:sSub><m:e>' + base + '</m:e><m:sub>' + s1 + '</m:sub></m:sSub>' : base;
      if (n.tag === 'msup') return s1 ? '<m:sSup><m:e>' + base + '</m:e><m:sup>' + s1 + '</m:sup></m:sSup>' : base;
      if (s1 && s2) return '<m:sSubSup><m:e>' + base + '</m:e><m:sub>' + s1 + '</m:sub><m:sup>' + s2 + '</m:sup></m:sSubSup>';
      if (s1) return '<m:sSub><m:e>' + base + '</m:e><m:sub>' + s1 + '</m:sub></m:sSub>';
      if (s2) return '<m:sSup><m:e>' + base + '</m:e><m:sup>' + s2 + '</m:sup></m:sSup>';
      return base;
    }
    case 'munder': case 'mover': case 'munderover': {
      const nary = tryNary(n, '', ctx);
      if (nary) return nary;
      const base = arg(mml(k[0], ctx));
      const under = n.tag === 'mover' ? null : k[1], over = n.tag === 'mover' ? k[1] : n.tag === 'munderover' ? k[2] : null;
      const sym = x => { const u = unwrap(x); return u && u.tag === 'mo' ? cleanMath(textOf(u)).trim() : null; };
      if (n.tag === 'mover' && !isEmptyMml(over)) {
        const c = sym(over);
        if (c === '‾') return '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>' + base + '</m:e></m:bar>';
        if (c === '⏞' || c === '︷') return '<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr><m:e>' + base + '</m:e></m:groupChr>';
        if (a.accent === 'true' && c && ACCENTS[c]) return '<m:acc><m:accPr><m:chr m:val="' + ACCENTS[c] + '"/></m:accPr><m:e>' + base + '</m:e></m:acc>';
      }
      if (n.tag === 'munder' && !isEmptyMml(under)) {
        const c = sym(under);
        if (c === '‾' || c === '_') return '<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>' + base + '</m:e></m:bar>';
        if (c === '⏟' || c === '︸') return '<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/></m:groupChrPr><m:e>' + base + '</m:e></m:groupChr>';
      }
      let s = base;
      if (under && !isEmptyMml(under)) s = '<m:limLow><m:e>' + s + '</m:e><m:lim>' + mml(under, ctx) + '</m:lim></m:limLow>';
      if (over && !isEmptyMml(over)) s = '<m:limUpp><m:e>' + s + '</m:e><m:lim>' + mml(over, ctx) + '</m:lim></m:limUpp>';
      return s;
    }
    case 'mtable': return mmlTable(n, ctx);
    case 'menclose': {
      const no = String(a.notation || 'box').split(/\s+/);
      const box = no.indexOf('box') >= 0 || no.indexOf('roundedbox') >= 0 || no.indexOf('circle') >= 0;
      const side = s => box || no.indexOf(s) >= 0;
      let pr = '';
      if (!side('top')) pr += '<m:hideTop m:val="1"/>';
      if (!side('bottom')) pr += '<m:hideBot m:val="1"/>';
      if (!side('left')) pr += '<m:hideLeft m:val="1"/>';
      if (!side('right')) pr += '<m:hideRight m:val="1"/>';
      if (no.indexOf('horizontalstrike') >= 0) pr += '<m:strikeH m:val="1"/>';
      if (no.indexOf('verticalstrike') >= 0) pr += '<m:strikeV m:val="1"/>';
      if (no.indexOf('updiagonalstrike') >= 0) pr += '<m:strikeBLTR m:val="1"/>';
      if (no.indexOf('downdiagonalstrike') >= 0) pr += '<m:strikeTLBR m:val="1"/>';
      return '<m:borderBox>' + (pr ? '<m:borderBoxPr>' + pr + '</m:borderBoxPr>' : '') + '<m:e>' + arg(mmlSeq(k, ctx)) + '</m:e></m:borderBox>';
    }
    case 'mphantom': return '<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e>' + arg(mmlSeq(k, ctx)) + '</m:e></m:phant>';
    case 'mpadded': {
      // 幅0の見えない文字(化学式の添字の位置合わせ)は、幅も高さも取らない見えない要素にする
      if (/^0(?:\.0*)?(?:px|em)?$/.test(a.width || '') && k.length === 1 && k[0].tag === 'mphantom') {
        return '<m:phant><m:phantPr><m:show m:val="0"/><m:zeroWid m:val="1"/><m:zeroAsc m:val="1"/><m:zeroDesc m:val="1"/></m:phantPr><m:e>' + arg(mmlSeq(kids(k[0]), ctx)) + '</m:e></m:phant>';
      }
      return mmlSeq(k, ctx);
    }
    default: return mmlSeq(k, ctx);
  }
}
function mmlTable(n, ctx) {
  let rows = kids(n).filter(r => r.tag === 'mtr' || r.tag === 'mlabeledtr').map(r => kids(r).filter(c => c.tag === 'mtd'));
  // \tag{…}: 幅 100% の表で、左右に幅 50% の空のセルがある。空のセルを除き、1行なら式と番号を空白で並べる
  if ((n.attrs || {}).width === '100%') {
    rows = rows.map(r => r.filter(c => (c.attrs || {}).width !== '50%'));
    if (rows.length === 1 && rows[0].length === 2) return mml(rows[0][0], ctx) + mRun('\u2003\u2003', {}, ctx) + mml(rows[0][1], ctx);
  }
  const ncol = Math.max(1, ...rows.map(r => r.length));
  const al = String((n.attrs || {}).columnalign || '').split(/\s+/).filter(Boolean);
  let mcs = '';
  for (let j = 0; j < ncol; j++) {
    const v = al.length ? al[Math.min(j, al.length - 1)] : 'center';
    mcs += '<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="' + (v === 'left' ? 'left' : v === 'right' ? 'right' : 'center') + '"/></m:mcPr></m:mc>';
  }
  // 列の間隔: aligned などの columnspacing="0em" は間を空けない
  const gap = /^0(?:\.0*)?(?:em|px)?(?:\s|$)/.test((n.attrs || {}).columnspacing || '') ? '<m:cGpRule m:val="3"/><m:cGp m:val="0"/>' : '';
  let s = '<m:m><m:mPr><m:plcHide m:val="1"/>' + gap + '<m:mcs>' + mcs + '</m:mcs></m:mPr>';
  for (const r of rows) {
    s += '<m:mr>';
    for (let j = 0; j < ncol; j++) s += '<m:e>' + arg(r[j] ? mml(r[j], ctx) : '') + '</m:e>';
    s += '</m:mr>';
  }
  return s + '</m:m>';
}
/* KaTeX の MathML の文字列 → <m:oMath>…</m:oMath>。読めなければ null */
function mathmlToOmml(mmlStr) {
  const root = parseMarkup(String(mmlStr || ''));
  const find = x => { if (x.tag === 'math') return x; for (const c of x.children || []) { const r = c.tag && find(c); if (r) return r; } return null; };
  const m = find(root);
  if (!m) return null;
  return '<m:oMath>' + mml(m, {}) + '</m:oMath>';
}

/* ---------- Word(.docx) ---------- */
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const STEP = 420;            // リストと引用の1段の字下げ(twip。10.5pt の文字2つ分)
const EMU_PER_PX = 9525;     // 96dpi の 1px
const EMU_PER_TWIP = 635;
const PAGE = { A4: { w: 11906, h: 16838 }, Letter: { w: 12240, h: 15840 } };
const MARGIN = 1440;
const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
const ALERT_COLORS = { note: '0969DA', tip: '1A7F37', important: '8250DF', warning: '9A6700', caution: 'D1242F' };   // アラートの線と見出しの色(GitHub と同じ)
const FONT_MONO = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="ＭＳ ゴシック" w:cs="Consolas"/>';

function wText(v) {
  // タブと改行を Word の要素にする
  return String(v).split(/(\t|\n)/).map(p => (p === '\t' ? '<w:tab/>' : p === '\n' ? '<w:br/>' : p ? '<w:t xml:space="preserve">' + xesc(p) + '</w:t>' : '')).join('');
}
function rPr(st) {
  let s = '';
  if (st.code) s += '<w:rStyle w:val="InlineCode"/>';
  else if (st.link) s += '<w:rStyle w:val="Hyperlink"/>';
  if (st.b) s += '<w:b/><w:bCs/>';
  if (st.i) s += '<w:i/><w:iCs/>';
  if (st.s) s += '<w:strike/>';
  if (st.code && st.link) s += '<w:color w:val="0563C1"/><w:u w:val="single"/>';
  else if (st.color) s += '<w:color w:val="' + st.color + '"/>';
  return s ? '<w:rPr>' + s + '</w:rPr>' : '';
}
/* 図の PNG を Word の画像として登録し、その名前を返す。PNG でなければ null */
function diagramImage(b, X) {
  if (!b.png) return null;
  const data = Buffer.from(b.png, 'base64');
  if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) return null;
  const key = '#diagram' + (X.nDiagram = (X.nDiagram || 0) + 1);
  X.images[key] = { data: data, ext: 'png', w: b.w, h: b.h };
  return key;
}
function imageXml(x, X, maxTwips) {
  const img = X.images[x.file];
  if (!img) return '';
  const ridKey = X.part === 'fn' ? 'fnRid' : 'rid';
  if (!img[ridKey]) { img[ridKey] = 'rIdImg' + (++X.nImg); if (!img.name) img.name = 'image' + X.nImg + '.' + img.ext; X.rels.push({ id: img[ridKey], type: 'image', target: 'media/' + img.name }); }
  let w = (x.w || img.w || 320) * EMU_PER_PX, h = (x.h || img.h || 240) * EMU_PER_PX;
  const maxW = Math.max(1, maxTwips) * EMU_PER_TWIP, maxH = (X.page.h - 2 * MARGIN) * EMU_PER_TWIP * 0.9;
  if (w > maxW) { h = h * maxW / w; w = maxW; }
  if (h > maxH) { w = w * maxH / h; h = maxH; }
  w = Math.round(w); h = Math.round(h);
  const id = ++X.nPic;
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + w + '" cy="' + h + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + xesc(x.alt) + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + img.name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="' + img[ridKey] + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}
function mathInline(x, st) {
  const om = !x.error && x.mml ? mathmlToOmml(x.mml) : null;
  return om || '<w:r>' + rPr(Object.assign({}, st, { code: true })) + wText(x.tex) + '</w:r>';
}
function runs(nodes, st, X, maxTwips) {
  let s = '';
  for (const x of nodes) {
    if (x.t === 'text') { if (x.v) s += '<w:r>' + rPr(st) + wText(x.v) + '</w:r>'; }
    else if (x.t === 'br') s += '<w:r><w:br/></w:r>';
    else if (x.t === 'b' || x.t === 'i' || x.t === 's') s += runs(x.c, Object.assign({}, st, { [x.t]: true }), X, maxTwips);
    else if (x.t === 'code') { if (x.v) s += '<w:r>' + rPr(Object.assign({}, st, { code: true })) + wText(x.v) + '</w:r>'; }
    else if (x.t === 'a') {
      const id = 'rIdLink' + (++X.nLink);
      X.rels.push({ id: id, type: 'hyperlink', target: x.href, external: true });
      s += '<w:hyperlink r:id="' + id + '" w:history="1">' + runs(x.c.length ? x.c : [{ t: 'text', v: x.href }], Object.assign({}, st, { link: true }), X, maxTwips) + '</w:hyperlink>';
    } else if (x.t === 'img') s += imageXml(x, X, maxTwips);
    else if (x.t === 'math') s += mathInline(x, st);
    else if (x.t === 'fn') s += footnoteRun(x.n, X);
  }
  return s;
}
/* 脚注の参照: 本文で最初に参照したところに Word の脚注を置く。同じ注の2回目からと、注の中の参照は、上付きの番号の文字にする */
const FN_REF = '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>';
function footnoteRun(n, X) {
  if (X.part !== 'fn' && X.notes.has(n) && !X.fnIds.has(n)) { const id = X.fnIds.size + 1; X.fnIds.set(n, id); return '<w:r>' + FN_REF + '<w:footnoteReference w:id="' + id + '"/></w:r>'; }
  return '<w:r>' + FN_REF + '<w:t>' + (X.fnIds.get(n) || n) + '</w:t></w:r>';
}
/* 段落の書式。o: { style, numId, ilvl, left, hanging, jc, border, bar(左の線の色), keepNext, spacingAfter } */
function pPr(o) {
  let s = '';
  if (o.style) s += '<w:pStyle w:val="' + o.style + '"/>';
  if (o.keepNext) s += '<w:keepNext/>';
  if (o.numId) s += '<w:numPr><w:ilvl w:val="' + o.ilvl + '"/><w:numId w:val="' + o.numId + '"/></w:numPr>';
  if (o.border || o.bar) s += '<w:pBdr>' + (o.bar ? '<w:left w:val="single" w:sz="18" w:space="8" w:color="' + o.bar + '"/>' : '') + (o.border ? '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/>' : '') + '</w:pBdr>';
  if (o.spacingAfter != null) s += '<w:spacing w:after="' + o.spacingAfter + '"/>';
  if (o.left || o.hanging) s += '<w:ind w:left="' + (o.left || 0) + '"' + (o.hanging ? ' w:hanging="' + o.hanging + '"' : '') + '/>';
  if (o.jc) s += '<w:jc w:val="' + o.jc + '"/>';
  return s ? '<w:pPr>' + s + '</w:pPr>' : '';
}
const para = (o, content) => '<w:p>' + pPr(o) + (content || '') + '</w:p>';
function docxBlocks(blocks, ctx, X) {
  return blocks.map(b => docxBlock(b, ctx, X)).join('');
}
function docxBlock(b, ctx, X) {
  const width = X.textW - ctx.ind;
  if (b.t === 'p') return para({ style: ctx.note ? 'FootnoteText' : ctx.quote ? 'BlockQuote' : null, left: ctx.ind, bar: ctx.bar }, runs(b.c, {}, X, width));
  if (b.t === 'h') return para({ style: 'Heading' + b.level, left: ctx.ind }, runs(b.c.filter(x => x.t !== 'br'), {}, X, width));
  if (b.t === 'pre') return para({ style: 'SourceCode', left: ctx.ind }, b.text ? '<w:r>' + wText(b.text) + '</w:r>' : '');
  if (b.t === 'math') {
    const om = !b.error && b.mml ? mathmlToOmml(b.mml) : null;
    if (om) return para({ left: ctx.ind }, '<m:oMathPara>' + om + '</m:oMathPara>');
    return para({ style: 'SourceCode', left: ctx.ind }, '<w:r>' + wText(b.tex) + '</w:r>');
  }
  if (b.t === 'diagram') {
    const key = diagramImage(b, X);
    if (key) return para({ jc: 'center', left: ctx.ind }, imageXml({ file: key, alt: '', w: b.w, h: b.h }, X, width));
    return para({ style: 'SourceCode', left: ctx.ind }, b.src ? '<w:r>' + wText(b.src) + '</w:r>' : '');
  }
  if (b.t === 'hr') return para({ border: true, left: ctx.ind }, '');
  if (b.t === 'quote') return docxBlocks(b.c, Object.assign({}, ctx, { ind: ctx.ind + STEP, quote: ctx.quote + 1, bar: null }), X);
  if (b.t === 'alert') {
    // 引用と同じ字下げで、左の線と見出しを種類の色にする
    const color = ALERT_COLORS[b.kind] || '595959';
    const sub = Object.assign({}, ctx, { ind: ctx.ind + STEP, quote: ctx.quote + 1, bar: color });
    return para({ style: 'BlockQuote', left: sub.ind, bar: color, keepNext: b.c.length > 0 }, runs(b.title, { b: true, color: color }, X, X.textW - sub.ind)) + docxBlocks(b.c, sub, X);
  }
  if (b.t === 'list') return docxList(b, ctx, X);
  if (b.t === 'table') return docxTable(b, ctx, X);
  return '';
}
function docxList(b, ctx, X) {
  const ilvl = Math.min(8, ctx.lvl);
  let numId = 1;
  if (b.ordered) { numId = X.nums.length + 2; X.nums.push({ id: numId, ilvl: ilvl, start: b.start }); }
  const itemInd = ctx.ind + STEP;
  const sub = Object.assign({}, ctx, { ind: itemInd, lvl: ctx.lvl + 1 });
  let s = '';
  for (const it of b.items) {
    const c = it.c.slice();
    const first = c[0] && c[0].t === 'p' ? c.shift() : null;
    const content = first ? runs(first.c, {}, X, X.textW - itemInd) : '';
    const style = ctx.quote ? 'BlockQuote' : 'ListParagraph';
    if (it.check != null) s += para({ style: style, left: itemInd, hanging: STEP, bar: ctx.bar }, '<w:r><w:t>' + (it.check ? '☑' : '☐') + '</w:t><w:tab/></w:r>' + content);
    else s += para({ style: style, numId: numId, ilvl: ilvl, left: itemInd, hanging: STEP, bar: ctx.bar }, content);
    s += docxBlocks(c, sub, X);
  }
  return s;
}
function plainLen(c) { let n = 0; for (const x of c) n += x.t === 'text' || x.t === 'code' ? [...x.v].length * (/[^\x00-\xff]/.test(x.v) ? 2 : 1) : x.c ? plainLen(x.c) : x.t === 'math' ? x.tex.length : 4; return n; }
function docxTable(b, ctx, X) {
  const n = b.align.length;
  if (!n) return '';
  const avail = X.textW - ctx.ind;
  // 列の幅は、各列のいちばん長いセルの文字数で配分する(Word が開くときに内容に合わせて調整する)
  const want = b.align.map((_, j) => Math.max(3, ...[b.head].concat(b.rows).map(r => plainLen(r[j] || []))) + 2);
  const total = want.reduce((p, q) => p + q, 0);
  const cols = want.map(w => Math.max(400, Math.floor(avail * Math.min(1, total * 110 / avail) * w / total)));
  const jc = { l: 'left', c: 'center', r: 'right' };
  const border = t => '<w:' + t + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
  let s = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + (ctx.ind ? '<w:tblInd w:w="' + ctx.ind + '" w:type="dxa"/>' : '')
    + '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>'
    + '<w:tblLayout w:type="autofit"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>'
    + '<w:tblGrid>' + cols.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
  const row = (cells, head) => '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + cells.map((c, j) =>
    '<w:tc><w:tcPr><w:tcW w:w="' + cols[j] + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '') + '</w:tcPr>'
    + para({ spacingAfter: 0, jc: jc[b.align[j]] }, runs(c, head ? { b: true } : {}, X, cols[j] - 216)) + '</w:tc>').join('') + '</w:tr>';
  s += row(b.head, true);
  for (const r of b.rows) s += row(r, false);
  return s + '</w:tbl>';
}
function stylesXml(lang) {
  const h = (lv, sz) => '<w:style w:type="paragraph" w:styleId="Heading' + lv + '"><w:name w:val="heading ' + lv + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>'
    + '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="' + (lv <= 2 ? 360 : 240) + '" w:after="120"/><w:outlineLvl w:val="' + (lv - 1) + '"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="游ゴシック" w:hAnsi="游ゴシック" w:eastAsia="游ゴシック"/><w:b/><w:bCs/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>';
  return XML_HEAD + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="游明朝" w:eastAsia="游明朝" w:hAnsi="游明朝" w:cs="Times New Roman"/><w:kern w:val="2"/><w:sz w:val="21"/><w:szCs w:val="21"/>'
    + '<w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
    + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    + h(1, 32) + h(2, 28) + h(3, 24) + h(4, 21) + h(5, 21) + h(6, 21)
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:contextualSpacing/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="BlockQuote"><w:name w:val="Block Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D0D7DE"/></w:pBdr></w:pPr><w:rPr><w:color w:val="595959"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:left w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/><w:right w:val="single" w:sz="4" w:space="4" w:color="E1E4E8"/></w:pBdr>'
    + '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:wordWrap w:val="0"/><w:spacing w:before="60" w:after="180" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr>' + FONT_MONO + '<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:customStyle="1" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/>'
    + '<w:rPr>' + FONT_MONO + '<w:sz w:val="19"/><w:szCs w:val="19"/><w:shd w:val="clear" w:color="auto" w:fill="EFF1F3"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>'
    + '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
    + '</w:styles>';
}
function numberingXml(nums) {
  const BUL = ['•', '◦', '▪'];
  const lv = (i, fmt, text) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>'
    + '<w:pPr><w:ind w:left="' + (STEP * (i + 1)) + '" w:hanging="' + STEP + '"/></w:pPr></w:lvl>';
  let s = XML_HEAD + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
  s += '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>';
  for (let i = 0; i < 9; i++) s += lv(i, 'bullet', BUL[i % 3]);
  s += '</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>';
  for (let i = 0; i < 9; i++) s += lv(i, 'decimal', '%' + (i + 1) + '.');
  s += '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  for (const n of nums) s += '<w:num w:numId="' + n.id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="' + n.ilvl + '"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride></w:num>';
  return s + '</w:numbering>';
}
/* 脚注の部品(word/footnotes.xml)。本文で参照した注だけを、参照した順に入れる。注の中のリンクと画像の関係は X.fnRels。参照が無ければ '' */
function footnotesXml(X) {
  X.fnRels = [];
  if (!X.fnIds.size) return '';
  const docRels = X.rels;
  X.part = 'fn'; X.rels = X.fnRels;
  const mark = '<w:r>' + FN_REF + '<w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>';
  const sep = (type, id, el) => '<w:footnote w:type="' + type + '" w:id="' + id + '"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:' + el + '/></w:r></w:p></w:footnote>';
  let s = XML_HEAD + '<w:footnotes ' + NS + '>' + sep('separator', -1, 'separator') + sep('continuationSeparator', 0, 'continuationSeparator');
  const ctx = { ind: 0, lvl: 0, quote: 0, note: true };
  for (const [n, id] of X.fnIds) {
    const c = X.notes.get(n).slice();
    const first = c[0] && c[0].t === 'p' ? c.shift() : null;
    s += '<w:footnote w:id="' + id + '">' + para({ style: 'FootnoteText' }, mark + (first ? runs(first.c, {}, X, X.textW) : '')) + docxBlocks(c, ctx, X) + '</w:footnote>';
  }
  X.part = 'doc'; X.rels = docRels;
  return s + '</w:footnotes>';
}
function relsXml(rels) {
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  return XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.map(r => '<Relationship Id="' + r.id + '" Type="' + REL + r.type + '" Target="' + xesc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('')
    + '</Relationships>';
}
const iso = d => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
/* o: { title, lang('ja'|'en'), paper('A4'|'Letter'), generator, date,
        images: { [ファイルID]: { data: Buffer, ext: 'png'|'jpeg'|'gif'|'bmp', w, h } } } → .docx の Buffer */
function toDocx(blocks, o) {
  o = o || {};
  const page = PAGE[o.paper] || PAGE.A4;
  const X = { images: {}, rels: [], nums: [], nImg: 0, nLink: 0, nPic: 0, page: page, textW: page.w - 2 * MARGIN, part: 'doc', notes: new Map(), fnIds: new Map() };
  const fnList = blocks.find(b => b.t === 'footnotes');
  if (fnList) for (const it of fnList.items) X.notes.set(it.n, it.c);
  for (const [k, v] of Object.entries(o.images || {})) if (v && v.data && MIME[v.ext]) X.images[k] = Object.assign({}, v);
  let body = docxBlocks(blocks, { ind: 0, lvl: 0, quote: 0 }, X);
  if (!body || /<\/w:tbl>$/.test(body)) body += '<w:p/>';
  const notesXml = footnotesXml(X);
  const doc = XML_HEAD + '<w:document ' + NS + '><w:body>' + body
    + '<w:sectPr><w:pgSz w:w="' + page.w + '" w:h="' + page.h + '"/><w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const docRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + REL + 'settings" Target="settings.xml"/>'
    + '<Relationship Id="rId3" Type="' + REL + 'numbering" Target="numbering.xml"/>'
    + (notesXml ? '<Relationship Id="rId4" Type="' + REL + 'footnotes" Target="footnotes.xml"/>' : '')
    + X.rels.map(r => '<Relationship Id="' + r.id + '" Type="' + REL + r.type + '" Target="' + xesc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('')
    + '</Relationships>';
  const used = Object.values(X.images).filter(v => v.rid || v.fnRid);
  const exts = [...new Set(used.map(v => v.ext))];
  const types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + exts.map(e => '<Default Extension="' + e + '" ContentType="' + MIME[e] + '"/>').join('')
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + (notesXml ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rootRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/></Relationships>';
  const when = iso(o.date || Date.now());
  const core = XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
    + 'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<dc:title>' + xesc(o.title || '') + '</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">' + when + '</dcterms:created>'
    + '<dcterms:modified xsi:type="dcterms:W3CDTF">' + when + '</dcterms:modified></cp:coreProperties>';
  const app = XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>' + xesc(o.generator || 'EverPad') + '</Application></Properties>';
  const settings = XML_HEAD + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
    + '<w:defaultTabStop w:val="840"/>' + (notesXml ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : '') + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
    + '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr>'
    + '</w:settings>';
  const entries = [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: doc },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: stylesXml(o.lang) },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/numbering.xml', data: numberingXml(X.nums) },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app }
  ];
  if (notesXml) {
    entries.push({ name: 'word/footnotes.xml', data: notesXml });
    if (X.fnRels.length) entries.push({ name: 'word/_rels/footnotes.xml.rels', data: relsXml(X.fnRels) });
  }
  for (const v of used) entries.push({ name: 'word/media/' + v.name, data: v.data });
  return writeZip(entries.map(e => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8') })), o.date ? new Date(o.date) : new Date());
}
/* 添付のファイル ID → Word に入れるときの画像の種類(Word が読めないもの(WebP・AVIF)は null。画面側で PNG にして渡す) */
function docxImageExt(fileId) {
  const m = /\.([a-z0-9]+)$/.exec(String(fileId || ''));
  const e = m ? m[1] : '';
  return e === 'jpg' || e === 'jpeg' ? 'jpeg' : e === 'png' || e === 'gif' || e === 'bmp' ? e : null;
}

module.exports = { parseMarkup, bodyTree, treeImages, treeHasMath, toAsciiDoc, toLatex, texDiagrams, texImagesDir, texImageOk, mathmlToOmml, toDocx, docxImageExt, colorHex };
