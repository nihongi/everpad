'use strict';
/* 最近見たメモ: 開いているメモを切り替える処理(S.active = …)は、どれも「最近見たメモ」に記録する。
   0.22.0 までは、検索結果から開く処理(openAt)だけが記録していなかった */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

// S.active を書き換える関数の本体を取り出す(次の行頭の「  function」「  async function」まで)
function functionsSettingActive() {
  const out = [];
  const re = /^ {2}(?:async )?function (\w+)\(/gm;
  const starts = [...src.matchAll(re)].map(m => ({ name: m[1], at: m.index }));
  starts.forEach((f, i) => {
    const body = src.slice(f.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
    if (/\bS\.active = /.test(body)) out.push({ name: f.name, body: body });
  });
  return out;
}

test('最近見たメモ: メモを切り替える処理は、どれも touchRecent を呼ぶ(検索結果から開いたときも)', () => {
  const fns = functionsSettingActive();
  const names = fns.map(f => f.name);
  assert.ok(names.includes('show') && names.includes('openAt'), '見つけた関数: ' + names.join(', '));
  for (const f of fns) assert.ok(/\btouchRecent\(cur\(\)\)/.test(f.body), f.name + ' が最近見たメモに記録していない');
});
