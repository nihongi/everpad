'use strict';
/* PowerPoint(.pptx)として書き出す(「エクスポート」→「PowerPoint…」)。
   本文は画面側で区切り線で分けたスライド(core.js の slidesHtml)。画面側は、書き出す前に幅 1280px のスライドに並べて測り、
   - スライド(<section class="slide">)に data-fit(入りきらないときに文字を縮めた割合)
   - スライドの中のいちばん外側のかたまりと画像に data-box="x,y,幅,高さ"(スライドの左上からの px。幅 1280px のスライドでの値)
   - 表に data-cols(列の幅)・data-rows(行の高さ)・data-cap(表題の場所)
   を付けて渡す。数式は data-mml(KaTeX の MathML)、図は data-png(PNG)、画像は data-att(ファイル ID)を持つ(docexport.js と同じ)。
   スライドの大きさは 16:9(13.333 × 7.5 インチ)で、1280px がちょうどスライドの幅(1px = 9525 EMU、文字は 0.75pt)。
   かたまりごとに、測った場所にテキストボックス・画像・表を置く(プレビューと同じ配置になる)。
   数式は PowerPoint の数式(OMML。Word と同じ変換)にし、PowerPoint で編集できるようにする(数式を含む図形は、
   数式を読めないソフトのために、LaTeX の文字にした図形も入れておく)。図(Mermaid)は画像にする。
   Electron なしでテストできるよう、ファイルの読み書きはしない(main.js が行う)。 */
const { writeZip } = require('./ziplite');
const { parseMarkup, blocksOf, mathmlToOmml } = require('./docexport');

const xesc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hasClass = (n, c) => (' ' + (n.attrs && n.attrs.class || '') + ' ').indexOf(' ' + c + ' ') >= 0;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS = 'xmlns:a="' + NS_A + '" xmlns:r="' + NS_R + '" xmlns:p="' + NS_P + '"';
const NS_MATH = ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const SLIDE_W = 12192000, SLIDE_H = 6858000;   // 16:9(EMU)
const EMU = 9525;                              // 1px(幅 1280px のスライドで)
const BASE = 35;                               // 文字の大きさ(px。スライドの CSS と同じ)
const FG = '1F2328', FG2 = '59636E', LINE = 'D0D7DE', CODE_BG = 'F6F8FA', LINK = '0563C1';
const ALERT_COLORS = { note: '0969DA', tip: '1A7F37', important: '8250DF', warning: '9A6700', caution: 'D1242F' };
const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
const MONO = { latin: 'Consolas', ea: 'ＭＳ ゴシック' };

const emu = px => Math.round(px * EMU);
const hund = px => Math.max(100, Math.round(px * 75));   // px → 1/100 pt
const parseBox = s => { const v = String(s || '').split(',').map(Number); return v.length === 4 && v.every(isFinite) && v[2] > 0 && v[3] > 0 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null; };
const xfrm = b => '<a:xfrm><a:off x="' + emu(b.x) + '" y="' + emu(b.y) + '"/><a:ext cx="' + emu(b.w) + '" cy="' + emu(b.h) + '"/></a:xfrm>';

