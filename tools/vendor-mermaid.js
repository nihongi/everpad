'use strict';
/* Mermaid の図の表示に使う mermaid.min.js(必要なものを1つにまとめたブラウザ用のファイル)を renderer/vendor/mermaid に写す。
   npm start と npm run dist の前に自動で動く(package.json の prestart / predist)。
   画面は、図のあるメモを開いたときに初めてこのファイルを読み込む(renderer/diagram.js)。 */
const fs = require('fs');
const path = require('path');

const src = path.dirname(require.resolve('mermaid/package.json'));
const out = path.join(__dirname, '..', 'renderer', 'vendor', 'mermaid');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(src, 'dist', 'mermaid.min.js'), path.join(out, 'mermaid.min.js'));
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'LICENSE'));
console.log('Mermaid ' + require('mermaid/package.json').version + ' → renderer/vendor/mermaid');
