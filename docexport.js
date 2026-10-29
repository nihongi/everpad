'use strict';
/* 文書の形式で書き出す: AsciiDoc(.adoc)と Word(.docx)。
   本文は画面側(renderer)で整形した HTML を受け取る(HTML・MHTML の書き出しと同じもの。ただし数式は中身を空にして、
   data-tex に LaTeX、data-mml に KaTeX の MathML を持たせ、画像は data-att にファイル ID、data-w・data-h に大きさを持たせる)。
   それを見出し・段落・リストなどの構造(ブロックと文中の要素の木)にしてから、それぞれの形式に書く。
   - AsciiDoc: テキストなので、画像はファイルの外(同じ場所のフォルダー)に置いて参照する。数式は latexmath で LaTeX のまま入れる
   - Word: ZIP に XML をまとめる(ziplite.js)。数式は MathML を Word の数式(OMML)に変換し、Word で編集できるようにする
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
   ブロック: { t:'p', c } { t:'h', level, c } { t:'pre', text } { t:'math', tex, mml, error } { t:'hr' }
             { t:'quote', c:[ブロック] } { t:'list', ordered, start, items:[{ check: null|true|false, c:[ブロック] }] }
             { t:'table', align:['l'|'c'|'r'], head:[セル], rows:[[セル]] }(セルは文中の要素の配列)
   文中: { t:'text', v } { t:'br' } { t:'b'|'i'|'s', c } { t:'code', v } { t:'a', href, c }
         { t:'img', file, alt, w, h } { t:'math', tex, mml, error, display } */