/* ---------- 文中 ---------- */
/* 文字の書式。st: { sz(px), b, i, s, code, color, sup, link(関係の ID) } */
function rPr(st, X, tag) {
  let a = ' lang="' + X.lang + '" sz="' + hund(st.sup ? st.sz * 0.75 : st.code ? st.sz * 0.85 : st.sz) + '"';
  if (st.b) a += ' b="1"';
  if (st.i) a += ' i="1"';
  if (st.link) a += ' u="sng"';
  if (st.s) a += ' strike="sngStrike"';
  if (st.sup) a += ' baseline="30000"';
  const f = st.code ? MONO : { latin: X.font, ea: X.font };
  const inner = '<a:solidFill><a:srgbClr val="' + (st.link ? LINK : st.color || FG) + '"/></a:solidFill>'
    + '<a:latin typeface="' + xesc(f.latin) + '"/><a:ea typeface="' + xesc(f.ea) + '"/><a:cs typeface="' + xesc(f.latin) + '"/>'
    + (st.link ? '<a:hlinkClick r:id="' + st.link + '"/>' : '');
  return '<a:' + (tag || 'rPr') + a + ' dirty="0">' + inner + '</a:' + (tag || 'rPr') + '>';
}
const run = (text, st, X) => (text ? '<a:r>' + rPr(st, X) + '<a:t>' + xesc(text) + '</a:t></a:r>' : '');
/* Word の数式(OMML)を PowerPoint の数式にする: 文字の書式を PowerPoint の形(a:rPr)にし、大きさを本文に合わせる */
function pptMath(om, st, X) {
  // 見えない文字(\phantom・\vphantom。\ce{} が添え字の高さをそろえるのに使う)は、PowerPoint では見えてしまうので、空の文字にする
  //(入れ子でも壊れないよう、内側から1つずつ)
  const PHANT = /<m:phant>(?:(?!<m:phant>)[\s\S])*?<\/m:phant>/g;
  while (PHANT.test(om)) om = om.replace(PHANT, '<m:r><m:t>\u200B</m:t></m:r>');
  return om.replace(/<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"\/>(?:<w:color w:val="([0-9A-F]{6})"\/>)?<\/w:rPr>/g, (m, c) =>
    '<a:rPr lang="en-US" sz="' + hund(st.sz) + '"><a:solidFill><a:srgbClr val="' + (c || st.color || FG) + '"/></a:solidFill><a:latin typeface="Cambria Math"/><a:ea typeface="Cambria Math"/><a:cs typeface="Cambria Math"/></a:rPr>')
    .replace(/<m:r><m:t>\u200B<\/m:t><\/m:r>/g, '<m:r><a:rPr lang="en-US" sz="' + hund(st.sz) + '"/><m:t>\u200B</m:t></m:r>');
}
// 数式: X.mode が 'omml' なら PowerPoint の数式、'text' なら LaTeX の文字(数式を読めないソフト向けの代わりの図形)
function mathRun(x, st, X) {
  const om = X.mode === 'omml' && !x.error && x.mml ? mathmlToOmml(x.mml) : null;
  if (!om) return run(x.tex, Object.assign({}, st, { code: true }), X);
  X.usedMath = true;
  return '<a14:m>' + pptMath(om, st, X) + '</a14:m>';
}
function linkId(href, X) {
  if (!X.links.has(href)) { const id = 'rIdL' + (X.links.size + 1); X.links.set(href, id); X.rels.push({ id: id, type: 'hyperlink', target: href, external: true }); }
  return X.links.get(href);
}
function runs(nodes, st, X) {
  let s = '';
  for (const x of nodes) {
    if (x.t === 'text') s += run(x.v, st, X);
    else if (x.t === 'br') s += '<a:br>' + rPr(st, X) + '</a:br>';
    else if (x.t === 'b' || x.t === 'i' || x.t === 's') s += runs(x.c, Object.assign({}, st, { [x.t]: true }), X);
    else if (x.t === 'code') s += run(x.v, Object.assign({}, st, { code: true }), X);
    else if (x.t === 'a') s += runs(x.c.length ? x.c : [{ t: 'text', v: x.href }], Object.assign({}, st, { link: linkId(x.href, X) }), X);
    else if (x.t === 'math') s += mathRun(x, st, X);
    else if (x.t === 'fn') s += run(String(x.n), Object.assign({}, st, { sup: true }), X);
    else if (x.t === 'check') s += run(x.on ? '☑ ' : '☐ ', st, X);
    // 画像(x.t === 'img')は、文の外に画像として置く(pictures)
  }
  return s;
}
const hasText = nodes => nodes.some(x => (x.t === 'text' && x.v.trim()) || x.t === 'code' || x.t === 'math' || x.t === 'fn' || x.t === 'check' || (x.c && hasText(x.c)));

