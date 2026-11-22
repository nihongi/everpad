'use strict';
/* README の画像(履歴の再生の GIF とスクリーンショット)を作る。
   node tools/make-readme-media.js [ja|en ...]   (言語を省くと両方。出力は docs/images)
   見本のメモを一時フォルダに作り、開発中の EverPad をその保存先と設定で起動して(本物の保存先・設定は使わない)、
   画面を撮る。GIF は ffmpeg(PATH にあるもの)でつなぐ。Microsoft Store のスクリーンショットにも使える */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const at = s => new Date(s + '+09:00').getTime();

/* ---------- 見本のメモ ---------- */
const T = {
  ja: {
    title: '振り子の実験',
    // 下書き(順に打っていく)と、あとで直すところ
    draft: [
      '# 振り子の実験',
      '',
      '## 目的',
      '糸の長さと周期の関係を確かめる。',
      '',
      '## 理論',
      '振れ幅が小さいとき、周期は次の式で近似できる。',
      '',
      '$$T = 2\\pi \\sqrt{\\frac{L}{g}}$$',
      '',
      '## 手順',
      'ストップウォッチで10往復の時間を測る(長さごとに3回)。',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[糸の長さを決める] --> B[10往復の時間を測る]',
      '  B --> C[周期を計算する]',
      '  C --> D{3回測った?}',
      '  D -- まだ --> B',
      '  D -- はい --> E[平均を記録する]',
      '```',
      '',
      '## 結果',
      '| 糸の長さ L (m) | 周期 T (s) | 理論値 (s) |',
      '|---:|---:|---:|',
      '| 0.25 | 1.01 | 1.00 |',
      '| 0.50 | 1.41 | 1.42 |',
      '| 1.00 | 2.00 | 2.01 |',
      '',
      '## やること',
      '- [ ] 糸とおもりを用意する',
      '- [ ] 3つの長さで測る',
      '- [ ] グラフにまとめる',
      ''
    ].join('\n'),
    edits: [
      ['ストップウォッチ', 'スマートフォンのタイマー'],
      ['| 1.41 |', '| 1.43 |'],
      ['- [ ] 糸とおもり', '- [x] 糸とおもり'],
      ['- [ ] 3つの長さ', '- [x] 3つの長さ']
    ],
    search: 'ストップウォッチ',
    others: [
      ['研究室ミーティングのスライド', '---\nmarp: true\n---\n\n# 振り子の周期\n\n研究室ミーティング・11月21日\n\n---\n\n## 結果\n\n- 周期は、糸の長さの平方根に比例する\n- 測った値と理論値の差は 1% 以内\n\n$$T = 2\\pi \\sqrt{\\frac{L}{g}}$$\n\n---\n\n## 次にやること\n\n| やること | 担当 |\n|---|---|\n| グラフにまとめる | A 班 |\n| 振れ幅を変えて測る | B 班 |\n'],
      ['週次ミーティング', '# 週次ミーティング\n\n- [x] 先週の結果を共有する\n- [ ] 次の実験の日程を決める\n\n> [!NOTE]\n> 次回は木曜日の 10 時から\n'],
      ['買い物リスト', '# 買い物リスト\n\n- [ ] 糸(1 m 以上)\n- [ ] 分度器\n- [x] 電池\n'],
      ['京都旅行の計画(3日間)', '# 京都旅行の計画(3日間)\n\n| 日 | 行き先 |\n|---|---|\n| 1日目 | 清水寺・祇園 |\n| 2日目 | 嵐山 |\n| 3日目 | 伏見稲荷 |\n'],
      ['アイデア', '# アイデア\n\n- 振り子の周期を測るアプリ\n- 実験ノートのひな型\n']
    ]
  },
  en: {
    title: 'Pendulum experiment',
    draft: [
      '# Pendulum experiment',
      '',
      '## Goal',
      'Check how the length of the string changes the period.',
      '',
      '## Theory',
      'For small swings, the period is close to',
      '',
      '$$T = 2\\pi \\sqrt{\\frac{L}{g}}$$',
      '',
      '## Method',
      'Time 10 swings with a stopwatch, three times for each length.',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Set the length] --> B[Time 10 swings]',
      '  B --> C[Work out the period]',
      '  C --> D{Measured 3 times?}',
      '  D -- No --> B',
      '  D -- Yes --> E[Record the average]',
      '```',
      '',
      '## Results',
      '| Length L (m) | Period T (s) | Theory (s) |',
      '|---:|---:|---:|',
      '| 0.25 | 1.01 | 1.00 |',
      '| 0.50 | 1.41 | 1.42 |',
      '| 1.00 | 2.00 | 2.01 |',
      '',
      '## To do',
      '- [ ] Get a string and a weight',
      '- [ ] Measure three lengths',
      '- [ ] Plot the results',
      ''
    ].join('\n'),
    edits: [
      ['a stopwatch', 'a phone timer'],
      ['| 1.41 |', '| 1.43 |'],
      ['- [ ] Get a string', '- [x] Get a string'],
      ['- [ ] Measure three', '- [x] Measure three']
    ],
    search: 'stopwatch',
    others: [
      ['Lab meeting slides', '---\nmarp: true\n---\n\n# The period of a pendulum\n\nLab meeting, November 21\n\n---\n\n## Results\n\n- The period grows with the square root of the length\n- Measured and expected values differ by less than 1%\n\n$$T = 2\\pi \\sqrt{\\frac{L}{g}}$$\n\n---\n\n## Next steps\n\n| Task | Team |\n|---|---|\n| Plot the results | A |\n| Try larger swings | B |\n'],
      ['Weekly meeting', '# Weekly meeting\n\n- [x] Share last week\'s results\n- [ ] Pick a date for the next experiment\n\n> [!NOTE]\n> Next meeting: Thursday at 10:00\n'],
      ['Shopping list', '# Shopping list\n\n- [ ] String (at least 1 m)\n- [ ] Protractor\n- [x] Batteries\n'],
      ['Trip plan: three days in Kyoto', '# Trip plan: three days in Kyoto\n\n| Day | Places |\n|---|---|\n| 1 | Kiyomizu-dera, Gion |\n| 2 | Arashiyama |\n| 3 | Fushimi Inari |\n'],
      ['Ideas', '# Ideas\n\n- An app that times a pendulum\n- A template for lab notes\n']
    ]
  }
};

