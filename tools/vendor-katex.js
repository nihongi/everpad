'use strict';
/* 数式の表示に使う KaTeX のうち、画面で読むファイルだけを renderer/vendor/katex に写す。
   npm start と npm run dist の前に自動で動く(package.json の prestart / predist)。
   フォントは WOFF2 だけを写す(CSS は WOFF2 を最初に指定しているので、ほかの形式は読みにいかない)。 */
const fs = require('fs');
const path = require('path');

const src = path.dirname(require.resolve('katex/package.json'));
const dist = path.join(src, 'dist');
const out = path.join(__dirname, '..', 'renderer', 'vendor', 'katex');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(out, 'contrib'), { recursive: true });
for (const f of ['katex.min.js', 'katex.min.css']) fs.copyFileSync(path.join(dist, f), path.join(out, f));
fs.copyFileSync(path.join(dist, 'contrib', 'mhchem.min.js'), path.join(out, 'contrib', 'mhchem.min.js'));
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'LICENSE'));
let n = 0;
for (const f of fs.readdirSync(path.join(dist, 'fonts'))) {
  if (f.endsWith('.woff2')) { fs.copyFileSync(path.join(dist, 'fonts', f), path.join(out, 'fonts', f)); n++; }
}
console.log('KaTeX ' + require('katex/package.json').version + ' → renderer/vendor/katex(フォント ' + n + ' 個)');
