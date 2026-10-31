'use strict';
/* 「Markdown の書き方」の画面(内容は help-content.js)。例ごとに、左に書き方、右に EverPad のプレビューでの表示(core.js の md で作る)を並べる。
   main.js が help.html?lang=ja|en&os=(process.platform) で開く。 */
(function () {
  const HELP = window.EVERPAD_HELP;
  const query = new URLSearchParams(location.search);
  const q = query.get('lang');
  const lang = HELP[q] ? q : 'ja';
  const H = HELP[lang];
  // Mac では、説明文のショートカットキーを Mac の書き方(⌘)にする(例の Markdown はそのまま)
  const keys = query.get('os') === 'darwin' ? macKeys : s => s;
  document.documentElement.lang = lang;
  document.title = H.title + ' - EverPad';
  const root = document.getElementById('help');
  let html = '<h1>' + esc(H.title) + '</h1><p class="intro">' + esc(keys(H.intro)) + '</p>';
  html += '<div class="diffs"><h2>' + esc(H.diffTitle) + '</h2><ul>' + H.diffs.map(d => '<li>' + esc(keys(d)) + '</li>').join('') + '</ul></div>';
  for (const sec of H.sections) {
    html += '<section><h2>' + esc(sec.h) + '</h2>' + (sec.note ? '<p class="explain">' + esc(keys(sec.note)) + '</p>' : '');
    html += '<div class="pair' + (sec.noRender ? ' single' : '') + '"><div class="col"><div class="lbl">' + esc(H.src) + '</div><pre class="src">' + esc(sec.src) + '</pre></div>';
    if (!sec.noRender) html += '<div class="col"><div class="lbl">' + esc(H.out) + '</div><div class="out md">' + md(sec.src) + '</div></div>';
    html += '</div></section>';
  }
  root.innerHTML = html;
  // Mermaid の図の例を図にする(ダークモードが変わったら描き直す)
  Diagrams.render(root).catch(() => {});
  Diagrams.onThemeChange(() => { Diagrams.render(root).catch(() => {}); });
  // リンクにマウスを重ねている間、行き先を左下に出す
  const box = document.getElementById('linkStatus');
  document.addEventListener('mouseover', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    const href = a && /^https?:/i.test(a.getAttribute('href')) ? a.getAttribute('href') : '';
    box.textContent = href;
    box.hidden = !href;
  });
  // 例のチェックボックスは押しても変わらないようにする(プレビューと同じ)
  root.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.disabled = true; });

})();
