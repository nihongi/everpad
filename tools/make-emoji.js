'use strict';
/* 絵文字ショートコード(:smile: など)の一覧 renderer/emoji.js を、gemoji(GitHub と同じ一覧)から作る。
   作ったファイルは Git に入れる(テストやビルドの前に作り直す必要はない)。gemoji を新しくしたときに、手で動かす:
     node tools/make-emoji.js
   1行に1つ、[絵文字, 名前(空白区切り), タグ(空白区切り)]。並びは gemoji のまま(よく使う顔の絵文字が先)で、入力候補の順に使う。 */
const fs = require('fs');
const path = require('path');

(async () => {
  const { gemoji } = await import('gemoji');
  const pkg = require('gemoji/package.json');
  const license = fs.readFileSync(path.join(path.dirname(require.resolve('gemoji/package.json')), 'license'), 'utf8').trim();
  const rows = gemoji.map(g => JSON.stringify([g.emoji, g.names.join(' '), g.tags.join(' ')]));
  const out = "'use strict';\n"
    + '/* 絵文字ショートコード(:smile: など)の一覧。tools/make-emoji.js が gemoji ' + pkg.version + ' から作る。手で直さない。\n'
    + '   1行に1つ、[絵文字, 名前(空白区切り), タグ(空白区切り)]。画面からは <script> で読み(window.EVERPAD_EMOJI)、core.js からは require で読む。\n\n'
    + '   gemoji(https://github.com/wooorm/gemoji)のライセンス:\n\n'
    + license.split(/\r?\n/).map(l => ('   ' + l).replace(/\s+$/, '')).join('\n').replace(/\*\//g, '* /') + '\n*/\n'
    + '(function (root) {\n'
    + '  const LIST = [\n'
    + rows.map(r => '    ' + r).join(',\n') + '\n'
    + '  ];\n'
    + '  if (typeof module !== \'undefined\' && module.exports) module.exports = LIST;\n'
    + '  else root.EVERPAD_EMOJI = LIST;\n'
    + '})(typeof window !== \'undefined\' ? window : this);\n';
  const file = path.join(__dirname, '..', 'renderer', 'emoji.js');
  fs.writeFileSync(file, out);
  console.log('gemoji ' + pkg.version + ' → renderer/emoji.js(' + gemoji.length + ' 個、' + Math.round(Buffer.byteLength(out) / 1024) + ' KB)');
})().catch(e => { console.error(e); process.exit(1); });
