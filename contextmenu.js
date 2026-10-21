'use strict';
/* 右クリックメニューの中身(Electronに依存しないので、テストできる)。
   params は Electron の 'context-menu' イベントの引数。 */
const I18N = require('./renderer/i18n');

function buildTemplate(params, opts) {
  const onSelectAll = opts && opts.onSelectAll;
  const T = key => I18N.t((opts && opts.lang) || 'ja', key);
  const f = params.editFlags || {};
  if (params.isEditable) {
    return [
      { label: T('mUndo'), role: 'undo', enabled: !!f.canUndo, accelerator: 'CmdOrCtrl+Z', registerAccelerator: false },
      { label: T('mRedo'), role: 'redo', enabled: !!f.canRedo, accelerator: 'CmdOrCtrl+Y', registerAccelerator: false },
      { type: 'separator' },
      { label: T('mCut'), role: 'cut', enabled: !!f.canCut, accelerator: 'CmdOrCtrl+X', registerAccelerator: false },
      { label: T('mCopy'), role: 'copy', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { label: T('mPaste'), role: 'paste', enabled: !!f.canPaste, accelerator: 'CmdOrCtrl+V', registerAccelerator: false },
      { label: T('mDelete'), role: 'delete', enabled: !!f.canDelete },
      { type: 'separator' },
      { label: T('mSelectAll'), role: 'selectAll', enabled: !!f.canSelectAll, accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
    ].concat(params.formControlType === 'text-area' && opts && opts.onFormat ? [{ type: 'separator' }, { label: T('mFormat'), submenu: formatItems(T, opts.onFormat) }] : []);
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
/* 書式(選んだ行をまとめて引用・箇条書き・番号付き・コードブロックにする)。メニューバーと右クリックで同じ項目を使う */
function formatItems(T, onFormat) {
  return [
    { label: T('mFmtQuote'), accelerator: 'CmdOrCtrl+Shift+Q', click: () => onFormat('quote') },
    { label: T('mFmtBullet'), accelerator: 'CmdOrCtrl+Shift+8', click: () => onFormat('bullet') },
    { label: T('mFmtNumbered'), accelerator: 'CmdOrCtrl+Shift+7', click: () => onFormat('numbered') },
    { label: T('mFmtCode'), accelerator: 'CmdOrCtrl+Shift+K', click: () => onFormat('code') }
  ];
}

/* 添付の画像・ファイルを右クリックしたときのメニュー。actions は { copy, open, show, save } のクリック時の処理 */
function buildAttachTemplate(image, actions, lang) {
  const T = key => I18N.t(lang || 'ja', key);
  if (image) {
    return [
      { label: T('mCopyImage'), click: actions.copy },
      { label: T('mOpenImage'), click: actions.open },
      { label: T('mShowImage'), click: actions.show },
      { type: 'separator' },
      { label: T('mSaveImageAs'), click: actions.save }
    ];
  }
  return [
    { label: T('mOpenFile'), click: actions.open },
    { label: T('mShowFile'), click: actions.show }
  ];
}
module.exports = { buildTemplate, buildAttachTemplate, formatItems };
