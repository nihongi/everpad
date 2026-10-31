'use strict';
/* Mermaid の図。core.js の md が ```mermaid のコードブロックを <div class="diagram" data-src="元の文"> にし、ここで図(SVG)に置き換える。
   - mermaid.min.js(約5MB)は、図のあるメモを初めて表示したときに読み込む(起動を遅くしない)
   - securityLevel: 'strict'(クリックの動作やスクリプトを入れない)。画面の CSP でも、スクリプトの実行と接続はできない
   - ラベルは HTML でなく SVG の文字にする(htmlLabels: false)。速く、Word に書き出すときに PNG にできる
   - 配色は画面のダークモードに合わせる。印刷と書き出しは明るい配色(light: true)
   - 同じ図は作り直さず、作った SVG を使い回す(入力中や履歴の再生でちらつかない)。
     SVG の中の ID(スタイルや矢印の参照に使う)は、置くたびに新しくする(同じ図が2か所にあっても混ざらない)
   誤りのある図は、元の文を赤く出し、マウスを重ねると誤りの内容が出る。 */
(function () {
  const CACHE_MAX = 60;
  const cache = new Map();   // '配色\n元の文' → { svg, id } か { error }
  let loading = null, seq = 0, queue = Promise.resolve();
  const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };

  function load() {
    if (typeof mermaid !== 'undefined') return Promise.resolve(true);
    if (!loading) {
      loading = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = 'vendor/mermaid/mermaid.min.js';
        s.onload = () => resolve(typeof mermaid !== 'undefined');
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }
    return loading;
  }
  function config(theme) {
    return {
      startOnLoad: false, securityLevel: 'strict', theme: theme,
      htmlLabels: false, flowchart: { htmlLabels: false },
      fontFamily: getComputedStyle(document.body).fontFamily,
      maxTextSize: 50000, maxEdges: 500, suppressErrorRendering: true
    };
  }
  const newId = () => 'evdg' + (++seq) + 'x' + Math.random().toString(36).slice(2, 8);
  function remember(key, v) {
    cache.set(key, v);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  /* 図を作る。前の図ができるのを待ってから作る(配色の設定を図ごとに変えるため) */
  function draw(src, theme) {
    const key = theme + '\n' + src;
    const p = queue.then(async () => {
      if (cache.has(key)) return cache.get(key);
      const id = newId();
      let v;
      try {
        mermaid.initialize(config(theme));
        const r = await mermaid.render(id, src);
        v = { svg: r.svg, id: id };
      } catch (e) {
        v = { error: String((e && e.message) || e).trim().split('\n').slice(0, 4).join('\n') };
      }
      // 作るときに使った一時的な要素が残っていれば消す
      for (const x of [id, 'd' + id]) { const el = document.getElementById(x); if (el && !el.closest('.diagram')) el.remove(); }
      remember(key, v);
      return v;
    });
    queue = p.catch(() => {});
    return p;
  }
  function apply(el, v, theme) {
    el.dataset.theme = theme;
    if (v.svg) {
      el.classList.remove('diagram-error');
      el.removeAttribute('title');
      el.innerHTML = v.svg.split(v.id).join(newId());
    } else {
      el.classList.add('diagram-error');
      el.title = v.error || '';
      el.innerHTML = '<pre class="diagram-src"><code>' + esc(el.dataset.src) + '</code></pre>';
    }
  }
  const themeOf = opts => (opts && opts.light) || !darkMq.matches ? 'default' : 'dark';
  /* root の中の図を描く。描き終わるまで待てる(印刷と書き出しで使う)。opts.light: 明るい配色にする */
  async function render(root, opts) {
    if (!root) return;
    const els = [...root.querySelectorAll('.diagram[data-src]')];
    if (!els.length) return;
    const theme = themeOf(opts);
    const todo = [];
    for (const el of els) {
      if (el.dataset.theme === theme) continue;
      const v = cache.get(theme + '\n' + el.dataset.src);
      if (v) apply(el, v, theme); else todo.push(el);
    }
    if (!todo.length || !(await load())) return;
    for (const el of todo) {
      const v = await draw(el.dataset.src, theme);
      // 待つ間にダークモードが変わったら、新しい配色で描き直す側に任せる
      if (themeOf(opts) !== theme) return;
      apply(el, v, theme);
    }
  }
  /* SVG の図を PNG にする(Word に書き出すため)。{ png: base64, w, h }(w・h は画面の大きさ)。できなければ null */
  async function toPng(svgEl) {
    try {
      const vb = (svgEl.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const w = vb[2], h = vb[3];
      if (!(w > 0 && h > 0)) return null;
      const s = svgEl.cloneNode(true);
      s.setAttribute('width', w);
      s.setAttribute('height', h);
      s.removeAttribute('style');
      if (!s.getAttribute('xmlns')) s.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(s));
      });
      const scale = Math.max(0.1, Math.min(2, 8000 / w, 8000 / h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/png');
      return { png: url.slice(url.indexOf(',') + 1), w: Math.round(w), h: Math.round(h) };
    } catch (e) { return null; }
  }
  /* ダークモードが変わったら、出ている図を描き直す(印刷・書き出し用の明るい図はそのまま) */
  const listeners = [];
  if (darkMq.addEventListener) darkMq.addEventListener('change', () => listeners.forEach(f => f()));
  const onThemeChange = f => listeners.push(f);

  window.Diagrams = { render, toPng, onThemeChange };
})();
