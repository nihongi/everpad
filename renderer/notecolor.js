'use strict';
/* メモの色(設定の「メモの色」)。メモの欄(テキスト・プレビュー・履歴)の背景と文字の色を、
   明るい画面とダークモードで別々に持つ。それぞれ 標準(std)・白黒(bw)・カスタム(custom)。
   カスタムの文字色は 'auto'(背景の明るさに合わせて、標準の濃い文字か明るい文字)か '#rrggbb'。
   main.js からは require で(受け取った値を確かめて config.json に覚える)、画面からは <script> で読む(window.NoteColor)。 */
(function (root) {
  // 標準の色(styles.css の --surface と --fg と同じ)
  const STD = { light: { bg: '#fafbfe', fg: '#141b33' }, dark: { bg: '#131a33', fg: '#e3e9f8' } };
  const BW = { light: { bg: '#ffffff', fg: '#000000' }, dark: { bg: '#000000', fg: '#ffffff' } };
  const MODES = ['std', 'bw', 'custom'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const DEFAULTS = () => ({ light: { mode: 'std', bg: STD.light.bg, fg: 'auto' }, dark: { mode: 'std', bg: STD.dark.bg, fg: 'auto' } });

  // 受け取った値を、決まった形に直す(知らない値は既定に戻す)
  function sanitize(v) {
    const d = DEFAULTS(), out = {};
    for (const k of ['light', 'dark']) {
      const s = v && typeof v === 'object' && v[k] && typeof v[k] === 'object' ? v[k] : {};
      out[k] = {
        mode: MODES.includes(s.mode) ? s.mode : 'std',
        bg: typeof s.bg === 'string' && HEX.test(s.bg) ? s.bg.toLowerCase() : d[k].bg,
        fg: typeof s.fg === 'string' && HEX.test(s.fg) ? s.fg.toLowerCase() : 'auto'
      };
    }
    return out;
  }

  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  // WCAG の相対輝度とコントラスト比
  function luminance(h) {
    const [r, g, b] = rgb(h).map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // 暗い背景か(黒い文字より白い文字のほうが読みやすい)
  const isDark = bg => contrast(bg, '#ffffff') > contrast(bg, '#000000');

  /* いまの画面(light か dark)で使う色。標準なら null(styles.css の色のまま)。
     { bg, fg, dark: 背景が暗いか(メモの欄の配色をダーク用にするか) } */
  function resolve(prefs, scheme) {
    const k = scheme === 'dark' ? 'dark' : 'light';
    const c = sanitize(prefs)[k];
    if (c.mode === 'std') return null;
    if (c.mode === 'bw') return { bg: BW[k].bg, fg: BW[k].fg, dark: k === 'dark' };
    const dark = isDark(c.bg);
    return { bg: c.bg, fg: c.fg === 'auto' ? STD[dark ? 'dark' : 'light'].fg : c.fg, dark: dark };
  }
  // 設定の窓の見本に出す色(標準も含む)
  function sample(prefs, scheme) {
    const k = scheme === 'dark' ? 'dark' : 'light';
    return resolve(prefs, k) || { bg: STD[k].bg, fg: STD[k].fg, dark: k === 'dark' };
  }
  /* メモの欄に付ける CSS の変数。薄い字・枠線・コードの背景は、文字色と背景色を混ぜて作る */
  function cssVars(r) {
    const mix = p => 'color-mix(in srgb, ' + r.fg + ' ' + p + '%, ' + r.bg + ')';
    return { '--surface': r.bg, '--fg': r.fg, '--fg-2': mix(70), '--surface-2': mix(8), '--line': mix(20) };
  }

  const api = { STD, BW, DEFAULTS, sanitize, luminance, contrast, isDark, resolve, sample, cssVars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteColor = api;
})(typeof window !== 'undefined' ? window : this);
