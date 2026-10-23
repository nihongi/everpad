'use strict';
/* Mac 用のメニュー(Electron に依存しないので、テストできる)。
   main.js が作る Windows の形のメニューを、Mac の流儀に組み替える。
   - 一番左にアプリ名のメニュー(EverPad について/サービス/隠す/終了)を足し、「終了」と「EverPad について」をそこへ移す
   - 「ウインドウ」メニューを足す
   - Mac で別の意味があるショートカットを、Mac でよく使うキーに変える(⌘H は「隠す」なので、置換は ⌘⌥F)
   項目は id で探す: quit / about / back / replace / props */

const MAC_KEYS = { back: 'Cmd+[', replace: 'Cmd+Alt+F', props: 'Cmd+I' };

/* items から id の項目を取り除いて返す */
function takeOut(items, id) {
  const i = items.findIndex(x => x.id === id);
  return i < 0 ? null : items.splice(i, 1)[0];
}
/* 取り除いたあとに残る、先頭・末尾・連続の区切り線を消す */
function tidy(items) {
  const out = [];
  for (const it of items) {
    if (it.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

function remapKeys(items) {
  for (const it of items) {
    if (it.id && MAC_KEYS[it.id]) it.accelerator = MAC_KEYS[it.id];
    if (Array.isArray(it.submenu)) remapKeys(it.submenu);
  }
}

/* template: Windows の形のメニュー(最上位は ファイル/編集/表示/ヘルプ。各 submenu は配列)
   o: { T(key), appName } */
function macTemplate(template, o) {
  const T = o.T;
  const tpl = template.map(m => Object.assign({}, m, { submenu: Array.isArray(m.submenu) ? m.submenu.slice() : m.submenu }));
  let about = null;
  for (const m of tpl) {
    if (!Array.isArray(m.submenu)) continue;
    takeOut(m.submenu, 'quit');
    about = takeOut(m.submenu, 'about') || about;
    m.submenu = tidy(m.submenu);
  }
  remapKeys(tpl);
  const appMenu = {
    label: o.appName,
    submenu: [
      ...(about ? [about, { type: 'separator' }] : []),
      { role: 'services', label: T('mServices') },
      { type: 'separator' },
      { role: 'hide', label: T('mHide') },
      { role: 'hideOthers', label: T('mHideOthers') },
      { role: 'unhide', label: T('mShowAll') },
      { type: 'separator' },
      { role: 'quit', label: T('mQuitApp') }
    ]
  };
  const windowMenu = {
    label: T('mWindow'),
    role: 'window',
    submenu: [
      { role: 'minimize', label: T('mMinimize') },
      { role: 'zoom', label: T('mZoomWindow') },
      { type: 'separator' },
      { role: 'front', label: T('mFront') }
    ]
  };
  const last = tpl[tpl.length - 1];
  const help = last && last.id === 'help' ? tpl.pop() : null;
  return [appMenu, ...tpl, windowMenu, ...(help ? [Object.assign(help, { role: 'help' })] : [])];
}

module.exports = { macTemplate, MAC_KEYS };
