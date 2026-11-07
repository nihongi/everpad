'use strict';
/* キーボードショートカット(Electron に依存しないので、テストできる)。
   キーは Electron のメニューの書き方(accelerator)で持つ。並びは CmdOrCtrl・Ctrl(Mac の Control)・Alt・Shift・キーにそろえる。
   CmdOrCtrl は、Windows と Linux では Ctrl、Mac では ⌘。
   変えたキーは config.json の keys に、既定と違うものだけを { 操作の id: キー }(キーなしは '')で覚える。 */

/* 変えられる操作(メニューバーの項目)。group と label は i18n のキー(group の > はサブメニュー)。
   def は既定のキー、mac は Mac での既定(無ければ def と同じ)。'' はキーなし。role はキーを変えたときに自分で動かす Electron の役割 */
const COMMANDS = [
  { id: 'new', group: 'mFile', label: 'mNewNote', def: 'CmdOrCtrl+N' },
  { id: 'search', group: 'mFile', label: 'mSearchAll', def: 'CmdOrCtrl+F' },
  { id: 'back', group: 'mFile', label: 'mBack', def: 'Alt+Left', mac: 'CmdOrCtrl+[' },
  { id: 'import', group: 'mFile', label: 'mImport', def: 'CmdOrCtrl+O' },
  { id: 'export', group: 'mFile>mExportMenu', label: 'mExportText', def: 'CmdOrCtrl+Shift+E' },
  { id: 'pdf', group: 'mFile>mExportMenu', label: 'mExportPdf', def: 'CmdOrCtrl+Shift+P' },
  { id: 'html', group: 'mFile>mExportMenu', label: 'mExportHtml', def: '' },
  { id: 'mhtml', group: 'mFile>mExportMenu', label: 'mExportMhtml', def: '' },
  { id: 'adoc', group: 'mFile>mExportMenu', label: 'mExportAdoc', def: '' },
  { id: 'docx', group: 'mFile>mExportMenu', label: 'mExportDocx', def: '' },
  { id: 'archive', group: 'mFile>mExportMenu', label: 'mExportArchive', def: '' },
  { id: 'print', group: 'mFile', label: 'mPrint', def: 'CmdOrCtrl+P' },
  { id: 'readonly', group: 'mFile', label: 'mReadOnly', def: '' },
  { id: 'props', group: 'mFile', label: 'mProps', def: 'Alt+Enter', mac: 'CmdOrCtrl+I' },
  { id: 'openDir', group: 'mFile', label: 'mOpenDir', def: '' },
  { id: 'attach', group: 'mEdit', label: 'mAttach', def: 'CmdOrCtrl+Shift+U' },
  // Mac の ⌘H は「隠す」なので、置換は ⌘⌥F
  { id: 'replace', group: 'mEdit', label: 'mReplace', def: 'CmdOrCtrl+H', mac: 'CmdOrCtrl+Alt+F' },
  // Ctrl+B はサイドバーの表示なので、太字は Ctrl+Shift+B。Mac の ⌘I はプロパティなので、Mac の斜体は ⌘⇧I
  { id: 'fmt:bold', group: 'mEdit>mFormat', label: 'mFmtBold', def: 'CmdOrCtrl+Shift+B' },
  { id: 'fmt:italic', group: 'mEdit>mFormat', label: 'mFmtItalic', def: 'CmdOrCtrl+I', mac: 'CmdOrCtrl+Shift+I' },
  { id: 'fmt:strike', group: 'mEdit>mFormat', label: 'mFmtStrike', def: 'CmdOrCtrl+Shift+X' },
  { id: 'fmt:icode', group: 'mEdit>mFormat', label: 'mFmtInlineCode', def: 'CmdOrCtrl+E' },
  // Mac の ⌘⇧Q はログアウトなので、引用は ⌘'(Mac のメールと同じ)
  { id: 'fmt:quote', group: 'mEdit>mFormat', label: 'mFmtQuote', def: 'CmdOrCtrl+Shift+Q', mac: "CmdOrCtrl+'" },
  { id: 'fmt:bullet', group: 'mEdit>mFormat', label: 'mFmtBullet', def: 'CmdOrCtrl+Shift+8' },
  { id: 'fmt:numbered', group: 'mEdit>mFormat', label: 'mFmtNumbered', def: 'CmdOrCtrl+Shift+7' },
  { id: 'fmt:code', group: 'mEdit>mFormat', label: 'mFmtCode', def: 'CmdOrCtrl+Shift+K' },
  { id: 'link', group: 'mEdit', label: 'mInsertLink', def: 'CmdOrCtrl+K' },
  { id: 'mode:edit', group: 'mView', label: 'mModeEdit', def: 'CmdOrCtrl+1' },
  { id: 'mode:preview', group: 'mView', label: 'mModePreview', def: 'CmdOrCtrl+2' },
  { id: 'mode:history', group: 'mView', label: 'mModeHistory', def: 'CmdOrCtrl+3' },
  { id: 'prune', group: 'mView', label: 'mPrune', def: '' },
  { id: 'side', group: 'mView', label: 'mSide', def: 'CmdOrCtrl+B' },
  { id: 'lines', group: 'mView', label: 'mLines', def: 'CmdOrCtrl+L' },
  { id: 'zoomIn', group: 'mView', label: 'mZoomIn', def: 'CmdOrCtrl+Plus', role: 'zoomIn' },
  { id: 'zoomOut', group: 'mView', label: 'mZoomOut', def: 'CmdOrCtrl+-', role: 'zoomOut' },
  { id: 'resetZoom', group: 'mView', label: 'mZoomReset', def: 'CmdOrCtrl+0', role: 'resetZoom' },
  { id: 'fullscreen', group: 'mView', label: 'mFullscreen', def: 'F11', mac: 'CmdOrCtrl+Ctrl+F', role: 'togglefullscreen' },
  { id: 'mdHelp', group: 'mHelp', label: 'mMdHelp', def: '' }
];
const BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

