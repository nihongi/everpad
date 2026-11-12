(function () {
  'use strict';
  const api = window.memoApi;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 言語 ----------
     main.js が index.html?lang=ja|en で渡す。固定の文言は、data-i18n* の付いた要素を置き換える */
  const query = new URLSearchParams(location.search);
  const qLang = query.get('lang');
  const LANG = I18N.LANGS.includes(qLang) ? qLang : 'ja';
  // Mac では、文中のショートカットキーを Mac の書き方(⌘)にする
  const IS_MAC = query.get('os') === 'darwin';
  // 改行と字下げの設定(「編集」メニューで切り替え、main.js が渡す): 自動インデント・箇条書きを続ける・字下げの幅
  const EDIT = { autoIndent: query.get('ai') !== '0', autoList: query.get('al') !== '0', indentWidth: query.get('iw') === '2' ? 2 : 4 };
  const T = (key, params) => (IS_MAC ? macKeys(I18N.t(LANG, key, params)) : I18N.t(LANG, key, params));
  document.documentElement.lang = LANG;
  setMdLang(LANG);   // アラートの見出しなど、Markdown の表示に出す言葉
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = T(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', T(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = T(el.dataset.i18nPh); });
  /* ボタンの説明に出すキー。main.js が index.html?kd= で { 操作の id: 表示するキー } を渡し、キーを変えたら送り直す。
     data-key の付いた要素の説明の {k} を「 (Ctrl+B)」にする(キーなしなら何も出さない) */
  const KEYD = (() => { try { return JSON.parse(query.get('kd') || '{}') || {}; } catch (e) { return {}; } })();
  function applyKeyTitles() {
    document.querySelectorAll('[data-key]').forEach(el => {
      const p = { k: KEYD[el.dataset.key] ? ' (' + KEYD[el.dataset.key] + ')' : '' };
      if (el.dataset.i18nTitle) el.title = T(el.dataset.i18nTitle, p);
      if (el.dataset.i18nAria) el.setAttribute('aria-label', T(el.dataset.i18nAria, p));
    });
  }
  applyKeyTitles();
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
  // プレビューでの編集の状態(「プレビューでの編集」を参照。表示の切り替えやメモの移動で閉じるので、ここで用意する)
  const pe = { box: null, holder: null, el: null, kind: '', s: 0, e: 0, n: 0, pre: '', post: '', hasPost: false, start: '', row: 0, col: 0, html: '', init: '' };
  let peComposing = false, peNext = null, peLastCell = null;
  const peUndo = [], peRedo = [];
  const cur = () => S.notes.find(n => n.id === S.active);
  const sorted = () => S.notes.slice().sort((a, b) => b.t - a.t);

  /* ---------- メモの読み込み ----------
     一覧に出すのは題名・更新時刻・版数だけ(起動時に保存先から受け取る)。
     履歴を含む中身は、開いたメモだけを読み込む。読み込んだメモは最近使った数件だけ覚え、古いものは手放す。 */
  const MAX_LOADED = 6;
  let useSeq = 0;
  /* 古い履歴を削除したメモは base(削除した版の数)を持つ。版の番号 = base + 編集の個数(削除しても版数は変わらない)。
     n.n は版数、nOps は手元にある編集の個数 */
  const nOps = n => (n.loaded ? n.ops.length : n.n - (n.base || 0));
  const baseOf = n => (n && n.base) || 0;
  // 履歴の表示で戻れる最も古い位置(古い履歴を削除したメモでは、最初の編集 = 残した最も古い版。空の版0には戻れない)
  const histLo = n => (baseOf(n) > 0 ? 1 : 0);
  function syncMeta(n) {
    n.n = baseOf(n) + n.ops.length;
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
        n.base = r.base || 0; n.pruned = r.pruned || 0;
        n.ro = !!r.ro;
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
  const LOCK_ICON = '<svg class="ro" viewBox="0 0 24 24" role="img" aria-label="' + esc(T('roListTitle')) + '"><title>' + esc(T('roListTitle')) + '</title><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3z"/></svg>';
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
      b.innerHTML = '<span class="nt">' + (n.ro ? LOCK_ICON : '') + esc(shownTitle(n.title)) + '</span><span class="nm">' + fmtShort(n.t) + T('sep') + T('versions', { n: n.n }) + '</span>';
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
      ? { cls: 'st-total', text: T('statusAt', { k: baseOf(n) + S.rev, chars: st.chars, lines: st.lines }), title: T('statusAtTitle') }
      : { cls: 'st-total', text: T('status', { chars: st.chars, lines: st.lines, versions: baseOf(n) + n.ops.length }), title: T('statusTitle') };
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
    // 履歴の表示中は、その版の編集で変更した位置(編集画面のカーソル位置と同じ数え方)
    if (S.mode === 'history' && S.histPos != null && S.histText != null) parts.push({ cls: 'st-pos', text: T('changePos', cursorInfo(S.histText, S.histPos)), title: T('changePosTitle') });
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
  // 見えない複製を、本文(textarea)と同じ幅・同じ書式にする
  function fitMirror(ta, cs) {
    mirror.style.font = cs.font;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize;
    mirror.style.overflowWrap = cs.overflowWrap;
    mirror.style.wordBreak = cs.wordBreak;
    mirror.style.width = (ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
  }
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
    fitMirror(ta, cs);
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
    // 読み取り専用のメモは変えない(入力は止めているが、万一変わったら元に戻す)
    if (isRO(n)) { $('editor').value = n.text; roBlocked(); return; }
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

  /* ---------- 読み取り専用 ----------
     メモの履歴ファイルの1行目に ro: true を持つ(store.js)。読み取り専用のメモは、編集・添付・置換・過去の版への復元・
     古い履歴の削除・メモの削除をしない。見る・検索する・コピーする・印刷とエクスポートは今までどおり。
     編集欄は readOnly にし、文字を変えるキーや貼り付けを押したときは、読み取り専用であることを知らせる */
  const isRO = n => !!(n && n.ro);
  let roToastAt = 0;
  function roBlocked() {
    const now = Date.now();
    if (now - roToastAt > 1500) { roToastAt = now; toast(T('roBlocked')); }
  }
  /* 今のメモに合わせて、編集欄・ボタン・状態表示の「読み取り専用」を切り替える */
  function applyRO() {
    const ro = isRO(cur());
    $('editor').readOnly = ro;
    $('roBtn').setAttribute('aria-pressed', String(ro));
    $('attBtn').disabled = ro;
    $('delBtn').disabled = ro;
    for (const id of ['frRepl', 'frOne', 'frAll']) $(id).disabled = ro;
    if (ro) emoClose();
    if (S.frOpen) frShow();   // 読み取り専用にしたら置換の行を隠す(戻したら出す)
  }
  // 文字を変えるキー(文字・Enter・Tab・Backspace・Delete、Ctrl+V・X・Z・Y)は、ほかの処理より先に止める
  $('editor').addEventListener('keydown', e => {
    if (!isRO(cur()) || e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    const edits = !e.altKey && (mod ? /^[vxzy]$/i.test(k) : (k.length === 1 || /^(Enter|Tab|Backspace|Delete)$/.test(k)));
    if (!edits) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    roBlocked();
  }, true);
  for (const type of ['paste', 'cut', 'drop']) {
    $('editor').addEventListener(type, e => { if (isRO(cur())) { e.preventDefault(); e.stopImmediatePropagation(); roBlocked(); } }, true);
  }
  $('roBtn').addEventListener('click', () => { if (S.active) toggleReadOnly(S.active); });
  /* 読み取り専用を付け外しする。付けるときは先に入力を止め、書き込み待ちの編集を書き出してから、ファイルの1行目を書き換える */
  let roBusy = false;
  async function toggleReadOnly(id) {
    const n = S.notes.find(x => x.id === id);
    if (!n || roBusy) return;
    const on = !n.ro;
    roBusy = true;
    let ok = false;
    try {
      if (on) { n.ro = true; if (n.id === S.active) applyRO(); }
      await flush();
      try { ok = await api.setReadOnly(id, on); } catch (e) { ok = false; }
      n.ro = ok ? on : !on;
    } finally {
      roBusy = false;
      if (n.id === S.active) {
        applyRO();
        sendUiState();
        if (S.mode === 'history') renderHist();   // 「この版に戻す」「これより前を削除…」を押せる・押せないにする
      }
      renderList();
    }
    toast(ok ? T(on ? 'roOn' : 'roOff', { title: shownTitle(n.loaded ? titleOf(n.text) : n.title) }) : T('roFailed'));
  }

  /* ---------- 絵文字の入力候補 ----------
     編集画面で : と名前の文字を2つ以上打つと(:sm など)、カーソルの下に候補を出す(core.js の emojiQueryAt・emojiSuggest)。
     ↑↓ で選び、Enter か Tab で :名前: を入れる(1回の編集。Ctrl+Z で戻せる)。Esc で閉じる。クリックでも入る。
     日本語入力の変換中・文字を選んでいるとき・コードブロックの中では出さない */
  const emo = { box: null, items: [], at: 0, from: -1, q: '' };
  function emoClose() {
    if (emo.box) { emo.box.remove(); emo.box = null; }
    emo.items = []; emo.from = -1; emo.q = '';
    $('editor').removeAttribute('aria-activedescendant');
  }
  function emoUpdate() {
    const ed = $('editor');
    if (S.mode !== 'edit' || composing || ed.readOnly || ed.selectionStart !== ed.selectionEnd || document.activeElement !== ed || !$('modal').hidden) { emoClose(); return; }
    const hit = emojiQueryAt(ed.value, ed.selectionStart);
    const items = hit ? emojiSuggest(hit.q, 8) : [];
    if (!items.length) { emoClose(); return; }
    if (!(emo.box && emo.from === hit.from && emo.q === hit.q)) emo.at = 0;
    emo.items = items; emo.from = hit.from; emo.q = hit.q;
    emoPaint();
    emoPlace();
  }
  function emoPaint() {
    if (!emo.box) {
      emo.box = document.createElement('ul');
      emo.box.className = 'emopick';
      emo.box.setAttribute('role', 'listbox');
      emo.box.setAttribute('aria-label', T('emojiPick'));
      // 押してもエディタからフォーカスを外さない
      emo.box.addEventListener('mousedown', e => { e.preventDefault(); const li = e.target.closest('li'); if (li) emoChoose(+li.dataset.i); });
      document.body.appendChild(emo.box);
    }
    emo.box.textContent = '';
    emo.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = 'emopick-' + i; li.dataset.i = i;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === emo.at));
      const c = document.createElement('span'); c.className = 'ec'; c.textContent = it.ch;
      const n = document.createElement('span'); n.className = 'en'; n.textContent = ':' + it.name + ':';
      li.append(c, n);
      emo.box.appendChild(li);
    });
    $('editor').setAttribute('aria-activedescendant', 'emopick-' + emo.at);
  }
  /* 文字位置 pos の、画面上の位置(折り返しも、行番号と同じ見えない複製で測る) */
  function caretRect(pos) {
    const ta = $('editor'), cs = getComputedStyle(ta);
    const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0, padT = parseFloat(cs.paddingTop) || 0;
    mirror.style.font = cs.font; mirror.style.lineHeight = cs.lineHeight; mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.tabSize = cs.tabSize; mirror.style.overflowWrap = cs.overflowWrap; mirror.style.wordBreak = cs.wordBreak;
    mirror.style.width = (ta.clientWidth - padL - padR) + 'px';
    mirror.textContent = ta.value.slice(0, pos);
    const mk = document.createElement('span');
    mk.textContent = '​';
    mirror.appendChild(mk);
    const x = mk.offsetLeft + padL, y = mk.offsetTop + padT, h = mk.offsetHeight || parseFloat(cs.lineHeight) || 20;
    mirror.innerHTML = '';
    const r = ta.getBoundingClientRect();
    return { left: r.left + ta.clientLeft + x - ta.scrollLeft, top: r.top + ta.clientTop + y - ta.scrollTop, height: h };
  }
  function emoPlace() {
    if (!emo.box) return;
    const c = caretRect(emo.from), r = $('editor').getBoundingClientRect();
    if (c.top + c.height < r.top || c.top > r.bottom) { emoClose(); return; }   // スクロールして見えなくなった
    const bw = emo.box.offsetWidth, bh = emo.box.offsetHeight;
    const left = Math.max(8, Math.min(c.left, window.innerWidth - bw - 8));
    let top = c.top + c.height + 2;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, c.top - bh - 2);   // 下に入らなければ上に出す
    emo.box.style.left = left + 'px';
    emo.box.style.top = top + 'px';
  }
  function emoChoose(i) {
    const it = emo.items[i];
    if (!it) return;
    const ed = $('editor'), from = emo.from, to = ed.selectionStart, text = ':' + it.name + ':';
    emoClose();
    frInsert(from, to, text);
    ed.focus();
    ed.setSelectionRange(from + text.length, from + text.length);
    queueStatus();
  }
  $('editor').addEventListener('input', () => { if (!composing) emoUpdate(); });
  $('editor').addEventListener('compositionend', () => setTimeout(emoUpdate, 0));
  // 候補が出ている間の ↑↓・Enter・Tab・Esc は候補の操作にする(自動インデントなど、ほかの処理より先に受け取る)
  $('editor').addEventListener('keydown', e => {
    if (!emo.box || e.isComposing || e.keyCode === 229) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && plain) {
      const n = emo.items.length;
      emo.at = (emo.at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      emoPaint();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && plain) emoChoose(emo.at);
    else if (e.key === 'Escape') emoClose();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  $('editor').addEventListener('keyup', e => { if (/^(ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/.test(e.key)) emoUpdate(); });
  $('editor').addEventListener('mouseup', () => setTimeout(emoUpdate, 0));
  $('editor').addEventListener('blur', emoClose);
  $('editor').addEventListener('scroll', emoPlace);
  window.addEventListener('resize', emoClose);

  /* ---------- 表示の切り替え ---------- */
  /* 表示は「編集」「プレビュー」の2つ。それぞれに、通常表示と履歴表示がある。
     S.mode は実際の画面(edit / preview / history)、S.hbase は履歴表示のときの元の画面(edit=変更箇所を示す文字、preview=整形した表示)。 */
  function setMode(m, focusEditor) {
    if (pe.box) peClose(true);
    stop();
    emoClose();
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
    $('attBtn').hidden = m === 'history';
    if (m === 'preview') renderPreview();
    if (m === 'history') { if (enteringHistory) S.rev = cur().ops.length; buildTimeline(); renderHist(); }
    if (m === 'edit') queueGutter();
    if (m === 'edit' && focusEditor) $('editor').focus({ preventScroll: true });
    if (S.frOpen) frRefresh();   // 表示を作り直したので、一致した箇所も探し直す
    queueStatus();
    sendUiState();
  }
  /* メニューの押せる・押せないのための画面の状態を main.js に送る */
  function sendUiState() {
    const back = typeof recent !== 'undefined' && recent.some(r => r.id !== S.active && S.notes.some(n => n.id === r.id));
    // 行番号が出るのは、編集画面と、編集から入った履歴の表示(変更箇所の表示)だけ
    const lines = S.mode === 'edit' || (S.mode === 'history' && S.hbase === 'edit');
    $('lnBtn').disabled = !lines;   // 右下の「行番号」ボタンも、メニューと同じく行番号が出る表示でだけ押せる
    api.setUiState({ edit: S.mode === 'edit', fmt: S.mode === 'edit' || pe.kind === 'block', lines: lines, back: back, hist: S.mode === 'history', base: S.hbase, ro: isRO(cur()) });
  }
  /* ---------- 「編集」と「プレビュー」を切り替えたときの位置合わせ ----------
     切り替える前の表示で基準の場所(元の文の行と、画面の上からの高さ)を決め、切り替えたあとの表示で、その行を同じ高さに出して一瞬光らせる。
     基準の場所: 編集では、カーソルが見えていればカーソルの行、見えていなければ上端の行。
     プレビュー(と履歴の表示)では、クリックした場所が見えていればそこ、なければ上端の行。プレビューから編集に戻るときは、クリックした行にカーソルを移す。
     基準が上端の行で、いちばん上・いちばん下にいるときは、切り替えたあともその端にする。
     プレビューの行は、md(…, { lines: true }) が付けた data-line・data-end で知る。編集の行は、行番号と同じ見えない複製で測る。 */
  let lastHydrate = null;   // いちばん新しいプレビューの図を描き終わるまでの Promise
  let lastClick = null;     // プレビュー・履歴の表示でクリックした場所: { el, frac }(el は行の範囲を持つかたまり、frac はその中の高さの割合)
  function noteClick(e) {
    const el = e.target.closest && e.target.closest('[data-line]');
    if (!el || !e.currentTarget.contains(el)) { lastClick = null; return; }
    const r = el.getBoundingClientRect();
    lastClick = { el, frac: r.height > 0 ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0 };
  }
  $('preview').addEventListener('mousedown', noteClick);
  $('hvBody').addEventListener('mousedown', noteClick);
  const viewKey = () => (S.mode === 'history' ? 'history:' + S.hbase : S.mode);
  const viewEl = () => (S.mode === 'edit' ? $('editor') : S.mode === 'preview' ? $('preview') : $('hvBody'));
  // 編集の行ごとの縦の位置(textarea の中の位置。折り返した行は高さが増える)
  function editorAnchors() {
    const ta = $('editor'), cs = getComputedStyle(ta);
    const lines = ta.value.split('\n');
    const pt = parseFloat(cs.paddingTop) || 0, lh = parseFloat(cs.lineHeight) || 21;
    const out = [];
    if (lines.length > 20000 || !ta.clientWidth) {   // 行が多すぎるときは折り返しを無視する(行番号と同じ)
      for (let i = 0; i < lines.length; i++) out.push({ s: i, e: i + 1, top: pt + i * lh, bottom: pt + (i + 1) * lh });
      return out;
    }
    fitMirror(ta, cs);
    mirror.innerHTML = lines.map(l => '<div>' + (l ? esc(l) : '&#8203;') + '</div>').join('');
    const m0 = mirror.getBoundingClientRect().top, kids = mirror.children;
    for (let i = 0; i < lines.length; i++) { const r = kids[i].getBoundingClientRect(); out.push({ s: i, e: i + 1, top: pt + r.top - m0, bottom: pt + r.bottom - m0 }); }
    mirror.innerHTML = '';
    return out;
  }
  // カーソル(位置 pos)の行の縦の位置
  function caretBox(ta, pos) {
    const cs = getComputedStyle(ta), pt = parseFloat(cs.paddingTop) || 0;
    fitMirror(ta, cs);
    mirror.textContent = ta.value.slice(0, pos);
    const mk = document.createElement('span');
    mk.textContent = '​';
    mirror.appendChild(mk);
    const m0 = mirror.getBoundingClientRect().top, r = mk.getBoundingClientRect();
    mirror.textContent = '';
    return { top: pt + r.top - m0, bottom: pt + r.bottom - m0 };
  }
  // プレビュー・履歴の表示の、行の範囲を持つかたまりの縦の位置(スクロールする中身の上からの位置)
  function domAnchors(root) {
    const rr = root.getBoundingClientRect(), base = root.scrollTop - rr.top;
    const out = [...root.querySelectorAll('[data-line]')].map(el => {
      const r = el.getBoundingClientRect(), s = +el.dataset.line;
      return { s, e: Math.max(s + 1, +el.dataset.end || 0), top: r.top + base, bottom: r.bottom + base, el };
    });
    // 入れ子のリストの項目は、中の項目の上までを自分の場所にする(縦の位置が重ならないように)
    for (let k = 0; k + 1 < out.length; k++) if (out[k].el.contains(out[k + 1].el)) out[k].bottom = Math.min(out[k].bottom, out[k + 1].top);
    return out;
  }
  function syncCapture() {
    const sc = viewEl(), top = sc.scrollTop, h = sc.clientHeight;
    const a = { line: 0, offset: 0, edge: null, caretLine: -1, target: false };
    if (S.mode === 'edit') {
      const ta = sc, anchors = editorAnchors();
      const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
      const c = caretBox(ta, pos);
      if (c.bottom > top && c.top < top + h) { a.line = yToLine(anchors, c.top + 0.5); a.offset = c.top - top; a.target = true; }
      else a.line = yToLine(anchors, top);
    } else {
      const anchors = domAnchors(sc);
      const el = lastClick && lastClick.el;
      if (el && el.isConnected && sc.contains(el)) {
        const r = el.getBoundingClientRect(), an = anchors.find(x => x.el === el);
        let y = r.top - sc.getBoundingClientRect().top + top + r.height * lastClick.frac;
        if (an && an.bottom > an.top) y = Math.min(Math.max(y, an.top), an.bottom - 0.5);   // 入れ子の項目を持つ項目は、自分の行の場所の中にする
        if (y >= top && y <= top + h) {
          a.line = yToLine(anchors, y);
          a.offset = y - top;
          a.target = true;
          a.caretLine = an ? Math.min(an.e - 1, Math.max(an.s, Math.floor(a.line))) : Math.floor(a.line);
        }
      }
      if (!a.target) a.line = yToLine(anchors, top);
    }
    lastClick = null;
    if (!a.target) {
      if (sc.scrollHeight <= h + 2 || top <= 1) a.edge = 'top';
      else if (top + h >= sc.scrollHeight - 2) a.edge = 'bottom';
    }
    return a;
  }
  // 編集で、行 line の文字の始まり(行頭のリストの記号・見出しの # ・引用の > のあと)
  function lineTextStart(text, line) {
    let p = 0;
    for (let k = 0; k < line; k++) { const q = text.indexOf('\n', p); if (q < 0) return text.length; p = q + 1; }
    const end = text.indexOf('\n', p), ln = text.slice(p, end < 0 ? text.length : end);
    const m = ln.match(/^\s*(?:(?:>\s?)+\s*)?(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/);
    return p + (m ? m[0].length : 0);
  }
  function syncApply(a) {
    const sc = viewEl();
    if (S.mode === 'edit') {
      const ta = sc;
      if (a.caretLine >= 0) { const p = lineTextStart(ta.value, a.caretLine); ta.setSelectionRange(p, p); queueStatus(); }
      const anchors = editorAnchors();
      if (a.edge === 'top') ta.scrollTop = 0;
      else if (a.edge === 'bottom') ta.scrollTop = ta.scrollHeight;
      else ta.scrollTop = Math.max(0, lineToY(anchors, a.line) - a.offset);
      if (!a.edge) flashEditorLine(anchorAt(anchors, a.line));
      return;
    }
    const anchors = domAnchors(sc);
    if (a.edge === 'top') sc.scrollTop = 0;
    else if (a.edge === 'bottom') sc.scrollTop = sc.scrollHeight;
    else sc.scrollTop = Math.max(0, lineToY(anchors, a.line) - a.offset);
    const an = a.edge ? null : anchorAt(anchors, a.line);
    if (an) {
      an.el.classList.remove('sync-flash');
      void an.el.offsetWidth;   // 続けて切り替えたときも、初めから光らせる
      an.el.classList.add('sync-flash');
      an.el.addEventListener('animationend', function off(e) { if (e.target === an.el) { an.el.classList.remove('sync-flash'); an.el.removeEventListener('animationend', off); } });
    }
    if (a.edge !== 'top') keepAnchor(a, sc, anchors);
  }
  /* 図(Mermaid)や画像は、あとから描かれて高さが変わる。描き終わるまで(最大で数秒)、同じ場所を見せ続ける。
     ホイール・クリック・キーを使ったら、そこでやめる */
  let keepTok = 0;
  function keepAnchor(a, sc, anchors) {
    const tok = ++keepTok, key = viewKey();
    let ref = null;
    if (!a.edge) {
      const an = anchorAt(anchors, a.line);
      if (an) {
        const y = lineToY(anchors, a.line), r = an.el.getBoundingClientRect(), elTop = r.top - sc.getBoundingClientRect().top + sc.scrollTop;
        ref = y >= elTop && r.height > 0 ? { el: an.el, frac: (y - elTop) / r.height } : { el: an.el, dy: y - elTop };
      }
      if (!ref) return;
    }
    let settled = false;
    Promise.resolve(lastHydrate).catch(() => {}).then(() => { settled = performance.now(); });
    const t0 = performance.now();
    const quit = () => { keepTok++; };
    const evs = ['wheel', 'mousedown', 'keydown', 'touchstart'];
    evs.forEach(t => window.addEventListener(t, quit, { capture: true, passive: true, once: true }));
    const step = () => {
      const now = performance.now();
      const live = tok === keepTok && viewKey() === key && (!ref || ref.el.isConnected) && now - t0 < 15000 && (now - t0 < 3000 || !settled || now - settled < 500);
      if (!live) { evs.forEach(t => window.removeEventListener(t, quit, { capture: true })); return; }
      let want;
      if (!ref) want = sc.scrollHeight - sc.clientHeight;
      else {
        const r = ref.el.getBoundingClientRect(), elTop = r.top - sc.getBoundingClientRect().top + sc.scrollTop;
        want = elTop + (ref.frac != null ? ref.frac * r.height : ref.dy) - a.offset;
      }
      want = Math.max(0, Math.min(want, sc.scrollHeight - sc.clientHeight));
      if (Math.abs(sc.scrollTop - want) > 1) sc.scrollTop = want;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // 編集の行を一瞬光らせる(textarea の中の行には色を付けられないので、後ろに重ねた帯を光らせる)
  function flashEditorLine(an) {
    if (!an) return;
    const ta = $('editor');
    let fl = $('syncFlash');
    if (!fl) {
      fl = document.createElement('div');
      fl.id = 'syncFlash';
      fl.setAttribute('aria-hidden', 'true');
      fl.addEventListener('animationend', () => { fl.hidden = true; });
      // スクロールしたら消す(位置を合わせたときのスクロールは、あとから届くので除く)
      ta.addEventListener('scroll', () => { if (Math.abs(ta.scrollTop - (+fl.dataset.st || 0)) > 1) fl.hidden = true; });
      $('edwrap').appendChild(fl);
    }
    const top = Math.max(0, an.top - ta.scrollTop), bottom = Math.min(ta.clientHeight, an.bottom - ta.scrollTop);
    if (bottom <= top) return;
    fl.style.cssText = 'top:' + (ta.offsetTop + top) + 'px;height:' + (bottom - top) + 'px;left:' + ta.offsetLeft + 'px;width:' + ta.clientWidth + 'px';
    fl.className = '';
    void fl.offsetWidth;
    fl.className = 'sync-flash-line';
    fl.dataset.st = String(ta.scrollTop);
    fl.hidden = false;
  }
  /* 「編集」「プレビュー」に切り替える。履歴表示の最中なら、履歴のまま(同じ版で)表示を切り替える。
     どちらも、見ていた場所を切り替えたあとの表示に合わせる */
  function switchBase(m) {
    if (S.mode === 'history') stop();
    const same = S.mode === 'history' ? S.hbase === m : S.mode === m;
    let a = null;
    if (!same && cur()) { try { a = syncCapture(); } catch (e) { a = null; } }
    if (S.mode === 'history') { S.hbase = m; setMode('history'); }
    else setMode(m, true);
    if (a) { try { syncApply(a); } catch (e) { /* 合わせられなくても切り替えは済んでいる */ } }
  }
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => switchBase(b.dataset.mode)));
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
    if (pe.box) peClose(true);
    peUndo.length = 0;
    peRedo.length = 0;
    peLastCell = null;
    stop();
    emoClose();
    S.active = id;
    $('editor').value = cur().text;
    applyRO();
    // 履歴の表示のまま別のメモに移ったときは、そのメモの最新の版から見せる(版の番号はメモごとに意味が違う)
    if (S.mode === 'history') S.rev = cur().ops.length;
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
    const n = cur(), N = n.ops.length, lo = histLo(n), span = Math.max(1, N - lo);
    const r = $('range');
    r.min = lo;
    r.max = N;
    const g = $('gaps');
    g.innerHTML = '';
    for (let k = Math.max(1, lo); k < N; k++) {
      if (n.ops[k].t - n.ops[k - 1].t > 30 * 60e3) {
        const i = document.createElement('i');
        i.style.left = 'calc(10px + (100% - 20px) * ' + ((k - lo) / span) + ')';
        g.appendChild(i);
      }
    }
    // 古い履歴を削除したメモは、左端に「第1〜b版は削除済み」と出す
    $('tStart').textContent = N ? (baseOf(n) ? T('tlPruned', { b: baseOf(n) }) + T('sep') : '') + fmtFull(n.ops[0].t) : '';
    $('tEnd').textContent = N ? fmtFull(n.ops[N - 1].t) : '';
  }

  function renderHist() {
    const n = cur(), N = n.ops.length, lo = histLo(n), k = Math.max(lo, Math.min(N, S.rev)), base = baseOf(n);
    S.rev = k;
    const past = k !== N;
    const text = textAt(n, k);
    // 古い履歴を削除したメモの最初の編集は、残した版の本文を入れただけなので、変更箇所としては示さない
    const baseOp = base > 0 && k === 1;
    const op = k > 0 && !baseOp ? n.ops[k - 1] : null;
    const opT = k > 0 ? n.ops[k - 1].t : null;
    S.histText = text;   // 状態表示の「全体」に使う
    S.histPos = op ? changeEnd(op) : null;   // 状態表示の「変更位置」に使う
    updateStatus();
    $('histView').dataset.past = past ? '1' : '0';
    $('tl').dataset.past = past ? '1' : '0';
    $('chip').textContent = past ? T('pastVersion') : T('latestVersion');
    $('revNo').textContent = T('revNo', { k: base + k, n: base + N });
    $('when').textContent = opT != null ? fmtFull(opT) : (N ? T('initialEmpty') : '');
    $('delta').textContent = op ? [op.i ? T('charsAdded', { n: count(op.i) }) : '', op.d ? T('charsRemoved', { n: count(op.d) }) : ''].filter(Boolean).join(T('sep')) : (baseOp ? T('prunedBefore') : '');
    $('delta').disabled = !op;

    const body = $('hvBody');
    if (!text && !(op && op.d)) {
      body.innerHTML = '<p class="empty">' + esc(T('emptyVersion')) + '</p>';
    } else if (S.hbase === 'preview') {
      body.innerHTML = '<div class="md">' + md(text, { lines: true }) + '</div>';
      lastHydrate = hydrate(body, cur().id);
      highlight(body, S.q);
    } else {
      const ranges = S.q ? matchRanges(text, S.q) : [];
      const lines = diffLines(text, op, ranges);
      // 50行ほどのかたまり(.hck)に分け、画面の外のかたまりは描画を省く(core.js の chunkLines)
      const chunks = render => chunkLines(lines, 50).map(([a, b]) => '<div class="hck" style="--n:' + (b - a) + '">' + render(a, b) + '</div>').join('');
      if (S.lines) {
        const digits = Math.max(2, String(lines.length).length);
        body.innerHTML = '<div class="diff lined" style="--ln-w: calc(' + digits + 'ch + 36px)">' + chunks((a, b) =>
          lines.slice(a, b).map((h, k) => { const i = a + k; return '<div class="dl' + (/<(ins|del)\b/.test(h) ? ' chg' : '') + '"' + lineAttr(0, i, i + 1) + '><span class="n">' + (i + 1) + '</span><span class="t">' + (h || '&#8203;') + '</span></div>'; }).join('')) + '</div>';
      } else {
        // 行ごとに span で囲んで行の範囲を付ける(編集とプレビューを切り替えたときの位置合わせに使う)。
        // かたまりの中は改行でつなぎ、かたまりの境目は、かたまり(ブロック)の切れ目が改行になる
        body.innerHTML = '<div class="diff">' + chunks((a, b) => lines.slice(a, b).map((h, k) => '<span' + lineAttr(0, a + k, a + k + 1) + '>' + h + '</span>').join('\n')) + '</div>';
      }
      const target = body.querySelector('ins, del') || body.querySelector('mark');
      if (target) target.scrollIntoView({ block: 'nearest' });
    }
    const r = $('range');
    r.value = k;
    r.style.setProperty('--p', (N > lo ? ((k - lo) / (N - lo)) * 100 : 0) + '%');
    $('restore').disabled = !past || isRO(n);
    $('pruneBtn').disabled = k < 2 || S.playing || isRO(n);
    $('bFirst').disabled = $('bPrev').disabled = k <= lo;
    $('bLast').disabled = $('bNext').disabled = k === N;
    $('playIcon').innerHTML = S.playing ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>' : '<path d="M7 4.5v15l12-7.5z"/>';
    $('bPlay').title = S.playing ? T('pause') : T('play');
    $('bPlay').setAttribute('aria-label', S.playing ? T('pause') : T('play'));
    $('bPlay').disabled = N === 0;
    // 検索のバーを開いていれば、この版の中の一致に色を付け直し、「前の変化」「次の変化」を押せるかを合わせる
    if (S.frOpen && S.mode === 'history') { pvRefresh(frRegex()); hbButtons(); }
  }

  let timer = null;
  function stop() { if (timer) { clearInterval(timer); timer = null; } if (S.playing) { S.playing = false; if (S.mode === 'history') renderHist(); } }
  function play() {
    const N = cur().ops.length;
    if (!N) return;
    if (S.rev >= N) S.rev = histLo(cur());
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
  /* 「追加 1文字」などを押したとき: 変更箇所へ表示を動かし、一瞬強調する。
     プレビューの表示では整形後のどこが変更箇所か分からないので、「編集」の表示の履歴に切り替えて示す */
  $('delta').addEventListener('click', () => {
    if (S.mode !== 'history' || !(S.rev > 0)) return;
    stop();
    if (S.hbase !== 'edit') { S.hbase = 'edit'; setMode('history'); }
    const els = [...$('hvBody').querySelectorAll('ins, del')];
    if (!els.length) return;
    els[0].scrollIntoView({ block: 'center' });
    for (const el of els) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });
  $('bFirst').addEventListener('click', () => go(histLo(cur())));
  $('bPrev').addEventListener('click', () => go(S.rev - 1));
  $('bNext').addEventListener('click', () => go(S.rev + 1));
  $('bLast').addEventListener('click', () => go(cur().ops.length));
  $('bPlay').addEventListener('click', () => (S.playing ? stop() : play()));
  /* 古い履歴の削除: 見ている版より古い版を、ファイルから消す(確認・アーカイブへの書き出し・添付の整理は main.js)。
     版の番号と版数は変わらない。書き込み待ちの編集を先に書き出し、ファイルと手元の履歴が同じ長さのときだけ行う */
  async function pruneHistory() {
    const n = cur();
    if (!n) return;
    if (isRO(n)) { roBlocked(); return; }
    if (S.mode !== 'history') { toast(T('pruneHowTo')); return; }
    stop();
    const k = S.rev;
    if (k < 2) { toast(T('pruneNothing')); return; }
    await flush();
    if (pendingOps.has(n.id) || saveError) { toast(T('pruneFailed')); return; }
    if (textDirty.has(n.id)) { textDirty.delete(n.id); try { await api.saveText(n.id, n.text); } catch (e) { /* .md は控え */ } }
    let r = null;
    try { r = await api.pruneHistory(n.id, k, n.ops.length, shownTitle(titleOf(n.text))); } catch (e) { r = { status: 'failed' }; }
    const st = r && r.status;
    if (st === 'cancelled') return;
    if (st === 'archiveFailed') { toast(T('pruneArcFailed')); return; }
    if (st !== 'pruned') { toast(T('pruneFailed')); return; }
    await adoptNote(n.id);
    if (cur() === n) { S.rev = 1; if (S.mode === 'history') { buildTimeline(); renderHist(); } }
    renderList();
    if (S.q && S.scope === 'history') runSearch();
    let msg = T('pruneDone', { from: r.from, to: r.to });
    if (r.trashed) msg += T('sep') + T(r.where === 'folder' ? 'pruneTrashedFolder' : 'pruneTrashed', { n: r.trashed });
    if (r.archive) msg += T('sep') + T('pruneArchived', { path: r.archive });
    toast(msg);
  }
  $('pruneBtn').addEventListener('click', pruneHistory);
  $('range').addEventListener('input', e => go(+e.target.value));
  $('speed').addEventListener('change', e => { S.speed = +e.target.value; });
  $('restore').addEventListener('click', () => {
    const n = cur(), k = S.rev;
    if (isRO(n)) { roBlocked(); return; }
    const text = textAt(n, k);
    if (text !== n.text) { n.ops.push(makeOp(n.text, text, Date.now())); n.text = text; syncMeta(n); queueOp(n, n.ops[n.ops.length - 1]); }
    $('editor').value = n.text;
    renderList();
    updateTitle();
    setMode('edit', true);
    toast(T('restored', { k: baseOf(n) + k }));
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
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('.math, .diagram') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
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
    emoClose();
    S.active = id;
    $('editor').value = loaded.text;
    renderList();
    updateTitle();
    updateStatus();
    rememberActive();
    touchRecent(cur());   // 検索結果から開いたメモも「最近見たメモ」に入れる(setMode が送る「戻る」の可否より先に)
    if (S.frOpen) frRefresh();
    evictOld();
    if (opt.rev != null) {
      S.hbase = 'edit';   // 検索で見つかった箇所は、変更箇所を示す文字の表示で見せる
      setMode('history');
      S.rev = opt.rev;
      renderHist();
      // 同じ検索語で検索のバーを開き、タイムスライダーに、その語がある版の範囲を示す
      if (S.q) { $('frFind').value = S.q; S.frOpen = true; frShow(); frRefresh(); }
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
        const range = r.a === r.b ? T('rangeOne', { a: baseOf(n) + r.a }) : T('rangeMany', { a: baseOf(n) + r.a, b: baseOf(n) + r.b });
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
    if (isRO(target)) { toast(T('roDelete')); return; }
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

  /* ---------- 検索と置換(編集画面・プレビューの上に出すバー) ----------
     プレビュー・履歴の表示・読み取り専用のメモでは、何も書き換えられないので、検索だけにする(置換の行を出さない)。
     履歴の表示では、正規表現は使わない(タイムスライダーの帯を、編集した箇所の近くだけを調べ直して数えるため) */
  const FR = { cs: false, word: false, re: false };
  try { Object.assign(FR, JSON.parse(localStorage.getItem('everpad:fr') || '{}')); } catch (e) { /* 無くても動く */ }
  const frBtns = { cs: 'frCase', word: 'frWord', re: 'frRe' };
  const frRegex = () => buildRe($('frFind').value, S.mode === 'history' ? { cs: FR.cs, word: FR.word } : FR);
  const frCanReplace = () => S.mode === 'edit' && !isRO(cur());
  function frShow() {
    const on = S.frOpen, repl = frCanReplace(), hist = S.mode === 'history';
    $('frbar').hidden = !on;
    $('frReplRow').hidden = !repl;
    $('frHistNav').hidden = !hist;
    $('frRe').disabled = hist;
    $('frRe').title = T(hist ? 'frReHistTitle' : 'frReTitle');
    for (const [id, k] of [['frbar', 'frAria'], ['frClose', 'frCloseAria']]) {
      $(id).dataset.i18nAria = repl ? k : k + 'Find';
      $(id).setAttribute('aria-label', T($(id).dataset.i18nAria));
    }
    if (!on || S.mode === 'edit') pvClear();
    if (!on || !hist) hbClear();
    queueGutter(); frPaintSoon();
  }
  function frLabel(text, bad) { const c = $('frCount'); c.textContent = text; c.classList.toggle('bad', !!bad); }
  function frRefresh() {
    for (const k in frBtns) $(frBtns[k]).setAttribute('aria-pressed', String(!!FR[k]));
    const re = frRegex();
    if (S.mode === 'history') { hbRefresh(); return pvRefresh(re); }
    if (S.mode === 'preview') return pvRefresh(re);
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

  /* プレビューと履歴の表示の中の検索。見えている文字を探す(数式と図の中は探さない。
     変更箇所の表示では、この版で消した文字と改行の印も探さない)。
     一致した箇所には色を重ねるだけで、表示の中身は書き換えない(CSS Custom Highlight)。
     pv = { hits: [Range], cur: いまの箇所の番号(まだ無ければ -1) } */
  let pv = null;
  const PV_BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, summary, figcaption, caption, div, article';
  const PV_SKIP = '.math, .diagram, a.fnback, script, style, svg, .diff del, .diff .nl, .diff .n';
  const pvRoot = () => (S.mode === 'history' ? $('hvBody') : $('preview'));
  function pvClear() {
    pv = null;
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('fr-all'); CSS.highlights.delete('fr-cur'); }
  }
  function pvRefresh(re) {
    pvClear();
    if (!re) return frLabel('');
    if (re.error) return frLabel(T('badRegex'), true);
    const pieces = [], nodes = [];
    const w = document.createTreeWalker(pvRoot(), NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => {
      if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if (n.matches(PV_SKIP)) return NodeFilter.FILTER_REJECT;
      return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    while (w.nextNode()) {
      const n = w.currentNode;
      if (n.nodeType === 1) { pieces.push({ br: true }); nodes.push(null); }
      else { pieces.push({ text: n.nodeValue, block: n.parentElement.closest(PV_BLOCK) }); nodes.push(n); }
    }
    const j = joinPieces(pieces), hits = [];
    for (const sp of pieceSpans(pieces, j.at, findAll(j.text, re))) {
      if (!sp) continue;
      const r = document.createRange();
      r.setStart(nodes[sp.a.i], sp.a.off);
      r.setEnd(nodes[sp.b.i], sp.b.off);
      hits.push(r);
    }
    pv = { hits, cur: -1 };
    if (!hits.length) return frLabel(T('noMatch'), true);
    if (window.CSS && CSS.highlights) { const h = new Highlight(); hits.forEach(r => h.add(r)); CSS.highlights.set('fr-all', h); }
    frLabel(T('matchTotal', { n: hits.length }));
  }
  function pvGo(dir) {
    if (!pv) pvRefresh(frRegex());
    if (!pv || !pv.hits.length) return null;
    const root = pvRoot(), rr = root.getBoundingClientRect(), n = pv.hits.length;
    let k, wrapped = false;
    if (pv.cur >= 0) {
      k = pv.cur + (dir >= 0 ? 1 : -1);
      if (k >= n || k < 0) { k = (k + n) % n; wrapped = true; }
    } else if (dir >= 0) {   // まだ選んでいなければ、いま見えているところから探す
      k = pv.hits.findIndex(r => r.getBoundingClientRect().top >= rr.top);
      if (k < 0) { k = 0; wrapped = true; }
    } else {
      k = -1;
      for (let i = n - 1; i >= 0; i--) if (pv.hits[i].getBoundingClientRect().bottom <= rr.bottom) { k = i; break; }
      if (k < 0) { k = n - 1; wrapped = true; }
    }
    pv.cur = k;
    if (window.CSS && CSS.highlights) { const h = new Highlight(pv.hits[k]); h.priority = 1; CSS.highlights.set('fr-cur', h); }
    const r = pv.hits[k].getBoundingClientRect();
    if (r.top < rr.top || r.bottom > rr.bottom) root.scrollTop += r.top - rr.top - root.clientHeight / 3;
    frLabel(T('matchAt', { at: k + 1, n }) + (wrapped ? T('wrapped') : ''));
    return k;
  }

  /* 履歴の表示: タイムスライダーの下に、検索語がある版の範囲を帯で示す(数えるのは core.js の historyCounter。
     メモの元の文字で数える)。「前の変化」「次の変化」で、検索語の数が変わった版(書いた版・消した版)へ移る。
     hb = { key, counts: 版ごとの数, done: 数え終わったか } */
  let hb = null, hbTok = 0;
  function hbClear() {
    hbTok++;
    hb = null;
    $('fhits').innerHTML = '';
    $('tlNote').textContent = T('gapNote');
    hbButtons();
  }
  async function hbRefresh() {
    const n = cur(), q = $('frFind').value;
    if (!S.frOpen || S.mode !== 'history' || !n || !q) { hbClear(); return; }
    const key = [n.id, n.ops.length, FR.cs, FR.word, q].join('\n');
    if (hb && hb.key === key) { if (hb.done) hbPaint(); return; }
    const tok = ++hbTok, c = historyCounter(n.ops, frRegex(), q.length);
    hb = { key, counts: c.counts, done: false };
    $('fhits').innerHTML = '';
    $('tlNote').textContent = T('tlHitsBusy');
    hbButtons();
    while (!c.step(4000)) { await yieldUi(); if (tok !== hbTok) return; }   // 長い履歴でも画面を止めない
    hb.done = true;
    hbPaint();
  }
  function hbPaint() {
    const n = cur(), N = n.ops.length, lo = histLo(n), span = N - lo, cn = hb.counts, g = $('fhits');
    const x = k => (span > 0 ? (k - lo) / span : 0), half = span > 0 ? 0.5 / span : 0.5;
    const frag = document.createDocumentFragment();
    let a = -1, bands = 0;
    for (let k = lo; k <= N + 1; k++) {
      const on = k <= N && cn[k] > 0;
      if (on && a < 0) a = k;
      else if (!on && a >= 0) {
        const left = Math.max(0, x(a) - half), right = Math.min(1, x(k - 1) + half);
        const i = document.createElement('i');
        i.style.left = 'calc(10px + (100% - 20px) * ' + left + ')';
        i.style.width = 'max(3px, calc((100% - 20px) * ' + (right - left) + '))';
        frag.appendChild(i);
        bands++;
        a = -1;
      }
    }
    g.innerHTML = '';
    g.appendChild(frag);
    $('tlNote').textContent = T(bands ? 'tlHits' : 'tlHitsNone', { q: $('frFind').value });
    hbButtons();
  }
  // 版 k の前後で、検索語の数が変わった次の版(dir=1)・前の版(dir=-1)。無ければ -1
  function hbNextChange(dir) {
    if (!hb || !hb.done || S.mode !== 'history') return -1;
    const n = cur(), N = n.ops.length, lo = Math.max(1, histLo(n)), cn = hb.counts;
    for (let k = S.rev + dir; k >= lo && k <= N; k += dir) if (cn[k] !== cn[k - 1]) return k;
    return -1;
  }
  function hbButtons() {
    $('frPrevChg').disabled = hbNextChange(-1) < 0;
    $('frNextChg').disabled = hbNextChange(1) < 0;
  }
  function hbGo(dir) {
    const k = hbNextChange(dir);
    if (k < 0) return;
    go(k);
    const n = cur(), d = hb.counts[k] - hb.counts[k - 1];
    toast(T(d > 0 ? 'chgAdded' : 'chgRemoved', { k: baseOf(n) + k, n: Math.abs(d) }));
  }
  $('frPrevChg').addEventListener('click', () => hbGo(-1));
  $('frNextChg').addEventListener('click', () => hbGo(1));

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
    if (isRO(cur())) { roBlocked(); return; }   // 書式・置換・自動インデント・添付などは、すべてここを通る
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
     選んだ文字を太字・斜体・取り消し線・コードにする(複数行なら行ごと。core.js の inlineFormat)。
     1回の編集として履歴に残り、Ctrl+Z で戻せる。編集画面でだけ使える */
  function applyFormat(kind) {
    // プレビューでかたまりを編集している間は、その編集欄に対して行う
    const blk = S.mode === 'preview' && pe.kind === 'block';
    if ((S.mode !== 'edit' && !blk) || !$('modal').hidden) return;
    const ed = blk ? pe.box : $('editor');
    const r = kind === 'indent' || kind === 'outdent'
      ? indentEdit(ed.value, ed.selectionStart, ed.selectionEnd, EDIT.indentWidth, kind === 'outdent')
      : ['bold', 'italic', 'strike', 'icode'].indexOf(kind) >= 0 ? inlineFormat(ed.value, ed.selectionStart, ed.selectionEnd, kind)
        : formatLines(ed.value, ed.selectionStart, ed.selectionEnd, kind);
    if (!r) return;
    if (ed.value.slice(r.from, r.to) !== r.insert) { if (blk) peReplace(r.from, r.to, r.insert); else frInsert(r.from, r.to, r.insert); }
    ed.focus();
    ed.setSelectionRange(r.selStart, r.selEnd);
    queueStatus();
  }
  /* 本文で Enter / Tab を押したとき: 自動インデント・箇条書きの続き・字下げ(core.js の newlineEdit / tabEdit)。
     1回の編集として履歴に残り、Ctrl+Z で戻せる。日本語入力の変換中は何もしない。
     本文の中では、Tab をボタンなどへの移動に使わない(検索と置換のバーなど、ほかの入力欄では今までどおり) */
  $('editor').addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== 'Tab') || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey) return;
    if (S.mode !== 'edit' || !$('modal').hidden) return;
    const ed = $('editor');
    let r;
    if (e.key === 'Tab') {
      e.preventDefault();
      r = tabEdit(ed.value, ed.selectionStart, ed.selectionEnd, EDIT.indentWidth, e.shiftKey);
    } else {
      r = newlineEdit(ed.value, ed.selectionStart, ed.selectionEnd, { indent: EDIT.autoIndent, list: EDIT.autoList, soft: e.shiftKey });
      if (!r) return;   // 普通の改行(ブラウザに任せる)
      e.preventDefault();
    }
    if (!r) return;
    if (ed.value.slice(r.from, r.to) !== r.insert) frInsert(r.from, r.to, r.insert);
    ed.setSelectionRange(r.selStart, r.selEnd);
    queueStatus();
  });
  function frGo(dir) {
    if (S.mode !== 'edit') return pvGo(dir);   // プレビュー・履歴の表示
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
    if (!frCanReplace()) return;
    const re = frRegex();
    if (!re || re.error) { frRefresh(); return; }
    const ed = $('editor'), s = ed.selectionStart, e = ed.selectionEnd;
    const hit = e > s ? findAll(ed.value, re).find(x => x.s === s && x.e === e) : null;
    if (hit) frInsert(s, e, expandRepl($('frRepl').value, hit.m, FR.re));
    frGo(1);
  }
  function frReplaceAll() {
    if (!frCanReplace()) return;
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
    S.frOpen = true;
    let sel = '';
    if (S.mode === 'edit') { const ed = $('editor'); sel = ed.value.slice(ed.selectionStart, ed.selectionEnd); }
    else { const ws = window.getSelection(); if (ws.rangeCount && pvRoot().contains(ws.anchorNode)) sel = ws.toString(); }
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
    if (e.key === 'F3' && S.frOpen) { e.preventDefault(); frGo(e.shiftKey ? -1 : 1); }
  });

  /* ---------- 画像・添付ファイル ----------
     本文には ![名前](attach:ID)(画像)/ [名前](attach:ID)(ファイル)と書かれ、実体はメモごとのフォルダに残る。
     本文から消しても履歴には残るので、ファイルは削除しない。 */
  const MAX_ATTACH_MB = 50;
  const missingEl = alt => { const s = document.createElement('span'); s.className = 'att-missing'; s.textContent = T('imageMissing', { alt: alt }); return s; };
  function hydrate(root, noteId, diagramOpts) {
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
    // Mermaid の図(diagram.js)。印刷と書き出しは、描き終わるのを待つ
    return Diagrams.render(root, diagramOpts).catch(() => {});
  }
  // ダークモードが変わったら、プレビューと履歴の図を描き直す
  Diagrams.onThemeChange(() => { Diagrams.render($('preview')); Diagrams.render($('hvBody')); });
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
    // 脚注の番号: 注の文を出す。「本文に戻る」はマウスを重ねたときの説明だけ
    if (el.classList.contains('fnback')) return '';
    if (el.parentElement && el.parentElement.matches('sup.fnref')) {
      const li = el.closest('#preview, #hvBody').querySelector('.footnotes li[data-fn="' + el.dataset.fn + '"]');
      return li ? li.textContent.replace(/↩︎?/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    }
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
  // 脚注: 番号をクリックすると注へ、注の ↩ をクリックすると本文の参照へ移り、少しの間、色を付ける
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('#preview sup.fnref a, #hvBody sup.fnref a, #preview a.fnback, #hvBody a.fnback');
    if (!a) return;
    e.preventDefault();
    const root = a.closest('#preview, #hvBody');
    const to = a.classList.contains('fnback') ? root.querySelector('sup.fnref a[data-fn="' + a.dataset.fnback + '"]') : root.querySelector('.footnotes li[data-fn="' + a.dataset.fn + '"]');
    if (!to) return;
    to.scrollIntoView({ block: 'center' });
    to.classList.add('fn-flash');
    setTimeout(() => to.classList.remove('fn-flash'), 1500);
  });
  // メモへのリンク: プレビューと履歴の「Markdown表示」ではクリック、編集画面では Ctrl+クリック(Mac は ⌘+クリック)で移動する
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('#preview a.note-link, #hvBody a.note-link');
    if (!a) return;
    e.preventDefault();
    openNoteById(a.dataset.note, 'linkMissing');
  });
  $('editor').addEventListener('click', e => {
    if (!(IS_MAC ? e.metaKey : e.ctrlKey) || S.mode !== 'edit') return;   // Mac の Ctrl+クリックは右クリックなので ⌘+クリック
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
  // 数式・図を右クリック: 元の LaTeX・図の元の文をコピーできる
  document.addEventListener('contextmenu', async e => {
    const m = e.target.closest && e.target.closest('#preview .math, #hvBody .math, #preview .diagram, #hvBody .diagram');
    if (!m || (window.getSelection().toString().trim() && !window.getSelection().isCollapsed)) return;
    e.preventDefault();
    const diagram = m.classList.contains('diagram');
    let r = null;
    const canEdit = !!m.closest('#preview') && peAllowed();
    try { r = await api.mathMenu(diagram ? m.dataset.src || '' : m.dataset.tex || '', diagram ? 'diagram' : 'math', canEdit); } catch (err) { r = null; }
    if (r && r.status === 'copied') toast(T(diagram ? 'diagramCopied' : 'texCopied'));
    else if (r && r.status === 'edit' && m.isConnected) { if (diagram) peDiagramEdit(m); else peMathEdit(m); }
    else if (r && r.status === 'view' && diagram) diagramView(m);
  });
  document.addEventListener('contextmenu', e => {
    const t = e.target.closest && e.target.closest('#preview [data-att], #hvBody [data-att], #attStrip [data-att]');
    if (!t) return;
    e.preventDefault();
    const chip = t.closest('.att-chip'), img = t.tagName === 'IMG' ? t : t.querySelector('img');
    const name = (chip && chip.dataset.name) || (img && img.alt) || t.title || t.textContent.trim();
    // 「ごみ箱に入れる…」は、編集画面の添付の一覧とプレビューだけ(履歴の表示は過去の版なので出さない)
    attachMenu(t.dataset.att, name, isImageName(t.dataset.att), e.clientX, e.clientY, !t.closest('#hvBody'));
  });
  async function attachMenu(fileId, name, image, x, y, canTrash) {
    let r = null;
    try { r = await api.attachMenu(S.active, fileId, name, image, x, y, !!canTrash && !isRO(cur())); } catch (err) { r = null; }
    const st = r && r.status;
    if (st === 'trash') trashAttachment(fileId, name);
    else if (st === 'missing') toast(T('fileMissing'));
    else if (st === 'copied') toast(T('imageCopied'));
    else if (st === 'copyFailed') toast(T('imageCopyFailed'));
    else if (st === 'saved') toast(T('attSaved', { path: r.path }));
    else if (st === 'saveFailed') toast(T('attSaveFailed'));
    else if (st === 'shown') toast(T('shownInFolder'));
  }
  /* 添付をごみ箱に入れ、本文からその添付へのリンクを消す。リンクを消すのは編集画面での1回の編集なので、「元に戻す」で戻せる
     (プレビューから選んだときは、編集画面に切り替えてから消す)。ファイルはごみ箱から戻せる */
  async function trashAttachment(fileId, name) {
    const n = cur();
    if (!n) return;
    if (isRO(n)) { roBlocked(); return; }
    const refs = removeAttachRefs(n.text, fileId).count;
    let r = null;
    try { r = await api.attachTrash(n.id, fileId, name, refs); } catch (e) { r = { status: 'failed' }; }
    const st = r && r.status;
    if (st === 'cancelled') return;
    if (st === 'missing') { toast(T('fileMissing')); return; }
    if (st !== 'trashed') { toast(T('attTrashFailed')); return; }
    if (cur() === n) {
      const res = removeAttachRefs(n.text, fileId);
      if (res.count) {
        if (S.mode !== 'edit') setMode('edit', true);
        const op = makeOp(n.text, res.text, 0);
        frInsert(op.p, op.p + op.d.length, op.i);   // input の処理で、履歴に1回の編集として入る
      }
    }
    toast(T(r.where === 'folder' ? 'attTrashedFolder' : 'attTrashed', { name: name }));
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
  /* 取り込んだ添付を書く。「テキスト」表示ではカーソルの位置(表の行の中なら横に並べて、表を壊さない)。
     プレビューでは where で決める(peInsertAttachments) */
  function insertAttachments(items, where) {
    if (!items.length) return;
    if (where && S.mode === 'preview') peInsertAttachments(items, where);
    else {
      const ed = $('editor');
      const s = ed.selectionStart, e = ed.selectionEnd;
      const ls = ed.value.lastIndexOf('\n', s - 1) + 1;
      const inTable = /^\s*\|/.test(ed.value.slice(ls, ed.value.indexOf('\n', s) < 0 ? undefined : ed.value.indexOf('\n', s)));
      const text = items.map(i => attachMarkup(i.name, i.fileId, i.image)).join(inTable ? ' ' : '\n');
      frInsert(s, e, text);
      ed.focus();
    }
    toast(T('itemsAdded', { n: items.length, images: items.every(i => i.image) }));
    updateStrip();
  }
  /* プレビューで添付を書く。where.box(開いていた編集欄)がまだ開いていれば、そのカーソルの位置(表のセルなら横に並べる)。
     そうでなければ、かたまり where.el の次(el が無ければメモの最後)に、1つのかたまりとして入れる */
  function peInsertAttachments(items, where) {
    const marks = items.map(i => attachMarkup(i.name, i.fileId, i.image));
    if (where.box && pe.box === where.box) {
      const b = pe.box, s = b.selectionStart, e = b.selectionEnd;
      if (pe.kind === 'block') { peReplace(s, e, marks.join('\n')); peFit(true); return; }
      const v = marks.join(' ');
      b.focus();
      b.setSelectionRange(s, e);
      try { if (!document.execCommand('insertText', false, v)) throw new Error('x'); } catch (x) { b.setRangeText(v, s, e, 'end'); }
      peSync();
      return;
    }
    if (pe.box) peClose();
    const el = where.el && where.el.isConnected && $('preview').contains(where.el) ? where.el : null;
    const before = cur().text;
    const r = blockInsert(before, el ? peAfter(el) : before.split('\n').length, marks);
    const top = el ? el.getBoundingClientRect().top : null;
    if (!peSetText(r.text)) return;
    peRecord(before, r.text);
    peRerender(el ? +el.dataset.line : r.at, top);
    const added = peBlockAt(r.at);
    if (added) added.scrollIntoView({ block: 'nearest' });
  }
  /* プレビューで、ファイルを落とした場所: 編集欄を開いていればそのカーソル、そうでなければ落としたかたまり(その次に入れる) */
  function peDropTarget(e) {
    if (pe.box) return { box: pe.box };
    const t = e.target, pv = $('preview');
    const el = t && t.closest && pv.contains(t) ? t.closest('[data-line]') : null;
    return { el: el && pv.contains(el) && !el.closest('.footnotes') ? el : null };
  }
  function reportErrors(errors) { if (errors.length) toast(errors[0] + (errors.length > 1 ? T('moreErrors', { n: errors.length - 1 }) : '')); }
  // where: プレビューでの入れる場所(peDropTarget の形)。無ければ、開いている編集欄のカーソルか、メモの最後
  async function ingestFiles(files, where) {
    if (isRO(cur())) { roBlocked(); return; }
    if (S.mode === 'preview') {
      if (!peAllowed()) return;
      if (!where) where = pe.box ? { box: pe.box } : { el: null };
    } else if (S.mode !== 'edit') { toast(T('attachEditOnly')); return; }
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
    insertAttachments(items, where);
    reportErrors(errors);
  }
  /* 「添付」ボタン・メニュー。プレビューでは、開いている編集欄のカーソルの位置か、メモの最後に入れる */
  async function pickAttachments() {
    if (isRO(cur())) { roBlocked(); return; }
    if (S.mode === 'preview' && !peAllowed()) return;
    if (S.mode !== 'edit' && S.mode !== 'preview') setMode('edit', false);
    const noteId = S.active, where = S.mode === 'preview' ? (pe.box ? { box: pe.box } : { el: null }) : null;
    let r;
    try { r = await api.attachPick(noteId); } catch (err) { r = { items: [], errors: [T('attachFailed')] }; }
    if (S.active === noteId) insertAttachments(r.items, where);
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
  // プレビューの編集欄(かたまり・表のセル)への貼り付けも同じ
  $('preview').addEventListener('paste', e => {
    const cd = e.clipboardData;
    if (e.target !== pe.box || !cd || !cd.files || !cd.files.length || cd.getData('text/plain')) return;
    e.preventDefault();
    ingestFiles([...cd.files], { box: pe.box });
  });
  // ドラッグ&ドロップ(ウィンドウのどこでも。ファイルを落としてもページが切り替わらないようにする)
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    ingestFiles([...e.dataTransfer.files], S.mode === 'preview' ? peDropTarget(e) : null);
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
  /* ---------- プレビューでの編集 ----------
     プレビューでかたまり(段落・見出し・リストの項目・引用や注意書きの中の段落・コード・区切り線)をクリックすると、
     そのかたまりの元の文(md が付けた data-line〜data-end の行。リストの項目は、その下の項目も含む)を、その場の編集欄にする。
     表はセルごとに、そのセルの中身だけを編集する(core.js の tableEdit)。チェックボックスは押すと [ ] と [x] を切り替える。
     打った文字は「テキスト」表示と同じく、入力ごとに履歴に入る(元の文を直して commit)。書いていない所は変えない。
     Esc か、ほかの場所をクリックすると閉じて、整形した表示に戻す。数式と図はここでは編集しない(ダブルクリックで数式エディタ・図エディタ)。
     読み取り専用のメモでは編集しない。
     元に戻す: 編集欄の中ではその編集欄の Ctrl+Z。閉じたあとは、プレビューでの変更を1回ずつ戻す(peUndo。メモを移ると消える) */
  const PE_SKIP = 'a, img, .math, .diagram, sup.fnref, .fnback, .link-other, .note-link, .att-file, input, button, textarea, .alert-title, .footnotes, .att-missing';
  const peAllowed = () => S.mode === 'preview' && !!cur() && !isRO(cur()) && $('modal').hidden;
  // 何も書いていないメモのプレビューなら、「空のメモ」の表示(そうでなければ null)
  const peBlank = () => $('preview').querySelector(':scope > p.empty');
  /* プレビューを作り直す。anchor(元の文の行)のかたまりが、作り直す前の top(画面の上からの高さ)と同じ高さに来るようにする */
  function renderPreview() {
    const pv = $('preview');
    pv.innerHTML = md(cur().text, { lines: true }) || '<p class="empty">' + esc(T('emptyNote')) + '</p>';
    lastHydrate = hydrate(pv, cur().id);
    highlight(pv, S.q);
    // チェックボックスは、編集できるメモでは押せるようにする(押したときは元の文を書き換える)
    const ro = isRO(cur());
    pv.classList.toggle('pe-on', !ro);
    pv.querySelectorAll('li > input[type=checkbox]').forEach(cb => { cb.disabled = ro; });
  }
  function peRerender(anchor, top) {
    const pv = $('preview');
    renderPreview();
    const el = anchor == null ? null : peBlockAt(anchor) || [...pv.querySelectorAll('[data-line]')].find(x => +x.dataset.line >= anchor);
    if (el && top != null) pv.scrollTop += el.getBoundingClientRect().top - top;
    if (S.frOpen) frRefresh();
  }
  /* 元の文を v にする(「テキスト」表示の編集欄にも入れて、履歴に入れる) */
  function peSetText(v) {
    const n = cur(), ed = $('editor');
    if (!n || isRO(n) || v === n.text) return false;
    const op = makeOp(ed.value, v, 0);
    ed.setRangeText(op.i, op.p, op.p + op.d.length, 'preserve');
    commit();
    return true;
  }
  function peRecord(before, after) {
    if (before === after) return;
    peUndo.push({ id: S.active, before: before, after: after });
    if (peUndo.length > 200) peUndo.shift();
    peRedo.length = 0;
  }
  function peUndoRedo(redo) {
    const from = redo ? peRedo : peUndo, to = redo ? peUndo : peRedo;
    const x = from[from.length - 1];
    if (!x || x.id !== S.active || cur().text !== (redo ? x.before : x.after)) { from.length = 0; return; }
    from.pop();
    const top = $('preview').getBoundingClientRect().top;
    const line = cur().text.slice(0, makeOp(cur().text, redo ? x.after : x.before, 0).p).split('\n').length - 1;
    const el = peBlockAt(line);
    const y = el ? el.getBoundingClientRect().top : top;
    peSetText(redo ? x.after : x.before);
    to.push(x);
    peRerender(line, y);
  }
  // 行 line から始まる、編集できるかたまり
  function peBlockAt(line) {
    return [...$('preview').querySelectorAll('[data-line="' + line + '"]')].find(x => !x.matches('.math, .diagram') && !x.closest('.footnotes')) || null;
  }
  // 編集できるかたまり(表は行)を、元の文の順に
  function peBlocks() {
    return [...$('preview').querySelectorAll('[data-line]')].filter(x => !x.matches('.math, .diagram') && !x.closest('.footnotes')).sort((a, b) => +a.dataset.line - +b.dataset.line);
  }
  /* クリックした場所を、作り直したあとでも探せる形で覚える: セルなら { row, col }、かたまりなら { line, before, total }
     (before はかたまりの中でクリックした場所より前の表示の文字、total は表示の文字の数。カーソルを置く場所を元の文で探すのに使う) */
  function peDescribe(e) {
    const t = e.target;
    if (!t.closest || !$('preview').contains(t) || t.closest(PE_SKIP)) return null;
    // 何も書いていないメモ(「空のメモ」の表示だけ)は、どこを押しても空の編集欄にする
    if (peBlank()) return { blank: true };
    const cell = t.closest('td, th');
    if (cell) { const tr = cell.closest('tr[data-line]'); return tr ? { row: +tr.dataset.line, col: [...tr.children].indexOf(cell) } : null; }
    const el = t.closest('[data-line]');
    if (!el || el.matches('.math, .diagram, tr')) return null;
    let before = '';
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (r && el.contains(r.startContainer)) { const rr = document.createRange(); rr.setStart(el, 0); rr.setEnd(r.startContainer, r.startOffset); before = rr.toString(); }
    return { line: +el.dataset.line, before: before, total: el.textContent.length };
  }
  function peOpen(d) {
    if (!d || !peAllowed()) return;
    if (d.blank) { const el = peBlank(); if (el) peOpenBlock(el, { at: 'end', blank: true }); return; }
    if (d.row != null) {
      const tr = $('preview').querySelector('tr[data-line="' + d.row + '"]');
      const cell = tr && tr.children[Math.max(0, Math.min(tr.children.length - 1, d.col))];
      if (cell) peOpenCell(cell, d.end);
      return;
    }
    const el = peBlockAt(d.line);
    if (!el) return;
    if (el.tagName === 'TR') { peOpenCell(el.children[d.end === false ? 0 : el.children.length - 1] || el.children[0]); return; }
    peOpenBlock(el, d);
  }
  function peOpenBlock(el, d) {
    const n = cur(), lines = n.text.split('\n');
    // 空のメモ(d.blank)は、元の文の全体(空か空白だけ)を編集する
    const s = d && d.blank ? 0 : +el.dataset.line;
    let e = d && d.blank ? lines.length : +el.dataset.end;
    if (!(d && d.blank)) el.querySelectorAll('[data-end]').forEach(x => { e = Math.max(e, +x.dataset.end); });
    e = Math.min(e, lines.length);
    const src = lines.slice(s, e).join('\n');
    const ta = document.createElement('textarea');
    ta.className = 'pe-edit';
    ta.spellcheck = false;
    ta.value = src;
    let holder = ta;
    if (el.tagName === 'LI') { holder = document.createElement('li'); holder.className = 'pe-li'; holder.appendChild(ta); }
    el.before(holder);
    el.hidden = true;
    Object.assign(pe, { box: ta, holder: holder, el: el, kind: 'block', s: s, e: e, n: e - s, start: n.text, pre: lines.slice(0, s).join('\n'), post: lines.slice(e).join('\n'), hasPost: e < lines.length });
    peFit(true);
    ta.focus({ preventScroll: true });
    const pos = d && d.at === 'start' ? 0 : d && d.at === 'end' ? src.length : caretFromRendered(src, d ? d.before : '', d ? d.total : 0);
    ta.setSelectionRange(pos, pos);
    // 描き終えたあとにもう一度合わせる(フォントや折り返しが決まってから)
    requestAnimationFrame(() => { if (pe.box === ta) peFit(true); });
    sendUiState();
  }
  function peOpenCell(cell, atEnd) {
    const tr = cell.closest('tr[data-line]');
    if (!tr) return;
    const row = +tr.dataset.line, col = [...tr.children].indexOf(cell);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pe-cell';
    inp.spellcheck = false;
    // 中身の \| は | で見せる(書き戻すときに tableEdit がエスケープし直す)
    inp.value = tableCell(cur().text, row, col).replace(/\\\|/g, '|');
    Object.assign(pe, { box: inp, holder: inp, el: cell, kind: 'cell', row: row, col: col, start: cur().text, html: cell.innerHTML, init: inp.value });
    peLastCell = { row: row, col: col };
    cell.innerHTML = '';
    cell.appendChild(inp);
    inp.focus({ preventScroll: true });
    const p = atEnd === false ? 0 : inp.value.length;
    inp.setSelectionRange(p, p);
    sendUiState();
  }
  /* 編集欄の高さを中身に合わせる(折り返した行も含めて、全体が見えるように)。reveal なら、編集欄の全体が画面に入るように動かす
     (画面より高いときは、編集欄の上端を画面の上端に) */
  function peFit(reveal) {
    if (!pe.box || pe.kind !== 'block') return;
    const ta = pe.box, pv = $('preview');
    const keep = pv.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
    pv.scrollTop = keep;
    if (!reveal) return;
    const r = ta.getBoundingClientRect(), v = pv.getBoundingClientRect();
    if (r.height > v.height - 16 || r.top < v.top) pv.scrollTop += r.top - v.top - 8;
    else if (r.bottom > v.bottom) pv.scrollTop += r.bottom - v.bottom + 8;
  }
  window.addEventListener('resize', () => peFit());
  // 編集欄の中身を元の文に入れる
  function peSync() {
    if (!pe.box || peComposing) return;
    if (pe.kind === 'block') {
      peSetText(pe.pre + (pe.s > 0 ? '\n' : '') + pe.box.value + (pe.hasPost ? '\n' + pe.post : ''));
      peFit();
    } else if (pe.box.value !== pe.init || cur().text !== pe.start) {
      // 何も変えずに閉じたときは書かない(セルの足りない行を補ったりしない)
      const r = tableEdit(cur().text, pe.row, pe.col, 'cell', pe.box.value);
      if (r) peSetText(r.text);
    }
  }
  /* 編集欄を閉じて、整形した表示に戻す。戻り値は、かたまりの行の数の増減(後ろのかたまりの行がずれる分) */
  function peClose(noRender) {
    if (!pe.box) return 0;
    peSync();
    const top = pe.holder.getBoundingClientRect().top;
    const delta = pe.kind === 'block' ? pe.box.value.split('\n').length - pe.n : 0;
    const anchor = pe.kind === 'block' ? pe.s : pe.row;
    peRecord(pe.start, cur().text);
    const wasFocused = pe.holder.contains(document.activeElement);
    pe.box = null;
    pe.holder = null;
    pe.kind = '';
    peComposing = false;
    if (!noRender && S.mode === 'preview') {
      peRerender(anchor, top);
      if (wasFocused) $('preview').focus({ preventScroll: true });
    }
    sendUiState();
    return delta;
  }
  // 前後のかたまりの編集に移る(↑ で前、↓ で次。表は行の最初のセル)
  function peMove(dir) {
    const s = pe.s, end = pe.s + pe.box.value.split('\n').length;
    peClose();
    const list = peBlocks();
    const el = dir < 0 ? list.filter(x => +x.dataset.line < s).pop() : list.find(x => +x.dataset.line >= end);
    if (!el) return;
    if (el.tagName === 'TR') { peOpenCell(el.children[0], dir < 0); return; }
    peOpenBlock(el, { at: dir < 0 ? 'end' : 'start' });
  }
  // セルを移る(Tab で次・Shift+Tab で前、↑↓ で上下の行)。最後のセルで Tab を押すと、下に行を足す
  function peCellMove(dx, dy) {
    const row = pe.row, col = pe.col;
    peClose();
    const t = tableAt(cur().text, row);
    if (!t) return;
    const rows = [t.head].concat(t.rows);
    let k = rows.indexOf(row), c = col;
    if (dy) k += dy;
    else {
      c += dx;
      if (c >= t.cols) { c = 0; k++; }
      if (c < 0) { c = t.cols - 1; k--; }
    }
    if (k < 0) return;
    if (k >= rows.length) {
      if (dy || !dx) return;
      peTable(rows[rows.length - 1], 0, 'rowBelow');
      return;
    }
    peOpen({ row: rows[k], col: c, end: true });
  }
  /* 表の操作(行・列の挿入と削除、列の配置、表の削除)。プレビューでは作り直して、挿入したときは新しいセルを編集にする */
  function peTable(row, col, action) {
    if (!peAllowed()) return;
    const before = cur().text;
    const r = tableEdit(before, row, col, action);
    if (!r) return;
    const tr = $('preview').querySelector('tr[data-line="' + row + '"]');
    const top = tr ? tr.getBoundingClientRect().top : null;
    peSetText(r.text);
    peRecord(before, r.text);
    peRerender(r.col < 0 ? r.row : row, top);
    if (/^(row|col)(Above|Below|Left|Right)$/.test(action)) peOpen({ row: r.row, col: r.col });
    else if (r.col >= 0) peLastCell = { row: r.row, col: r.col };
    else peLastCell = null;
  }
  /* 「テキスト」表示での表の操作: カーソルのあるセルに対して行い、元に戻せるよう編集欄への入力として書き換える */
  function textTable(action) {
    const ed = $('editor');
    if (isRO(cur())) { roBlocked(); return; }
    const at = tableCaret(ed.value, ed.selectionStart);
    const r = at && tableEdit(ed.value, at.row, at.col, action);
    if (!r) { toast(T(at ? 'tblCannot' : 'tblNotInTable')); return; }
    const op = makeOp(ed.value, r.text, 0);
    frInsert(op.p, op.p + op.d.length, op.i);
    const p = r.col >= 0 ? tableCellPos(ed.value, r.row, r.col) : Math.min(ed.value.length, op.p);
    ed.focus();
    ed.setSelectionRange(p, p);
    queueStatus();
  }
  /* 空の表を入れる(core.js の tableInsert)。「テキスト」表示ではカーソルの行の次(表・コードの中ならその後ろ)、
     プレビューでは編集中・右クリックしたかたまりの次(どこでもなければメモの最後)。入れたら見出しの最初のセルにカーソルを置く */
  function textInsertTable() {
    const ed = $('editor');
    if (isRO(cur())) { roBlocked(); return; }
    const r = tableInsert(ed.value, tableInsertAfter(ed.value, ed.selectionStart));
    const op = makeOp(ed.value, r.text, 0);
    frInsert(op.p, op.p + op.d.length, op.i);
    const p = tableCellPos(ed.value, r.row, 0);
    ed.focus();
    ed.setSelectionRange(p, p);
    queueStatus();
  }
  // かたまり el の最後の行(リストの項目は下の項目も含む)
  const peBlockEnd = el => { let e = +el.dataset.end || 0; el.querySelectorAll('[data-end]').forEach(x => { e = Math.max(e, +x.dataset.end); }); return e - 1; };
  // 表を入れる行: かたまりの次。引用・注意書き・表の中なら、それ全体の次(途中に入れると分かれてしまうので)
  function peAfter(el) {
    if (!el.closest('blockquote, .tblwrap')) return peBlockEnd(el);
    let top = el;
    while (top.parentElement && top.parentElement !== $('preview')) top = top.parentElement;
    return peBlockEnd(top);
  }
  function peInsertTable(after, el) {
    if (!peAllowed()) return;
    const before = cur().text;
    const r = tableInsert(before, after == null ? before.split('\n').length : after);
    const top = el && el.isConnected ? el.getBoundingClientRect().top : null;
    peSetText(r.text);
    peRecord(before, r.text);
    peRerender(top == null ? null : +el.dataset.line, top);
    peOpen({ row: r.row, col: 0, end: true });
    if (pe.box) pe.box.scrollIntoView({ block: 'nearest' });
  }
  function tableMenuAction(action) {
    if (action === 'insert') {
      if (S.mode === 'edit') { textInsertTable(); return; }
      if (S.mode !== 'preview' || isRO(cur())) return;
      const line = pe.kind === 'block' ? pe.s : null, row = pe.kind === 'cell' ? pe.row : null;
      if (pe.box) peClose();
      const el = line != null ? peBlockAt(line) : row != null ? $('preview').querySelector('tr[data-line="' + row + '"]')
        : lastClick && lastClick.el && lastClick.el.isConnected && $('preview').contains(lastClick.el) ? lastClick.el : null;
      peInsertTable(el ? peAfter(el) : null, el);
      return;
    }
    if (S.mode === 'edit') { textTable(action); return; }
    if (S.mode !== 'preview' || isRO(cur())) return;
    const at = pe.kind === 'cell' ? { row: pe.row, col: pe.col } : peLastCell;
    if (pe.box) peClose();
    if (!at || !tableAt(cur().text, at.row)) { toast(T('tblNotInTable')); return; }
    peTable(at.row, at.col, action);
  }
  $('preview').addEventListener('click', e => {
    const cb = e.target.closest && e.target.closest('li > input[type=checkbox]');
    if (cb && $('preview').contains(cb)) {
      e.preventDefault();
      if (!peAllowed()) return;
      const li = cb.closest('li[data-line]');
      if (!li) return;
      const n = +li.dataset.line, before = cur().text, lines = before.split('\n');
      const m = /^((?:\s*>\s?)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(lines[n] || '');
      if (!m) return;
      lines[n] = m[1] + (m[2] === ' ' ? 'x' : ' ') + lines[n].slice(m[1].length + 1);
      const top = li.getBoundingClientRect().top;
      if (peSetText(lines.join('\n'))) { peRecord(before, cur().text); peRerender(n, top); }
      return;
    }
    if (pe.box || !peAllowed() || !window.getSelection().isCollapsed) return;
    const d = peNext || peDescribe(e);
    peNext = null;
    peOpen(d);
  });
  // 編集欄の外を押したら閉じる(押した場所がプレビューのかたまりなら、閉じたあとでそこを編集にする)
  document.addEventListener('mousedown', e => {
    peNext = null;
    if (!pe.box || pe.holder.contains(e.target)) return;
    // 「添付」ボタンは、編集欄を開いたまま押せる(カーソルの位置に入れる)
    if (e.target.closest && e.target.closest('#attBtn')) { e.preventDefault(); return; }
    let d = peDescribe(e);
    const kind = pe.kind, end = pe.e;
    const delta = peClose();
    if (d && kind === 'block') {
      if (d.line != null && d.line >= end) d.line += delta;
      if (d.row != null && d.row >= end) d.row += delta;
    }
    peNext = d;
    if (d) e.preventDefault();   // 作り直した表示で文字の選択を始めない
  }, true);
  // 押した場所のかたまりは作り直して無くなっているので(click が来ない)、離したときに開く
  document.addEventListener('mouseup', () => {
    if (!peNext) return;
    const d = peNext;
    peNext = null;
    if (!pe.box && window.getSelection().isCollapsed) peOpen(d);
  }, true);
  // 数式をダブルクリック: 数式エディタで編集。図をダブルクリック: 図エディタで編集(読み取り専用のメモでは見るだけ)
  $('preview').addEventListener('dblclick', e => {
    const m = e.target.closest && e.target.closest('#preview .math, #preview .diagram[data-line]');
    if (!m || pe.box || !$('preview').contains(m)) return;
    if (m.classList.contains('math')) { if (peAllowed()) peMathEdit(m); }
    else if (peAllowed()) peDiagramEdit(m);
    else diagramView(m);
  });
  // 履歴の表示の図をダブルクリック: 見るだけの図エディタ
  $('hvBody').addEventListener('dblclick', e => {
    const m = e.target.closest && e.target.closest('.diagram[data-src]');
    if (m && $('hvBody').contains(m)) diagramView(m);
  });
  $('preview').addEventListener('input', e => { if (e.target === pe.box) peSync(); });
  $('preview').addEventListener('compositionstart', e => { if (e.target === pe.box) peComposing = true; });
  $('preview').addEventListener('compositionend', e => { if (e.target === pe.box) { peComposing = false; peSync(); } });
  $('preview').addEventListener('keydown', e => {
    if (e.target !== pe.box || e.isComposing || e.keyCode === 229) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.key === 'Escape') { e.preventDefault(); peClose(); return; }
    if (pe.kind === 'cell') {
      if (e.key === 'Tab' && plain) { e.preventDefault(); peCellMove(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'Enter' && plain) { e.preventDefault(); peClose(); }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain && !e.shiftKey) { e.preventDefault(); peCellMove(0, e.key === 'ArrowUp' ? -1 : 1); }
      return;
    }
    const ta = pe.box, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if (e.key === 'ArrowUp' && plain && !e.shiftKey && s === en && v.lastIndexOf('\n', s - 1) < 0) { e.preventDefault(); peMove(-1); return; }
    if (e.key === 'ArrowDown' && plain && !e.shiftKey && s === en && v.indexOf('\n', s) < 0) { e.preventDefault(); peMove(1); return; }
    // Enter / Tab: 「テキスト」表示と同じ、箇条書きの続き・自動インデント・字下げ
    if ((e.key === 'Enter' || e.key === 'Tab') && plain) {
      const r = e.key === 'Tab' ? tabEdit(v, s, en, EDIT.indentWidth, e.shiftKey) : newlineEdit(v, s, en, { indent: EDIT.autoIndent, list: EDIT.autoList, soft: e.shiftKey });
      if (!r) return;
      e.preventDefault();
      peReplace(r.from, r.to, r.insert);
      ta.setSelectionRange(r.selStart, r.selEnd);
    }
  });
  /* 編集欄の範囲を置き換える(元に戻せるよう、入力として行う) */
  function peReplace(from, to, str) {
    const ta = pe.box;
    if (ta.value.slice(from, to) === str) return;
    ta.focus();
    ta.setSelectionRange(from, to);
    let ok = false;
    try { ok = str ? document.execCommand('insertText', false, str) : document.execCommand('delete'); } catch (err) { ok = false; }
    if (!ok) { ta.setRangeText(str, from, to, 'end'); peSync(); }
  }
  // プレビューでの変更を元に戻す・やり直す(編集欄を開いていないとき)
  document.addEventListener('keydown', e => {
    if (S.mode !== 'preview' || pe.box || !(e.ctrlKey || e.metaKey) || e.altKey || !$('modal').hidden) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== $('preview') && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); peUndoRedo(false); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); peUndoRedo(true); }
  });
  // 表のセルを右クリック: 表の操作のメニュー
  document.addEventListener('contextmenu', async e => {
    const cell = e.target.closest && e.target.closest('#preview td, #preview th');
    if (!cell || !peAllowed() || e.target.closest('input')) return;
    if (!window.getSelection().isCollapsed && window.getSelection().toString().trim()) return;
    e.preventDefault();
    const tr = cell.closest('tr[data-line]');
    if (!tr) return;
    let row = +tr.dataset.line;
    const col = [...tr.children].indexOf(cell);
    if (pe.box) { const kind = pe.kind, end = pe.e, delta = peClose(); if (kind === 'block' && row >= end) row += delta; }
    const t = tableAt(cur().text, row);
    if (!t) return;
    let action = null;
    try { action = await api.tableMenu({ inTable: true, head: row === t.head, cols: t.cols, align: t.align[col] || '' }); } catch (err) { action = null; }
    if (action === 'insert') peInsertTable(t.rows.length ? t.rows[t.rows.length - 1] : t.delim, tr);
    else if (action) peTable(row, col, action);
    else peLastCell = { row: row, col: col };
  });
  // 表の外を右クリック(文字を選んでいないとき): 「数式を挿入…」と「表を挿入」。かたまりの上ならその次、何もない所(空のメモも)ならメモの最後に入れる
  document.addEventListener('contextmenu', async e => {
    const t = e.target;
    if (!t.closest || !$('preview').contains(t) || t.closest('td, th, a, img, .math, .diagram, [data-att], input, textarea, .footnotes') || !peAllowed()) return;
    if (!window.getSelection().isCollapsed && window.getSelection().toString().trim()) return;
    e.preventDefault();
    const blk = t.closest('[data-line]');
    let line = blk ? +blk.dataset.line : null;
    if (pe.box) {
      const kind = pe.kind, end = pe.e, delta = peClose();
      if (kind === 'block' && line != null && line >= end) line += delta;
    }
    let action = null;
    try { action = await api.tableMenu({ inTable: false }); } catch (err) { action = null; }
    if (action !== 'insert' && action !== 'math' && action !== 'diagram') return;
    const el = line != null ? peBlockAt(line) : null;
    if (action === 'math') peInsertMath(el);
    else if (action === 'diagram') peInsertDiagram(el);
    else peInsertTable(el ? peAfter(el) : null, el);
  });
  // 「テキスト」表示と、プレビューで編集しているかたまり・セルの右クリック: メニューに「数式を挿入…」(カーソルが数式の中なら「数式を編集…」)と「表」を足す
  // (カーソルが表の中なら表の操作、外なら「表を挿入」だけ。main.js に先に知らせる)
  document.addEventListener('contextmenu', e => {
    let info = null, math = false, cell = false, diagram = false;
    if (e.target === $('editor') && S.mode === 'edit' && !isRO(cur())) {
      const ed = $('editor'), at = tableCaret(ed.value, ed.selectionStart);
      const t = at && tableAt(ed.value, at.row);
      info = t ? { inTable: true, head: at.row === t.head || at.row === t.delim, cols: t.cols, align: t.align[at.col] || '' } : { inTable: false };
      math = !!mathAt(ed.value, ed.selectionStart);
      diagram = !!diagramBlock(ed.value, ed.value.slice(0, ed.selectionStart).split('\n').length - 1);
    } else if (pe.box && e.target === pe.box && S.mode === 'preview' && !isRO(cur())) {
      cell = pe.kind === 'cell';
      const t = cell && tableAt(cur().text, pe.row);
      info = t ? { inTable: true, head: pe.row === t.head, cols: t.cols, align: t.align[pe.col] || '' } : { inTable: false };
      math = !!mathAt(pe.box.value, pe.box.selectionStart);
    }
    api.editContext({ table: info, math: math, cell: cell, diagram: diagram, editable: !!info });
  }, true);

  /* ---------- 数式エディタ ----------
     「編集」→「数式を挿入…」(Ctrl+Shift+M)、右クリック、プレビューの数式のダブルクリックで開く窓。
     左はパレット(ひな型と、記号のタブ。mathpalette.js)、右上は LaTeX、右下はメモと同じ設定で描いたプレビュー。
     パレットの記号はカーソルの位置に入り、最初の空の {} にカーソルを置く(Tab で次の {}、Shift+Tab で前の {})。
     ひな型は、LaTeX が空ならそのまま入れ、空でなければカーソルの位置に入れる。書き方に誤りがあれば、誤りを出して「挿入」を押せなくする。
     入れる・置き換えるのは core.js の mathInsert・mathReplace(1回の編集として履歴に残る) */
  const mathCache = new Map();   // パレットのボタンの描画(LaTeX → HTML)
  let mathTab = 'tpl';
  function mathHtml(tex, display) {
    const key = (display ? 'D' : 'I') + tex;
    if (mathCache.has(key)) return mathCache.get(key);
    let h;
    try { h = katex.renderToString(tex, Object.assign({}, MATH_OPTS, { displayMode: !!display })); } catch (err) { h = esc(tex); }
    mathCache.set(key, h);
    return h;
  }
  // パレットのボタンに描く形(mathpalette.js の show)
  const mathShow = s => window.MATH_PALETTE.show(s);
  /* init: { tex, display, editing }。onOK(tex, display) */
  function openMathEditor(init, onOK) {
    const P = window.MATH_PALETTE;
    const L = LANG === 'en' ? 'en' : 'ja';
    const box = el('div', 'mathed');
    const left = el('div', 'me-left'), tabs = el('div', 'me-tabs'), pal = el('div', 'me-pal');
    tabs.setAttribute('role', 'tablist');
    left.append(tabs, pal);
    const right = el('div', 'me-right');
    const ta = el('textarea', 'me-tex');
    ta.spellcheck = false;
    ta.value = init.tex || '';
    ta.setAttribute('aria-label', T('mathTexLabel'));
    const pv = el('div', 'me-pv'), err = el('div', 'me-err');
    pv.setAttribute('aria-live', 'polite');
    right.append(el('div', 'me-lbl', T('mathTexLabel')), ta, el('div', 'me-lbl', T('mathPreviewLabel')), pv, err);
    box.append(left, right);
    // 下: 独立した行・文中の選択と、キャンセル・挿入
    const foot = el('div', 'me-foot');
    const radio = (v, label) => { const lb = el('label', 'me-mode'); const r = el('input'); r.type = 'radio'; r.name = 'meMode'; r.value = v; lb.append(r, document.createTextNode(label)); return { lb, r }; };
    const rd = radio('display', T('mathDisplay')), ri = radio('inline', T('mathInline'));
    if (init.inlineOnly) rd.r.disabled = true;
    (init.display && !init.inlineOnly ? rd : ri).r.checked = true;
    const modes = el('div', 'me-modes');
    modes.append(rd.lb, ri.lb);
    const cancel = el('button', 'btn', T('cancel'));
    const ok = el('button', 'btn primary', T(init.editing ? 'mathReplaceBtn' : 'mathInsertBtn'));
    cancel.type = ok.type = 'button';
    const btns = el('div', 'me-btns');
    btns.append(cancel, ok);
    foot.append(modes, btns);
    const display = () => rd.r.checked;
    function update() {
      const v = ta.value;
      let e = '';
      if (!v.trim()) { pv.innerHTML = ''; pv.classList.add('empty'); pv.textContent = T('mathEmpty'); }
      else {
        pv.classList.remove('empty');
        try { pv.innerHTML = katex.renderToString(v, Object.assign({}, MATH_OPTS, { displayMode: display() })); } catch (x) { e = String(x && x.message || x).replace(/^KaTeX parse error: /, ''); pv.textContent = v; }
      }
      err.textContent = e ? T('mathError', { msg: e }) : '';
      ok.disabled = !v.trim() || !!e;
    }
    // カーソルの位置に s を入れる(元に戻せるよう入力として)。最初の空の {} にカーソルを置く
    function put(s, replaceAll) {
      ta.focus();
      if (replaceAll) ta.setSelectionRange(0, ta.value.length);
      const a = ta.selectionStart;
      let done = false;
      try { done = document.execCommand('insertText', false, s); } catch (x) { done = false; }
      if (!done) { ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end'); }
      const i = s.indexOf('{}');
      const p = i >= 0 ? a + i + 1 : a + s.length;
      ta.setSelectionRange(p, p);
      update();
    }
    function showTab(id) {
      mathTab = id;
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
      pal.textContent = '';
      pal.className = 'me-pal' + (id === 'tpl' ? ' tpl' : '');
      if (id === 'tpl') {
        for (const g of P.templates) {
          pal.append(el('div', 'me-group', g[L]));
          for (const it of g.items) {
            const b = el('button', 'me-tplbtn');
            b.type = 'button';
            b.title = it[2];
            const name = el('span', 'me-name', L === 'en' ? it[1] : it[0]), m = el('span', 'me-math');
            m.innerHTML = mathHtml(it[2], false);
            b.append(name, m);
            b.addEventListener('click', () => put(it[2], !ta.value.trim()));
            pal.append(b);
          }
        }
        return;
      }
      const tab = P.tabs.find(x => x.id === id);
      for (const s of tab.items) {
        const b = el('button', 'me-sym');
        b.type = 'button';
        b.title = s;
        b.setAttribute('aria-label', s);
        b.innerHTML = mathHtml(mathShow(s), false);
        b.addEventListener('click', () => put(s));
        pal.append(b);
      }
    }
    for (const t of P.tabs) {
      const b = el('button', 'me-tab', t[L]);
      b.type = 'button';
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => showTab(t.id));
      tabs.append(b);
    }
    ta.addEventListener('input', update);
    rd.r.addEventListener('change', update);
    ri.r.addEventListener('change', update);
    ta.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const p = emptyBraceAt(ta.value, e.shiftKey ? ta.selectionStart : ta.selectionEnd, e.shiftKey);
        if (p >= 0) { e.preventDefault(); ta.setSelectionRange(p, p); }
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); }
    });
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', () => {
      update();
      if (ok.disabled) return;
      const tex = ta.value, disp = display();
      closeModal();
      onOK(tex, disp);
    });
    openModal(T(init.editing ? 'mathEditTitle' : 'mathInsertTitle'), box, null, { wide: true, foot: foot, focus: ta });
    showTab(P.tabs.some(t => t.id === mathTab) ? mathTab : 'tpl');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    update();
  }
  /* 「数式を挿入…」: 「テキスト」表示ではカーソルの数式(あれば編集、無ければ挿入。文字を選んでいればそれを LaTeX にする)、
     プレビューでは編集中のかたまり・セルのカーソルの位置(数式の中なら編集)か、クリックしたかたまりの次(どこでもなければメモの最後) */
  function mathCommand() {
    const n = cur();
    if (!n || !$('modal').hidden) return;
    if (isRO(n)) { roBlocked(); return; }
    if (S.mode === 'edit') {
      const ed = $('editor'), s = ed.selectionStart, e = ed.selectionEnd;
      const at = mathAt(ed.value, s);
      const apply = r => {
        const op = makeOp(ed.value, r.text, 0);
        frInsert(op.p, op.p + op.d.length, op.i);
        ed.focus();
        ed.setSelectionRange(r.cursor, r.cursor);
        queueStatus();
      };
      if (at && (s === e || (s >= at.s && e <= at.e))) {
        openMathEditor({ tex: at.tex.trim(), display: at.display, editing: true }, (tex, disp) => {
          const r = mathReplace(ed.value, at, tex, disp);
          apply({ text: r.text, cursor: r.e });
        });
        return;
      }
      const sel = ed.value.slice(s, e);
      const line = ed.value.slice(ed.value.lastIndexOf('\n', s - 1) + 1, ed.value.indexOf('\n', e) < 0 ? ed.value.length : ed.value.indexOf('\n', e));
      openMathEditor({ tex: sel.indexOf('\n') < 0 ? sel : '', display: !sel && !line.trim() }, (tex, disp) => {
        const r = mathInsert(ed.value, s, e, tex, disp, disp ? tableInsertAfter(ed.value, s) : null);
        apply({ text: r.text, cursor: disp ? r.selEnd + 3 : r.selEnd + (r.text[r.selEnd] === '$' ? 1 : 2) });
      });
      return;
    }
    if (S.mode !== 'preview') return;
    if (pe.kind === 'block') {
      const ta = pe.box, s = ta.selectionStart, e = ta.selectionEnd;
      const at = mathAt(ta.value, s);
      if (at && (s === e || (s >= at.s && e <= at.e))) {
        openMathEditor({ tex: at.tex.trim(), display: at.display, editing: true }, (tex, disp) => {
          const r = mathReplace(ta.value, at, tex, disp);
          const op = makeOp(ta.value, r.text, 0);
          peReplace(op.p, op.p + op.d.length, op.i);
          ta.focus();
          ta.setSelectionRange(r.e, r.e);
          peFit();
        });
        return;
      }
      const sel = ta.value.slice(s, e);
      openMathEditor({ tex: sel.indexOf('\n') < 0 ? sel : '', display: false }, (tex, disp) => {
        const r = mathInsert(ta.value, s, e, tex, disp);
        const op = makeOp(ta.value, r.text, 0);
        peReplace(op.p, op.p + op.d.length, op.i);
        ta.focus();
        ta.setSelectionRange(r.selEnd, r.selEnd);
        peFit();
      });
      return;
    }
    if (pe.kind === 'cell') {
      const inp = pe.box, s = inp.selectionStart, e = inp.selectionEnd;
      const at = mathAt(inp.value, s);
      if (at && (s === e || (s >= at.s && e <= at.e))) {
        openMathEditor({ tex: at.tex.trim(), display: false, editing: true, inlineOnly: true }, tex => {
          const op = makeOp(inp.value, mathReplace(inp.value, at, tex, false).text, 0);
          inp.focus();
          inp.setSelectionRange(op.p, op.p + op.d.length);
          try { if (!document.execCommand('insertText', false, op.i)) throw new Error('x'); } catch (x) { inp.setRangeText(op.i, op.p, op.p + op.d.length, 'end'); }
          peSync();
        });
        return;
      }
      openMathEditor({ tex: inp.value.slice(s, e), display: false, inlineOnly: true }, tex => {
        inp.focus();
        inp.setSelectionRange(s, e);
        const v = mathInline(tex, inp.value[e]);
        try { if (!document.execCommand('insertText', false, v)) throw new Error('x'); } catch (x) { inp.setRangeText(v, s, e, 'end'); }
        peSync();
      });
      return;
    }
    peInsertMath(lastClick && lastClick.el && lastClick.el.isConnected && $('preview').contains(lastClick.el) ? lastClick.el : null);
  }
  /* プレビュー(編集欄を開いていないとき): かたまり el0 の次に数式を入れる(el0 が無ければメモの最後) */
  function peInsertMath(el0) {
    if (!peAllowed()) return;
    openMathEditor({ tex: '', display: true }, (tex, disp) => {
      const before = cur().text;
      const after = el0 ? peAfter(el0) : before.split('\n').length;
      const r = disp ? mathInsert(before, 0, 0, tex, true, after) : (() => { const b = blockInsert(before, after, [mathInline(tex, '')]); return { text: b.text }; })();
      const top = el0 && el0.isConnected ? el0.getBoundingClientRect().top : null;
      if (peSetText(r.text)) { peRecord(before, r.text); peRerender(el0 ? +el0.dataset.line : null, top); }
    });
  }
  /* プレビューの数式を編集する(ダブルクリック・右クリックの「数式を編集…」)。元の文の位置は、かたまりの中で何番目の数式かで探す */
  function peMathEdit(m) {
    if (!peAllowed() || !$('modal').hidden) return;
    if (pe.box) peClose();
    const text = cur().text;
    let at = null, anchor = null;
    if (m.matches('[data-line]')) {
      anchor = +m.dataset.line;
      const lines = text.split('\n');
      let p = 0;
      for (let i = 0; i < anchor; i++) p += lines[i].length + 1;
      at = mathAt(text, p);
    } else {
      const box = m.closest('[data-line]');
      if (!box) return;
      anchor = +box.dataset.line;
      const own = [...box.querySelectorAll('.math')].filter(x => x.closest('[data-line]') === box);
      at = mathInBlock(text, +box.dataset.line, +box.dataset.end, own.indexOf(m), m.dataset.tex || '');
    }
    if (!at) { toast(T('mathNotFound')); return; }
    const inTable = !!m.closest('td, th');
    openMathEditor({ tex: at.tex.trim(), display: at.display, editing: true, inlineOnly: inTable }, (tex, disp) => {
      const before = cur().text;
      if (before !== text) return;   // 開いている間に変わったときは書き換えない
      const r = mathReplace(before, at, tex, disp && !inTable);
      const blk = peBlockAt(anchor), top = blk ? blk.getBoundingClientRect().top : null;
      if (peSetText(r.text)) { peRecord(before, r.text); peRerender(anchor, top); }
    });
  }

  /* ---------- 図エディタ ----------
     「編集」→「図を挿入…」(Ctrl+Shift+D)、右クリック、プレビューの図のダブルクリックで開く窓。
     左はひな型(diagramtemplates.js)、中は Mermaid の文、右はビューア(入力が止まって少しすると描き直す)。
     ビューアは、ドラッグで動かし、ホイール(タッチパッドのピンチも)でマウスの場所を中心に拡大・縮小し、ダブルクリックで全体を表示する。
     動かすまでは図の全体が入る大きさに合わせ続け、動かしたあとは、描き直しても拡大の具合と場所を保つ。
     書き方に誤りがあれば誤りの内容を出し、最後に描けた図を薄くして残す(誤りがあっても入れられる。プレビューでは元の文が赤く出る)。
     読み取り専用のメモと履歴の表示では、見るだけ(view)。入れる・置き換えるのは core.js の diagramInsert・diagramReplace(1回の編集) */
  let diagRefresh = null;
  Diagrams.onThemeChange(() => { if (diagRefresh) diagRefresh(); });
  /* ビューアの移動と拡大縮小。図(stage の中の SVG)を transform で動かす。onZoom(倍率) で倍率を知らせる */
  function panZoom(view, stage, onZoom) {
    const z = { k: 1, x: 0, y: 0, w: 0, h: 0, fitted: true };
    const clamp = k => Math.min(16, Math.max(0.05, k));
    const apply = () => { stage.style.transform = 'translate(' + z.x + 'px, ' + z.y + 'px) scale(' + z.k + ')'; onZoom(z.k); };
    function fit() {
      z.fitted = true;
      const vw = view.clientWidth, vh = view.clientHeight;
      if (!z.w || !z.h || !vw || !vh) return;
      z.k = clamp(Math.min((vw - 32) / z.w, (vh - 32) / z.h, 1));
      z.x = (vw - z.w * z.k) / 2;
      z.y = (vh - z.h * z.k) / 2;
      apply();
    }
    function zoomAt(k, cx, cy) {
      if (!z.w) return;
      k = clamp(k);
      z.x = cx - (cx - z.x) * k / z.k;
      z.y = cy - (cy - z.y) * k / z.k;
      z.k = k;
      z.fitted = false;
      apply();
    }
    const zoomBy = f => zoomAt(z.k * f, view.clientWidth / 2, view.clientHeight / 2);
    const pan = (dx, dy) => { if (!z.w) return; z.x += dx; z.y += dy; z.fitted = false; apply(); };
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // タッチパッドのピンチは Ctrl 付きの小さなホイールで来るので、よく効くようにする
      zoomAt(z.k * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    let drag = null;
    view.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      view.focus({ preventScroll: true });
      drag = { id: e.pointerId, px: e.clientX, py: e.clientY, x: z.x, y: z.y };
      view.setPointerCapture(e.pointerId);
      view.classList.add('dragging');
    });
    view.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id || !z.w) return;
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      if (!dx && !dy) return;
      z.x = drag.x + dx;
      z.y = drag.y + dy;
      z.fitted = false;
      apply();
    });
    const end = e => { if (drag && e.pointerId === drag.id) { drag = null; view.classList.remove('dragging'); } };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('lostpointercapture', end);
    view.addEventListener('dblclick', e => { e.preventDefault(); fit(); });
    view.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const step = e.shiftKey ? 160 : 40;
      const k = { ArrowLeft: () => pan(step, 0), ArrowRight: () => pan(-step, 0), ArrowUp: () => pan(0, step), ArrowDown: () => pan(0, -step),
        '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), ';': () => zoomBy(1.25), '-': () => zoomBy(0.8), '0': fit, '1': () => zoomAt(1, view.clientWidth / 2, view.clientHeight / 2) }[e.key];
      if (k) { e.preventDefault(); k(); }
    });
    // 窓の大きさが変わったら、全体を表示しているときは合わせ直す
    const ro = new ResizeObserver(() => { if (z.fitted) fit(); });
    ro.observe(view);
    return {
      // 図の大きさ(初めての図か、全体を表示しているときは全体を表示する。そうでなければ今の倍率と場所のまま)
      size(w, h) { const first = !z.w; z.w = w; z.h = h; if (first || z.fitted) fit(); else apply(); },
      clear() { z.w = z.h = 0; z.fitted = true; },
      fit, zoomBy,
      actual: () => zoomAt(1, view.clientWidth / 2, view.clientHeight / 2),
      stop: () => ro.disconnect()
    };
  }
  /* init: { src, editing, view }。onOK(元の文) */
  function openDiagramEditor(init, onOK) {
    const L = LANG === 'en' ? 'en' : 'ja';
    const view = !!init.view;
    const box = el('div', 'diaged' + (view ? ' view' : ''));
    const ta = el('textarea', 'de-src');
    ta.spellcheck = false;
    ta.wrap = 'off';
    ta.value = init.src || '';
    ta.readOnly = view;
    ta.placeholder = T('diagPlaceholder');
    ta.setAttribute('aria-label', T('diagSrcLabel'));
    // ひな型: 選ぶと、書いた文と置き換える(入力として入れるので Ctrl+Z で戻せる)
    if (!view) {
      const left = el('div', 'de-left'), list = el('div', 'de-tpls');
      list.setAttribute('role', 'list');
      for (const t of window.DIAGRAM_TEMPLATES || []) {
        const b = el('button', 'de-tpl', t[L]);
        b.type = 'button';
        b.addEventListener('click', () => {
          ta.focus();
          ta.setSelectionRange(0, ta.value.length);
          let done = false;
          try { done = document.execCommand('insertText', false, t.src[L]); } catch (x) { done = false; }
          if (!done) ta.setRangeText(t.src[L], 0, ta.value.length, 'end');
          ta.setSelectionRange(0, 0);
          ta.scrollTop = 0;
          pz.clear();
          changed(true);
        });
        list.append(b);
      }
      left.append(el('div', 'de-lbl', T('diagTemplates')), list, el('div', 'de-hint', T('diagTplHint')));
      box.append(left);
    }
    const mid = el('div', 'de-mid');
    mid.append(el('div', 'de-lbl', T('diagSrcLabel')), ta);
    const right = el('div', 'de-right'), bar = el('div', 'de-bar');
    const zb = (text, title, f, cls) => {
      const b = el('button', 'de-zb' + (cls ? ' ' + cls : ''), text);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', f);
      return b;
    };
    const vw = el('div', 'de-view'), stage = el('div', 'de-stage'), msg = el('div', 'de-msg'), err = el('div', 'de-err');
    vw.tabIndex = 0;
    vw.title = T('diagViewHint');
    vw.setAttribute('aria-label', T('diagViewLabel') + '. ' + T('diagViewHint'));
    vw.append(stage, msg);
    const pct = zb('100%', T('diagActual'), () => pz.actual(), 'de-pct');
    const zbs = el('div', 'de-zbs');
    zbs.append(zb('−', T('diagZoomOut'), () => pz.zoomBy(0.8)), pct, zb('+', T('diagZoomIn'), () => pz.zoomBy(1.25)), zb(T('diagFit'), T('diagFitTitle'), () => pz.fit(), 'de-fit'));
    bar.append(el('div', 'de-lbl', T('diagViewLabel')), el('div', 'de-vhint', T('diagViewHint')), zbs);
    right.append(bar, vw, err);
    box.append(mid, right);
    const pz = panZoom(vw, stage, k => { pct.textContent = Math.round(k * 100) + '%'; });
    // 下: キャンセル・挿入(見るだけなら「閉じる」だけ)
    const foot = el('div', 'de-foot'), btns = el('div', 'de-btns');
    const cancel = el('button', 'btn' + (view ? ' primary' : ''), T(view ? 'close' : 'cancel'));
    const ok = el('button', 'btn primary', T(init.editing ? 'mathReplaceBtn' : 'mathInsertBtn'));
    cancel.type = ok.type = 'button';
    btns.append(cancel);
    if (!view) btns.append(ok);
    foot.append(btns);
    // 描く: 入力が止まって 0.3 秒(ひな型を選んだときはすぐ)。古い入力の図は捨てる
    let seq = 0, timer = 0, hasSvg = false, alive = true;
    async function draw() {
      clearTimeout(timer);
      const my = ++seq, src = ta.value;
      if (!src.trim()) {
        stage.textContent = '';
        hasSvg = false;
        pz.clear();
        msg.textContent = T(view ? 'diagNothing' : 'diagEmpty');
        msg.hidden = false;
        err.textContent = '';
        vw.classList.remove('stale');
        return;
      }
      let r;
      try { r = await Diagrams.svgOf(src); } catch (x) { r = { error: String((x && x.message) || x) }; }
      if (!alive || my !== seq) return;
      if (r.svg) {
        stage.innerHTML = r.svg;
        const svg = stage.querySelector('svg');
        const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        svg.removeAttribute('style');
        let w = vb[2], h = vb[3];
        if (!(w > 0 && h > 0)) { const b = svg.getBoundingClientRect(); w = b.width; h = b.height; }
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        hasSvg = true;
        msg.hidden = true;
        err.textContent = '';
        vw.classList.remove('stale');
        pz.size(w, h);
      } else {
        err.textContent = r.error ? T('diagError', { msg: r.error }) : T('diagLoadFail');
        if (hasSvg) vw.classList.add('stale');
        else { stage.textContent = ''; msg.hidden = true; }
      }
    }
    function changed(now) {
      ok.disabled = !ta.value.trim();
      clearTimeout(timer);
      if (now) draw(); else timer = setTimeout(draw, 300);
    }
    ta.addEventListener('input', () => changed(false));
    ta.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!view) ok.click(); return; }
      if (view || e.ctrlKey || e.altKey || e.metaKey) return;
      const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
      let r = null;
      // Tab / Shift+Tab: 字下げ(Mermaid の図には、字下げで形が決まるものがある)。Enter: 前の行と同じだけ字下げする
      if (e.key === 'Tab') r = tabEdit(v, s, en, EDIT.indentWidth, e.shiftKey);
      else if (e.key === 'Enter' && !e.shiftKey) {
        const ind = /^[ \t]*/.exec(v.slice(v.lastIndexOf('\n', s - 1) + 1, s))[0];
        r = { from: s, to: en, insert: '\n' + ind, selStart: s + 1 + ind.length, selEnd: s + 1 + ind.length };
      } else return;
      e.preventDefault();
      if (!r) return;
      ta.setSelectionRange(r.from, r.to);
      let done = false;
      try { done = document.execCommand('insertText', false, r.insert); } catch (x) { done = false; }
      if (!done) { ta.setRangeText(r.insert, r.from, r.to, 'end'); changed(false); }
      ta.setSelectionRange(r.selStart, r.selEnd);
    });
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', () => {
      const src = diagramNorm(ta.value);
      if (!src) return;
      closeModal();
      onOK(src);
    });
    diagRefresh = () => draw();
    openModal(T(view ? 'diagViewTitle' : init.editing ? 'diagEditTitle' : 'diagInsertTitle'), box, () => {
      alive = false;
      clearTimeout(timer);
      pz.stop();
      diagRefresh = null;
    }, { wide: true, full: true, foot: foot, focus: view ? vw : ta });
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
    changed(true);
  }
  /* 「図を挿入…」: 「テキスト」表示では、カーソルが図の中ならその図を編集、外ならカーソルの行の次(表・コード・数式の中ならその後ろ)に入れる。
     プレビューでは、編集中のかたまり・セル(表全体)の次か、クリックしたかたまりの次(図をクリックしていればその図を編集。どこでもなければメモの最後) */
  function diagramCommand() {
    const n = cur();
    if (!n || !$('modal').hidden) return;
    if (isRO(n)) { roBlocked(); return; }
    if (S.mode === 'edit') {
      const ed = $('editor'), text = ed.value;
      const b = diagramBlock(text, text.slice(0, ed.selectionStart).split('\n').length - 1);
      const apply = r => {
        if (ed.value !== text) return;
        const op = makeOp(ed.value, r.text, 0);
        frInsert(op.p, op.p + op.d.length, op.i);
        // カーソルは図の閉じの行の終わりに
        const lines = ed.value.split('\n');
        let p = 0;
        for (let i = 0; i < r.end - 1 && i < lines.length; i++) p += lines[i].length + 1;
        p = Math.min(ed.value.length, p + (lines[r.end - 1] || '').length);
        ed.focus();
        ed.setSelectionRange(p, p);
        queueStatus();
      };
      if (b) openDiagramEditor({ src: b.src, editing: true }, src => apply(diagramReplace(ed.value, b, src)));
      else openDiagramEditor({ src: '' }, src => apply(diagramInsert(ed.value, tableInsertAfter(ed.value, ed.selectionStart), src)));
      return;
    }
    if (S.mode !== 'preview') return;
    let el0 = null;
    if (pe.box) {
      const line = pe.kind === 'block' ? pe.s : pe.row;
      peClose();
      el0 = peBlockAt(line);
    } else if (lastClick && lastClick.el && lastClick.el.isConnected && $('preview').contains(lastClick.el)) el0 = lastClick.el;
    if (el0 && el0.matches('.diagram')) { peDiagramEdit(el0); return; }
    peInsertDiagram(el0);
  }
  /* プレビュー(編集欄を開いていないとき): かたまり el0 の次に図を入れる(el0 が無ければメモの最後) */
  function peInsertDiagram(el0) {
    if (!peAllowed()) return;
    openDiagramEditor({ src: '' }, src => {
      const before = cur().text;
      const el = el0 && el0.isConnected && $('preview').contains(el0) ? el0 : null;
      const r = diagramInsert(before, el ? peAfter(el) : before.split('\n').length, src);
      const top = el ? el.getBoundingClientRect().top : null;
      if (!peSetText(r.text)) return;
      peRecord(before, r.text);
      peRerender(el ? +el.dataset.line : r.line, top);
      const d = $('preview').querySelector('.diagram[data-line="' + r.line + '"]');
      if (d) d.scrollIntoView({ block: 'nearest' });
    });
  }
  /* プレビューの図を編集する(ダブルクリック・右クリックの「図を編集…」) */
  function peDiagramEdit(m) {
    if (!peAllowed() || !$('modal').hidden) return;
    if (pe.box) peClose();
    const text = cur().text, line = +m.dataset.line;
    const b = diagramBlock(text, line);
    if (!b || b.line !== line) { toast(T('diagNotFound')); return; }
    openDiagramEditor({ src: b.src, editing: true }, src => {
      const before = cur().text;
      if (before !== text) return;   // 開いている間に変わったときは書き換えない
      const r = diagramReplace(before, b, src);
      const blk = $('preview').querySelector('.diagram[data-line="' + line + '"]'), top = blk ? blk.getBoundingClientRect().top : null;
      if (peSetText(r.text)) { peRecord(before, r.text); peRerender(line, top); }
    });
  }
  /* 図を見るだけ(読み取り専用のメモ・履歴の表示) */
  function diagramView(m) {
    if (!$('modal').hidden || !m.dataset.src) return;
    openDiagramEditor({ src: m.dataset.src, view: true });
  }

  api.onMenu(name => {
    if (name === 'new') createNote();
    else if (name === 'selectall') selectAllScoped();
    else if (name === 'lines') setLines(!S.lines, true);
    else if (name === 'replace') frOpen();
    else if (name === 'attach') pickAttachments();
    else if (name === 'side') toggleSide();
    else if (name === 'search') { showSide(); $('q').focus(); $('q').select(); }
    else if (name === 'mode:history') toggleHistory();
    else if (name === 'prune') pruneHistory();
    else if (name.indexOf('fmt:') === 0) applyFormat(name.slice(4));
    else if (name.indexOf('tbl:') === 0) tableMenuAction(name.slice(4));
    else if (name === 'math') mathCommand();
    else if (name === 'diagram') diagramCommand();
    else if (name.indexOf('prefs:') === 0) { try { Object.assign(EDIT, JSON.parse(name.slice(6))); } catch (err) { /* 読めなければ今のまま */ } }
    else if (name.indexOf('keys:') === 0) { try { Object.assign(KEYD, JSON.parse(name.slice(5))); applyKeyTitles(); } catch (err) { /* 読めなければ今のまま */ } }
    else if (name === 'keys') showKeys();
    else if (name.indexOf('open:') === 0) openNoteById(name.slice(5), 'noteDeleted');
    else if (name === 'back') goBack();
    else if (name === 'recent:clear') clearRecent();
    else if (name === 'link') pickNoteLink();
    else if (name === 'props') showProps();
    else if (name === 'readonly') { if (S.active) toggleReadOnly(S.active); }
    else if (name === 'export') exportNote();
    else if (name === 'archive') exportArchive();
    else if (name === 'print') printNote('print');
    else if (name === 'pdf') printNote('pdf');
    else if (name === 'html' || name === 'mhtml' || name === 'adoc' || name === 'docx' || name === 'tex') exportPage(name);
    else if (name.indexOf('mode:') === 0) switchBase(name.slice(5));
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
    await hydrate(area, n.id, { light: true });
    const edited = (op ? T('printEdited', { when: fmtFull(op.t) }) : '') + (k !== N ? T('sep') + T('revNo', { k: baseOf(n) + k, n: baseOf(n) + N }) : '');
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
  /* ---------- HTML・MHTML・AsciiDoc・Word・LaTeX ----------
     PDF と同じく、整形した本文(履歴表示中は見ている版)を書き出す。HTML・MHTML は、上に題名と最終編集の日時、下に作成の日時。
     kind: 'html'(画像を埋め込んだ HTML)、'mhtml'、'adoc'(AsciiDoc)、'docx'(Word)、'tex'(LaTeX)。
     HTML・MHTML: 画像は読み込めたものだけ cid:<ファイルID>@everpad にして、main.js がファイルの中に入れる。
     AsciiDoc・Word・LaTeX: 画像はファイル ID と大きさ(data-w・data-h)を持たせる。数式は中身を空にして、Word には MathML(data-mml)も付ける。
     図は、Word と LaTeX には PNG(data-png)にして持たせる
     (main.js の docexport.js が、本文を見出し・段落などの構造にしてから書き出す)。
     EverPad の外では開けないリンク(他のメモ・添付ファイル・相対パスなど)は、ただの文字にする */
  let pageBusy = false;
  async function exportPage(kind, target) {
    const n = target || cur();
    if (!n || pageBusy) return;
    pageBusy = true;
    try {
      const N = n.ops.length, k = !target && S.mode === 'history' ? Math.max(0, Math.min(N, S.rev)) : N;
      const text = k === N ? n.text : textAt(n, k);
      const op = k > 0 ? n.ops[k - 1] : null;
      const box = document.createElement('div');
      box.innerHTML = md(text);
      await Diagrams.render(box, { light: true });
      for (const el of box.querySelectorAll('.diagram[data-src]')) {
        el.removeAttribute('data-theme');
        if (!(kind === 'adoc' || kind === 'docx' || kind === 'tex')) continue;
        const svg = el.querySelector('svg');
        const p = (kind === 'docx' || kind === 'tex') && svg ? await Diagrams.toPng(svg) : null;
        if (p) { el.dataset.png = p.png; el.dataset.w = p.w; el.dataset.h = p.h; }
        el.textContent = '';
      }
      const plain = (el, prefix) => { const s = document.createElement('span'); s.className = el.classList.contains('att-file') ? 'att-file' : ''; s.textContent = (prefix || '') + el.textContent; el.replaceWith(s); };
      box.querySelectorAll('a.note-link, .link-other').forEach(el => plain(el));
      box.querySelectorAll('a.att-file').forEach(el => plain(el, '📎 '));
      // 画像: 読み込めるかを確かめる(最長3秒)。読めなかったものは「画像が見つかりません」にする
      const imgs = [...box.querySelectorAll('img[data-att]')];
      await Promise.race([
        Promise.all(imgs.map(img => new Promise(r => {
          img.removeAttribute('loading');
          img.addEventListener('load', () => r(), { once: true });
          img.addEventListener('error', () => { img.replaceWith(missingEl(img.alt)); r(); }, { once: true });
          img.src = api.fileUrl(n.id, img.dataset.att);
        }))),
        new Promise(r => setTimeout(r, 3000))
      ]);
      const doc = kind === 'adoc' || kind === 'docx' || kind === 'tex';
      box.querySelectorAll('img[data-att]').forEach(img => {
        if (!img.complete || !img.naturalWidth) { img.replaceWith(missingEl(img.alt)); return; }
        if (doc) { img.dataset.w = img.naturalWidth; img.dataset.h = img.naturalHeight; img.removeAttribute('src'); return; }
        img.src = 'cid:' + img.dataset.att + '@everpad';
        img.removeAttribute('data-att');
      });
      if (doc) {
        box.querySelectorAll('.math[data-tex]').forEach(el => {
          if (kind === 'docx' && !el.classList.contains('math-error') && typeof katex !== 'undefined') {
            const display = el.classList.contains('math-display');
            try { el.dataset.mml = katex.renderToString(el.dataset.tex, Object.assign({}, MATH_OPTS, { output: 'mathml', displayMode: display })); } catch (err) { el.classList.add('math-error'); }
          }
          el.textContent = '';
        });
      }
      const head = (op ? T('printEdited', { when: fmtFull(op.t) }) : '') + (k !== N ? T('sep') + T('revNo', { k: baseOf(n) + k, n: baseOf(n) + N }) : '');
      const r = await api.exportPage(n.id, { title: shownTitle(titleOf(text)), head: head, foot: T('printCreated', { when: fmtFull(Date.now()) }), bodyHtml: box.innerHTML }, kind);
      if (r && r.status === 'saved') toast(T(kind + 'Saved', { path: r.path }));
      else if (r && r.status === 'failed') toast(T(kind + 'Failed'));
    } catch (e) {
      toast(T(kind + 'Failed'));
    } finally {
      pageBusy = false;
    }
  }
  /* ---------- 画面の上に出す小さな窓 ---------- */
  let modalBack = null;
  let modalOnClose = null;   // 閉じるときに呼ぶ(キーボードショートカットの割り当てをやめるなど)
  /* opts: { wide(広い窓), foot(「閉じる」の代わりに下に出すボタンなど), focus(最初に入力する場所) } */
  function openModal(title, body, onClose, opts) {
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
    modalOnClose = onClose || null;
    modalBack = document.activeElement;
    $('modalTitle').textContent = title;
    const b = $('modalBody'); b.textContent = ''; b.appendChild(body);
    const o = opts || {};
    $('modal').classList.toggle('wide', !!o.wide);
    $('modal').classList.toggle('full', !!o.full);
    const foot = $('modalClose').parentElement;
    foot.querySelectorAll('.modal-extra').forEach(x => x.remove());
    $('modalClose').hidden = !!o.foot;
    if (o.foot) { o.foot.classList.add('modal-extra'); foot.prepend(o.foot); }
    $('modal').hidden = false;
    (o.focus || $('modalClose')).focus();
  }
  function closeModal() {
    if ($('modal').hidden) return;
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
    $('modal').hidden = true;
    $('modal').classList.remove('wide', 'full');
    $('modalClose').parentElement.querySelectorAll('.modal-extra').forEach(x => x.remove());
    $('modalClose').hidden = false;
    $('modalBody').textContent = '';
    if (modalBack && modalBack.focus) modalBack.focus({ preventScroll: true });
  }
  $('modalClose').addEventListener('click', closeModal);
  // 外側を押したら閉じる。中で押して外で離したとき(文字の選択や図のドラッグ)は閉じない
  let modalDown = null;
  $('modal').addEventListener('mousedown', e => { modalDown = e.target; });
  $('modal').addEventListener('click', e => { if (e.target === $('modal') && modalDown === $('modal')) closeModal(); modalDown = null; });
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
    row(T('propVersions'), (baseOf(n) + n.ops.length).toLocaleString('en-US'));
    row(T('propReadOnly'), T(isRO(n) ? 'propRoOn' : 'propRoOff'));
    // 古い履歴を削除したメモは、見られる履歴の範囲と、削除した日時を出す(版数と、見られる版の数が違うことを示す)
    if (baseOf(n)) row(T('propHistory'), T('propHistoryVal', { from: baseOf(n) + 1, to: baseOf(n) + n.ops.length, b: baseOf(n), when: n.pruned ? fmtFull(n.pruned) : '' }));
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
    try { action = await api.noteMenu(shownTitle(n.loaded ? titleOf(n.text) : n.title), isRO(n)); } catch (err) { action = null; }
    row.classList.remove('ctx-target');
    if (action) noteAction(action, id);
  });
  async function noteAction(action, id) {
    if (action === 'open') { openNoteById(id, 'noteDeleted'); return; }
    if (action === 'delete') { deleteNote(id); return; }
    if (action === 'readonly') { toggleReadOnly(id); return; }
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
    else if (action === 'exportHtml') exportPage('html', n);
    else if (action === 'exportMhtml') exportPage('mhtml', n);
    else if (action === 'exportAdoc') exportPage('adoc', n);
    else if (action === 'exportDocx') exportPage('docx', n);
    else if (action === 'exportTex') exportPage('tex', n);
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

  /* ---------- キーボードショートカット(「編集」→「キーボードショートカット…」) ----------
     一覧と判定は main.js(keymap.js)。行をダブルクリックするか、選んで Enter を押すと、割り当てを始める。
     割り当て中に押したキーは main.js が読んで知らせる(そのあいだ、メニューのキーは効かない)。Enter で決め、Esc でやめる */
  let keysCap = null;          // 割り当て中: { id, accel, shown, error, conflict }
  let keysOnCaptured = null;   // 開いている一覧の、押したキーの受け取り
  api.onKeysCaptured(r => { if (keysOnCaptured) keysOnCaptured(r); });
  async function showKeys() {
    let data = await api.keysList();
    if (!data || !data.items.length) return;
    let sel = data.items[0].id;
    const box = el('div', 'keys');
    const input = el('input'); input.type = 'search'; input.placeholder = T('keysFilter'); input.setAttribute('aria-label', T('keysFilter'));
    const list = el('div', 'keys-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', T('keysTitle'));
    const msg = el('p', 'keys-msg'); msg.setAttribute('aria-live', 'polite');
    const btn = (label, fn) => { const b = el('button', 'btn', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const bChange = btn(T('keysChange'), () => startCap(sel));
    const bClear = btn(T('keysClear'), () => setKey(sel, ''));
    const bReset = btn(T('keysReset'), () => setKey(sel, null));
    const bAll = btn(T('keysResetAll'), async () => { stopCap(); const r = await api.keysResetAll(); if (r) data = r; paint(); });
    const bar = el('div', 'keys-bar'), left = el('div', 'keys-btns');
    left.append(bChange, bClear, bReset);
    bar.append(left, bAll);
    box.append(el('p', 'lead', T('keysLead')), input, list, msg, bar);
    const item = id => data.items.find(x => x.id === id);
    const filterText = () => input.value.trim().toLowerCase();
    const shown = () => data.items.filter(x => !filterText() || (x.group + ' ' + x.label + ' ' + x.shown).toLowerCase().includes(filterText()));
    const errText = e => T(e === 'needMod' ? 'keysErrNeedMod' : e === 'reserved' ? 'keysErrReserved' : e === 'winKey' ? 'keysErrWinKey' : 'keysErrBadKey', { mods: T(IS_MAC ? 'keysModsMac' : 'keysModsWin') });
    const defText = x => (x.def ? T('keysDefault', { key: x.def }) : T('keysDefaultNone'));
    function stopCap() { if (!keysCap) return; keysCap = null; api.keysCapture(null); }
    function startCap(id) { if (!item(id)) return; sel = id; keysCap = { id: id }; api.keysCapture(id); paint(true); }
    async function setKey(id, accel) { stopCap(); const r = await api.keysSet(id, accel); if (r) data = r; paint(true); }
    function paint(focus) {
      const keepFocus = focus || list.contains(document.activeElement);
      const items = shown();
      if (!keysCap && items.length && !items.some(x => x.id === sel)) sel = items[0].id;
      list.textContent = '';
      let group = null, selBtn = null;
      if (!items.length) list.appendChild(el('div', 'keys-none', T('keysNoMatch')));
      for (const x of items) {
        if (x.group !== group) { group = x.group; list.appendChild(el('div', 'keys-group', group)); }
        const b = el('button', 'keys-row'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(x.id === sel));
        const cap = keysCap && keysCap.id === x.id;
        const k = el('span', 'keys-key' + (cap ? ' cap' : x.has ? '' : ' none'), cap ? (keysCap.shown || T('keysPress')) : x.has ? x.shown : T('keysNone'));
        const badge = el('span', 'keys-badge', x.changed ? T('keysChanged') : '');
        if (x.changed) badge.title = defText(x);
        b.append(el('span', 'keys-label', x.label), k, badge);
        b.addEventListener('click', () => { if (keysCap && keysCap.id !== x.id) stopCap(); sel = x.id; paint(true); });
        b.addEventListener('dblclick', () => startCap(x.id));
        list.appendChild(b);
        if (x.id === sel) selBtn = b;
      }
      const fixed = data.fixed.filter(f => !filterText() || (f.label + ' ' + f.shown).toLowerCase().includes(filterText()));
      if (fixed.length) {
        list.appendChild(el('div', 'keys-group', T('keysFixed')));
        for (const f of fixed) { const r = el('div', 'keys-row fixed'); r.append(el('span', 'keys-label', f.label), el('span', 'keys-key', f.shown), el('span', 'keys-badge', '')); list.appendChild(r); }
      }
      const cur = item(sel);
      bChange.disabled = !cur; bClear.disabled = !cur || !cur.has; bReset.disabled = !cur || !cur.changed;
      msg.className = 'keys-msg';
      if (keysCap) {
        if (keysCap.error) { msg.textContent = errText(keysCap.error); msg.classList.add('err'); }
        else if (keysCap.conflict) { msg.textContent = T('keysConflict', { key: keysCap.shown, cmd: keysCap.conflict }); msg.classList.add('warn'); }
        else msg.textContent = T(keysCap.accel ? 'keysEnter' : 'keysPressHint');
      } else msg.textContent = cur && cur.changed ? defText(cur) : '';
      if (selBtn && keepFocus) { selBtn.focus({ preventScroll: true }); selBtn.scrollIntoView({ block: 'nearest' }); }
    }
    list.addEventListener('keydown', e => {
      if (keysCap) return;
      const items = shown(), i = items.findIndex(x => x.id === sel);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const j = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        if (items[j]) { sel = items[j].id; paint(true); }
      } else if (e.key === 'Enter' && e.target.classList.contains('keys-row') && !e.target.classList.contains('fixed')) { e.preventDefault(); startCap(sel); }
    });
    input.addEventListener('input', () => paint());
    input.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && shown().length) { e.preventDefault(); paint(true); } });
    keysOnCaptured = r => {
      if (!keysCap || !r) return;
      if (r.cancel) { stopCap(); paint(true); return; }
      if (r.enter) { if (keysCap.accel && !keysCap.error) setKey(keysCap.id, keysCap.accel); return; }
      keysCap = r.partial !== undefined
        ? { id: keysCap.id, shown: r.partial }
        : { id: keysCap.id, accel: r.error ? null : r.accel, shown: r.shown, error: r.error || null, conflict: r.conflict || null };
      paint(true);
    };
    paint();
    openModal(T('keysTitle'), box, () => { stopCap(); keysOnCaptured = null; });
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
    n.c = r.c; n.imported = r.imported || 0; n.base = r.base || 0; n.pruned = r.pruned || 0; n.ro = !!r.ro;
    n.ops = r.ops.map(o => ({ p: o[0], d: o[1], i: o[2], t: o[3] }));
    n._cp = null;
    n.text = textAt(n, n.ops.length);
    n.loaded = true; n.used = ++useSeq;
    syncMeta(n);
    if (n.id === S.active && $('editor').value !== n.text) { $('editor').value = n.text; }   // 同じ本文なら書き換えない(元に戻すの記録を消さない)
    if (n.id === S.active) { applyRO(); sendUiState(); }
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
    if (v.frOpen) { S.frOpen = true; frShow(); frRefresh(); }
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
    S.notes = data.notes.map(r => ({ id: r.id, c: r.c, t: r.t, imported: r.imported || 0, base: r.base || 0, n: r.n, title: r.title, ro: !!r.ro, loaded: false }));
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
