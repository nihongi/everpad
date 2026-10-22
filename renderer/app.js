(function () {
  'use strict';
  const api = window.memoApi;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 言語 ----------
     main.js が index.html?lang=ja|en で渡す。固定の文言は、data-i18n* の付いた要素を置き換える */
  const qLang = new URLSearchParams(location.search).get('lang');
  const LANG = I18N.LANGS.includes(qLang) ? qLang : 'ja';
  const T = (key, params) => I18N.t(LANG, key, params);
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', T(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = T(el.dataset.i18nPh); });
  const shownTitle = title => title || T('untitled');   // 題名が無い(空の)メモの表示
  // 例: 20261006-175012-k3x9(日時順に並び、そのままファイル名になる)
  const uid = () => { const d = new Date(); return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0'); };
  const count = s => { let c = 0; for (const _ of s) c++; return c; };
  // 日付: 日本語は 2026年10月6日 / 2026/10/6、英語は Oct 6, 2026
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = d => (LANG === 'en' ? MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate());
  const fmtFull = t => {
    const d = new Date(t), hms = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    return LANG === 'en' ? fmtDate(d) + ' ' + hms : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hms;
  };
  const fmtShort = t => {
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return fmtDate(d);
  };

  const fmtMin = t => { const d = new Date(t); return fmtDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  const S = { notes: [], active: null, mode: 'edit', hbase: 'edit', rev: 0, playing: false, speed: 1, q: '', scope: 'latest', lines: false, frOpen: false };
  const cur = () => S.notes.find(n => n.id === S.active);
  const sorted = () => S.notes.slice().sort((a, b) => b.t - a.t);

  /* ---------- メモの読み込み ----------
     一覧に出すのは題名・更新時刻・版数だけ(起動時に保存先から受け取る)。
     履歴を含む中身は、開いたメモだけを読み込む。読み込んだメモは最近使った数件だけ覚え、古いものは手放す。 */
  const MAX_LOADED = 6;
  let useSeq = 0;
  const nOps = n => (n.loaded ? n.ops.length : n.n);
  function syncMeta(n) {
    n.n = n.ops.length;
    n.t = Math.max(n.ops.length ? n.ops[n.ops.length - 1].t : n.c, n.imported || 0);   // インポートしたメモは一覧の上に出す
    n.title = titleOf(n.text);
  }
  function unload(n) { delete n.ops; delete n.text; delete n._cp; n.loaded = false; }
  function evictOld() {
    // 書き込み待ちのメモや、書き込みに失敗しているときは手放さない(手元にしかない編集を失わないため)
    if (isPending() || saveError) return;
    const loaded = S.notes.filter(x => x.loaded);
    let over = loaded.length - MAX_LOADED;
    if (over <= 0) return;
    loaded.filter(x => x.id !== S.active).sort((a, b) => a.used - b.used).forEach(x => { if (over > 0) { unload(x); over--; } });
  }
  function ensureLoaded(id) {
    const n = S.notes.find(x => x.id === id);
    if (!n) return Promise.resolve(null);
    if (n.loaded) { n.used = ++useSeq; return Promise.resolve(n); }
    if (!n.loading) {
      n.loading = api.loadNote(id).then(r => {
        n.loading = null;
        if (!r) return null;
        n.ops = r.ops.map(o => ({ p: o[0], d: o[1], i: o[2], t: o[3] }));
        n.imported = r.imported || 0;
        n._cp = null;
        n.text = textAt(n, n.ops.length);
        n.loaded = true; n.used = ++useSeq;
        syncMeta(n);
        evictOld();
        return n;
      }).catch(() => { n.loading = null; return null; });
    }
    return n.loading;
  }

  /* ---------- ファイルへの保存 ----------
     編集は1回ごとに「まだ書いていない編集」へ積み、0.3秒ごとにまとめてファイルへ追記する。
     最新の本文(.md)は1.5秒ごとに書き直す。閉じる直前は同期で書き切る。 */
  const pendingOps = new Map(); // メモID -> まだ書いていない編集 [位置, 消した文字列, 入れた文字列, 時刻]
  const textDirty = new Set();  // 最新の本文(.md)をまだ書いていないメモ
  let saveError = false, writing = false, flushTimer = null, textTimer = null, chain = Promise.resolve();
  const isPending = () => pendingOps.size > 0 || textDirty.size > 0 || writing;

  function queueOp(n, op) {
    if (!pendingOps.has(n.id)) pendingOps.set(n.id, []);
    pendingOps.get(n.id).push([op.p, op.d, op.i, op.t]);
    textDirty.add(n.id);
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 300);
    clearTimeout(textTimer); textTimer = setTimeout(flushText, 1500);
    updateStatus();
  }

  function flush() {
    clearTimeout(flushTimer);
    chain = chain.then(async () => {
      writing = true;
      for (const [id, ops] of Array.from(pendingOps)) {
        pendingOps.delete(id);
        if (!S.notes.some(x => x.id === id)) continue; // 削除されたメモ
        let ok = false;
        try { ok = await api.append(id, ops); } catch (e) { ok = false; }
        if (!ok) {
          // 失敗した分は順番を保ったまま戻し、少し待って再試行する
          pendingOps.set(id, ops.concat(pendingOps.get(id) || []));
          saveError = true;
          clearTimeout(flushTimer); flushTimer = setTimeout(flush, 3000);
          break;
        }
        saveError = false;
      }
      writing = false;
      updateStatus();
    });
    return chain;
  }

  function flushText() {
    clearTimeout(textTimer);
    for (const id of Array.from(textDirty)) {
      textDirty.delete(id);
      const n = S.notes.find(x => x.id === id);
      if (!n) continue;
      // .mdは他のアプリで読むための控えなので、失敗しても履歴(.jsonl)の保存には影響しない
      api.saveText(id, n.text).catch(() => {});
    }
    updateStatus();
  }

  function flushSync() {
    clearTimeout(flushTimer); clearTimeout(textTimer);
    for (const [id, ops] of Array.from(pendingOps)) {
      let ok = false;
      try { ok = api.appendSync(id, ops); } catch (e) { ok = false; }
      if (ok) pendingOps.delete(id); else saveError = true;
    }
    for (const id of Array.from(textDirty)) {
      textDirty.delete(id);
      const n = S.notes.find(x => x.id === id);
      if (n) { try { api.saveTextSync(id, n.text); } catch (e) { /* 控えなので無視 */ } }
    }
  }

  function rememberActive() { try { localStorage.setItem('everpad:active', S.active); } catch (e) { /* 無くても動く */ } }

  function newNote() {
    const n = { id: uid(), c: Date.now(), ops: [], text: '', loaded: true, used: ++useSeq };
    syncMeta(n);
    return n;
  }

  /* ---------- 描画 ---------- */
  let listTimer = null;
  function renderListSoon() {   // 入力のたびに一覧全体を作り直さない
    if (listTimer) return;
    listTimer = setTimeout(() => { listTimer = null; renderList(); }, 250);
  }
  function renderList() {
    clearTimeout(listTimer); listTimer = null;
    const ul = $('noteList');
    ul.innerHTML = '';
    for (const n of sorted()) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'note';
      b.dataset.id = n.id;
      if (n.id === S.active) b.setAttribute('aria-current', 'true');
      b.innerHTML = '<span class="nt">' + esc(shownTitle(n.title)) + '</span><span class="nm">' + fmtShort(n.t) + T('sep') + T('versions', { n: n.n }) + '</span>';
      b.addEventListener('click', () => { select(n.id); closeSide(); });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }
  function updateTitle() { retitleRecent(cur()); const t = shownTitle(titleOf(cur().text)); $('docTitle').textContent = t; document.title = t + ' - EverPad'; }
  function updateStatus() {
    const n = cur();
    if (!n) return;
    // 履歴の表示中は、いま表示している版の本文で数える(タイムスライダーに合わせて変わる)
    const hist = S.mode === 'history' && S.histText != null;
    const text = hist ? S.histText : n.text;
    const st = textStats(text);   // 文字数は改行を含まない。行数は空のメモでも1行
    const total = hist
      ? { cls: 'st-total', text: T('statusAt', { k: S.rev, chars: st.chars, lines: st.lines }), title: T('statusAtTitle') }
      : { cls: 'st-total', text: T('status', { chars: st.chars, lines: st.lines, versions: n.ops.length }), title: T('statusTitle') };
    // カーソル・選択・全体を、見出し付きの別々のまとまりにして区切り線で分ける
    const parts = caretParts().concat(total);
    const box = $('stLeft');
    box.textContent = '';
    for (const p of parts) { const sp = document.createElement('span'); sp.className = p.cls; sp.textContent = p.text; sp.title = p.title; box.appendChild(sp); }
    $('stRight').textContent = saveError ? T('saveError') : isPending() ? T('saving') : T('saved');
  }
  /* 状態表示の左側に出す、カーソル位置(編集画面だけ)と選択の文字数。{ cls, text, title } の配列 */
  function caretParts() {
    const parts = [], ed = $('editor');
    let sel = '';
    if (S.mode === 'edit') sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    else {
      const ws = window.getSelection(), host = S.mode === 'preview' ? $('preview') : $('hvBody');
      if (ws && ws.rangeCount && !ws.isCollapsed && host.contains(ws.anchorNode) && host.contains(ws.focusNode)) sel = ws.toString();
    }
    if (S.mode === 'edit') parts.push({ cls: 'st-pos', text: T('cursorPos', cursorInfo(ed.value, ed.selectionDirection === 'backward' ? ed.selectionStart : ed.selectionEnd)), title: T('cursorTitle') });
    if (sel) { const si = selectionInfo(sel); parts.push({ cls: 'st-sel', text: T(si.lines > 1 ? 'selCharsLines' : 'selChars', si), title: T('selTitle') }); }
    return parts;
  }
  let caretTimer = 0;
  function queueStatus() { if (!caretTimer) caretTimer = setTimeout(() => { caretTimer = 0; updateStatus(); }, 30); }
  let toastTimer = null;
  function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); }

  /* ---------- 行番号 ----------
     折り返した行には番号を付けず、次の番号を実際の表示位置に合わせる。
     見えない複製に、本文と同じ幅・同じ書式で全行を並べて1行ずつの高さを測り、番号の高さにする。 */
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0;margin:0;padding:0;border:0;box-sizing:content-box;white-space:pre-wrap;';
  document.body.appendChild(mirror);
  let gutterRaf = 0;
  function queueGutter() { if (!S.lines || gutterRaf) return; gutterRaf = requestAnimationFrame(updateGutter); }
  function syncGutterScroll() { $('gin').style.transform = 'translateY(' + (-$('editor').scrollTop) + 'px)'; }
  function updateGutter() {
    gutterRaf = 0;
    const ta = $('editor');
    if (!S.lines || $('edwrap').hidden) return;
    const lines = ta.value.split('\n');
    // 桁数に合わせて番号欄の幅を決める(本文の幅が変わるので、幅を測るのはそのあと)
    $('edwrap').style.setProperty('--ln-w', 'calc(' + Math.max(2, String(lines.length).length) + 'ch + 22px)');
    if (!ta.clientWidth) return;
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight);
    mirror.style.font = cs.font;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize;
    mirror.style.overflowWrap = cs.overflowWrap;
    mirror.style.wordBreak = cs.wordBreak;
    mirror.style.width = (ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
    let out = '';
    if (lines.length > 20000 || !(lh > 0)) {
      for (let i = 1; i <= lines.length; i++) out += '<div>' + i + '</div>'; // 行が多すぎるときは折り返しを無視する
    } else {
      mirror.innerHTML = lines.map(l => '<div>' + (l ? esc(l) : '&#8203;') + '</div>').join('');
      const kids = mirror.children;
      for (let i = 0; i < lines.length; i++) {
        const h = kids[i].getBoundingClientRect().height;
        out += h > lh * 1.5 ? '<div style="height:' + h + 'px">' + (i + 1) + '</div>' : '<div>' + (i + 1) + '</div>';
      }
      mirror.innerHTML = '';
    }
    $('gin').innerHTML = out;
    syncGutterScroll();
  }
  function setLines(on, persist) {
    S.lines = !!on;
    $('edwrap').dataset.ln = S.lines ? '1' : '0';
    $('gutter').hidden = !S.lines;
    $('lnBtn').setAttribute('aria-pressed', String(S.lines));
    if (persist) { try { localStorage.setItem('everpad:lines', S.lines ? '1' : '0'); } catch (e) { /* 無くても動く */ } }
    if (S.lines) queueGutter();
    if (S.mode === 'history') renderHist();
  }
  $('lnBtn').addEventListener('click', () => setLines(!S.lines, true));
  $('editor').addEventListener('scroll', syncGutterScroll);
  $('editor').addEventListener('input', queueGutter);
  if (window.ResizeObserver) new ResizeObserver(queueGutter).observe($('editor'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueGutter);

  /* ---------- 編集 ---------- */
  let composing = false;
  function commit() {
    const n = cur(), v = $('editor').value;
    if (!n || v === n.text) return;
    n.ops.push(makeOp(n.text, v, Date.now()));
    n.text = v;
    syncMeta(n);
    queueOp(n, n.ops[n.ops.length - 1]);
    renderListSoon();
    updateTitle();
    if (S.q) scheduleSearch(2000);
  }
  $('editor').addEventListener('input', () => { if (!composing) commit(); });
  $('editor').addEventListener('compositionstart', () => { composing = true; });
  $('editor').addEventListener('compositionend', () => { composing = false; commit(); });

  /* ---------- 表示の切り替え ---------- */
  /* 表示は「編集」「プレビュー」の2つ。それぞれに、通常表示と履歴表示がある。
     S.mode は実際の画面(edit / preview / history)、S.hbase は履歴表示のときの元の画面(edit=変更箇所を示す文字、preview=整形した表示)。 */
  function setMode(m, focusEditor) {
    stop();
    const enteringHistory = m === 'history' && S.mode !== 'history';
    if (m !== 'history') S.hbase = m;
    S.mode = m;
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === S.hbase)));
    $('histBtn').setAttribute('aria-pressed', String(m === 'history'));
    $('edwrap').hidden = m !== 'edit';
    $('preview').hidden = m !== 'preview';
    $('histView').hidden = m !== 'history';
    $('tl').hidden = m !== 'history';
    if (typeof frShow === 'function') frShow();
    if (typeof updateStrip === 'function') updateStrip();
    $('attBtn').hidden = m !== 'edit';
    if (m === 'preview') { $('preview').innerHTML = md(cur().text) || '<p class="empty">' + esc(T('emptyNote')) + '</p>'; hydrate($('preview'), cur().id); highlight($('preview'), S.q); }
    if (m === 'history') { if (enteringHistory) S.rev = cur().ops.length; buildTimeline(); renderHist(); }
    if (m === 'edit') queueGutter();
    if (m === 'edit' && focusEditor) $('editor').focus({ preventScroll: true });
    queueStatus();
    sendUiState();
  }
  /* メニューの押せる・押せないのための画面の状態を main.js に送る */
  function sendUiState() {
    const back = typeof recent !== 'undefined' && recent.some(r => r.id !== S.active && S.notes.some(n => n.id === r.id));
    // 行番号が出るのは、編集画面と、編集から入った履歴の表示(変更箇所の表示)だけ
    const lines = S.mode === 'edit' || (S.mode === 'history' && S.hbase === 'edit');
    $('lnBtn').disabled = !lines;   // 右下の「行番号」ボタンも、メニューと同じく行番号が出る表示でだけ押せる
    api.setUiState({ edit: S.mode === 'edit', lines: lines, back: back });
  }
  // 「編集」「プレビュー」: 履歴表示の最中なら、履歴のまま(同じ版で)表示を切り替える
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
    if (S.mode === 'history') { stop(); S.hbase = b.dataset.mode; setMode('history'); }
    else setMode(b.dataset.mode, true);
  }));
  const toggleHistory = () => (S.mode === 'history' ? setMode(S.hbase, true) : setMode('history'));
  $('histBtn').addEventListener('click', toggleHistory);

  let selTok = 0;
  async function select(id) {
    const tok = ++selTok;
    const n = await ensureLoaded(id);
    if (tok !== selTok) return false;          // 読み込み中に別のメモが選ばれた
    if (!n) { toast(T('loadFailed')); return false; }
    show(id);
    return true;
  }
  function show(id) {
    stop();
    S.active = id;
    $('editor').value = cur().text;
    renderList();
    updateTitle();
    updateStatus();
    setMode(S.mode);
    rememberActive();
    touchRecent(cur());
    if (S.frOpen) frRefresh();
    evictOld();
  }

  /* ---------- 履歴ビュー ---------- */
  function buildTimeline() {
    const n = cur(), N = n.ops.length;
    const r = $('range');
    r.max = N;
    const g = $('gaps');
    g.innerHTML = '';
    for (let k = 1; k < N; k++) {
      if (n.ops[k].t - n.ops[k - 1].t > 30 * 60e3) {
        const i = document.createElement('i');
        i.style.left = 'calc(10px + (100% - 20px) * ' + (k / N) + ')';
        g.appendChild(i);
      }
    }
    $('tStart').textContent = N ? fmtFull(n.ops[0].t) : '';
    $('tEnd').textContent = N ? fmtFull(n.ops[N - 1].t) : '';
  }

  function renderHist() {
    const n = cur(), N = n.ops.length, k = Math.max(0, Math.min(N, S.rev));
    S.rev = k;
    const past = k !== N;
    const text = textAt(n, k);
    S.histText = text;   // 状態表示の「全体」に使う
    updateStatus();
    $('histView').dataset.past = past ? '1' : '0';
    $('tl').dataset.past = past ? '1' : '0';
    $('chip').textContent = past ? T('pastVersion') : T('latestVersion');
    $('revNo').textContent = T('revNo', { k: k, n: N });
    const op = k > 0 ? n.ops[k - 1] : null;
    $('when').textContent = op ? fmtFull(op.t) : (N ? T('initialEmpty') : '');
    $('delta').textContent = op ? [op.i ? T('charsAdded', { n: count(op.i) }) : '', op.d ? T('charsRemoved', { n: count(op.d) }) : ''].filter(Boolean).join(T('sep')) : '';

    const body = $('hvBody');
    if (!text && !(op && op.d)) {
      body.innerHTML = '<p class="empty">' + esc(T('emptyVersion')) + '</p>';
    } else if (S.hbase === 'preview') {
      body.innerHTML = '<div class="md">' + md(text) + '</div>';
      hydrate(body, cur().id);
      highlight(body, S.q);
    } else {
      const ranges = S.q ? matchRanges(text, S.q) : [];
      const lines = diffLines(text, op, ranges);
      if (S.lines) {
        const digits = Math.max(2, String(lines.length).length);
        body.innerHTML = '<div class="diff lined" style="--ln-w: calc(' + digits + 'ch + 36px)">' +
          lines.map((h, i) => '<div class="dl"><span class="n">' + (i + 1) + '</span><span class="t">' + (h || '&#8203;') + '</span></div>').join('') + '</div>';
      } else {
        body.innerHTML = '<pre class="diff">' + lines.join('\n') + '</pre>';
      }
      const target = body.querySelector('ins, del') || body.querySelector('mark');
      if (target) target.scrollIntoView({ block: 'nearest' });
    }
    const r = $('range');
    r.value = k;
    r.style.setProperty('--p', (N ? (k / N) * 100 : 0) + '%');
    $('restore').disabled = !past;
    $('bFirst').disabled = $('bPrev').disabled = k === 0;
    $('bLast').disabled = $('bNext').disabled = k === N;
    $('playIcon').innerHTML = S.playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M7 4.5v15l12-7.5z"/>';
    $('bPlay').title = S.playing ? T('pause') : T('play');
    $('bPlay').setAttribute('aria-label', S.playing ? T('pause') : T('play'));
    $('bPlay').disabled = N === 0;
  }

  let timer = null;
  function stop() { if (timer) { clearInterval(timer); timer = null; } if (S.playing) { S.playing = false; if (S.mode === 'history') renderHist(); } }
  function play() {
    const N = cur().ops.length;
    if (!N) return;
    if (S.rev >= N) S.rev = 0;
    S.playing = true;
    let pos = S.rev;   // ゆっくりの再生では1コマ未満ずつ進むので、小数で数えておく
    timer = setInterval(() => {
      pos = Math.min(N, pos + S.speed);
      const k = Math.floor(pos);
      if (k >= N) { clearInterval(timer); timer = null; S.playing = false; }
      else if (k === S.rev) return;
      S.rev = k;
      renderHist();
    }, 70);
    renderHist();
  }
  const go = k => { stop(); S.rev = k; renderHist(); };
  $('bFirst').addEventListener('click', () => go(0));
  $('bPrev').addEventListener('click', () => go(S.rev - 1));
  $('bNext').addEventListener('click', () => go(S.rev + 1));
  $('bLast').addEventListener('click', () => go(cur().ops.length));
  $('bPlay').addEventListener('click', () => (S.playing ? stop() : play()));
  $('range').addEventListener('input', e => go(+e.target.value));
  $('speed').addEventListener('change', e => { S.speed = +e.target.value; });
  $('restore').addEventListener('click', () => {
    const n = cur(), k = S.rev;
    const text = textAt(n, k);
    if (text !== n.text) { n.ops.push(makeOp(n.text, text, Date.now())); n.text = text; syncMeta(n); queueOp(n, n.ops[n.ops.length - 1]); }
    $('editor').value = n.text;
    renderList();
    updateTitle();
    setMode('edit', true);
    toast(T('restored', { k: k }));
  });
  document.addEventListener('keydown', e => {
    if (S.mode !== 'history' || !$('modal').hidden) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(S.rev - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(S.rev + 1); }
    else if (e.key === ' ') { e.preventDefault(); S.playing ? stop() : play(); }
  });

  /* ---------- 検索 ---------- */
  function highlight(root, q) {
    if (!q) return;
    const re = new RegExp(escRe(q), 'gi');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('.math') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const nd of nodes) {
      const t = nd.nodeValue;
      const rs = matchRanges(t, q);
      if (!rs.length) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const r of rs) {
        if (r.s > last) frag.append(t.slice(last, r.s));
        const mk = document.createElement('mark');
        mk.textContent = t.slice(r.s, r.e);
        frag.append(mk);
        last = r.e;
      }
      if (last < t.length) frag.append(t.slice(last));
      nd.replaceWith(frag);
    }
  }

  /* textareaの指定位置が見えるようにスクロールする(折り返しを含めた高さを別要素で測る) */
  function scrollTextareaTo(ta, idx) {
    const cs = getComputedStyle(ta);
    const m = document.createElement('div');
    m.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
    ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'paddingLeft', 'paddingRight'].forEach(p => { m.style[p] = cs[p]; });
    m.style.width = ta.clientWidth + 'px';
    m.textContent = ta.value.slice(0, idx);
    const mk = document.createElement('span');
    mk.textContent = '​';
    m.appendChild(mk);
    document.body.appendChild(m);
    const y = mk.offsetTop;
    document.body.removeChild(m);
    ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
  }

  function refreshView() {
    if (S.mode === 'preview') setMode('preview');
    else if (S.mode === 'history') renderHist();
  }

  async function openAt(id, opt) {
    const tok = ++selTok;
    const loaded = await ensureLoaded(id);
    if (tok !== selTok) return;
    if (!loaded) { toast(T('loadFailed')); return; }
    stop();
    S.active = id;
    $('editor').value = loaded.text;
    renderList();
    updateTitle();
    updateStatus();
    rememberActive();
    evictOld();
    if (opt.rev != null) {
      S.hbase = 'edit';   // 検索で見つかった箇所は、変更箇所を示す文字の表示で見せる
      setMode('history');
      S.rev = opt.rev;
      renderHist();
    } else {
      setMode('edit');
      const ed = $('editor');
      ed.focus({ preventScroll: true });
      ed.setSelectionRange(opt.s, opt.e);
      scrollTextareaTo(ed, opt.s);
    }
  }

  const HINTS = { latest: T('hintLatest'), history: T('hintHistory') };
  function updateHint() {
    $('hint').textContent = HINTS[S.scope];
    document.querySelectorAll('#scopeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === S.scope)));
  }

  /* 検索は100件(履歴まで探すときは20件)ずつに分けて進め、途中で検索語が変わったら打ち切る。
     開いていないメモは、必要な分だけ保存先から読み、覚えずに捨てる。 */
  let sTok = 0;
  const yieldUi = () => new Promise(r => setTimeout(r, 0));
  async function chunkLatest(part) {
    const need = part.filter(n => !n.loaded).map(n => n.id);
    const m = need.length ? ((await api.readTexts(need)) || {}) : {};
    return part.map(n => ({ id: n.id, text: n.loaded ? n.text : (m[n.id] || '') }));
  }
  async function chunkHistory(part) {
    const need = part.filter(n => !n.loaded).map(n => n.id);
    const got = need.length ? ((await api.loadNotes(need)) || []) : [];
    const byId = new Map(got.map(r => [r.id, { id: r.id, ops: r.ops.map(o => ({ p: o[0], d: o[1], i: o[2], t: o[3] })) }]));
    return part.map(n => (n.loaded ? n : (byId.get(n.id) || { id: n.id, ops: [] })));
  }
  function paintResults(q, hist, res, total, progress) {
    const shown = res.slice(0, 60);
    const matches = T('matches', { n: total, hist: hist });
    $('rhead').textContent = progress ? T('searching', { q: q, progress: progress }) + (total ? T('sep') + matches : '')
      : total === 0 ? T('notFound', { q: q })
      : T('found', { q: q, matches: matches }) + (total > shown.length ? T('sep') + T('showingFirst', { n: shown.length }) : '');
    const ul = $('resList');
    ul.innerHTML = '';
    for (const r of shown) {
      const n = S.notes.find(x => x.id === r.id);
      if (!n) continue;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hit';
      b.dataset.id = r.id;
      let meta = '';
      if (hist) {
        const range = r.a === r.b ? T('rangeOne', { a: r.a }) : T('rangeMany', { a: r.a, b: r.b });
        const when = fmtMin(r.addedAt) + (LANG === 'en' ? ' – ' : ' 〜 ') + (r.removedAt ? fmtMin(r.removedAt) : T('now'));
        const bd = r.b === nOps(n) ? '<span class="bd">' + esc(T('inLatest')) + '</span>' : '<span class="bd gone">' + esc(T('gone')) + '</span>';
        meta = '<span class="hm"><span>' + range + '</span><span>' + when + '</span>' + bd + '</span>';
      }
      b.innerHTML = '<span class="ht">' + esc(shownTitle(n.title)) + '</span><span class="hs">' + r.snippet + '</span>' + meta;
      b.addEventListener('click', () => { openAt(r.id, hist ? { rev: r.a } : { s: r.s, e: r.e }); closeSide(); });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  async function runSearch() {
    const q = $('q').value.trim();
    const had = S.q;
    S.q = q;
    const tok = ++sTok;
    $('qClear').hidden = !$('q').value;
    $('results').hidden = !q;
    $('noteList').hidden = !!q;
    if (!q) { if (had) refreshView(); return; }

    const notes = sorted();
    const hist = S.scope === 'history';
    const CH = hist ? 20 : 100;
    const res = [];
    let total = 0;
    for (let i = 0; i < notes.length; i += CH) {
      const part = notes.slice(i, i + CH);
      let objs;
      try { objs = hist ? await chunkHistory(part) : await chunkLatest(part); } catch (e) { objs = []; }
      if (tok !== sTok) return;                 // 検索語などが変わった
      const r = hist ? searchHistory(objs, q, 10) : searchLatest(objs, q, 10);
      res.push(...r.res); total += r.total;
      if (i + CH < notes.length) {
        paintResults(q, hist, res, total, T('searchProgress', { i: Math.min(i + CH, notes.length), n: notes.length }));
        await yieldUi();
        if (tok !== sTok) return;
      }
    }
    paintResults(q, hist, res, total, '');
    refreshView();
  }

  let qTimer = null;
  function scheduleSearch(ms) { clearTimeout(qTimer); qTimer = setTimeout(runSearch, ms); }
  let qComposing = false;
  $('q').addEventListener('input', () => { if (!qComposing) scheduleSearch(150); });
  $('q').addEventListener('compositionstart', () => { qComposing = true; });
  $('q').addEventListener('compositionend', () => { qComposing = false; scheduleSearch(0); });
  $('q').addEventListener('keydown', e => { if (e.key === 'Escape' && $('q').value) { $('q').value = ''; runSearch(); } });
  $('qClear').addEventListener('click', () => { $('q').value = ''; runSearch(); $('q').focus(); });
  document.querySelectorAll('#scopeSeg button').forEach(b => b.addEventListener('click', () => { S.scope = b.dataset.scope; updateHint(); runSearch(); }));
  updateHint();

  /* ---------- メモの追加・削除 ---------- */
  /* ファイルを作れたときだけメモを作る(同じ名前があれば作り直す) */
  async function makeNote() {
    for (let tries = 0; tries < 3; tries++) {
      const n = newNote();
      let ok = false;
      try { ok = await api.create(n.id, n.c); } catch (e) { ok = false; }
      if (ok) return n;
    }
    return null;
  }
  async function createNote() {
    const n = await makeNote();
    if (!n) { toast(T('createFailed')); return; }
    S.notes.push(n);
    S.mode = 'edit';
    await select(n.id);
    closeSide();
    $('editor').focus();
  }
  $('newBtn').addEventListener('click', createNote);
  $('delBtn').addEventListener('click', () => deleteNote(S.active));
  async function deleteNote(id) {
    const target = S.notes.find(n => n.id === id);
    if (!target) return;
    let yes = false;
    try { yes = await api.confirmTrash(T('confirmTrash', { title: shownTitle(target.loaded ? titleOf(target.text) : target.title) })); } catch (e) { yes = false; }
    if (!yes || !S.notes.includes(target)) return;
    if (id !== S.active) {
      // 開いていないメモ: 開いているメモはそのまま
      pendingOps.delete(id);
      textDirty.delete(id);
      await chain;
      let ok = false;
      try { ok = await api.remove(id); } catch (e) { ok = false; }
      if (!ok) { toast(T('deleteFailed')); return; }
      S.notes = S.notes.filter(n => n.id !== id);
      renderList();
      sendRecent();
      if (S.q) runSearch();
      toast(T(ok === 'folder' ? 'deletedToFolder' : 'deleted'));
      return;
    }
    // 次に開くメモを先に読み込んでおく(読めないときは何も消さない)
    let next = sorted().find(n => n.id !== id) || null;
    if (next && !(await ensureLoaded(next.id))) { toast(T('deleteAborted')); return; }
    if (S.active !== id) return;
    pendingOps.delete(id);
    textDirty.delete(id);
    await chain; // 書き込み中の分が終わるのを待つ
    let ok = false;
    try { ok = await api.remove(id); } catch (e) { ok = false; }
    if (!ok) { toast(T('deleteFailed')); return; }
    S.notes = S.notes.filter(n => n.id !== id);
    if (!next) { next = (await makeNote()) || newNote(); S.notes.push(next); }
    ++selTok;
    show(next.id);
    if (S.q) runSearch();
    toast(T(ok === 'folder' ? 'deletedToFolder' : 'deleted'));
  }

  /* ---------- 検索と置換(編集画面の上に出すバー) ---------- */
  const FR = { cs: false, word: false, re: false };
  try { Object.assign(FR, JSON.parse(localStorage.getItem('everpad:fr') || '{}')); } catch (e) { /* 無くても動く */ }
  const frBtns = { cs: 'frCase', word: 'frWord', re: 'frRe' };
  const frRegex = () => buildRe($('frFind').value, FR);
  function frShow() { $('frbar').hidden = !(S.frOpen && S.mode === 'edit'); queueGutter(); frPaintSoon(); }
  function frLabel(text, bad) { const c = $('frCount'); c.textContent = text; c.classList.toggle('bad', !!bad); }
  function frRefresh() {
    for (const k in frBtns) $(frBtns[k]).setAttribute('aria-pressed', String(!!FR[k]));
    const re = frRegex();
    if (!re) return frLabel('');
    if (re.error) return frLabel(T('badRegex'), true);
    const ed = $('editor'), all = findAll(ed.value, re);
    if (!all.length) return frLabel(T('noMatch'), true);
    const at = all.findIndex(x => x.s === ed.selectionStart && x.e === ed.selectionEnd);
    frLabel(at >= 0 ? T('matchAt', { at: at + 1, n: all.length }) : T('matchTotal', { n: all.length }));
  }
  /* 文字位置 pos が見える高さまでエディタをスクロールする(折り返しも見えない複製で測る) */
  function scrollToPos(pos) {
    const ta = $('editor'), cs = getComputedStyle(ta);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
    const lh = parseFloat(cs.lineHeight);
    if (!ta.clientWidth || !(lh > 0)) return;
    mirror.style.font = cs.font; mirror.style.lineHeight = cs.lineHeight; mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize; mirror.style.overflowWrap = cs.overflowWrap; mirror.style.wordBreak = cs.wordBreak;
    mirror.style.width = (ta.clientWidth - padL - padR) + 'px';
    mirror.textContent = ta.value.slice(0, pos);
    const mk = document.createElement('span');
    mk.textContent = '\u200b';
    mirror.appendChild(mk);
    const y = mk.offsetTop + padT;
    mirror.innerHTML = '';
    if (y < ta.scrollTop + lh || y + 2 * lh > ta.scrollTop + ta.clientHeight) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
  }
  /* 検索ボックスにフォーカスがあるとエディタの選択は見えなくなるので、同じ範囲を色付きで重ねて見せる */
  function frPaint() {
    const ta = $('editor'), layer = $('frhl'), inner = $('frhlin');
    inner.innerHTML = '';
    if (!S.frOpen || S.mode !== 'edit' || document.activeElement === ta || ta.selectionEnd <= ta.selectionStart || !ta.clientWidth) { layer.style.display = 'none'; return; }
    const cs = getComputedStyle(ta), padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
    mirror.style.font = cs.font; mirror.style.lineHeight = cs.lineHeight; mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize; mirror.style.overflowWrap = cs.overflowWrap; mirror.style.wordBreak = cs.wordBreak;
    mirror.style.width = (ta.clientWidth - padL - padR) + 'px';
    mirror.textContent = ta.value;
    const node = mirror.firstChild;
    if (!node) { layer.style.display = 'none'; return; }
    const range = document.createRange();
    range.setStart(node, ta.selectionStart); range.setEnd(node, ta.selectionEnd);
    const mr = mirror.getBoundingClientRect();
    let html = '';
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      html += '<i style="left:' + (r.left - mr.left + padL) + 'px;top:' + (r.top - mr.top + padT) + 'px;width:' + r.width + 'px;height:' + r.height + 'px"></i>';
    }
    mirror.innerHTML = '';
    layer.style.cssText = 'display:block;left:' + ta.offsetLeft + 'px;top:' + ta.offsetTop + 'px;width:' + ta.clientWidth + 'px;height:' + ta.clientHeight + 'px';
    inner.innerHTML = html;
    inner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }
  const frPaintSoon = () => setTimeout(frPaint, 0);
  $('editor').addEventListener('scroll', () => { if ($('frhl').style.display === 'block') $('frhlin').style.transform = 'translateY(' + (-$('editor').scrollTop) + 'px)'; });
  $('editor').addEventListener('focus', frPaintSoon);
  $('editor').addEventListener('blur', frPaintSoon);
  if (window.ResizeObserver) new ResizeObserver(frPaintSoon).observe($('editor'));

  /* 検索ボックスにいたまま、エディタの文字を選んで画面内に出す */
  function frSelect(s, e) {
    const ed = $('editor'), prev = document.activeElement;
    ed.focus();
    ed.setSelectionRange(s, e);
    scrollToPos(s);
    if (prev && prev !== ed && $('frbar').contains(prev)) prev.focus();
    frPaint();
  }
  /* 範囲 s〜e を str に置き換える。元に戻す(Ctrl+Z)が効くよう、エディタへの入力として行う */
  function frInsert(s, e, str) {
    const ed = $('editor'), prev = document.activeElement;
    ed.focus();
    ed.setSelectionRange(s, e);
    let ok = false;
    try { ok = str ? document.execCommand('insertText', false, str) : document.execCommand('delete'); } catch (err) { ok = false; }
    if (!ok || ed.value.slice(s, s + str.length) !== str) {
      ed.setSelectionRange(s, e);
      ed.setRangeText(str, s, e, 'end');
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (prev && prev !== ed && $('frbar').contains(prev)) prev.focus();
  }
  /* 選んだ行をまとめて引用・箇条書き・番号付き・コードブロックにする(すでにその書式なら外す)。
     1回の編集として履歴に残り、Ctrl+Z で戻せる。編集画面でだけ使える */
  function applyFormat(kind) {
    if (S.mode !== 'edit' || !$('modal').hidden) return;
    const ed = $('editor');
    const r = formatLines(ed.value, ed.selectionStart, ed.selectionEnd, kind);
    if (!r) return;
    if (ed.value.slice(r.from, r.to) !== r.insert) frInsert(r.from, r.to, r.insert);
    ed.focus();
    ed.setSelectionRange(r.selStart, r.selEnd);
    queueStatus();
  }
  function frGo(dir) {
    const re = frRegex();
    if (!re || re.error) { frRefresh(); return null; }
    const ed = $('editor');
    const r = findFrom(ed.value, re, dir >= 0 ? ed.selectionEnd : ed.selectionStart, dir);
    if (!r) { frLabel(T('noMatch'), true); return null; }
    frSelect(r.s, r.e);
    frLabel(T('matchAt', { at: r.index + 1, n: r.total }) + (r.wrapped ? T('wrapped') : ''));
    return r;
  }
  function frReplaceOne() {
    const re = frRegex();
    if (!re || re.error) { frRefresh(); return; }
    const ed = $('editor'), s = ed.selectionStart, e = ed.selectionEnd;
    const hit = e > s ? findAll(ed.value, re).find(x => x.s === s && x.e === e) : null;
    if (hit) frInsert(s, e, expandRepl($('frRepl').value, hit.m, FR.re));
    frGo(1);
  }
  function frReplaceAll() {
    const re = frRegex();
    if (!re || re.error) { frRefresh(); return; }
    const ed = $('editor'), t = ed.value;
    const r = replaceAllText(t, re, $('frRepl').value, FR.re);
    if (!r.count) { frLabel(T('noMatch'), true); return; }
    frInsert(r.first, r.last, r.text.slice(r.first, r.text.length - (t.length - r.last)));
    frRefresh();
    toast(T('replaced', { n: r.count }));
  }
  function frOpen() {
    if (S.mode !== 'edit') setMode('edit', false);
    S.frOpen = true;
    const ed = $('editor'), sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    if (sel && sel.length < 200 && sel.indexOf('\n') < 0) $('frFind').value = sel;
    frShow(); frRefresh();
    $('frFind').focus(); $('frFind').select();
  }
  function frClose() { S.frOpen = false; frShow(); if (S.mode === 'edit') $('editor').focus(); }
  for (const k in frBtns) $(frBtns[k]).addEventListener('click', () => {
    FR[k] = !FR[k];
    try { localStorage.setItem('everpad:fr', JSON.stringify(FR)); } catch (e) { /* 無くても動く */ }
    frRefresh();
  });
  $('frFind').addEventListener('input', frRefresh);
  $('frFind').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); frGo(e.shiftKey ? -1 : 1); } });
  $('frRepl').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); frReplaceOne(); } });
  $('frbar').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); frClose(); } });
  $('frNext').addEventListener('click', () => frGo(1));
  $('frPrev').addEventListener('click', () => frGo(-1));
  $('frOne').addEventListener('click', frReplaceOne);
  $('frAll').addEventListener('click', frReplaceAll);
  $('frClose').addEventListener('click', frClose);
  $('editor').addEventListener('input', () => { if (S.frOpen) setTimeout(() => { frRefresh(); frPaint(); }, 0); });
  document.addEventListener('keydown', e => {
    if (e.key === 'F3' && S.frOpen && S.mode === 'edit') { e.preventDefault(); frGo(e.shiftKey ? -1 : 1); }
  });

  /* ---------- 画像・添付ファイル ----------
     本文には ![名前](attach:ID)(画像)/ [名前](attach:ID)(ファイル)と書かれ、実体はメモごとのフォルダに残る。
     本文から消しても履歴には残るので、ファイルは削除しない。 */
  const MAX_ATTACH_MB = 50;
  const missingEl = alt => { const s = document.createElement('span'); s.className = 'att-missing'; s.textContent = T('imageMissing', { alt: alt }); return s; };
  function hydrate(root, noteId) {
    root.querySelectorAll('img[data-att]').forEach(img => {
      img.addEventListener('error', () => img.replaceWith(missingEl(img.alt)), { once: true });
      img.src = api.fileUrl(noteId, img.dataset.att);
    });
    root.querySelectorAll('a.note-link').forEach(a => {
      const n = S.notes.find(x => x.id === a.dataset.note);
      a.classList.toggle('missing', !n);
      a.removeAttribute('title');
      a.dataset.status = n ? T('linkStatusNote', { title: shownTitle(n.title) }) : T('linkStatusMissing');
    });
  }
  async function openAttachment(id) {
    let r = 'none';
    try { r = await api.attachOpen(S.active, id); } catch (e) { r = 'none'; }
    if (r === 'shown') toast(T('shownInFolder'));
    else if (r === 'missing') toast(T('fileMissing'));
  }
  /* リンクにマウスを重ねている間、行き先を左下に出す */
  const LINK_SEL = '#preview a, #hvBody a, #preview .link-other, #hvBody .link-other';
  function linkStatusText(el) {
    if (el.classList.contains('note-link')) return el.dataset.status || '';
    if (el.classList.contains('att-file')) return T('linkStatusAttach', { name: el.textContent });
    if (el.classList.contains('link-other')) { const t = el.dataset.target || ''; return t[0] === '#' ? t : T('linkStatusOther', { href: t }); }
    return el.getAttribute('href') || '';
  }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest(LINK_SEL);
    const box = $('linkStatus');
    const text = el ? linkStatusText(el) : '';
    box.textContent = text;
    box.hidden = !text;
  });
  document.addEventListener('scroll', () => { $('linkStatus').hidden = true; }, true);
  // EverPad では開けないリンク(相対パスなど): クリックしたら行き先を知らせる
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('#preview .link-other, #hvBody .link-other');
    if (!t) return;
    e.preventDefault();
    const target = t.dataset.target || '';
    if (target[0] === '#') {
      // 同じメモの中の見出しへ(GitHub と同じ規則で、見出しの文字からページ内リンクの名前を作って探す)
      let want = target.slice(1); try { want = decodeURIComponent(want); } catch (err) { /* そのまま */ }
      want = want.toLowerCase();
      const root = t.closest('#preview, #hvBody');
      const seen = {};
      const h = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(el => { const s = headingSlug(el.textContent); const k = seen[s] ? s + '-' + seen[s] : s; seen[s] = (seen[s] || 0) + 1; return k === want; });
      if (h) h.scrollIntoView({ block: 'start' }); else toast(T('linkUnsupported', { href: target }));
      return;
    }
    toast(T('linkUnsupported', { href: target }));
  });
  // メモへのリンク: プレビューと履歴の「Markdown表示」ではクリック、編集画面では Ctrl+クリックで移動する
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('#preview a.note-link, #hvBody a.note-link');
    if (!a) return;
    e.preventDefault();
    openNoteById(a.dataset.note, 'linkMissing');
  });
  $('editor').addEventListener('click', e => {
    if (!e.ctrlKey || S.mode !== 'edit') return;
    const id = noteLinkAt($('editor').value, $('editor').selectionStart);
    if (id) { e.preventDefault(); openNoteById(id, 'linkMissing'); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('#preview [data-att], #hvBody [data-att], #attStrip [data-att]');
    if (!t) return;
    e.preventDefault();
    openAttachment(t.dataset.att);
  });
  // 右クリック: 画像は「コピー・開く・場所を開く・名前をつけて保存」、ファイルは「開く・場所を開く」(左クリックはこれまでどおり開く)
  // 数式を右クリック: 元の LaTeX をコピーできる
  document.addEventListener('contextmenu', async e => {
    const m = e.target.closest && e.target.closest('#preview .math, #hvBody .math');
    if (!m || (window.getSelection().toString().trim() && !window.getSelection().isCollapsed)) return;
    e.preventDefault();
    let r = null;
    try { r = await api.mathMenu(m.dataset.tex || ''); } catch (err) { r = null; }
    if (r && r.status === 'copied') toast(T('texCopied'));
  });
  document.addEventListener('contextmenu', e => {
    const t = e.target.closest && e.target.closest('#preview [data-att], #hvBody [data-att], #attStrip [data-att]');
    if (!t) return;
    e.preventDefault();
    const chip = t.closest('.att-chip'), img = t.tagName === 'IMG' ? t : t.querySelector('img');
    const name = (chip && chip.dataset.name) || (img && img.alt) || t.title || t.textContent.trim();
    attachMenu(t.dataset.att, name, isImageName(t.dataset.att), e.clientX, e.clientY);
  });
  async function attachMenu(fileId, name, image, x, y) {
    let r = null;
    try { r = await api.attachMenu(S.active, fileId, name, image, x, y); } catch (err) { r = null; }
    const st = r && r.status;
    if (st === 'missing') toast(T('fileMissing'));
    else if (st === 'copied') toast(T('imageCopied'));
    else if (st === 'copyFailed') toast(T('imageCopyFailed'));
    else if (st === 'saved') toast(T('attSaved', { path: r.path }));
    else if (st === 'saveFailed') toast(T('attSaveFailed'));
    else if (st === 'shown') toast(T('shownInFolder'));
  }
  /* 編集画面の下に、いまの本文で使っている添付を並べる */
  let stripSig = '';
  function updateStrip() {
    const strip = $('attStrip');
    const refs = S.mode === 'edit' && cur() ? attachRefs(cur().text) : [];
    const sig = S.active + '|' + refs.map(r => r.id + r.name).join(',');
    strip.hidden = !refs.length;
    if (sig === stripSig) return;
    stripSig = sig;
    strip.innerHTML = '';
    for (const r of refs) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'att-chip'; b.dataset.att = r.id; b.dataset.name = r.name; b.title = T('clickToOpen', { name: r.name });
      if (r.image) { const im = document.createElement('img'); im.dataset.att = r.id; im.alt = r.name; b.appendChild(im); }
      else b.insertAdjacentHTML('beforeend', '<span class="att-ico" aria-hidden="true">📎</span>');
      const sp = document.createElement('span'); sp.textContent = r.name; b.appendChild(sp);
      strip.appendChild(b);
    }
    hydrate(strip, S.active);
  }
  let stripTimer = 0;
  $('editor').addEventListener('input', () => { clearTimeout(stripTimer); stripTimer = setTimeout(updateStrip, 250); });

  const extOfType = t => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }[t] || 'png');
  const stamp = () => { const d = new Date(); return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };
  /* 取り込んだ添付を、カーソルの位置に書く。表の行の中なら横に並べて、表を壊さない */
  function insertAttachments(items) {
    if (!items.length) return;
    const ed = $('editor');
    const s = ed.selectionStart, e = ed.selectionEnd;
    const ls = ed.value.lastIndexOf('\n', s - 1) + 1;
    const inTable = /^\s*\|/.test(ed.value.slice(ls, ed.value.indexOf('\n', s) < 0 ? undefined : ed.value.indexOf('\n', s)));
    const text = items.map(i => attachMarkup(i.name, i.fileId, i.image)).join(inTable ? ' ' : '\n');
    frInsert(s, e, text);
    ed.focus();
    toast(T('itemsAdded', { n: items.length, images: items.every(i => i.image) }));
    updateStrip();
  }
  function reportErrors(errors) { if (errors.length) toast(errors[0] + (errors.length > 1 ? T('moreErrors', { n: errors.length - 1 }) : '')); }
  async function ingestFiles(files) {
    if (S.mode !== 'edit') { toast(T('attachEditOnly')); return; }
    const noteId = S.active, items = [], errors = [];
    for (const f of files) {
      if (f.size > MAX_ATTACH_MB * 1024 * 1024) { errors.push(T('tooLarge', { name: f.name || T('file'), mb: MAX_ATTACH_MB })); continue; }
      const name = f.name && !/^image\.\w+$/i.test(f.name) ? f.name : T('imageName') + '-' + stamp() + '.' + extOfType(f.type);
      try {
        const r = await api.attachSave(noteId, name, await f.arrayBuffer());
        items.push(...r.items); errors.push(...r.errors);
      } catch (err) { errors.push(T('saveFailed', { name: name })); }
    }
    if (S.active !== noteId) { toast(T('pasteAborted')); return; }
    insertAttachments(items);
    reportErrors(errors);
  }
  async function pickAttachments() {
    if (S.mode !== 'edit') setMode('edit', false);
    const noteId = S.active;
    let r;
    try { r = await api.attachPick(noteId); } catch (err) { r = { items: [], errors: [T('attachFailed')] }; }
    if (S.active === noteId) insertAttachments(r.items);
    reportErrors(r.errors);
  }
  $('attBtn').addEventListener('click', pickAttachments);
  // 貼り付け: 画像やコピーしたファイル。文字も一緒にあるとき(表計算などからのコピー)は、文字をそのまま貼る
  $('editor').addEventListener('paste', e => {
    const cd = e.clipboardData;
    if (!cd || !cd.files || !cd.files.length || cd.getData('text/plain')) return;
    e.preventDefault();
    ingestFiles([...cd.files]);
  });
  // ドラッグ&ドロップ(ウィンドウのどこでも。ファイルを落としてもページが切り替わらないようにする)
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    ingestFiles([...e.dataTransfer.files]);
  });

  /* ---------- サイドバー(狭い画面) ---------- */
  const narrow = () => window.matchMedia('(max-width: 759px)').matches;
  const openSide = () => { $('app').dataset.side = 'open'; };
  const closeSide = () => { $('app').dataset.side = 'closed'; };
  /* 広い画面: 左側を畳む/広げる(設定は次回も使う)。狭い画面: 引き出しとして開閉 */
  function setCollapsed(c, persist) {
    $('app').dataset.collapsed = c ? '1' : '0';
    $('menuBtn').setAttribute('aria-pressed', String(!c));
    if (persist) { try { localStorage.setItem('everpad:side', c ? 'hidden' : 'shown'); } catch (e) { /* 無くても動く */ } }
    queueGutter();
  }
  const showSide = () => { if (narrow()) openSide(); else setCollapsed(false, true); };
  function toggleSide() {
    if (narrow()) { if ($('app').dataset.side === 'open') closeSide(); else openSide(); }
    else setCollapsed($('app').dataset.collapsed !== '1', true);
  }
  $('menuBtn').addEventListener('click', toggleSide);
  $('scrim').addEventListener('click', closeSide);

  /* ---------- すべて選択 ----------
     入力欄ではその中身を、プレビュー・履歴表示ではメモの本文だけを選ぶ(サイドバーやボタンまでは選ばない)。 */
  function selectAllScoped() {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|)$/.test(a.type)))) { a.select(); return; }
    const root = S.mode === 'preview' ? $('preview') : S.mode === 'history' ? $('hvBody') : null;
    if (!root) { $('editor').focus(); $('editor').select(); return; }
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(root);
    sel.removeAllRanges(); sel.addRange(r);
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAllScoped(); }
  });

  /* ---------- メニュー・終了時の保存 ---------- */
  api.onMenu(name => {
    if (name === 'new') createNote();
    else if (name === 'selectall') selectAllScoped();
    else if (name === 'lines') setLines(!S.lines, true);
    else if (name === 'replace') frOpen();
    else if (name === 'attach') pickAttachments();
    else if (name === 'side') toggleSide();
    else if (name === 'search') { showSide(); $('q').focus(); $('q').select(); }
    else if (name === 'mode:history') toggleHistory();
    else if (name.indexOf('fmt:') === 0) applyFormat(name.slice(4));
    else if (name.indexOf('open:') === 0) openNoteById(name.slice(5), 'noteDeleted');
    else if (name === 'back') goBack();
    else if (name === 'recent:clear') clearRecent();
    else if (name === 'link') pickNoteLink();
    else if (name === 'props') showProps();
    else if (name === 'export') exportNote();
    else if (name === 'archive') exportArchive();
    else if (name === 'print') printNote('print');
    else if (name === 'pdf') printNote('pdf');
    else if (name.indexOf('mode:') === 0) { if (S.mode === 'history') { stop(); S.hbase = name.slice(5); setMode('history'); } else setMode(name.slice(5), true); }
  });
  /* ---------- 印刷・PDF ----------
     いまのメモを、プレビューと同じ整形した見た目で出す。履歴表示中は、見ている版を出す。
     ページの上に題名と最終編集の日時、下に印刷(作成)の日時とページ番号を入れる。 */
  const cssStr = v => '"' + String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  let printing = false;
  async function printNote(kind, target) {
    const n = target || cur();
    if (!n || printing) return;
    printing = true;
    const N = n.ops.length, k = !target && S.mode === 'history' ? Math.max(0, Math.min(N, S.rev)) : N;
    const text = k === N ? n.text : textAt(n, k);
    const op = k > 0 ? n.ops[k - 1] : null;
    const title = shownTitle(titleOf(text));
    const area = $('printArea');
    area.innerHTML = '<div class="md">' + md(text) + '</div>';
    hydrate(area, n.id);
    const edited = (op ? T('printEdited', { when: fmtFull(op.t) }) : '') + (k !== N ? T('sep') + T('revNo', { k: k, n: N }) : '');
    const stampText = T(kind === 'pdf' ? 'printCreated' : 'printPrinted', { when: fmtFull(Date.now()) });
    const box = 'font-family: ' + getComputedStyle(document.body).fontFamily.replace(/[;{}]/g, '') + '; font-size: 8.5pt; color: #4A5468;';
    $('printPage').textContent = '@page { margin: 18mm 16mm; background: #fff;'
      + ' @top-left { content: ' + cssStr(title) + '; ' + box + ' }'
      + ' @top-right { content: ' + cssStr(edited) + '; ' + box + ' }'
      + ' @bottom-left { content: ' + cssStr(stampText) + '; ' + box + ' }'
      + ' @bottom-right { content: counter(page) " / " counter(pages); ' + box + ' } }';
    // 添付の画像が読み込まれるのを待つ(最長3秒)
    await Promise.race([
      Promise.all([...area.querySelectorAll('img')].map(img => (img.complete ? null : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); })))),
      new Promise(r => setTimeout(r, 3000))
    ]);
    try {
      if (kind === 'pdf') {
        const r = await api.savePdf(title);
        if (r && r.status === 'saved') toast(T('pdfSaved', { path: r.path }));
        else if (r && r.status === 'failed') toast(T('pdfFailed'));
      } else {
        const r = await api.print();
        if (r === 'failed') toast(T('printFailed'));
      }
    } catch (e) {
      toast(T(kind === 'pdf' ? 'pdfFailed' : 'printFailed'));
    } finally {
      area.innerHTML = '';
      $('printPage').textContent = '';
      printing = false;
    }
  }
  /* ---------- 画面の上に出す小さな窓 ---------- */
  let modalBack = null;
  function openModal(title, body) {
    modalBack = document.activeElement;
    $('modalTitle').textContent = title;
    const b = $('modalBody'); b.textContent = ''; b.appendChild(body);
    $('modal').hidden = false;
    $('modalClose').focus();
  }
  function closeModal() {
    if ($('modal').hidden) return;
    $('modal').hidden = true;
    $('modalBody').textContent = '';
    if (modalBack && modalBack.focus) modalBack.focus({ preventScroll: true });
  }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) { e.preventDefault(); e.stopPropagation(); closeModal(); } }, true);
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const fmtSize = b => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

  /* ---------- プロパティ: いま開いているメモの情報と、実体のファイル ---------- */
  async function showProps(target) {
    const n = target || cur();
    if (!n) return;
    // 書き込み待ちの編集と本文(.md)を先に書き出して、ファイルの大きさを最新にする
    await flush();
    if (textDirty.has(n.id)) { textDirty.delete(n.id); try { await api.saveText(n.id, n.text); } catch (e) { /* .md は控え */ } }
    let info = null;
    try { info = await api.noteInfo(n.id); } catch (e) { info = null; }
    if (!info || !S.notes.includes(n) || (!target && cur() !== n)) return;
    const t = el('table', 'props');
    const row = (label, ...cells) => { const tr = el('tr'); tr.appendChild(el('th', '', label)); const td = el('td'); cells.forEach(c => td.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); tr.appendChild(td); t.appendChild(tr); };
    const fileCell = (p, sub, kind, exists) => {
      const box = el('div');
      box.appendChild(el('div', 'path', p));
      if (sub) box.appendChild(el('div', 'sub', sub));
      if (exists) {
        const acts = el('div', 'acts');
        const reveal = el('button', 'btn', T('propReveal')); reveal.type = 'button'; reveal.addEventListener('click', () => api.revealNote(n.id, kind));
        const copy = el('button', 'btn', T('propCopy')); copy.type = 'button'; copy.addEventListener('click', async () => { try { await api.copyText(p); toast(T('propCopied')); } catch (e) { /* 何もしない */ } });
        acts.append(reveal, copy); box.appendChild(acts);
      }
      return box;
    };
    const stats = textStats(n.text);
    row(T('propName'), shownTitle(titleOf(n.text)));
    row(T('propId'), el('span', 'path', n.id));
    row(T('propCreated'), fmtFull(n.c));
    row(T('propEdited'), fmtFull(n.ops.length ? n.ops[n.ops.length - 1].t : n.c));
    if (n.imported) row(T('propImported'), fmtFull(n.imported));
    row(T('propVersions'), String(n.ops.length));
    row(T('propChars'), stats.chars.toLocaleString('en-US'));
    row(T('propWords'), stats.words.toLocaleString('en-US'));
    row(T('propLines'), stats.lines.toLocaleString('en-US'));
    row(T('propJsonl'), fileCell(info.jsonl.path, info.jsonl.size != null ? fmtSize(info.jsonl.size) : T('propNotYet'), 'jsonl', info.jsonl.size != null));
    row(T('propMd'), fileCell(info.md.path, info.md.size != null ? fmtSize(info.md.size) : T('propNotYet'), 'md', info.md.size != null));
    if (info.files.exists) row(T('propFiles'), fileCell(info.files.path, T('propFilesVal', { n: info.files.count, size: fmtSize(info.files.total) }), 'files', true));
    else row(T('propFiles'), T('propNone'));
    const linkRow = el('div', 'acts');
    const copyLink = el('button', 'btn', T('propCopyLink')); copyLink.type = 'button';
    copyLink.addEventListener('click', async () => { try { await api.copyText('[' + (linkText(shownTitle(titleOf(n.text))) || n.id) + '](note:' + n.id + ')'); toast(T('linkCopied')); } catch (e) { /* 何もしない */ } });
    linkRow.appendChild(copyLink);
    const body = el('div'); body.append(t, linkRow);
    openModal(T('propTitle'), body);
  }

  /* ---------- 左の一覧(と検索結果)の右クリックメニュー ----------
     今開いているメモとは関係なく、右クリックしたメモに対して操作する。メニューを開いている間は、その行に枠を付ける。
     アプリケーションキー(Shift+F10)でも出る(フォーカスのある行が対象) */
  document.addEventListener('contextmenu', async e => {
    const row = e.target.closest && e.target.closest('#noteList .note[data-id], #resList .hit[data-id]');
    if (!row) return;
    e.preventDefault();
    const id = row.dataset.id, n = S.notes.find(x => x.id === id);
    if (!n) return;
    document.querySelectorAll('.ctx-target').forEach(x => x.classList.remove('ctx-target'));
    row.classList.add('ctx-target');
    let action = null;
    try { action = await api.noteMenu(shownTitle(n.loaded ? titleOf(n.text) : n.title)); } catch (err) { action = null; }
    row.classList.remove('ctx-target');
    if (action) noteAction(action, id);
  });
  async function noteAction(action, id) {
    if (action === 'open') { openNoteById(id, 'noteDeleted'); return; }
    if (action === 'delete') { deleteNote(id); return; }
    if (action === 'copyLink') {
      const n = S.notes.find(x => x.id === id);
      if (!n) return;
      try { await api.copyText('[' + (linkText(shownTitle(n.loaded ? titleOf(n.text) : n.title)) || id) + '](note:' + id + ')'); toast(T('linkCopied')); } catch (err) { /* 何もしない */ }
      return;
    }
    // プロパティ・エクスポートは中身が要るので、開いていないメモは読み込む(最近見たメモには記録しない)
    const n = await ensureLoaded(id);
    if (!n) { toast(T('loadFailed')); return; }
    if (action === 'props') showProps(n);
    else if (action === 'exportText') exportNote(n);
    else if (action === 'exportPdf') printNote('pdf', n);
    else if (action === 'exportArchive') exportArchive(n);
  }

  /* ---------- 最近見たメモ ----------
     保存先ごとに localStorage に控える(題名も控えるので、削除したメモも一覧に出せる)。
     今のメモを除いた最大10件を main.js に送り、「ファイル」→「最近見たメモ」を作ってもらう */
  const RECENT_MAX = 11;   // 今のメモ + 10件
  let recent = [];
  const recentKey = () => 'everpad:recent:' + S.dir;
  function loadRecent() {
    try { recent = (JSON.parse(localStorage.getItem(recentKey()) || '[]') || []).filter(r => r && typeof r.id === 'string').slice(0, RECENT_MAX); } catch (e) { recent = []; }
  }
  function saveRecent() { try { localStorage.setItem(recentKey(), JSON.stringify(recent)); } catch (e) { /* 控えられなくても動く */ } }
  function sendRecent() {
    sendUiState();
    api.setRecent(recent.filter(r => r.id !== S.active).slice(0, 10).map(r => ({ id: r.id, title: shownTitle(r.title), deleted: !S.notes.some(n => n.id === r.id) })));
  }
  function touchRecent(n) { if (!n) return; recent = pushRecent(recent, n.id, titleOf(n.text), RECENT_MAX); saveRecent(); sendRecent(); }
  function retitleRecent(n) {
    const r = n && recent.find(x => x.id === n.id), t = n && titleOf(n.text);
    if (r && r.title !== t) { r.title = t; saveRecent(); }
  }
  function clearRecent() { recent = recent.filter(r => r.id === S.active); saveRecent(); sendRecent(); }
  /* メモを開く(最近見たメモ・リンク・戻る)。削除されていれば知らせる */
  async function openNoteById(id, missingKey) {
    if (!S.notes.some(n => n.id === id)) { toast(T(missingKey)); return; }
    if (id === S.active) return;
    if (S.mode === 'history') { stop(); S.mode = S.hbase; }
    closeModal();
    await select(id);
    closeSide();
  }
  // 前に見たメモ(最近見たメモの、今のメモの次)。続けて使うと、2つのメモを行き来する
  function goBack() { const r = recent.find(x => x.id !== S.active); if (r) openNoteById(r.id, 'noteDeleted'); }

  /* ---------- メモへのリンクを挿入する ----------
     題名で絞り込める一覧から選ぶと、カーソルの位置に [題名](note:メモID) を書く(1回の編集) */
  function pickNoteLink() {
    if (!cur()) return;
    if (S.mode !== 'edit') setMode('edit', false);
    const ed = $('editor'), selS = ed.selectionStart, selE = ed.selectionEnd;
    const box = el('div', 'linkpick');
    const input = el('input'); input.type = 'search'; input.placeholder = T('linkFilter'); input.setAttribute('aria-label', T('linkFilter'));
    const ul = el('ul'); ul.setAttribute('role', 'listbox');
    box.append(input, ul);
    let shown = [], at = 0;
    const choose = n => {
      closeModal();
      const text = '[' + (linkText(shownTitle(n.title)) || n.id) + '](note:' + n.id + ')';
      frInsert(selS, selE, text);
      ed.focus();
      ed.setSelectionRange(selS + text.length, selS + text.length);
    };
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      shown = sorted().filter(n => n.id !== S.active && (!q || shownTitle(n.title).toLowerCase().includes(q))).slice(0, 200);
      at = Math.min(at, Math.max(0, shown.length - 1));
      ul.textContent = '';
      if (!shown.length) { ul.appendChild(el('li', 'none', T('linkNoMatch'))); return; }
      shown.forEach((n, i) => {
        const li = el('li'), b = el('button'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === at));
        b.append(el('span', 'lt', shownTitle(n.title)), el('span', 'lm', fmtShort(n.t) + T('sep') + T('versions', { n: n.n })));
        b.addEventListener('click', () => choose(n));
        li.appendChild(b); ul.appendChild(li);
      });
      const sel = ul.querySelector('[aria-selected="true"]'); if (sel) sel.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { at = 0; paint(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, shown.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) choose(shown[at]); }
    });
    paint();
    openModal(T('linkPickTitle'), box);
    input.focus();
  }

  /* ---------- テキストの取り込み・書き出し ----------
     取り込み: main.js が読んで文字コードを見分けたテキストを、1ファイル1つの新しいメモにする(最初の行が題名)。
     読めなかったファイルは、まとめて一覧で知らせる。 */
  api.onImport(async items => {
    const bad = items.filter(i => !i.ok).map(i => ({ name: i.name, message: i.message }));
    let last = null, made = 0, lastItem = null;
    let lastArc = null;
    for (const it of items.filter(i => i.ok)) {
      if (it.kind === 'archive') {
        const n = await adoptNote(it.id);
        if (!n) { bad.push({ name: it.name, message: T('loadFailed') }); continue; }
        last = n; lastItem = it; lastArc = n; made++;
        continue;
      }
      const n = await makeNote();
      if (!n) { bad.push({ name: it.name, message: T('createFailed') }); continue; }
      if (it.text) { const op = makeOp('', it.text, Date.now()); n.ops.push(op); n.text = it.text; syncMeta(n); queueOp(n, op); }
      S.notes.push(n);
      last = n; lastItem = it; made++;
    }
    if (last) {
      closeModal();
      if (S.mode === 'history') stop();
      S.mode = 'edit';
      await select(last.id);
      flush();
    }
    if (bad.length) {
      const box = el('div');
      box.appendChild(el('p', 'lead', T('impErrSummary', { ok: made, bad: bad.length })));
      const ul = el('ul', 'implist');
      for (const b of bad) { const li = el('li'); li.appendChild(el('div', 'fname', b.name)); li.appendChild(el('div', 'why', b.message)); ul.appendChild(li); }
      box.appendChild(ul);
      openModal(T('impErrTitle'), box);
    } else if (made === 1 && lastArc) toast(T(lastItem.replaced ? 'arcReplaced' : 'arcDone', { title: shownTitle(lastArc.title) }));
    else if (made === 1) toast(T('impDone', { name: lastItem.name, enc: lastItem.encoding }));
    else if (made > 1) toast(T('impDoneN', { n: made }));
  });
  /* main.js が保存先に書いたメモを読み込み、一覧に入れる(同じ ID が既にあれば、中身を差し替える) */
  async function adoptNote(id) {
    let r = null;
    try { r = await api.loadNote(id); } catch (e) { r = null; }
    if (!r) return null;
    let n = S.notes.find(x => x.id === id);
    if (!n) { n = { id: id }; S.notes.push(n); }
    pendingOps.delete(id); textDirty.delete(id);
    n.c = r.c; n.imported = r.imported || 0;
    n.ops = r.ops.map(o => ({ p: o[0], d: o[1], i: o[2], t: o[3] }));
    n._cp = null;
    n.text = textAt(n, n.ops.length);
    n.loaded = true; n.used = ++useSeq;
    syncMeta(n);
    if (n.id === S.active) { $('editor').value = n.text; }
    return n;
  }
  // EverPad アーカイブとしてエクスポート: 書き込み待ちの編集と本文を先に書き出してから、main.js にまとめてもらう
  async function exportArchive(target) {
    const n = target || cur();
    if (!n) return;
    await flush();
    if (textDirty.has(n.id)) { textDirty.delete(n.id); try { await api.saveText(n.id, n.text); } catch (e) { /* .md は控え */ } }
    let r = null;
    try { r = await api.exportArchive(n.id, shownTitle(titleOf(n.text))); } catch (e) { r = { status: 'failed' }; }
    if (r && r.status === 'saved') toast(T('arcExported', { path: r.path }));
    else if (r && r.status === 'failed') toast(T('arcExportFailed'));
  }
  // 書き出し: いまのメモを(履歴の表示中は見ている版を)テキストファイルにする
  async function exportNote(target) {
    const n = target || cur();
    if (!n) return;
    const N = n.ops.length, k = !target && S.mode === 'history' ? Math.max(0, Math.min(N, S.rev)) : N;
    const text = k === N ? n.text : textAt(n, k);
    let r = null;
    try { r = await api.exportText(shownTitle(titleOf(text)), text); } catch (e) { r = { status: 'failed' }; }
    if (r && r.status === 'saved') toast(T('expDone', { path: r.path }));
    else if (r && r.status === 'failed') toast(T('expFailed'));
  }

  api.onFlushRequest(() => { flushSync(); api.flushed(); });
  window.addEventListener('pagehide', flushSync);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  $('openDirBtn').addEventListener('click', () => api.openFolder());
  document.addEventListener('selectionchange', queueStatus);
  ['keydown', 'keyup', 'mouseup', 'select', 'focus'].forEach(ev => $('editor').addEventListener(ev, queueStatus));

  /* ---------- 画面を読み直すとき(言語の切り替え)に、表示の状態を引き継ぐ ----------
     読み直す直前に sessionStorage へ預け、読み直した直後に1回だけ戻す。
     sessionStorage はアプリを閉じると消えるので、ふつうの起動には影響しない。 */
  const VIEW_KEY = 'everpad:view';
  function saveView() {
    if (!cur()) return;
    const ed = $('editor'), fe = document.activeElement;
    const v = {
      mode: S.mode, hbase: S.hbase, rev: S.rev, speed: S.speed,
      q: $('q').value, scope: S.scope,
      frOpen: S.frOpen, frFind: $('frFind').value, frRepl: $('frRepl').value,
      selS: ed.selectionStart, selE: ed.selectionEnd,
      scroll: { editor: ed.scrollTop, preview: $('preview').scrollTop, hvBody: $('hvBody').scrollTop },
      focus: fe && fe.id && fe !== document.body ? fe.id : ''
    };
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch (e) { /* 引き継げなくても動く */ }
  }
  function takeView() {
    try { const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); sessionStorage.removeItem(VIEW_KEY); return v; } catch (e) { return null; }
  }
  function restoreView(v) {
    const modes = ['edit', 'preview'];
    if ([...$('speed').options].some(o => +o.value === v.speed)) { S.speed = v.speed; $('speed').value = String(v.speed); }
    if (v.scope === 'latest' || v.scope === 'history') { S.scope = v.scope; updateHint(); }
    $('frFind').value = v.frFind || '';
    $('frRepl').value = v.frRepl || '';
    const ed = $('editor'), len = ed.value.length;
    ed.setSelectionRange(Math.min(+v.selS || 0, len), Math.min(+v.selE || 0, len));
    if (v.mode === 'history') {
      setMode(modes.includes(v.hbase) ? v.hbase : 'edit');
      setMode('history');
      S.rev = +v.rev || 0;
      renderHist();
    } else setMode(modes.includes(v.mode) ? v.mode : 'edit');
    if (v.frOpen && S.mode === 'edit') { S.frOpen = true; frShow(); frRefresh(); }
    if (v.q) { $('q').value = v.q; runSearch(); }
    // スクロールとフォーカスは、表示が組み上がってから戻す(描画が止まっていても動くよう setTimeout で)
    setTimeout(() => {
      const sc = v.scroll || {};
      for (const id of ['editor', 'preview', 'hvBody']) if (sc[id]) $(id).scrollTop = sc[id];
      const fe = v.focus && $(v.focus);
      if (fe && !fe.closest('[hidden]')) fe.focus({ preventScroll: true });
      else if (S.mode === 'edit') ed.focus({ preventScroll: true });
    }, 0);
  }
  window.addEventListener('pagehide', saveView);

  /* ---------- 起動 ---------- */
  (async function boot() {
    let data = null;
    try { data = await api.load(); } catch (e) { data = null; }
    if (!data) { toast(T('dirLoadFailed')); return; }
    $('dirPath').textContent = data.dir;
    S.dir = data.dir;
    loadRecent();
    // 起動時は一覧用の情報だけ受け取る。履歴を含む中身は、開いたメモの分だけ読む
    S.notes = data.notes.map(r => ({ id: r.id, c: r.c, t: r.t, imported: r.imported || 0, n: r.n, title: r.title, loaded: false }));
    if (!S.notes.length) S.notes.push((await makeNote()) || newNote());
    let last = null;
    try { last = localStorage.getItem('everpad:active'); } catch (e) { /* 無くても動く */ }
    const first = S.notes.some(n => n.id === last) ? last : sorted()[0].id;
    try { setCollapsed(localStorage.getItem('everpad:side') === 'hidden', false); } catch (e) { /* 無くても動く */ }
    try { setLines(localStorage.getItem('everpad:lines') === '1', false); } catch (e) { /* 無くても動く */ }
    if (!(await select(first))) {
      // 前回のメモが読めないときは、ほかのメモを順に試す
      let okOpen = false;
      for (const n of sorted()) { if (n.id !== first && await select(n.id)) { okOpen = true; break; } }
      if (!okOpen) { toast(T('loadFailed')); return; }
    }
    const view = takeView();
    if (view) restoreView(view);
    else setMode('edit', true);
    api.ready();
  })();
})();