/* 変えられないキー(一覧の最後に、参考として出す)。label は i18n のキー、keys は表示するキー */
function fixedKeys(platform) {
  const mac = platform === 'darwin';
  return [
    { label: 'mUndo', keys: ['CmdOrCtrl+Z'] },
    { label: 'mRedo', keys: [mac ? 'CmdOrCtrl+Shift+Z' : 'CmdOrCtrl+Y'] },
    { label: 'mCut', keys: ['CmdOrCtrl+X'] },
    { label: 'mCopy', keys: ['CmdOrCtrl+C'] },
    { label: 'mPaste', keys: ['CmdOrCtrl+V'] },
    { label: 'mSelectAll', keys: ['CmdOrCtrl+A'] },
    { label: 'mFmtIndent', keys: ['Tab'] },
    { label: 'mFmtOutdent', keys: ['Shift+Tab'] },
    { label: 'kfFindNext', keys: ['F3', 'Shift+F3'] },
    { label: 'kfHistMove', keys: ['Left', 'Right'] },
    { label: 'kfHistPlay', keys: ['Space'] },
    { label: 'kfOpenLink', keys: ['CmdOrCtrl+Click'] }
  ];
}

const MODS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'];
// 割り当てられるキー(キーボードの配置で意味が変わる記号のキーは除く)
const NAMED = ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace', 'Space', 'Enter', 'Tab'];
const KEYS = new Set([].concat(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  Array.from({ length: 24 }, (_, i) => 'F' + (i + 1)),
  NAMED,
  Array.from({ length: 10 }, (_, i) => 'num' + i),
  ['numadd', 'numsub', 'nummult', 'numdiv', 'numdec']
));
// 既定でだけ使う記号のキー(読み込みと表示のため)
const DEFAULT_ONLY = new Set(['Plus', '-', '[', "'"]);
const KEY_ALIAS = { return: 'Enter', esc: 'Escape', escape: 'Escape', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', tab: 'Tab', plus: 'Plus' };

/* キーの書き方をそろえる。読めないときは null。platform で Ctrl と ⌘ の意味が変わる */
function normalize(accel, platform) {
  if (typeof accel !== 'string' || !accel || accel.length > 60) return null;
  const mac = platform === 'darwin';
  const parts = accel === '+' ? ['Plus'] : accel.replace(/\+\+$/, '+Plus').split('+');
  const mods = new Set();
  let key = null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim(), l = p.toLowerCase();
    if (!p) return null;
    let m = null;
    if (l === 'cmdorctrl' || l === 'commandorcontrol') m = 'CmdOrCtrl';
    else if (l === 'cmd' || l === 'command' || l === 'meta' || l === 'super') { if (!mac) return null; m = 'CmdOrCtrl'; }
    else if (l === 'ctrl' || l === 'control') m = mac ? 'Ctrl' : 'CmdOrCtrl';
    else if (l === 'alt' || l === 'option') m = 'Alt';
    else if (l === 'shift') m = 'Shift';
    if (m) { if (i === parts.length - 1) return null; mods.add(m); continue; }
    if (i !== parts.length - 1) return null;
    key = KEY_ALIAS[l] || (/^f([1-9]|1\d|2[0-4])$/i.test(p) ? p.toUpperCase() : /^num(\d|add|sub|mult|div|dec)$/i.test(p) ? l : p.length === 1 ? p.toUpperCase() : null);
    if (!key || !(KEYS.has(key) || DEFAULT_ONLY.has(key) || key === 'Escape')) return null;
  }
  if (!key) return null;
  return MODS.filter(m => mods.has(m)).concat(key).join('+');
}