const HEADING = /^h([1-6])$/;
function mathNode(n, display) {
  return { t: 'math', tex: n.attrs['data-tex'] || '', mml: n.attrs['data-mml'] || '', error: hasClass(n, 'math-error'), display: !!display };
}
function inlinesOf(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.text != null) { if (n.text) out.push({ t: 'text', v: n.text.replace(/\r?\n/g, ' ') }); continue; }
    const tag = n.tag;
    if (hasClass(n, 'math')) out.push(mathNode(n, hasClass(n, 'math-display')));
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
    else if (tag === 'blockquote') { flush(); out.push({ t: 'quote', c: blocksOf(n.children) }); }
    else if (tag === 'ul' || tag === 'ol') { flush(); out.push(listOf(n)); }
    else if (tag === 'table') { flush(); out.push(tableOf(n)); }
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
    for (const k of ['c', 'items', 'head', 'rows']) if (x[k]) visit(x[k]);
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
    for (const k of ['c', 'items', 'head', 'rows']) if (x[k]) visit(x[k]);
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
  }
  return s;
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
  if (b.t === 'hr') return "'''";
  if (b.t === 'quote') { const q = ctx.quote || 0; return adocDelimited('_', 4 + q, adocBlocks(b.c, Object.assign({}, ctx, { quote: q + 1, inItem: false }))); }
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
/* o: { title, imagesDir(画像を置くフォルダーの名前。画像が無ければ不要) } */
function toAsciiDoc(blocks, o) {
  o = o || {};
  let body = blocks.slice(), title = String(o.title || ''), shift = 1;
  // 大見出し(#)が先頭に1つだけなら、それを文書の題名にして、## 以下を1段ずつ上げる
  const h1 = body.filter(b => b.t === 'h' && b.level === 1);
  const ctx = { shift: 1 };
  let titleText;
  if (h1.length === 1 && body[0] === h1[0]) {
    titleText = adocInline(body.shift().c, { oneLine: true });
    shift = 0;
  } else titleText = adocText(title, {});
  ctx.shift = shift;
  const head = ['= ' + (titleText || '{empty}')];
  if (treeHasMath(blocks)) head.push(':stem: latexmath');
  if (o.imagesDir && treeImages(blocks).length) head.push(':imagesdir: ' + o.imagesDir);
  const text = adocBlocks(body, ctx);
  return head.join('\n') + '\n' + (text ? '\n' + text + '\n' : '');
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
  return s ? '<w:rPr>' + s + '</w:rPr>' : '';
}
function imageXml(x, X, maxTwips) {
  const img = X.images[x.file];
  if (!img) return '';
  if (!img.rid) { img.rid = 'rIdImg' + (++X.nImg); img.name = 'image' + X.nImg + '.' + img.ext; X.rels.push({ id: img.rid, type: 'image', target: 'media/' + img.name }); }
  let w = (x.w || img.w || 320) * EMU_PER_PX, h = (x.h || img.h || 240) * EMU_PER_PX;
  const maxW = Math.max(1, maxTwips) * EMU_PER_TWIP, maxH = (X.page.h - 2 * MARGIN) * EMU_PER_TWIP * 0.9;
  if (w > maxW) { h = h * maxW / w; w = maxW; }
  if (h > maxH) { w = w * maxH / h; h = maxH; }
  w = Math.round(w); h = Math.round(h);
  const id = ++X.nPic;
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + w + '" cy="' + h + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
    + '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + xesc(x.alt) + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + img.name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="' + img.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
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
  }
  return s;
}
/* 段落の書式。o: { style, numId, ilvl, left, hanging, jc, border, keepNext, spacingAfter } */
function pPr(o) {
  let s = '';
  if (o.style) s += '<w:pStyle w:val="' + o.style + '"/>';
  if (o.numId) s += '<w:numPr><w:ilvl w:val="' + o.ilvl + '"/><w:numId w:val="' + o.numId + '"/></w:numPr>';
  if (o.border) s += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>';
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
  if (b.t === 'p') return para({ style: ctx.quote ? 'BlockQuote' : null, left: ctx.ind }, runs(b.c, {}, X, width));
  if (b.t === 'h') return para({ style: 'Heading' + b.level, left: ctx.ind }, runs(b.c.filter(x => x.t !== 'br'), {}, X, width));
  if (b.t === 'pre') return para({ style: 'SourceCode', left: ctx.ind }, b.text ? '<w:r>' + wText(b.text) + '</w:r>' : '');
  if (b.t === 'math') {
    const om = !b.error && b.mml ? mathmlToOmml(b.mml) : null;
    if (om) return para({ left: ctx.ind }, '<m:oMathPara>' + om + '</m:oMathPara>');
    return para({ style: 'SourceCode', left: ctx.ind }, '<w:r>' + wText(b.tex) + '</w:r>');
  }
  if (b.t === 'hr') return para({ border: true, left: ctx.ind }, '');
  if (b.t === 'quote') return docxBlocks(b.c, Object.assign({}, ctx, { ind: ctx.ind + STEP, quote: ctx.quote + 1 }), X);
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
    if (it.check != null) s += para({ style: style, left: itemInd, hanging: STEP }, '<w:r><w:t>' + (it.check ? '☑' : '☐') + '</w:t><w:tab/></w:r>' + content);
    else s += para({ style: style, numId: numId, ilvl: ilvl, left: itemInd, hanging: STEP }, content);
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
const iso = d => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
/* o: { title, lang('ja'|'en'), paper('A4'|'Letter'), generator, date,
        images: { [ファイルID]: { data: Buffer, ext: 'png'|'jpeg'|'gif'|'bmp', w, h } } } → .docx の Buffer */
function toDocx(blocks, o) {
  o = o || {};
  const page = PAGE[o.paper] || PAGE.A4;
  const X = { images: {}, rels: [], nums: [], nImg: 0, nLink: 0, nPic: 0, page: page, textW: page.w - 2 * MARGIN };
  for (const [k, v] of Object.entries(o.images || {})) if (v && v.data && MIME[v.ext]) X.images[k] = Object.assign({}, v);
  let body = docxBlocks(blocks, { ind: 0, lvl: 0, quote: 0 }, X);
  if (!body || /<\/w:tbl>$/.test(body)) body += '<w:p/>';
  const doc = XML_HEAD + '<w:document ' + NS + '><w:body>' + body
    + '<w:sectPr><w:pgSz w:w="' + page.w + '" w:h="' + page.h + '"/><w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const docRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + REL + 'settings" Target="settings.xml"/>'
    + '<Relationship Id="rId3" Type="' + REL + 'numbering" Target="numbering.xml"/>'
    + X.rels.map(r => '<Relationship Id="' + r.id + '" Type="' + REL + r.type + '" Target="' + xesc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('')
    + '</Relationships>';
  const used = Object.values(X.images).filter(v => v.rid);
  const exts = [...new Set(used.map(v => v.ext))];
  const types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + exts.map(e => '<Default Extension="' + e + '" ContentType="' + MIME[e] + '"/>').join('')
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
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
    + '<w:defaultTabStop w:val="840"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
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
  for (const v of used) entries.push({ name: 'word/media/' + v.name, data: v.data });
  return writeZip(entries.map(e => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8') })), o.date ? new Date(o.date) : new Date());
}
/* 添付のファイル ID → Word に入れるときの画像の種類(Word が読めないもの(WebP・AVIF)は null。画面側で PNG にして渡す) */
function docxImageExt(fileId) {
  const m = /\.([a-z0-9]+)$/.exec(String(fileId || ''));
  const e = m ? m[1] : '';
  return e === 'jpg' || e === 'jpeg' ? 'jpeg' : e === 'png' || e === 'gif' || e === 'bmp' ? e : null;
}

module.exports = { parseMarkup, bodyTree, treeImages, treeHasMath, toAsciiDoc, mathmlToOmml, toDocx, docxImageExt, colorHex };
