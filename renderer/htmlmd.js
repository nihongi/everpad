'use strict';
/* 貼り付けた整形された文書(HTML)を、EverPad の Markdown にする。
   ほかのアプリ(Web ページ・Word・Excel・Google ドキュメントなど)からのコピーと、EverPad のプレビューからのコピーの両方を読む。
   EverPad のプレビューの部分(数式・図・メモへのリンク・添付・絵文字・アラート・脚注・フロントマター)は、
   プレビューが持たせた data-* などから、元の書き方に戻す。
   HTML のタグはメモに入れない(できるのは Markdown の文字だけ)。色・文字の大きさ・フォント・下線などは、Markdown に無いので外す。
   読むのは { tag, attrs, children } と { text } の木(画面では DOMParser の結果を fromDom で、テストでは docexport.js の parseMarkup で作る)。
   画像のうち data: のもの(画像そのもの)と、Word・Excel が一時ファイルに置いたもの(file:…/msohtmlclip…)は、
   images に入れて本文には目印(\u0000番号\u0000)を置く。添付にするのは画面側(app.js)。
   EverPad のプレビューの添付は、元のメモを atts に入れる(別のメモに貼ったとき、画面側がファイルをコピーする) */
(function (root) {
  const BLOCK = new Set(['#root', 'html', 'body', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table',
    'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'hr', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure',
    'figcaption', 'dl', 'dt', 'dd', 'address', 'details', 'summary', 'center', 'form', 'fieldset', 'legend']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'button', 'select', 'option', 'textarea',
    'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'svg', 'colgroup', 'col', 'area', 'map', 'base']);
  const MAX_NODES = 50000, MAX_DEPTH = 200;

  const attr = (n, k) => (n.attrs && n.attrs[k] != null ? String(n.attrs[k]) : '');
  const hasCls = (n, c) => (' ' + attr(n, 'class') + ' ').replace(/\s+/g, ' ').indexOf(' ' + c + ' ') >= 0;
  const styleOf = n => attr(n, 'style').toLowerCase().replace(/\s+/g, '');
  const kids = n => n.children || [];
  const textOf = n => (n.text != null ? n.text : kids(n).map(textOf).join(''));
  const find = (n, pred) => { for (const c of kids(n)) { if (c.tag && pred(c)) return c; const f = c.tag ? find(c, pred) : null; if (f) return f; } return null; };
  const hidden = n => { const st = styleOf(n); return /display:none|visibility:hidden/.test(st) || /mso-list:ignore/.test(st) || n.attrs && n.attrs.hidden != null; };
  // 制御文字は捨てる(EverPad の Markdown の読み取りが、内部の目印に使っている)
  const clean = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

  /* ---------- 文字のエスケープ: 書いた文字が Markdown の記号として読まれないようにする(必要なときだけ) ---------- */
  function escapeText(s, ctx) {
    s = clean(s);
    // \ の後に ASCII の記号があるとエスケープになるので、その \ は重ねる
    s = s.replace(/\\(?=[!-/:-@[-`{-~$])/g, '\\\\');
    if ((s.match(/\*/g) || []).length >= 2) s = s.replace(/\*/g, '\\*');
    if ((s.match(/`/g) || []).length >= 2) s = s.replace(/`/g, '\\`');
    if ((s.match(/\$/g) || []).length >= 2) s = s.replace(/\$/g, '\\$');
    s = s.replace(/~~/g, '\\~\\~');
    s = s.replace(/\[(?=\^|[^\]]*\]\()/g, '\\[');   // [ は、リンク([…](…))と脚注([^…])になるときだけ
    s = s.replace(/(?<![A-Za-z0-9\\]):([a-z0-9_+-]+):(?![A-Za-z0-9])/g, '\\:$1:');   // 絵文字のショートコードにしない
    if (ctx && ctx.table) s = s.replace(/\|/g, '\\|');
    return s;
  }
  // 行の初めにあると見出し・引用・リスト・区切り線になる書き方を、文字のままにする
  function escLineStart(l) {
    return l.replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2')
      .replace(/^(\s*)>/, '$1\\>')
      .replace(/^(\s*)([-+])(?=\s)/, '$1\\$2')
      .replace(/^(\s*)(\d{1,9})([.)])(?=\s)/, '$1$2\\$3')
      .replace(/^(\s*)([-_])((?:\s*\2){2,}\s*)$/, '$1\\$2$3');
  }
  const fenceFor = (s, ch) => { let n = 3; const re = ch === '`' ? /`+/g : /~+/g; for (const m of s.match(re) || []) n = Math.max(n, m.length + 1); return ch.repeat(n); };
  const codeSpan = s => { s = clean(s).replace(/\n/g, ' '); let n = 1; for (const m of s.match(/`+/g) || []) n = Math.max(n, m.length + 1); const t = '`'.repeat(n); const pad = /^`|`$/.test(s) ? ' ' : ''; return t + pad + s + pad + t; };
  const urlPart = u => u.replace(/[\s()<>]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  const attachName = s => String(s || '').replace(/[[\]()|*_`<>\\\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  // 添付の元のメモ: プレビューが持たせた data-att-note か、画像の everpad-file://f/<メモID>/<ファイルID>
  function attachFrom(n, ctx) {
    let note = attr(n, 'data-att-note');
    if (!note) { const m = attr(n, 'src').match(/^everpad-file:\/\/f\/([^/?#]+)\//); if (m) { try { note = decodeURIComponent(m[1]); } catch (e) { note = ''; } } }
    if (note) ctx.atts.push({ note: note, file: attr(n, 'data-att') });
  }
  // Word・Excel がコピーした画像の一時ファイル(Windows の一時フォルダの msohtmlclip…\01\clip_image001.png)
  const OFFICE_CLIP_RE = /^file:\/\/\/.+\/msohtmlclip\d*\/\d+\/clip_image\d+\.(png|jpe?g|gif|bmp)$/i;

  /* ---------- 文中(インライン): 文字を、太字・斜体・取り消し線の印を付けた「かたまり」の並びにしてから、Markdown にする ---------- */
  function boldOf(n, b) {
    const t = n.tag, st = styleOf(n), m = st.match(/font-weight:([a-z0-9]+)/);
    if (m) return /^(bold|bolder|[6-9]00)$/.test(m[1]) ? true : /^(normal|lighter|[1-5]00)$/.test(m[1]) ? false : b;
    return t === 'b' || t === 'strong' ? true : b;
  }
  function italicOf(n, i) {
    const t = n.tag, st = styleOf(n), m = st.match(/font-style:([a-z]+)/);
    if (m) return m[1] === 'italic' || m[1] === 'oblique' ? true : m[1] === 'normal' ? false : i;
    return t === 'i' || t === 'em' || t === 'cite' || t === 'dfn' || t === 'var' ? true : i;
  }
  const strikeOf = (n, s) => (n.tag === 's' || n.tag === 'del' || n.tag === 'strike' || /text-decoration(-line)?:[^;]*line-through/.test(styleOf(n)) ? true : s);

  // 数式: EverPad のプレビュー(data-tex)、KaTeX・MathML(LaTeX の注釈)から LaTeX を取り出す
  function texOf(n) {
    if (n.attrs && n.attrs['data-tex'] != null) return attr(n, 'data-tex');
    const a = find(n, c => c.tag === 'annotation' && /tex/i.test(attr(c, 'encoding')));
    return a ? textOf(a).trim() : null;
  }
  const inlineMath = (tex, display) => {
    tex = tex.trim();
    if (display) return '$$' + tex.replace(/\n+/g, ' ') + '$$';
    return /\n|^\s|\s$/.test(tex) || tex.indexOf('$') >= 0 ? '\\(' + tex.replace(/\n+/g, ' ') + '\\)' : '$' + tex + '$';
  };

  // n の中身をかたまり(out)にする。f は今の印 { b, i, s }
  function inl(n, f, out, ctx) {
    if (n.text != null) { out.push({ t: n.text.replace(/[\t\n\r\f ]+/g, ' ').replace(/ /g, ' '), b: f.b, i: f.i, s: f.s }); return; }
    const t = n.tag;
    if (!t || SKIP.has(t) || hidden(n)) return;
    if (t === 'br') { out.push({ br: true }); return; }
    // EverPad のプレビューの部分
    if (hasCls(n, 'math') && n.attrs['data-tex'] != null) { out.push({ raw: inlineMath(attr(n, 'data-tex'), hasCls(n, 'math-display')) }); return; }
    if (hasCls(n, 'katex') || t === 'math') { const tex = texOf(n); if (tex != null) { out.push({ raw: inlineMath(tex, hasCls(n, 'katex-display') || attr(n, 'display') === 'block') }); return; } }
    if (hasCls(n, 'katex-display')) { const k = find(n, c => hasCls(c, 'katex')); const tex = k && texOf(k); if (tex != null) { out.push({ raw: inlineMath(tex, true) }); return; } }
    if (t === 'a' && hasCls(n, 'note-link') && attr(n, 'data-note')) { out.push({ raw: '[' + (emit(runs(n, {}, ctx), ctx).replace(/\n+/g, ' ').trim() || attr(n, 'data-note')) + '](note:' + attr(n, 'data-note') + ')' }); return; }
    if (t === 'img' && attr(n, 'data-att')) { attachFrom(n, ctx); out.push({ raw: '![' + attachName(attr(n, 'alt')) + '](attach:' + attr(n, 'data-att') + ')' }); return; }
    if (t === 'a' && hasCls(n, 'att-file') && attr(n, 'data-att')) { attachFrom(n, ctx); out.push({ raw: '[' + (attachName(attr(n, 'title') || textOf(n).replace(/^📎\s*/, '')) || 'file') + '](attach:' + attr(n, 'data-att') + ')' }); return; }
    if (hasCls(n, 'link-other') && attr(n, 'data-target')) { out.push({ raw: '[' + emit(runs(n, {}, ctx), ctx).replace(/\n+/g, ' ').trim() + '](' + urlPart(attr(n, 'data-target')) + ')' }); return; }
    if (hasCls(n, 'emoji') && /^:[a-z0-9_+-]+:$/.test(attr(n, 'title'))) { out.push({ raw: attr(n, 'title') }); return; }
    if (t === 'sup' && hasCls(n, 'fnref')) { const a = find(n, c => c.tag === 'a'); out.push({ raw: '[^' + ((a && attr(a, 'data-fn')) || textOf(n).trim()) + ']' }); return; }
    if (hasCls(n, 'fnback') || hasCls(n, 'alert-title')) return;
    if (t === 'code' || t === 'kbd' || t === 'samp' || t === 'tt') { const s = textOf(n); if (s) out.push({ code: s }); return; }
    if (t === 'img') {
      const src = attr(n, 'src').trim(), alt = attr(n, 'alt').replace(/\s+/g, ' ').trim();
      if (/^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,/i.test(src) || OFFICE_CLIP_RE.test(src)) { ctx.images.push(src); out.push({ raw: '\u0000' + (ctx.images.length - 1) + '\u0000' }); }
      else if (/^https?:\/\//i.test(src)) out.push({ raw: '[' + (escapeText(alt, ctx) || ctx.imageLabel) + '](' + urlPart(src) + ')' });
      else if (alt) out.push({ t: alt, b: f.b, i: f.i, s: f.s });
      return;
    }
    if (t === 'input') return;
    if (t === 'a') {
      const href = attr(n, 'href').trim(), inner = runs(n, f, ctx);
      const text = emit(inner, ctx).replace(/\n+/g, ' ').trim();
      // 表示の文字が URL そのもの(EverPad の自動リンクも)なら、URL だけを書く(EverPad がリンクにする)
      if (/^https?:\/\//i.test(href) && (text === href || text + '/' === href) && !/\s/.test(href)) { out.push({ raw: href }); return; }
      if (text && (/^(https?:|mailto:)/i.test(href) || /^#[^\s]/.test(href) || /^note:[A-Za-z0-9_-]{6,64}$/.test(href))) { out.push({ raw: '[' + text.replace(/(?<!\\)\]/g, '\\]') + '](' + urlPart(href) + ')' }); return; }
      out.push(...inner);
      return;
    }
    const g = { b: boldOf(n, f.b), i: italicOf(n, f.i), s: strikeOf(n, f.s) };
    const block = BLOCK.has(t);
    if (block && out.length) out.push({ br: true });
    for (const c of kids(n)) inl(c, g, out, ctx);
    if (block) out.push({ br: true });
  }
  const runs = (n, f, ctx) => { const out = []; for (const c of kids(n)) inl(c, f, out, ctx); return out; };

  // かたまりの並び → Markdown の文字(改行は \n。行の初めのエスケープは、段落にするときに行う)
  function emit(list, ctx) {
    let s = '';
    for (let k = 0; k < list.length; k++) {
      const r = list[k];
      if (r.br) { s += ctx.inline ? ' ' : '\n'; continue; }
      if (r.raw != null) { s += r.raw; continue; }
      if (r.code != null) { s += codeSpan(r.code); continue; }
      // 同じ印の文字はまとめる
      let t = r.t;
      while (k + 1 < list.length && list[k + 1].t != null && list[k + 1].b === r.b && list[k + 1].i === r.i && list[k + 1].s === r.s) t += list[++k].t;
      const m = t.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const inner = escapeText(m[2], ctx);
      if (!inner || (!r.b && !r.i && !r.s)) { s += m[1] + inner + m[3]; continue; }
      const mk = r.b && r.i ? '***' : r.b ? '**' : r.i ? '*' : '';
      const st = r.s ? '~~' : '';
      s += m[1] + st + mk + inner + mk + st + m[3];
    }
    return s.replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n');
  }

  /* ---------- かたまり(ブロック) ---------- */
  const para = s => s.split('\n').map(l => escLineStart(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // 箇条書きの項目のしるし(Word のリストの段落も)
  const wordListItem = n => n.tag === 'p' && (/^MsoListParagraph/i.test(attr(n, 'class')) || /mso-list:l\d/.test(styleOf(n)));
  /* Word の箇条書きの段落の、段の深さ(mso-list:l0 level2 lfo1)と、番号付きかどうか。
     番号は mso-list:Ignore の中の「しるしの文字」で見分ける(1. ・1.1・a)・(1)・① なら番号付き。
     Wingdings・Symbol のしるしや、・ o § などは箇条書き)。番号の数字が読めれば、その番号から始める */
  function wordLevel(n) {
    const m = styleOf(n).match(/mso-list:l\d+level(\d+)/);
    let mark = '', symbol = false;
    const walk = (x, sym) => {
      for (const c of kids(x)) {
        if (!c.tag) continue;
        const s = sym || /font-family:[^;]*(wingdings|symbol|webdings)/.test(styleOf(c));
        if (/mso-list:ignore/.test(styleOf(c))) { mark = textOf(c); symbol = s; return true; }
        if (walk(c, s)) return true;
      }
      return false;
    };
    walk(n, false);
    const k = mark.normalize('NFKC').replace(/[\s ]+/g, '');
    const ordered = !symbol && (/^[([]?\d+(\.\d+)*[.)\]]?$/.test(k) || /^[([]?[^\s.()[\]]{1,3}[.)\]]$/.test(k));
    const d = ordered && k.match(/(\d{1,9})[.)\]]?$/);
    return { level: Math.min(9, m ? +m[1] : 1), ordered: ordered, num: d ? +d[1] : null };
  }
  /* 段のある項目のしるしと字下げ。st は続いている項目の段ごとの { ordered, width, n }。
     入れ子は、上の段のしるしの幅(- は2、1. は3)だけ字下げする。段が飛んだときは1段ずつにする */
  function levelMark(st, lv) {
    const d = Math.min(lv.level - 1, st.length);
    const prev = st[d];
    const n = lv.ordered ? (lv.num != null ? lv.num : prev && prev.ordered ? prev.n + 1 : 1) : 0;
    const marker = lv.ordered ? n + '. ' : '- ';
    let indent = 0;
    for (let k = 0; k < d; k++) indent += st[k].width;
    st.length = d;
    st.push({ ordered: lv.ordered, width: marker.length, n: n });
    return { indent: indent, marker: marker };
  }

  function children(n, ctx) {
    const out = [];
    let buf = [];
    const flush = () => { const s = para(emit(buf, ctx)); if (s) out.push(s); buf = []; };
    for (const c of kids(n)) {
      const k = kind(c);
      if (k === 'inline') { inl(c, {}, buf, ctx); continue; }
      flush();
      out.push(...(k === 'wrap' ? children(c, ctx) : block(c, ctx)));
    }
    flush();
    return out;
  }
  const isSpecialBlock = n => (hasCls(n, 'diagram') && n.attrs['data-src'] != null) || (n.tag === 'math' && attr(n, 'display') === 'block');
  // 中にかたまりを含むか(Google ドキュメントは、全体を <b style="font-weight:normal"> で囲んでコピーする)
  const hasBlock = n => kids(n).some(c => c.tag && !SKIP.has(c.tag) && (BLOCK.has(c.tag) || isSpecialBlock(c) || hasBlock(c)));
  // 'block'(かたまり)、'wrap'(かたまりを囲んだ文中の要素。中身をかたまりとして読む)、'inline'(文中)
  const kind = c => (c.text != null ? 'inline' : BLOCK.has(c.tag) || isSpecialBlock(c) ? 'block' : !SKIP.has(c.tag) && hasBlock(c) ? 'wrap' : 'inline');
  // 並びをつなぐ。箇条書きの項目どうし({ item })は改行1つ、ほかは空行。
  // Word の箇条書きの段落({ item, lv, body })は、続いている間の段と番号から、しるしと字下げを決める
  function join(list) {
    let s = '', prevItem = false, st = [];
    for (const b of list) {
      const item = typeof b === 'object';
      let v = item ? b.item : b;
      if (!v) continue;
      if (!item || !prevItem) st = [];
      if (item && b.lv) { const r = levelMark(st, b.lv); v = ' '.repeat(r.indent) + r.marker + b.body; }
      s += (s ? (item && prevItem ? '\n' : '\n\n') : '') + v;
      prevItem = item;
    }
    return s;
  }

  function block(n, ctx) {
    const t = n.tag;
    if (SKIP.has(t) || hidden(n) || hasCls(n, 'pe-tail') || hasCls(n, 'alert-title')) return [];
    // EverPad のプレビューの部分
    if (hasCls(n, 'fm')) return [frontMatter(n)];
    if (hasCls(n, 'diagram') && n.attrs['data-src'] != null) { const src = attr(n, 'data-src'); const fe = fenceFor(src, '`'); return [fe + 'mermaid\n' + src + '\n' + fe]; }
    if (hasCls(n, 'math') && n.attrs['data-tex'] != null) return ['$$\n' + attr(n, 'data-tex').trim() + '\n$$'];
    if (t === 'math' && attr(n, 'display') === 'block') { const tex = texOf(n); return tex != null ? ['$$\n' + tex + '\n$$'] : []; }
    if (t === 'blockquote' && hasCls(n, 'alert') && attr(n, 'data-alert')) return [quote(['[!' + attr(n, 'data-alert').toUpperCase() + ']'].concat(join(children(n, ctx)).split('\n')))];
    if (t === 'section' && hasCls(n, 'footnotes')) return [footnotes(n, ctx)];
    if (/^h[1-6]$/.test(t)) { const s = emit(runs(n, {}, ctx), ctx).replace(/\n+/g, ' ').trim(); return s ? ['#'.repeat(+t[1]) + ' ' + s] : []; }
    if (t === 'hr') return ['---'];
    if (t === 'pre') return [codeBlock(n)];
    // GitHub のコード: <div class="highlight highlight-source-js"><pre>…</pre></div>(言語は外側の div にある)
    if (t === 'div') { const m = attr(n, 'class').match(/(?:^|\s)highlight-source-([A-Za-z0-9_+#.-]+)/), p = m && find(n, c => c.tag === 'pre'); if (p) return [codeBlock(p, m[1])]; }
    if (t === 'ul' || t === 'ol') { const s = list(n, ctx, 0); return s ? [s] : []; }
    if (t === 'li') { const s = item(n, ctx, 0, '- '); return s ? [s] : []; }
    if (t === 'blockquote') { const s = join(children(n, ctx)); return s ? [quote(s.split('\n'))] : []; }
    if (t === 'table') { const s = table(n, ctx); return s ? [s] : []; }
    if (wordListItem(n)) { const s = emit(runs(n, {}, ctx), ctx).replace(/\n+/g, ' ').trim(); return s ? [{ item: '- ' + s, lv: wordLevel(n), body: s }] : []; }
    return children(n, ctx);
  }
  const quote = lines => lines.map(l => (l ? '> ' + l : '>')).join('\n');

  function codeBlock(n, lang) {
    const text = clean(pre(n)).replace(/\n$/, '');
    // 言語: <pre class="language-js">・<code class="language-js">(lang は外側で分かったもの)。EverPad は表示に使わないが、書いたまま残す
    const code = find(n, c => c.tag === 'code');
    const cl = attr(n, 'class') + ' ' + (code ? attr(code, 'class') : '');
    const m = cl.match(/(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]+)/);
    const fe = fenceFor(text, '`');
    return fe + (lang || (m ? m[1] : '')) + '\n' + text + '\n' + fe;
  }
  const pre = n => (n.text != null ? n.text : n.tag === 'br' ? '\n' : SKIP.has(n.tag) ? '' : kids(n).map(pre).join('') + (n.tag === 'div' || n.tag === 'p' ? '\n' : ''));

  function list(n, ctx, ind) {
    const ordered = n.tag === 'ol';
    let k = parseInt(attr(n, 'start'), 10);
    if (!(k >= 0)) k = 1;
    // 入れ子を、項目の aria-level だけで表した平らなリスト(Google ドキュメントなど)は、段の深さで字下げする
    const lvs = kids(n).filter(c => c.tag === 'li').map(c => parseInt(attr(c, 'aria-level'), 10)).filter(x => x >= 1 && x <= 9);
    const base = lvs.length ? Math.min(...lvs) : 0, flat = lvs.some(x => x !== base), st = [];
    const lines = [];
    for (const c of kids(n)) {
      if (!c.tag) { if (c.text.trim()) lines.push(' '.repeat(ind) + (ordered ? k++ + '. ' : '- ') + escapeText(c.text.trim(), ctx)); continue; }
      if (c.tag === 'ul' || c.tag === 'ol') { const s = list(c, ctx, ind + 2); if (s) lines.push(s); continue; }   // ul の中に直接ある ul(よくある崩れた形)
      if (flat) {
        const lv = Math.min(9, parseInt(attr(c, 'aria-level'), 10) || base);
        const r = levelMark(st, { level: lv - base + 1, ordered: ordered, num: ordered && !st.length ? k : null });
        const s = item(c, ctx, ind + r.indent, r.marker);
        if (s) lines.push(s);
        continue;
      }
      const s = item(c, ctx, ind, ordered ? k + '. ' : '- ');
      if (ordered) k++;
      if (s) lines.push(s);
    }
    return lines.join('\n');
  }
  // 項目 1つ: 「しるし + 最初の行」、続きの行と入れ子のリストは、しるしの幅だけ字下げする
  function item(n, ctx, ind, marker) {
    const pad = ' '.repeat(ind + marker.length);
    const cb = (kids(n).find(c => c.tag === 'input' && attr(c, 'type').toLowerCase() === 'checkbox')) || (() => { const p = kids(n).find(c => c.tag === 'p' || c.tag === 'label'); return p && kids(p).find(c => c.tag === 'input' && attr(c, 'type').toLowerCase() === 'checkbox'); })();
    const text = [], nested = [];
    let buf = [];
    const flush = () => { const s = emit(buf, ctx).trim(); if (s) text.push(...s.split('\n')); buf = []; };
    for (const c of kids(n)) {
      if (kind(c) === 'inline') { inl(c, {}, buf, ctx); continue; }
      flush();
      if (c.tag === 'ul' || c.tag === 'ol') { const s = list(c, ctx, ind + marker.length); if (s) nested.push(s); continue; }
      if (c.tag === 'pre') { nested.push(codeBlock(c).split('\n').map(l => pad + l).join('\n')); continue; }
      // そのほかの段落などは、項目の続きの行にする(EverPad の項目の中には、見出しや表は書けない)
      for (const b of children({ children: [c] }, ctx)) text.push(...(typeof b === 'object' ? b.item : b).split('\n'));
    }
    flush();
    const lines = text.map(l => l.trim()).filter(l => l);
    if (!lines.length && !nested.length && !cb) return '';
    const check = cb ? (cb.attrs.checked != null ? '[x] ' : '[ ] ') : '';
    const out = [' '.repeat(ind) + marker + check + (lines.shift() || '')];
    for (const l of lines) out.push(pad + escLineStart(l));
    return out.concat(nested).join('\n');
  }

  function table(n, ctx) {
    const rows = [];
    let caption = '';
    const walk = x => { for (const c of kids(x)) { if (c.tag === 'tr') rows.push(c); else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c); else if (c.tag === 'caption') caption = emit(runs(c, {}, ctx), ctx).trim(); } };
    walk(n);
    const tctx = Object.assign({}, ctx, { inline: true, table: true });
    const cells = [], aligns = [];
    for (const r of rows) {
      const line = [], al = [];
      for (const c of kids(r)) {
        if (c.tag !== 'td' && c.tag !== 'th') continue;
        line.push(emit(runs(c, {}, tctx), tctx).trim());
        const cl = attr(c, 'class').match(/\bal-([lcr])\b/), a = (cl && cl[1]) || ({ left: 'l', center: 'c', right: 'r' })[(attr(c, 'align') || (styleOf(c).match(/text-align:(left|center|right)/) || [])[1] || '').toLowerCase()] || '';
        al.push(a);
        // 結合したセルは、結合を外して空のセルを足す
        const span = Math.min(50, parseInt(attr(c, 'colspan'), 10) || 1);
        for (let k = 1; k < span; k++) { line.push(''); al.push(a); }
      }
      if (line.length) { cells.push(line); aligns.push(al); }
    }
    if (!cells.length) return '';
    const cols = Math.max(...cells.map(r => r.length));
    const row = r => '| ' + Array.from({ length: cols }, (_, k) => r[k] || ' ').join(' | ') + ' |';
    const delim = '| ' + Array.from({ length: cols }, (_, k) => ({ c: ':---:', r: '---:' })[aligns[0][k]] || '---').join(' | ') + ' |';
    return (caption ? para(caption) + '\n\n' : '') + [row(cells[0]), delim].concat(cells.slice(1).map(row)).join('\n');
  }

  // EverPad のプレビューのフロントマター(キーと値の並び。tags は札のボタンの data-tag)
  function frontMatter(n) {
    const lines = [];
    const rows = []; const walk = x => { for (const c of kids(x)) { if (c.tag && hasCls(c, 'fm-row')) rows.push(c); else if (c.tag) walk(c); } }; walk(n);
    for (const r of rows) {
      const k = find(r, c => hasCls(c, 'fm-k')), v = find(r, c => hasCls(c, 'fm-v'));
      const key = k ? textOf(k).trim() : '';
      if (!key) continue;
      if (hasCls(r, 'fm-tags')) {
        const tags = []; const w = x => { for (const c of kids(x)) { if (c.tag && attr(c, 'data-tag')) tags.push(attr(c, 'data-tag')); else if (c.tag) w(c); } }; if (v) w(v);
        lines.push(key + ': ' + tags.map(t => (/[,#"'[\]{}:]|^\s|\s$/.test(t) ? JSON.stringify(t) : t)).join(', '));
      } else lines.push(key + ': ' + (v ? textOf(v).replace(/\s+/g, ' ').trim() : ''));
    }
    return lines.length ? '---\n' + lines.join('\n') + '\n---' : '';
  }
  // EverPad のプレビューの脚注の一覧 → [^n]: 注(2段落目からは字下げした続きの行)
  function footnotes(n, ctx) {
    const out = [];
    const walk = x => { for (const c of kids(x)) { if (c.tag === 'li' && attr(c, 'data-fn')) out.push(fn(c)); else if (c.tag) walk(c); } };
    const fn = li => { const parts = children(li, ctx).map(b => (typeof b === 'object' ? b.item : b)); const lines = join(parts).split('\n'); return '[^' + attr(li, 'data-fn') + ']: ' + lines.map((l, k) => (k ? '  ' + l : l)).join('\n'); };
    walk(n);
    return out.join('\n');
  }

  /* ---------- 入口 ---------- */
  /* 整形があるか(見出し・太字・斜体・取り消し線・リスト・表・引用・コード・区切り線・リンク・画像・チェックボックス・数式・EverPad の部分)。
     色やフォントだけの HTML(コードエディタからのコピーなど)は、今までどおり文字として貼るため */
  function isRich(tree) {
    let count = 0;
    const rich = n => {
      if (++count > MAX_NODES) return false;
      if (n.text != null || SKIP.has(n.tag) || hidden(n)) return false;
      const t = n.tag;
      if (/^h[1-6]$/.test(t) || ['ul', 'ol', 'table', 'blockquote', 'pre', 'code', 'hr', 'kbd', 's', 'del', 'strike', 'math'].includes(t)) return true;
      if ((t === 'b' || t === 'strong' || t === 'i' || t === 'em') && textOf(n).trim() && (boldOf(n, false) || italicOf(n, false))) return true;
      if (t === 'a' && /^(https?:|mailto:|note:)/i.test(attr(n, 'href').trim())) return true;
      if (t === 'img' && (/^(data:image\/|https?:)/i.test(attr(n, 'src').trim()) || OFFICE_CLIP_RE.test(attr(n, 'src').trim()))) return true;
      if (t === 'input' && attr(n, 'type').toLowerCase() === 'checkbox') return true;
      if (['math', 'diagram', 'note-link', 'att-img', 'att-file', 'emoji', 'alert', 'fm', 'fnref', 'katex', 'link-other'].some(c => hasCls(n, c))) return true;
      if (t === 'span' && textOf(n).trim() && (boldOf(n, false) || italicOf(n, false) || strikeOf(n, false))) return true;
      if (wordListItem(n)) return true;
      return kids(n).some(rich);
    };
    return rich(tree);
  }
  // 文字があるか(画像だけのコピーは、今までどおり添付にするため)
  const hasText = tree => /\S/.test(textOf({ children: [tree] }).replace(/ /g, ' '));

  /* tree → { md, images, atts }。opts.inline: 表のセルなど1行の入力欄(見出しやリストは作らず、改行は空白)。
     images: 画像そのもの(data:)と Word・Excel の一時ファイル(file:)。atts: 添付の元のメモ [{ note, file }] */
  function toMarkdown(tree, opts) {
    const ctx = { images: [], atts: [], inline: !!(opts && opts.inline), imageLabel: (opts && opts.imageLabel) || 'image' };
    let md;
    if (ctx.inline) md = emit(runs(tree, {}, ctx), ctx).replace(/\s*\n\s*/g, ' ').trim();
    else md = join(children(tree, ctx)).replace(/\n{3,}/g, '\n\n').trim();
    return { md: md, images: ctx.images, atts: ctx.atts };
  }

  /* 画面: DOM の節 → 木(大きすぎる・深すぎるものは null) */
  function fromDom(node) {
    let count = 0;
    const conv = (x, depth) => {
      if (++count > MAX_NODES) throw new Error('too large');
      if (x.nodeType === 3) return { text: x.nodeValue };
      if (x.nodeType !== 1) return null;
      const attrs = {};
      for (const a of x.attributes) attrs[a.name.toLowerCase()] = a.value;
      const out = { tag: x.nodeName.toLowerCase(), attrs: attrs, children: [] };
      if (depth < MAX_DEPTH) for (const c of x.childNodes) { const k = conv(c, depth + 1); if (k) out.children.push(k); }
      return out;
    };
    try { return conv(node, 0); } catch (e) { return null; }
  }

  /* ---------- ブラウザから落としたリンク(app.js のドロップ) ---------- */
  // text/uri-list の最初の URL(# の行は注釈)。http・https・mailto だけ
  function dropUrl(list) {
    for (const l of String(list || '').split(/\r?\n/)) {
      const u = l.trim();
      if (!u || u[0] === '#') continue;
      return u.length <= 4096 && /^(https?:\/\/[^\s]|mailto:[^\s])/i.test(u) && !/[\u0000-\u001f\u007f]/.test(u) ? u : '';
    }
    return '';
  }
  // 落とした HTML(ページの中のリンク)から、その URL の <a> の文字(無ければ最初のリンクの文字、画像だけなら代わりの文字)
  function anchorTitle(tree, url) {
    if (!tree) return '';
    const links = [];
    const walk = n => { for (const c of kids(n)) { if (!c.tag) continue; if (c.tag === 'a' && attr(c, 'href')) links.push(c); walk(c); } };
    walk(tree);
    const a = links.find(x => attr(x, 'href').trim() === url) || links.find(x => /^(https?:|mailto:)/i.test(attr(x, 'href').trim()));
    if (!a) return '';
    const t = textOf(a).replace(/\s+/g, ' ').trim();
    if (t) return t;
    const img = find(a, c => c.tag === 'img' && attr(c, 'alt').trim());
    return img ? attr(img, 'alt').trim() : '';
  }
  // インターネットのショートカット(.url)の中の URL([InternetShortcut] の URL=)
  function shortcutUrl(content) {
    const m = String(content || '').match(/^\s*URL\s*=\s*(\S.*?)\s*$/im);
    return m ? dropUrl(m[1]) : '';
  }
  // [タイトル](URL) の書き方。タイトルが無いか URL と同じなら、URL だけ(EverPad がリンクにする)。ctx.table: 表のセルの中
  function linkMd(url, title, ctx) {
    url = String(url || '').trim();
    let t = clean(String(title || '')).replace(/\s+/g, ' ').trim();
    if ([...t].length > 300) t = [...t].slice(0, 300).join('').trim() + '…';
    if (/^mailto:/i.test(url) && (!t || t === url)) t = url.slice(7);
    if (!t || t === url || t + '/' === url || t === url + '/') return urlPart(url);
    // ] はエスケープする(リンクが途中で切れないように)。[ はそのまま(EverPad のリンクの文字の中では普通の文字。
    // \[ と \] がそろうと数式になるので、escapeText が付けた \[ も戻す)
    return '[' + escapeText(t, ctx).replace(/(?<!\\)\\\[/g, '[').replace(/(?<!\\)\]/g, '\\]') + '](' + urlPart(url) + ')';
  }

  const api = { toMarkdown, isRich, hasText, fromDom, escapeText, escLineStart, dropUrl, anchorTitle, shortcutUrl, linkMd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HtmlMd = api;
})(typeof window !== 'undefined' ? window : this);