/* 文字の入力や文字の操作と重なるので、割り当てられないキー */
function reservedKeys(platform) {
  const mac = platform === 'darwin';
  const r = ['CmdOrCtrl+Z', 'CmdOrCtrl+Y', 'CmdOrCtrl+Shift+Z', 'CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+A', 'F3', 'Shift+F3', 'CmdOrCtrl+Insert'];
  const moves = ['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Backspace', 'Delete'];
  const withShift = (mod, keys) => keys.forEach(k => r.push(mod + '+' + k, mod + '+Shift+' + k));
  if (mac) {
    withShift('CmdOrCtrl', moves);
    withShift('Alt', moves);
    r.push('CmdOrCtrl+Q', 'CmdOrCtrl+H', 'CmdOrCtrl+Alt+H', 'CmdOrCtrl+M', 'CmdOrCtrl+W', 'CmdOrCtrl+Space', 'CmdOrCtrl+Tab');
    'AEFBNPKDHTO'.split('').forEach(k => r.push('Ctrl+' + k));   // 入力欄の Emacs 風の操作
  } else {
    withShift('CmdOrCtrl', moves);
    r.push('Alt+F4', 'Alt+Space', 'F10', 'Alt+Tab', 'CmdOrCtrl+Escape');
  }
  return new Set(r);
}

/* 割り当てられるかを確かめる。よければ null、だめなら理由('needMod' | 'reserved' | 'badKey') */
function check(accel, platform) {
  const n = normalize(accel, platform);
  if (!n) return 'badKey';
  const parts = n.split('+'), key = parts[parts.length - 1], mods = parts.slice(0, -1);
  if (!KEYS.has(key)) return 'badKey';
  const fkey = /^F\d+$/.test(key);
  if (!fkey && !mods.some(m => m === 'CmdOrCtrl' || m === 'Ctrl' || m === 'Alt')) return 'needMod';
  // Mac の Option+文字は、特別な文字の入力に使う
  if (platform === 'darwin' && !mods.includes('CmdOrCtrl') && !mods.includes('Ctrl') && !fkey && /^([A-Z0-9]|Space)$/.test(key)) return 'reserved';
  if (reservedKeys(platform).has(n)) return 'reserved';
  return null;
}

const defaultOf = (c, platform) => (platform === 'darwin' && c.mac !== undefined ? c.mac : c.def);
function defaults(platform) {
  const o = {};
  for (const c of COMMANDS) o[c.id] = defaultOf(c, platform);
  return o;
}

/* config.json の keys を読んで、使えるものだけにする(知らない操作・読めないキー・既定と同じものは捨てる) */
function cleanOverrides(raw, platform) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of COMMANDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, c.id)) continue;
    const v = raw[c.id];
    if (v === '' || v === null) { if (defaultOf(c, platform) !== '') out[c.id] = ''; continue; }
    if (check(v, platform)) continue;
    const n = normalize(v, platform);
    if (n !== defaultOf(c, platform)) out[c.id] = n;
  }
  return out;
}

/* 使うキー { id: キー('' はキーなし) }。変えたキーを先に決め、既定のキーが変えたキーと重なったら、既定のほうをキーなしにする。
   (手で書き換えて)変えたキーどうしが重なったら、一覧で先にあるほうを使う */
function resolve(raw, platform) {
  const ov = cleanOverrides(raw, platform), out = {}, used = new Set();
  for (const c of COMMANDS) {
    if (!(c.id in ov)) continue;
    const k = ov[c.id];
    out[c.id] = k && !used.has(k) ? k : '';
    if (out[c.id]) used.add(k);
  }
  for (const c of COMMANDS) {
    if (c.id in out) continue;
    const k = defaultOf(c, platform);
    out[c.id] = k && !used.has(k) ? k : '';
    if (out[c.id]) used.add(k);
  }
  return out;
}