/* ---------- 段落 ----------
   o: { sz(px), lh(行の高さ。文字の大きさの倍), before・after(em), marL・indent(px), algn, lvl(リストの深さ。番号付きのリストを、入れ子の項目をはさんでも続けて数えるため),
        bullet: { char } | { num, start } } */
function para(o, content, X) {
  let p = '';
  if (o.marL) p += ' marL="' + emu(o.marL) + '"';
  if (o.indent) p += ' indent="' + emu(o.indent) + '"';
  if (o.algn) p += ' algn="' + o.algn + '"';
  if (o.lvl) p += ' lvl="' + Math.min(8, o.lvl) + '"';
  let s = '<a:lnSpc><a:spcPts val="' + hund(o.sz * (o.lh || 1.45)) + '"/></a:lnSpc>'
    + '<a:spcBef><a:spcPts val="' + Math.round((o.before || 0) * o.sz * 75) + '"/></a:spcBef>'
    + '<a:spcAft><a:spcPts val="' + Math.round((o.after || 0) * o.sz * 75) + '"/></a:spcAft>';
  if (o.bullet && o.bullet.num) s += '<a:buClr><a:srgbClr val="' + (o.color || FG) + '"/></a:buClr><a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"' + (o.bullet.start > 1 ? ' startAt="' + o.bullet.start + '"' : '') + '/>';
  else if (o.bullet) s += '<a:buClr><a:srgbClr val="' + (o.color || FG) + '"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="' + o.bullet.char + '"/>';
  else s += '<a:buNone/>';
  return '<a:p><a:pPr' + p + '>' + s + '</a:pPr>' + content + '<a:endParaRPr lang="' + X.lang + '" sz="' + hund(o.sz) + '" dirty="0"/></a:p>';
}
const HEAD_EM = [0, 1.8, 1.45, 1.2, 1, 0.875, 0.85];
const BULLETS = ['•', '◦', '▪'];
/* かたまりの並び → 段落の並び(テキストボックスの中身)。ctx: { sz, color, marL, lvl } */
function paras(blocks, ctx, X) {
  let s = '';
  blocks.forEach((b, k) => {
    const last = k === blocks.length - 1, after = last ? 0 : 0.55;
    const base = { sz: ctx.sz, marL: ctx.marL, color: ctx.color, after: after, lvl: ctx.lvl };
    if (b.t === 'p') s += para(base, runs(b.c, { sz: ctx.sz, color: ctx.color }, X), X);
    else if (b.t === 'h') {
      const sz = ctx.sz * HEAD_EM[b.level];
      s += para(Object.assign({}, base, { sz: sz, lh: 1.25, after: last ? 0 : 0.45 * ctx.sz / sz }), runs(b.c.filter(x => x.t !== 'br'), { sz: sz, b: true, color: b.level === 6 ? FG2 : ctx.color }, X), X);
    } else if (b.t === 'math') {
      const om = X.mode === 'omml' && !b.error && b.mml ? mathmlToOmml(b.mml) : null;
      if (om) { X.usedMath = true; s += para(Object.assign({}, base, { algn: 'ctr', lh: 1.6 }), '<a14:m><m:oMathPara><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>' + pptMath(om, ctx, X) + '</m:oMathPara></a14:m>', X); }
      else s += para(Object.assign({}, base, { algn: 'ctr' }), run(b.tex, { sz: ctx.sz, code: true, color: ctx.color }, X), X);
    } else if (b.t === 'pre') {
      const lines = b.text.replace(/\n$/, '').split('\n');
      lines.forEach((l, i) => { s += para(Object.assign({}, base, { sz: ctx.sz * 0.85, after: i === lines.length - 1 ? after / 0.85 : 0 }), run(l.replace(/\t/g, '    ') || ' ', { sz: ctx.sz, code: true, color: ctx.color }, X), X); });
    } else if (b.t === 'list') s += listParas(b, ctx, X, last);
    else if (b.t === 'quote') s += paras(b.c, Object.assign({}, ctx, { marL: ctx.marL + ctx.sz * 1.25, color: FG2 }), X);
    else if (b.t === 'alert') {
      const color = ALERT_COLORS[b.kind] || FG2, sub = Object.assign({}, ctx, { marL: ctx.marL + ctx.sz * 1.25 });
      s += para(Object.assign({}, base, { marL: sub.marL, after: b.c.length ? 0.3 : after }), runs(b.title, { sz: ctx.sz, b: true, color: color }, X), X) + paras(b.c, sub, X);
    } else if (b.t === 'footnotes') {
      const sz = ctx.sz * 0.7;
      b.items.forEach(it => { const c = it.c[0] && it.c[0].t === 'p' ? it.c[0].c : []; s += para({ sz: sz, marL: ctx.marL, color: FG2 }, run(it.n + '. ', { sz: sz, color: FG2 }, X) + runs(c, { sz: sz, color: FG2 }, X), X); });
    } else if (b.t === 'table') {
      // 入れ子の表(リストや引用の中): 行ごとに、セルを「 | 」でつないだ文にする
      for (const r of b.rows) s += para(base, r.filter(x => x).map((x, j) => (j ? run(' | ', { sz: ctx.sz, color: FG2 }, X) : '') + runs(x.c, { sz: ctx.sz, color: ctx.color }, X)).join(''), X);
    } else if (b.t === 'diagram' && !b.png) s += paras([{ t: 'pre', text: b.src }], ctx, X);
  });
  return s;
}
function listParas(b, ctx, X, lastBlock) {
  const step = ctx.sz * 1.3, marL = ctx.marL + step, lvl = ctx.lvl || 0;
  let s = '';
  b.items.forEach((it, i) => {
    const c = it.c.slice();
    const first = c[0] && c[0].t === 'p' ? c.shift() : null;
    const lastItem = i === b.items.length - 1 && !c.length;
    const o = { sz: ctx.sz, marL: marL, indent: -step * 0.8, lvl: lvl, color: ctx.color, before: i ? 0.15 : 0, after: lastItem && !lastBlock ? 0.55 : 0 };
    let content = first ? runs(first.c, { sz: ctx.sz, color: ctx.color }, X) : '';
    if (it.check != null) content = run(it.check ? '☑ ' : '☐ ', { sz: ctx.sz, color: ctx.color }, X) + content;
    // 番号は PowerPoint が続けて数える(どの項目にも、最初の番号を書く)
    else o.bullet = b.ordered ? { num: true, start: b.start } : { char: BULLETS[lvl % 3] };
    s += para(o, content, X);
    if (c.length) s += paras(c, Object.assign({}, ctx, { marL: marL, lvl: lvl + 1 }), X);
  });
  return s;
}

