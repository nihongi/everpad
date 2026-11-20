'use strict';
/* portable 版の起動役(electron-builder の portable.nsi)を、起動ごとに別のフォルダへ展開するように直す。
   npm run dist の前に自動で動く(package.json の predist)。

   electron-builder の portable 版は、起動するたびにアプリを一時フォルダへ展開してから起動する。展開先は版ごとに決まった
   1つのフォルダ(%TEMP%\<ビルドごとの ID>)なので、起動中にもう一度起動すると、
     1. 展開先を空にしようとして、動いている EverPad の(使用中でない)ファイルを消し、
     2. 使用中のファイルを上書きできるまで(1つ目の EverPad が終わるまで)待ち続け、終わったところで2つ目を起動する。
   起動ごとに作られる $PLUGINSDIR(起動役が終わると消える)に展開すれば、2つ目は自分のフォルダに展開して起動し、
   1つ目があれば、それを手前に出して終わる(main.js の requestSingleInstanceLock)。
   electron-builder の設定 portable.unpackDirName: false がこのためのものだが、26.x では効かない(既定の ID が使われる)。
   また $PLUGINSDIR は、画面を出さない起動では InitPluginsDir を呼ぶまで空なので、ここで呼ぶ。

   node tools/portable-unpack.js          直す(直してあれば何もしない)
   node tools/portable-unpack.js --check  直してあるかだけを確かめる(直していなければ 1 で終わる) */
const fs = require('fs');
const path = require('path');

const MARK = '; EverPad: unpack to a folder of its own for each launch';
const ORIGINAL = /( *)StrCpy \$INSTDIR "\$PLUGINSDIR\\app"\r?\n *!ifdef UNPACK_DIR_NAME\r?\n *StrCpy \$INSTDIR "\$TEMP\\\$\{UNPACK_DIR_NAME\}"\r?\n *!endif\r?\n/;

function templatePath() {
  return path.join(path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.join(__dirname, '..')] })), 'templates', 'nsis', 'portable.nsi');
}

/* 直した内容を返す(直してあれば null、直す場所が見つからなければ例外) */
function patch(text) {
  if (text.includes(MARK)) return null;
  if (!ORIGINAL.test(text)) throw new Error('portable.nsi has changed; the unpack folder cannot be fixed. Check tools/portable-unpack.js against the new electron-builder.');
  return text.replace(ORIGINAL, (m, sp) => sp + MARK + '\n' + sp + 'InitPluginsDir\n' + sp + 'StrCpy $INSTDIR "$PLUGINSDIR\\app"\n');
}

if (require.main === module) {
  const f = templatePath();
  const text = fs.readFileSync(f, 'utf8');
  let next;
  try { next = patch(text); } catch (e) { console.error(e.message); process.exit(1); }
  if (next === null) { console.log('portable.nsi: already unpacks to a folder of its own for each launch'); process.exit(0); }
  if (process.argv.includes('--check')) { console.error('portable.nsi: not fixed yet (run node tools/portable-unpack.js)'); process.exit(1); }
  fs.writeFileSync(f, next);
  console.log('portable.nsi: fixed to unpack to a folder of its own for each launch');
}

module.exports = { patch, MARK };
