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
  dirMenu: pos => ipcRenderer.invoke('dir:menu', pos),   // 保存先フォルダを切り替えるメニュー
  // 画像・添付ファイル
  attachSave: (noteId, name, bytes) => ipcRenderer.invoke('attach:save', noteId, name, bytes),
  attachPick: noteId => ipcRenderer.invoke('attach:pick', noteId),
  attachClip: (noteId, url, name) => ipcRenderer.invoke('attach:clip', noteId, url, name),
  attachCopy: (fromId, toId, fileIds) => ipcRenderer.invoke('attach:copy', fromId, toId, fileIds),
  importImages: (token, noteId) => ipcRenderer.invoke('import:images', token, noteId),   // インポートした Markdown の画像を、できたメモの添付にする
  attachOpen: (noteId, fileId) => ipcRenderer.invoke('attach:open', noteId, fileId),
  attachMenu: (noteId, fileId, name, image, x, y, canTrash) => ipcRenderer.invoke('attach:menu', noteId, fileId, name, image, x, y, canTrash),
  attachTrash: (noteId, fileId, name, refs) => ipcRenderer.invoke('attach:trash', noteId, fileId, name, refs),
  // 古い履歴の削除(確認・アーカイブへの書き出し・書き換え・使われなくなった添付をごみ箱へ、まで main.js が行う)
  pruneHistory: (id, k, n, title) => ipcRenderer.invoke('history:prune', id, k, n, title),
  mathMenu: (tex, kind, canEdit) => ipcRenderer.invoke('math:menu', tex, kind, canEdit),
  // 表の操作: プレビューのセルの右クリックのメニュー(選んだ操作を返す)と、「テキスト」表示の右クリックの前に知らせるカーソルの場所(表・数式)
  tableMenu: st => ipcRenderer.invoke('table:menu', st),
  editContext: st => ipcRenderer.sendSync('edit:ctx', st),
  noteMenu: (title, ro) => ipcRenderer.invoke('note:menu', title, ro),
  setReadOnly: (id, on) => ipcRenderer.invoke('memo:setReadOnly', id, on),
  // 同じ保存先を開いている、ほかの EverPad(読み取り専用で開いたとき・編集の引き継ぎ)
  dirState: () => ipcRenderer.invoke('dir:state'),
  dirAction: name => ipcRenderer.invoke('dir:action', name),
  onDirState: cb => { ipcRenderer.on('dir:state', (_e, st) => cb(st)); },
  onDirPrepare: cb => { ipcRenderer.on('dir:prepare', () => cb()); },
  dirPrepared: () => ipcRenderer.send('dir:prepared'),
  changedNotes: ids => ipcRenderer.invoke('memo:changed', ids),
  // 最近見たメモ(メニューを作り直してもらう)
  setRecent: items => ipcRenderer.send('recent:set', items),
  // 画面の状態(メニューの押せる・押せないに使う)
  setUiState: st => ipcRenderer.send('ui:state', st),
  // キーボードショートカット(一覧・変更・すべて既定に戻す。割り当て中に押したキーは main.js が読んで知らせる)
  prefsGet: () => ipcRenderer.invoke('prefs:get'),
  prefsSet: (key, value) => ipcRenderer.invoke('prefs:set', key, value),
  // 検索した言葉の履歴(kind: 'q' は「全メモから検索」、'fr' は「検索と置換」)
  searchHistGet: () => ipcRenderer.invoke('shist:get'),
  searchHistAdd: (kind, text) => ipcRenderer.invoke('shist:add', kind, text),
  searchHistDel: (kind, text) => ipcRenderer.invoke('shist:del', kind, text),
  keysList: () => ipcRenderer.invoke('keys:list'),
  keysSet: (id, accel) => ipcRenderer.invoke('keys:set', id, accel),
  keysResetAll: () => ipcRenderer.invoke('keys:resetAll'),
  keysCapture: id => ipcRenderer.send('keys:capture', id),
  onKeysCaptured: cb => { ipcRenderer.on('keys:captured', (_e, r) => cb(r)); },
  // プロパティ
  noteInfo: id => ipcRenderer.invoke('note:info', id),
  revealNote: (id, kind) => ipcRenderer.invoke('note:reveal', id, kind),
  copyText: text => ipcRenderer.invoke('app:copyText', text),
  pastePlain: () => ipcRenderer.invoke('edit:pastePlain'),
  // テキストの取り込み・書き出し
  onImport: cb => { ipcRenderer.on('import:texts', (_e, items) => cb(items)); },
  exportText: (title, text) => ipcRenderer.invoke('export:text', title, text),
  exportArchive: (id, title) => ipcRenderer.invoke('export:archive', id, title),
  ready: () => ipcRenderer.send('app:ready'),
  // 印刷・PDF(画面に用意した印刷用の紙面を出す)
  // page: { paper, landscape }(フロントマターの用紙の大きさと向き)
  print: page => ipcRenderer.invoke('print:print', page),
  savePdf: (title, page) => ipcRenderer.invoke('print:pdf', title, page),
  showFullScreen: on => ipcRenderer.invoke('win:show', !!on),
  exportPage: (id, p, kind) => ipcRenderer.invoke('export:page', id, p, kind),
  fileUrl: (noteId, fileId) => 'everpad-file://f/' + encodeURIComponent(noteId) + '/' + encodeURIComponent(fileId),
  // 画面を閉じる直前に使う同期版(非同期だと間に合わないことがある)
  appendSync: (id, ops) => ipcRenderer.sendSync('memo:appendSync', id, ops),
  saveTextSync: (id, text) => ipcRenderer.sendSync('memo:saveTextSync', id, text),
  // メニューからの操作
  onMenu: cb => { ipcRenderer.on('menu', (_e, name) => cb(name)); },
  // ウィンドウを閉じる前に、未保存の編集を書き出すよう求められる
  onFlushRequest: cb => { ipcRenderer.on('app:flush', () => cb()); },
  // アプリの中からの更新: ダウンロードの進み具合({ text, frac } か、消すときは null)と、やめる
  onUpdateProgress: cb => { ipcRenderer.on('update:progress', (_e, p) => cb(p)); },
  updateCancel: () => ipcRenderer.send('update:cancel'),
  flushed: () => ipcRenderer.send('app:flushed')
});
