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
  attachMenu: (noteId, fileId, name, image, x, y, canTrash) => ipcRenderer.invoke('attach:menu', noteId, fileId, name, image, x, y, canTrash),
  attachTrash: (noteId, fileId, name, refs) => ipcRenderer.invoke('attach:trash', noteId, fileId, name, refs),
  // 古い履歴の削除(確認・アーカイブへの書き出し・書き換え・使われなくなった添付をごみ箱へ、まで main.js が行う)
  pruneHistory: (id, k, n, title) => ipcRenderer.invoke('history:prune', id, k, n, title),
  mathMenu: tex => ipcRenderer.invoke('math:menu', tex),
  noteMenu: title => ipcRenderer.invoke('note:menu', title),
  // 最近見たメモ(メニューを作り直してもらう)
  setRecent: items => ipcRenderer.send('recent:set', items),
  // 画面の状態(メニューの押せる・押せないに使う)
  setUiState: st => ipcRenderer.send('ui:state', st),
  // プロパティ
  noteInfo: id => ipcRenderer.invoke('note:info', id),
  revealNote: (id, kind) => ipcRenderer.invoke('note:reveal', id, kind),
  copyText: text => ipcRenderer.invoke('app:copyText', text),
  // テキストの取り込み・書き出し
  onImport: cb => { ipcRenderer.on('import:texts', (_e, items) => cb(items)); },
  exportText: (title, text) => ipcRenderer.invoke('export:text', title, text),
  exportArchive: (id, title) => ipcRenderer.invoke('export:archive', id, title),
  ready: () => ipcRenderer.send('app:ready'),
  // 印刷・PDF(画面に用意した印刷用の紙面を出す)
  print: () => ipcRenderer.invoke('print:print'),
  savePdf: title => ipcRenderer.invoke('print:pdf', title),
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
