'use strict';
/* 画面(renderer)に渡す最小限の窓口。Node.jsの機能は画面に直接渡さない。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoApi', {
  load: () => ipcRenderer.invoke('memo:load'),
  loadNote: id => ipcRenderer.invoke('memo:loadNote', id),
  readTexts: ids => ipcRenderer.invoke('memo:readTexts', ids),
  loadNotes: ids => ipcRenderer.invoke('memo:loadNotes', ids),
  create: (id, c) => ipcRenderer.invoke('memo:create', id, c),
  append: (id, ops) => ipcRenderer.invoke('memo:append', id, ops),
  saveText: (id, text) => ipcRenderer.invoke('memo:saveText', id, text),
  remove: id => ipcRenderer.invoke('memo:remove', id),
  confirmTrash: message => ipcRenderer.invoke('memo:confirmTrash', message),
  openFolder: () => ipcRenderer.invoke('memo:openFolder'),
  // 画像・添付ファイル
  attachSave: (noteId, name, bytes) => ipcRenderer.invoke('attach:save', noteId, name, bytes),
  attachPick: noteId => ipcRenderer.invoke('attach:pick', noteId),
  attachOpen: (noteId, fileId) => ipcRenderer.invoke('attach:open', noteId, fileId),
  fileUrl: (noteId, fileId) => 'everpad-file://f/' + encodeURIComponent(noteId) + '/' + encodeURIComponent(fileId),
  // 画面を閉じる直前に使う同期版(非同期だと間に合わないことがある)
  appendSync: (id, ops) => ipcRenderer.sendSync('memo:appendSync', id, ops),
  saveTextSync: (id, text) => ipcRenderer.sendSync('memo:saveTextSync', id, text),
  // メニューからの操作
  onMenu: cb => { ipcRenderer.on('menu', (_e, name) => cb(name)); },
  // ウィンドウを閉じる前に、未保存の編集を書き出すよう求められる
  onFlushRequest: cb => { ipcRenderer.on('app:flush', () => cb()); },
  flushed: () => ipcRenderer.send('app:flushed')
});
