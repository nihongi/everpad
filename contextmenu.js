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
    ];
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
module.exports = { buildTemplate };