/* ---------- 図形 ---------- */
function textShape(id, box, body, o, X) {
  o = o || {};
  const ins = o.ins || [0, 0, 0, 0];
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + (o.name || 'TextBox') + ' ' + id + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr>' + xfrm(box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    + (o.fill ? '<a:solidFill><a:srgbClr val="' + o.fill + '"/></a:solidFill>' : '<a:noFill/>') + '</p:spPr>'
    + '<p:txBody><a:bodyPr wrap="' + (o.nowrap ? 'none' : 'square') + '" lIns="' + emu(ins[0]) + '" tIns="' + emu(ins[1]) + '" rIns="' + emu(ins[2]) + '" bIns="' + emu(ins[3]) + '" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>'
    + (body || '<a:p><a:endParaRPr lang="' + X.lang + '" dirty="0"/></a:p>') + '</p:txBody></p:sp>';
}
function rectShape(id, box, color) {
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Rectangle ' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>' + xfrm(box)
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
}
function lineShape(id, x, y, w) {
  return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="Line ' + id + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>'
    + '<a:xfrm><a:off x="' + emu(x) + '" y="' + emu(y) + '"/><a:ext cx="' + emu(w) + '" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
    + '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + LINE + '"/></a:solidFill></a:ln></p:spPr></p:cxnSp>';
}
/* 画像の登録(同じファイルは1つ)。key は添付のファイル ID か '#diagramN' */
function mediaRel(key, X) {
  const m = X.media.get(key);
  if (!m) return null;
  if (!m.name) m.name = 'image' + (X.mediaCount = (X.mediaCount || 0) + 1) + '.' + m.ext;
  if (!X.slideMedia.has(key)) { const id = 'rIdI' + (X.slideMedia.size + 1); X.slideMedia.set(key, id); X.rels.push({ id: id, type: 'image', target: '../media/' + m.name }); }
  return X.slideMedia.get(key);
}
function picShape(id, box, rid, descr) {
  return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Picture ' + id + '" descr="' + xesc(descr || '') + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
    + '<p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + '<p:spPr>' + xfrm(box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
}
/* 表: 測った列の幅・行の高さで置く。結合したセルは gridSpan・rowSpan と、覆われた場所の hMerge・vMerge */
function tableShape(id, box, b, el, ctx, X) {
  const n = b.align.length;
  let cols = String(el.attrs['data-cols'] || '').split(',').map(Number).filter(v => v > 0);
  if (cols.length !== n) cols = Array.from({ length: n }, () => box.w / n);
  let rows = String(el.attrs['data-rows'] || '').split(',').map(Number).filter(v => v > 0);
  if (rows.length !== b.rows.length) rows = b.rows.map(() => box.h / Math.max(1, b.rows.length));
  // 覆われた場所が、横の結合か縦の結合か
  const cover = b.rows.map(r => r.map(() => null));
  b.rows.forEach((r, i) => r.forEach((x, j) => { if (!x) return; for (let a = 0; a < x.rs; a++) for (let c = 0; c < x.cs; c++) if ((a || c) && cover[i + a]) cover[i + a][j + c] = a ? 'v' : 'h'; }));
  const border = side => '<a:' + side + ' w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:' + side + '>';
  const algn = { l: 'l', c: 'ctr', r: 'r' };
  // セルの左右の余白は、画面(0.6em)より少し狭くする(PowerPoint は日本語の文字の幅を、画面より少し広く取るので、同じ幅でも折り返すことがある)
  const pad = ctx.sz * 0.3, padX = ctx.sz * 0.4;
  let s = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Table ' + id + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="' + emu(box.x) + '" y="' + emu(box.y) + '"/><a:ext cx="' + emu(box.w) + '" cy="' + emu(box.h) + '"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>'
    + cols.map(w => '<a:gridCol w="' + emu(w) + '"/>').join('') + '</a:tblGrid>';
  b.rows.forEach((r, i) => {
    const head = i < b.nh;
    s += '<a:tr h="' + emu(rows[i]) + '">';
    for (let j = 0; j < n; j++) {
      const x = r[j];
      const attr = x ? (x.cs > 1 ? ' gridSpan="' + x.cs + '"' : '') + (x.rs > 1 ? ' rowSpan="' + x.rs + '"' : '') : cover[i][j] === 'v' ? ' vMerge="1"' : ' hMerge="1"';
      const text = x ? runs(x.c, { sz: ctx.sz, b: head, color: FG }, X) : '';
      s += '<a:tc' + attr + '><a:txBody><a:bodyPr/><a:lstStyle/>' + para({ sz: ctx.sz, algn: algn[(x && x.al) || b.align[j]] }, text, X) + '</a:txBody>'
        + '<a:tcPr marL="' + emu(padX) + '" marR="' + emu(padX) + '" marT="' + emu(pad) + '" marB="' + emu(pad) + '" anchor="t">'
        + border('lnL') + border('lnR') + border('lnT') + border('lnB')
        + (head ? '<a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill>' : '<a:noFill/>') + '</a:tcPr></a:tc>';
    }
    s += '</a:tr>';
  });
  return s + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
}