/* 下書きを少しずつ打っていく版の列(日本語は数文字ずつ、英語は単語2〜3個ずつ) */
function typingSteps(text, lang) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const pieces = [];
    if (/^```|^ {2}[A-Z]|^\|[-:|]+\|$/.test(line) || line.length <= 14) pieces.push(line);
    else if (lang === 'en') {
      const words = line.split(/(?<= )/);
      for (let i = 0; i < words.length; i += 3) pieces.push(words.slice(i, i + 3).join(''));
    } else {
      for (let i = 0; i < line.length; i += 9) pieces.push(line.slice(i, i + 9));
    }
    pieces[pieces.length - 1] += '\n';
    for (const p of pieces) { cur += p; out.push(cur); }
  }
  // 空の行は、前の行と一緒に打つ(空の行だけを足す版は作らない)
  return out.filter((s, i) => i === out.length - 1 || out[i + 1] !== s + '\n');
}
/* 2つの版の差を [位置, 消した文字, 入れた文字] にする */
function diffOp(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, a.slice(p, a.length - s), b.slice(p, b.length - s)];
}
function writeNote(dir, id, created, versions, times) {
  const lines = [JSON.stringify({ v: 1, id: id, c: created })];
  let prev = '';
  versions.forEach((v, i) => { const [p, d, ins] = diffOp(prev, v); lines.push(JSON.stringify([p, d, ins, times[i]])); prev = v; });
  fs.writeFileSync(path.join(dir, id + '.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, id + '.md'), prev);
}
function makeNotes(dir, lang) {
  const t = T[lang];
  // ほかのメモ(古い順)
  t.others.forEach(([, text], i) => {
    const c = at('2026-11-' + String(14 + i).padStart(2, '0') + 'T09:00:00');
    writeNote(dir, '202611' + String(14 + i).padStart(2, '0') + '-090000-' + 'o' + i + 'xx', c, [text], [c + 60000]);
  });
  // 振り子の実験: 前の日に下書きを打ち、次の日に直す
  const steps = typingSteps(t.draft, lang);
  const c = at('2026-11-20T10:02:00');
  const times = steps.map((_, i) => c + 20000 + i * 9000 + (i % 4) * 1700);
  let text = steps[steps.length - 1];
  const versions = steps.slice();
  let t2 = at('2026-11-21T09:15:00');
  for (const [from, to] of t.edits) { text = text.replace(from, to); versions.push(text); times.push(t2); t2 += 140000; }
  writeNote(dir, '20261120-100200-pend', c, versions, times);
  return versions.length;
}

/* ---------- 開発中の EverPad を動かす ---------- */
async function connect(port) {
  let list;
  for (let i = 0; i < 80; i++) { try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (list.length) break; } catch (e) { /* 起動待ち */ } await sleep(500); }
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const waiters = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const ev = expr => new Promise(r => { const id = ++seq; waiters.set(id, m => r(m.result && m.result.result ? m.result.result.value : undefined)); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
  return { ws, ev };
}

async function run(lang) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'everpad-media-'));
  const data = path.join(tmp, 'notes'), ud = path.join(tmp, 'settings'), frames = path.join(tmp, 'frames');
  for (const d of [data, ud, frames]) fs.mkdirSync(d, { recursive: true });
  const nVersions = makeNotes(data, lang);
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ dataDir: data, lang: lang, update: { checkOnStart: false }, window: { x: 40, y: 30, width: 1300, height: 860, maximized: false } }, null, 2));
  const port = 9400 + Math.floor(Math.random() * 200);
  const app = spawn(require('electron'), ['--inspect=' + port, ROOT, '--user-data-dir=' + ud], { cwd: ROOT, stdio: 'ignore' });
  const { ws, ev } = await connect(port);
  const E = "(process.mainModule ? process.mainModule.require : require)('electron')";
  const W = `${E}.BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))`;
  try {
    for (let i = 0; i < 80; i++) { if ((await ev(`${E}.BrowserWindow.getAllWindows().length`)) > 0) break; await sleep(500); }
    await sleep(3000);
    const R = js => ev(`${W}.webContents.executeJavaScript(${JSON.stringify('(async () => { const $ = id => document.getElementById(id); ' + js + ' })()')})`);
    // 一時フォルダの保存先で開いたことを確かめてから撮る
    let dir = '';
    for (let i = 0; i < 20 && !dir; i++) { dir = await R(`return $('dirPath').textContent;`); if (!dir) await sleep(500); }
    if (dir !== data) throw new Error('not the temporary data folder: ' + dir);
    // 画面に出す保存先は、一時フォルダの場所(ユーザー名を含む)ではなく見本の場所にする
    await R(`$('dirPath').textContent = ${JSON.stringify(lang === 'ja' ? 'D:\\メモ\\EverPad' : 'D:\\Notes\\EverPad')}; return 1;`);
    const size = async (w, h) => { await ev(`${W}.setContentSize(${w}, ${h})`); await sleep(600); };
    const shot = async (file, w) => ev(`(async () => { let img = await ${W}.webContents.capturePage(); if (img.getSize().width !== ${w}) img = img.resize({ width: ${w}, quality: 'best' }); (process.mainModule ? process.mainModule.require : require)('fs').writeFileSync(${JSON.stringify(file)}, img.toPNG()); return 1; })()`);
    const click = sel => R(`document.querySelector(${JSON.stringify(sel)}).click(); return 1;`);
    const open = async id => { await click(`#noteList .note[data-id="${id}"]`); await sleep(1200); };
    const mode = async m => { await click(`#tabs [data-mode="${m}"]`); await sleep(1500); };
    const PEND = '20261120-100200-pend';
    const deck = (await R(`return [...document.querySelectorAll('#noteList .note')].map(x => x.dataset.id).find(id => id.endsWith('-o0xx'));`));

    /* 1. 履歴の再生の GIF */
    const GW = 1100, GH = 690;
    await size(GW, GH);
    await open(PEND);
    await mode('edit');
    await click('#histBtn');
    await sleep(800);
    const list = [];
    let f = 0;
    const frame = async dur => { const file = path.join(frames, 'f' + String(++f).padStart(4, '0') + '.png'); await shot(file, GW); list.push([file, dur]); };
    // 版を進める。書いている所が表示の下のほうに来るようにして、上に書いた文も見えるようにする
    const goRev = async k => {
      await R(`const r = $('range'); r.value = ${k}; r.dispatchEvent(new Event('input'));
        const b = $('hvBody'), t = b.querySelector('ins, del');
        if (t) b.scrollTop = Math.max(0, b.scrollTop + t.getBoundingClientRect().top - b.getBoundingClientRect().top - b.clientHeight * 0.7);
        return 1;`);
      await sleep(90);
    };
    const typed = nVersions - T[lang].edits.length;
    await goRev(1); await frame(0.9);
    for (let k = 2; k <= typed; k++) { await goRev(k); await frame(0.11); }
    await frame(0.8);
    for (let k = typed + 1; k <= nVersions; k++) { await goRev(k); await frame(1.2); }
    // 履歴を閉じて、仕上がりのプレビューを見せる
    await click('#histBtn');
    await sleep(500);
    await mode('preview');
    await sleep(1500);
    await R(`$('preview').scrollTop = 0; return 1;`);
    await sleep(300);
    await frame(2.2);
    const maxScroll = await R(`return $('preview').scrollHeight - $('preview').clientHeight;`);
    for (let i = 1; i <= 14; i++) { await R(`$('preview').scrollTop = ${Math.round(maxScroll * i / 14)}; return 1;`); await sleep(60); await frame(0.07); }
    await frame(2.8);
    const concat = list.map(([file, d]) => `file '${file.replace(/\\/g, '/')}'\nduration ${d}`).join('\n') + `\nfile '${list[list.length - 1][0].replace(/\\/g, '/')}'\n`;
    fs.writeFileSync(path.join(frames, 'list.txt'), concat);
    const gif = path.join(OUT, lang + '-replay.gif');
    await new Promise((res, rej) => {
      const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
        '-vf', 'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', gif], { stdio: 'inherit' });
      p.on('exit', c => c === 0 ? res() : rej(new Error('ffmpeg ' + c)));
    });

    /* 2. スクリーンショット(1280×800) */
    const SW = 1280, SH = 800;
    await size(SW, SH);
    // プレビュー: 数式・図・表
    await open(PEND);
    await mode('preview');
    await sleep(1500);
    await R(`const h = [...$('preview').querySelectorAll('h2')][1]; $('preview').scrollTop = h ? h.offsetTop - 16 : 0; return 1;`);
    await sleep(500);
    await shot(path.join(OUT, lang + '-preview.png'), SW);
    // スライド
    await open(deck);
    await mode('preview');
    await sleep(1500);
    // 2枚目(箇条書きと数式)が見えるように
    await R(`const s = $('preview').querySelectorAll('.slide')[1]; $('preview').scrollTop = s ? s.offsetTop - 24 : 0; return 1;`);
    await sleep(500);
    await shot(path.join(OUT, lang + '-slides.png'), SW);
    // ダークモード(プレビュー)
    await ev(`${E}.nativeTheme.themeSource = 'dark'`);
    await open(PEND);
    await mode('preview');
    await sleep(1500);
    await R(`$('preview').scrollTop = 0; return 1;`);
    await sleep(800);
    await shot(path.join(OUT, lang + '-dark.png'), SW);
    await ev(`${E}.nativeTheme.themeSource = 'system'`);
    await sleep(500);
    // 履歴すべてから検索して、見つかった版を開く(タイムスライダーに、その言葉がある版の帯)
    await click('#scopeSeg [data-scope="history"]');
    await R(`const q = $('q'); q.value = ${JSON.stringify(T[lang].search)}; q.dispatchEvent(new Event('input')); return 1;`);
    await sleep(1500);
    await R(`$('resList').querySelector('.hit').click(); return 1;`);
    await sleep(2000);
    // 見つかった版の範囲の、あとのほうの版にする(本文が長く、帯の中にいることがわかる)
    await R(`const r = $('range'); r.value = ${nVersions - T[lang].edits.length - 3}; r.dispatchEvent(new Event('input')); return 1;`);
    await sleep(800);
    await R(`$('q').blur(); return 1;`);
    await sleep(300);
    await shot(path.join(OUT, lang + '-history-search.png'), SW);
  } finally {
    try { await ev(`${E}.app.quit()`); } catch (e) { /* 閉じている */ }
    ws.close();
    await new Promise(r => { if (app.exitCode !== null) r(); else app.once('exit', r); setTimeout(r, 8000); });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const langs = process.argv.slice(2).filter(a => T[a]);
  for (const l of langs.length ? langs : ['en', 'ja']) { console.log('making ' + l); await run(l); }
  for (const f of fs.readdirSync(OUT)) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
