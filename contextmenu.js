'use strict';
/* 右クリックメニューの中身(Electronに依存しないので、テストできる)。
   params は Electron の 'context-menu' イベントの引数。 */
function buildTemplate(params, opts) {
  const onSelectAll = opts && opts.onSelectAll;
  const f = params.editFlags || {};
  if (params.isEditable) {
    return [
      { label: '元に戻す', role: 'undo', enabled: !!f.canUndo, accelerator: 'CmdOrCtrl+Z', registerAccelerator: false },
      { label: 'やり直し', role: 'redo', enabled: !!f.canRedo, accelerator: 'CmdOrCtrl+Y', registerAccelerator: false },
      { type: 'separator' },
      { label: '切り取り', role: 'cut', enabled: !!f.canCut, accelerator: 'CmdOrCtrl+X', registerAccelerator: false },
      { label: 'コピー', role: 'copy', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { label: '貼り付け', role: 'paste', enabled: !!f.canPaste, accelerator: 'CmdOrCtrl+V', registerAccelerator: false },
      { label: '削除', role: 'delete', enabled: !!f.canDelete },
      { type: 'separator' },
      { label: 'すべて選択', role: 'selectAll', enabled: !!f.canSelectAll, accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
    ];
  }
  // 編集できない場所(プレビュー・履歴など): 文字を選んでいるときだけ出す
  if (params.selectionText && params.selectionText.trim()) {
    return [
      { label: 'コピー', role: 'copy', enabled: !!f.canCopy, accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { type: 'separator' },
      onSelectAll
        ? { label: 'すべて選択', click: onSelectAll, accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
        : { label: 'すべて選択', role: 'selectAll', accelerator: 'CmdOrCtrl+A', registerAccelerator: false }
    ];
  }
  return [];
}
module.exports = { buildTemplate };