/* スライドの中のいちばん外側のかたまり(el: 読んだ HTML の要素)→ 図形の並び */
function blockShapes(el, ctx, X) {
  const box = parseBox(el.attrs['data-box']);
  const blocks = blocksOf([el]);
  if (!box || !blocks.length) return pictures(blocks, X);
  const b = blocks[0], one = blocks.length === 1;
  if (one && b.t === 'table') {
    let s = '';
    const cap = parseBox(el.attrs['data-cap']);
    if (cap && b.caption) s += shape(cap, () => para({ sz: ctx.sz }, runs(b.caption, { sz: ctx.sz, b: true }, X), X), {}, X);
    return s + tableShape(X.nextId++, box, b, el, ctx, X) + pictures(blocks, X);
  }
  if (one && b.t === 'diagram' && b.png) {
    const key = '#diagram' + (X.nDiagram = (X.nDiagram || 0) + 1);
    const data = Buffer.from(b.png, 'base64');
    if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) return '';
    X.media.set(key, { data: data, ext: 'png' });
    return picShape(X.nextId++, box, mediaRel(key, X), '');
  }
  let s = '';
  if (one && b.t === 'pre') return shape(box, () => paras(blocks, ctx, X), { fill: CODE_BG, nowrap: true, ins: [ctx.sz * 0.8 * 0.85, ctx.sz * 0.6 * 0.85, ctx.sz * 0.8 * 0.85, ctx.sz * 0.6 * 0.85], name: 'Code' }, X);
  if (one && (b.t === 'quote' || b.t === 'alert')) {
    // 左の線は細い四角。中の文は線の右から
    s += rectShape(X.nextId++, { x: box.x, y: box.y, w: ctx.sz * 0.25, h: box.h }, b.t === 'alert' ? ALERT_COLORS[b.kind] || LINE : LINE);
    return s + shape(box, () => paras(blocks, ctx, X), { ins: [0, b.t === 'alert' ? ctx.sz * 0.5 : 0, 0, 0] }, X) + pictures(blocks, X);
  }
  if (one && b.t === 'h' && b.level <= 2) s += lineShape(X.nextId++, box.x, box.y + box.h, box.w);   // h1・h2 の下の線
  if (blocks.some(x => x.t !== 'p' || hasText(x.c))) s += shape(box, () => paras(blocks, ctx, X), {}, X);
  return s + pictures(blocks, X);
}
/* テキストボックス。数式を含むときは、PowerPoint の数式の図形と、数式を LaTeX の文字にした図形(読めないソフト用)の両方を入れる */
function shape(box, body, o, X) {
  const id = X.nextId++;
  X.mode = 'omml'; X.usedMath = false;
  const main = textShape(id, box, body(), o, X);
  if (!X.usedMath) return main;
  X.mode = 'text';
  const fallback = textShape(id, box, body(), o, X);
  X.mode = 'omml';
  return '<mc:AlternateContent><mc:Choice Requires="a14">' + main + '</mc:Choice><mc:Fallback>' + fallback + '</mc:Fallback></mc:AlternateContent>';
}
/* かたまりの中の画像を、測った場所に置く */
function pictures(blocks, X) {
  let s = '';
  const visit = x => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    if (x.t === 'img') { const box = parseBox(x.box), rid = box && mediaRel(x.file, X); if (rid) s += picShape(X.nextId++, box, rid, x.alt); return; }
    for (const k of ['c', 'items', 'rows', 'caption', 'title']) if (x[k]) visit(x[k]);
  };
  visit(blocks);
  return s;
}
function slideXml(sec, X) {
  const fit = Math.min(1, Math.max(0.3, parseFloat(sec.attrs['data-fit']) || 1));
  const inner = (sec.children || []).find(c => c.tag === 'div' && hasClass(c, 'slide-in')) || sec;
  const ctx = { sz: BASE * fit, color: FG, marL: 0, lvl: 0 };
  X.nextId = 2;
  let shapes = '';
  for (const el of inner.children || []) if (el.tag) shapes += blockShapes(el, ctx, X);
  return XML_HEAD + '<p:sld ' + NS + NS_MATH + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

/* ---------- ファイルの部品 ---------- */
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
function themeXml(font) {
  const f = xesc(font);
  const fonts = '<a:latin typeface="' + f + '"/><a:ea typeface="' + f + '"/><a:cs typeface="' + f + '"/>';
  const clr = (name, v) => '<a:' + name + '><a:srgbClr val="' + v + '"/></a:' + name + '>';
  const three = x => x + x + x;
  return XML_HEAD + '<a:theme xmlns:a="' + NS_A + '" name="EverPad"><a:themeElements>'
    + '<a:clrScheme name="EverPad">' + clr('dk1', '000000') + clr('lt1', 'FFFFFF') + clr('dk2', FG) + clr('lt2', 'EEF1F6')
    + clr('accent1', '2B4FB3') + clr('accent2', '1A7F37') + clr('accent3', '9A6700') + clr('accent4', '8250DF') + clr('accent5', 'D1242F') + clr('accent6', '0969DA')
    + clr('hlink', LINK) + clr('folHlink', '954F72') + '</a:clrScheme>'
    + '<a:fontScheme name="EverPad"><a:majorFont>' + fonts + '</a:majorFont><a:minorFont>' + fonts + '</a:minorFont></a:fontScheme>'
    + '<a:fmtScheme name="EverPad"><a:fillStyleLst>' + three('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>') + '</a:fillStyleLst>'
    + '<a:lnStyleLst>' + three('<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>') + '</a:lnStyleLst>'
    + '<a:effectStyleLst>' + three('<a:effectStyle><a:effectLst/></a:effectStyle>') + '</a:effectStyleLst>'
    + '<a:bgFillStyleLst>' + three('<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>') + '</a:bgFillStyleLst></a:fmtScheme>'
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}
function masterXml() {
  const lvl = sz => '<a:lvl1pPr><a:defRPr sz="' + sz + '"/></a:lvl1pPr>';
  return XML_HEAD + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' + EMPTY_TREE + '</p:cSld>'
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
    + '<p:txStyles><p:titleStyle>' + lvl(4400) + '</p:titleStyle><p:bodyStyle>' + lvl(2400) + '</p:bodyStyle><p:otherStyle>' + lvl(1800) + '</p:otherStyle></p:txStyles></p:sldMaster>';
}
const layoutXml = () => XML_HEAD + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank">' + EMPTY_TREE + '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
function relsXml(rels) {
  return XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + rels.map(r => '<Relationship Id="' + r.id + '" Type="' + REL + r.type + '" Target="' + xesc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('')
    + '</Relationships>';
}
const iso = d => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');

/* 本文の HTML の中の画像(ファイル ID の一覧) */
function pptxImages(bodyHtml) {
  const ids = [];
  for (const m of String(bodyHtml).matchAll(/data-att="([0-9a-f]{16}\.[a-z0-9]{1,8})"/g)) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  return ids;
}
/* bodyHtml: 画面側で測ったスライド。o: { title, meta: { title, author: [], keywords: [] }, lang('ja'|'en'), font, generator, date,
   images: { [ファイルID]: { data: Buffer, ext: 'png'|'jpeg'|'gif'|'bmp' } } } → .pptx の Buffer */
function toPptx(bodyHtml, o) {
  o = o || {};
  const meta = Object.assign({ title: '', author: [], keywords: [] }, o.meta || {});
  const font = String(o.font || '').replace(/["<>&]/g, '').trim().slice(0, 64) || (o.lang === 'ja' ? 'Yu Gothic UI' : 'Segoe UI');
  const X = { lang: o.lang === 'ja' ? 'ja-JP' : 'en-US', font: font, media: new Map(), mode: 'omml' };
  for (const [k, v] of Object.entries(o.images || {})) if (v && v.data && MIME[v.ext]) X.media.set(k, { data: v.data, ext: v.ext });
  const root = parseMarkup(String(bodyHtml || ''));
  const secs = [];
  const find = n => { for (const c of n.children || []) { if (c.tag === 'section' && hasClass(c, 'slide')) secs.push(c); else if (c.tag) find(c); } };
  find(root);
  const slides = secs.map(sec => {
    X.rels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    X.links = new Map(); X.slideMedia = new Map();
    const xml = slideXml(sec, X);
    return { xml: xml, rels: X.rels };
  });
  if (!slides.length) {
    X.rels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    slides.push({ xml: XML_HEAD + '<p:sld ' + NS + '><p:cSld>' + EMPTY_TREE + '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>', rels: X.rels });
  }
  const n = slides.length;
  const presRels = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }]
    .concat(slides.map((s, i) => ({ id: 'rId' + (i + 2), type: 'slide', target: 'slides/slide' + (i + 1) + '.xml' })))
    .concat([{ id: 'rId' + (n + 2), type: 'presProps', target: 'presProps.xml' }, { id: 'rId' + (n + 3), type: 'viewProps', target: 'viewProps.xml' },
      { id: 'rId' + (n + 4), type: 'theme', target: 'theme/theme1.xml' }, { id: 'rId' + (n + 5), type: 'tableStyles', target: 'tableStyles.xml' }]);
  const pres = XML_HEAD + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + '<p:sldIdLst>' + slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst>'
    + '<p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  const used = [...X.media.values()].filter(m => m.name);
  const exts = [...new Set(used.map(m => m.ext))];
  const CT = 'application/vnd.openxmlformats-officedocument.presentationml.';
  const types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + exts.map(e => '<Default Extension="' + e + '" ContentType="' + MIME[e] + '"/>').join('')
    + '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'slideLayout+xml"/>'
    + slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="' + CT + 'slide+xml"/>').join('')
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presProps+xml"/>'
    + '<Override PartName="/ppt/viewProps.xml" ContentType="' + CT + 'viewProps+xml"/>'
    + '<Override PartName="/ppt/tableStyles.xml" ContentType="' + CT + 'tableStyles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const rootRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="ppt/presentation.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/></Relationships>';
  const when = iso(o.date || Date.now());
  const core = XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
    + 'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + '<dc:title>' + xesc(meta.title || o.title || '') + '</dc:title>'
    + (meta.author.length ? '<dc:creator>' + xesc(meta.author.join('; ')) + '</dc:creator>' : '')
    + (meta.keywords.length ? '<cp:keywords>' + xesc(meta.keywords.join(', ')) + '</cp:keywords>' : '')
    + '<dcterms:created xsi:type="dcterms:W3CDTF">' + when + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + when + '</dcterms:modified></cp:coreProperties>';
  const app = XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>' + xesc(o.generator || 'EverPad') + '</Application><Slides>' + n + '</Slides></Properties>';
  const entries = [
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'ppt/presentation.xml', data: pres },
    { name: 'ppt/_rels/presentation.xml.rels', data: relsXml(presRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: masterXml() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]) },
    { name: 'ppt/theme/theme1.xml', data: themeXml(font) },
    { name: 'ppt/presProps.xml', data: XML_HEAD + '<p:presentationPr ' + NS + '/>' },
    { name: 'ppt/viewProps.xml', data: XML_HEAD + '<p:viewPr ' + NS + '/>' },
    { name: 'ppt/tableStyles.xml', data: XML_HEAD + '<a:tblStyleLst xmlns:a="' + NS_A + '" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>' },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app }
  ];
  slides.forEach((s, i) => {
    entries.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: s.xml });
    entries.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: relsXml(s.rels) });
  });
  for (const m of used) entries.push({ name: 'ppt/media/' + m.name, data: m.data });
  return writeZip(entries.map(e => ({ name: e.name, data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8') })), o.date ? new Date(o.date) : new Date());
}

module.exports = { toPptx, pptxImages, parseBox, SLIDE_W, SLIDE_H };