/* id にキーを割り当てたときに重なる操作の id(無ければ null) */
function conflictOf(raw, id, accel, platform) {
  const n = normalize(accel, platform);
  if (!n) return null;
  const cur = resolve(raw, platform);
  for (const c of COMMANDS) if (c.id !== id && cur[c.id] === n) return c.id;
  return null;
}

/* id のキーを accel にする('' はキーなし、null は既定に戻す)。重なる操作はキーなしにする。新しい keys を返す */
function assign(raw, id, accel, platform) {
  const c = BY_ID.get(id);
  if (!c) return cleanOverrides(raw, platform);
  const ov = Object.assign({}, cleanOverrides(raw, platform));
  const put = (cmd, k) => { if (k === defaultOf(cmd, platform)) delete ov[cmd.id]; else ov[cmd.id] = k; };
  const k = accel === null ? defaultOf(c, platform) : accel === '' ? '' : normalize(accel, platform);
  if (k === null || (k && accel !== null && check(k, platform))) return ov;
  if (k) {
    const cur = resolve(ov, platform);
    for (const o of COMMANDS) if (o.id !== id && cur[o.id] === k) put(o, '');
  }
  put(c, k);
  return cleanOverrides(ov, platform);
}

/* Electron の before-input-event の input から、押したキーを読む。
   返す値: { mods: true }(修飾キーだけ)/ { accel }/ { bad: true }(割り当てられないキー)。どれにも押していた修飾キー(mods の表示用の accel の頭)を付ける */
const CODE_KEYS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Insert: 'Insert', Delete: 'Delete', Backspace: 'Backspace', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };
const MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
function fromInput(input, platform) {
  const mac = platform === 'darwin';
  const mods = [];
  if (mac ? input.meta : input.control) mods.push('CmdOrCtrl');
  if (mac && input.control) mods.push('Ctrl');
  if (input.alt) mods.push('Alt');
  if (input.shift) mods.push('Shift');
  const prefix = mods.join('+');
  const code = String(input.code || '');
  if (MOD_CODES.test(code) || /^(Control|Shift|Alt|Meta|OS)$/.test(String(input.key || ''))) return { mods: true, prefix: prefix };
  if (!mac && input.meta) return { bad: true, prefix: prefix, win: true };   // Windows キーは Windows が使う
  let key = null, m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit(\d)$/.exec(code))) key = m[1];
  else if ((m = /^Numpad(\d)$/.exec(code))) key = 'num' + m[1];
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else if (CODE_KEYS[code]) key = CODE_KEYS[code];
  if (!key) return { bad: true, prefix: prefix };
  return { accel: mods.concat(key).join('+'), key: key, prefix: prefix };
}

/* 画面に出すキーの書き方。Windows・Linux は Ctrl+Shift+B、Mac は ⇧⌘B(記号の順は ⌃⌥⇧⌘) */
const WIN_NAMES = { Plus: '+', numadd: 'Num +', numsub: 'Num -', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num .', Escape: 'Esc', Click: 'click' };
const MAC_NAMES = { Plus: '+', Left: '←', Right: '→', Up: '↑', Down: '↓', Enter: '↩', Backspace: '⌫', Delete: '⌦', Tab: '⇥', PageUp: '⇞', PageDown: '⇟',
  Home: '↖', End: '↘', Escape: '⎋', Space: 'Space', numadd: 'Num +', numsub: 'Num -', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num .', Click: 'click' };
function display(accel, platform) {
  if (!accel) return '';
  const mac = platform === 'darwin';
  const parts = accel.split('+').map(p => (p === '' ? 'Plus' : p));
  const key = parts.pop();
  const name = k => (mac ? MAC_NAMES : WIN_NAMES)[k] || (/^num\d$/.test(k) ? 'Num ' + k.slice(3) : k);
  if (mac) {
    const sym = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘' };
    const ms = ['Ctrl', 'Alt', 'Shift', 'CmdOrCtrl'].filter(m => parts.includes(m)).map(m => sym[m]).join('');
    return key === 'Click' ? ms + '+click' : ms + name(key);
  }
  return parts.map(p => (p === 'CmdOrCtrl' ? 'Ctrl' : p)).concat(name(key)).join('+');
}

module.exports = { COMMANDS, fixedKeys, normalize, check, defaults, cleanOverrides, resolve, conflictOf, assign, fromInput, display, reservedKeys };
