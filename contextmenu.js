'use strict';
/* 右クリックメニューの中身(Electronに依存しないので、テストできる)。
   params は Electron の 'context-menu' イベントの引数。 */
const I18N = require('./renderer/i18n');
const keymap = require('./keymap');

function buildTemplate(params, opts) {
  const onSelectAll = opts && opts.onSelectAll;
  const T = key => I18N.t((opts && opts.lang) || 'ja', key);
  const platform = (opts && opts.platform) || process.platform;
  const f = params.editFlags || {};
  if (params.isEditable) {
    // 本文(テキストエリア)では、装飾(太字など)と行の書式(引用など)も、サブメニューにせずに並べる。
    // 装飾は文字を選んでいるときだけ使える(選んでいなければグレー。項目の位置は変えない)
    const body = params.formControlType === 'text-area' && opts && opts.onFormat;
    const fmt = body
      ? [{ type: 'separator' }].concat(
          inlineItems(T, opts.onFormat, platform, opts.keys).map(x => Object.assign(x, { enabled: !!params.selectionText })),
          [{ type: 'separator' }], formatItems(T, opts.onFormat, platform, opts.keys))
      : [];
    // 「数式を挿入…」(カーソルが数式の中なら「数式を編集…」)と「表」は、画面側が右クリックの前に知らせたときだけ。
    // 本文のほか、プレビューで編集している表のセル(1行の入力欄。opts.cell)にも出す
    const extra = body || (params.formControlType === 'input-text' && opts && opts.cell);
    if (extra && opts.onMath) fmt.push({ type: 'separator' }, { label: T(opts.inMath ? 'mEditMath' : 'mInsertMath'), accelerator: (opts.keys || keymap.defaults(platform))['math'] || undefined, registerAccelerator: false, click: opts.onMath });
    // カーソルが表の中なら「表」(画面側が右クリックの前に知らせた opts.table)
    if (extra && opts.table && opts.onTable) fmt.push({ type: 'separator' }, { label: T('mTable'), submenu: tableItems(T, opts.onTable, opts.table, opts.keys, platform) });
    return [
      { label: T('mUndo'), role: 'undo', enabled: !!f.canUndo, accelerator: 'CmdOrCtrl+Z', registerAccelerator: false },
      { label: T('mRedo'), role: 'redo', enabled: !!f.canRedo, accelerator: platform === 'darwin' ? 'Shift+Cmd+Z' : 'CmdOrCtrl+Y', registerAccelerator: false },
      { type: 'separator' },
      { label: T('mCut'), role: 'cut', enabled: !!f.canCut, accelerator: 'CmdOrCtrl+X', registerAccelerator: false },
      { label: T('mCopy'), role: 'copy', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { label: T('mPaste'), role: 'paste', enabled: !!f.canPaste, accelerator: 'CmdOrCtrl+V', registerAccelerator: false },
      { label: T('mDelete'), role: 'delete', enabled: !!f.canDelete },
      { type: 'separator' },
      { label: T('mSelectAll'), role: 'selectAll', enabled: !!f.canSelectAll, accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
    ].concat(fmt);
  }
  // 編集できない場所(プレビュー・履歴など): 文字を選んでいるときだけ出す
  if (params.selectionText && params.selectionText.trim()) {
    return [
      { label: T('mCopy'), role: 'copy', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { type: 'separator' },
      onSelectAll
        ? { label: T('mSelectAll'), click: onSelectAll, accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
        : { label: T('mSelectAll'), role: 'selectAll', accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
    ];
  }
  return [];
}
/* 書式と装飾のキー。keys は main.js が使っているキー({ 操作の id: キー }、keymap.js)。無ければ既定のキー */
const fmtKey = (keys, platform, kind) => (keys || keymap.defaults(platform || process.platform))['fmt:' + kind] || undefined;

/* 書式(選んだ行をまとめて引用・箇条書き・番号付き・コードブロックにする)。メニューバーと右クリックで同じ項目を使う。
   既定のキーは keymap.js にある(Mac の ⌘⇧Q はログアウトなので、Mac の引用は ⌘') */
function formatItems(T, onFormat, platform, keys) {
  const K = kind => fmtKey(keys, platform, kind);
  return [
    { label: T('mFmtQuote'), accelerator: K('quote'), click: () => onFormat('quote') },
    { label: T('mFmtBullet'), accelerator: K('bullet'), click: () => onFormat('bullet') },
    { label: T('mFmtNumbered'), accelerator: K('numbered'), click: () => onFormat('numbered') },
    { label: T('mFmtCode'), accelerator: K('code'), click: () => onFormat('code') },
    { type: 'separator' },
    // Tab / Shift+Tab は本文の中で画面側が受け取るので、メニューでは表示だけにする(ほかの入力欄の Tab を奪わない)
    { label: T('mFmtIndent'), accelerator: 'Tab', registerAccelerator: false, click: () => onFormat('indent') },
    { label: T('mFmtOutdent'), accelerator: 'Shift+Tab', registerAccelerator: false, click: () => onFormat('outdent') }
  ];
}

/* 装飾(選んだ文字を太字・斜体・取り消し線・コードにする)。右クリックと、メニューバーの「書式」で同じ項目を使う。
   既定のキーは keymap.js にある(Ctrl+B はサイドバーの表示なので、太字は Ctrl+Shift+B) */
function inlineItems(T, onFormat, platform, keys) {
  const K = kind => fmtKey(keys, platform, kind);
  return [
    { label: T('mFmtBold'), accelerator: K('bold'), click: () => onFormat('bold') },
    { label: T('mFmtItalic'), accelerator: K('italic'), click: () => onFormat('italic') },
    { label: T('mFmtStrike'), accelerator: K('strike'), click: () => onFormat('strike') },
    { label: T('mFmtInlineCode'), accelerator: K('icode'), click: () => onFormat('icode') }
  ];
}

/* 表の操作(行・列の挿入と削除、列の配置、表の削除)。プレビューのセルの右クリック、「テキスト」表示の右クリック(カーソルが表の中のとき)、
   「編集」→「表」で同じ項目を使う。st はカーソルのあるセル { inTable, head: 見出しの行か, cols: 列の数, align: 'l'|'c'|'r'|'' }(inTable が false なら表の外で、「表を挿入」だけ)。
   st が無いとき(メニューバー)は、押せない項目を作らない(表の外で選んだときは画面側が知らせる) */
function tableItems(T, onTable, st, keys, platform) {
  const K = id => (keys || keymap.defaults(platform || process.platform))['tbl:' + id] || undefined;
  const item = (id, label, enabled) => ({ label: T(label), accelerator: K(id), registerAccelerator: !st, enabled: enabled !== false, click: () => onTable(id) });
  const al = st ? (st.align || 'l') : '';
  const radio = (id, label, a) => Object.assign(item(id, label), st ? { type: 'checkbox', checked: al === a } : {});
  // 表の外では「表を挿入」だけ
  if (st && st.inTable === false) return [item('insert', 'mTblInsert')];
  return [
    item('insert', 'mTblInsert'),
    { type: 'separator' },
    item('rowAbove', 'mTblRowAbove', !st || !st.head),
    item('rowBelow', 'mTblRowBelow'),
    item('rowDelete', 'mTblRowDelete', !st || !st.head),
    { type: 'separator' },
    item('colLeft', 'mTblColLeft'),
    item('colRight', 'mTblColRight'),
    item('colDelete', 'mTblColDelete', !st || st.cols > 1),
    { type: 'separator' },
    { label: T('mTblAlign'), submenu: [radio('alignLeft', 'mTblAlignLeft', 'l'), radio('alignCenter', 'mTblAlignCenter', 'c'), radio('alignRight', 'mTblAlignRight', 'r')] },
    { type: 'separator' },
    item('delete', 'mTblDelete')
  ];
}

/* 添付の画像・ファイルを右クリックしたときのメニュー。actions は { copy, open, show, save, trash } のクリック時の処理。
   trash があるとき(編集画面とプレビュー。履歴の表示では出さない)だけ、最後に「ごみ箱に入れる…」を出す */
function buildAttachTemplate(image, actions, lang) {
  const T = key => I18N.t(lang || 'ja', key);
  const items = image
    ? [
        { label: T('mCopyImage'), click: actions.copy },
        { label: T('mOpenImage'), click: actions.open },
        { label: T('mShowImage'), click: actions.show },
        { type: 'separator' },
        { label: T('mSaveImageAs'), click: actions.save }
      ]
    : [
        { label: T('mOpenFile'), click: actions.open },
        { label: T('mShowFile'), click: actions.show }
      ];
  if (actions.trash) items.push({ type: 'separator' }, { label: T('mTrashAttach'), click: actions.trash });
  return items;
}
module.exports = { buildTemplate, buildAttachTemplate, formatItems, inlineItems, tableItems };
