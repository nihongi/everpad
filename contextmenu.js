'use strict';
/* 右クリックメニューの中身(Electronに依存しないので、テストできる)。
   params は Electron の 'context-menu' イベントの引数。 */
const I18N = require('./renderer/i18n');

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
          inlineItems(T, opts.onFormat, platform).map(x => Object.assign(x, { enabled: !!params.selectionText })),
          [{ type: 'separator' }], formatItems(T, opts.onFormat, platform))
      : [];
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
/* 書式(選んだ行をまとめて引用・箇条書き・番号付き・コードブロックにする)。メニューバーと右クリックで同じ項目を使う。
   Mac の ⌘⇧Q はログアウトなので、引用は ⌘'(Mac のメールと同じ) */
function formatItems(T, onFormat, platform) {
  const mac = (platform || process.platform) === 'darwin';
  return [
    { label: T('mFmtQuote'), accelerator: mac ? "Cmd+'" : 'CmdOrCtrl+Shift+Q', click: () => onFormat('quote') },
    { label: T('mFmtBullet'), accelerator: 'CmdOrCtrl+Shift+8', click: () => onFormat('bullet') },
    { label: T('mFmtNumbered'), accelerator: 'CmdOrCtrl+Shift+7', click: () => onFormat('numbered') },
    { label: T('mFmtCode'), accelerator: 'CmdOrCtrl+Shift+K', click: () => onFormat('code') },
    { type: 'separator' },
    // Tab / Shift+Tab は本文の中で画面側が受け取るので、メニューでは表示だけにする(ほかの入力欄の Tab を奪わない)
    { label: T('mFmtIndent'), accelerator: 'Tab', registerAccelerator: false, click: () => onFormat('indent') },
    { label: T('mFmtOutdent'), accelerator: 'Shift+Tab', registerAccelerator: false, click: () => onFormat('outdent') }
  ];
}

/* 装飾(選んだ文字を太字・斜体・取り消し線・コードにする)。右クリックと、メニューバーの「書式」で同じ項目を使う。
   Ctrl+B はサイドバーの表示なので、太字は Ctrl+Shift+B。Mac の ⌘I はプロパティなので、Mac の斜体は ⌘⇧I */
function inlineItems(T, onFormat, platform) {
  const mac = (platform || process.platform) === 'darwin';
  return [
    { label: T('mFmtBold'), accelerator: 'CmdOrCtrl+Shift+B', click: () => onFormat('bold') },
    { label: T('mFmtItalic'), accelerator: mac ? 'Cmd+Shift+I' : 'CmdOrCtrl+I', click: () => onFormat('italic') },
    { label: T('mFmtStrike'), accelerator: 'CmdOrCtrl+Shift+X', click: () => onFormat('strike') },
    { label: T('mFmtInlineCode'), accelerator: 'CmdOrCtrl+E', click: () => onFormat('icode') }
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
module.exports = { buildTemplate, buildAttachTemplate, formatItems, inlineItems };
