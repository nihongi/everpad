'use strict';
/* ウィンドウの位置と大きさを覚えて、次の起動で戻す(Electronに依存しないので、テストできる)。
   saved は前回の { x, y, width, height, maximized }、workAreas は各ディスプレイの作業領域 [{ x, y, width, height }]。 */
const MIN_VISIBLE = 100;   // ディスプレイの中にこれだけ見えていれば、前回の位置をそのまま使う

function restoreBounds(saved, workAreas, defaults) {
  const def = { width: defaults.width, height: defaults.height, maximized: false };
  if (!saved || typeof saved !== 'object') return def;
  const num = v => typeof v === 'number' && isFinite(v);
  if (![saved.x, saved.y, saved.width, saved.height].every(num)) return def;
  const width = Math.max(defaults.minWidth, Math.round(saved.width));
  const height = Math.max(defaults.minHeight, Math.round(saved.height));
  const x = Math.round(saved.x), y = Math.round(saved.y);
  const maximized = !!saved.maximized;
  // ディスプレイを外したなどで画面の外に出てしまう位置なら、大きさだけ戻して位置はOSに任せる
  const visible = (workAreas || []).some(a =>
    Math.min(x + width, a.x + a.width) - Math.max(x, a.x) >= MIN_VISIBLE &&
    Math.min(y + height, a.y + a.height) - Math.max(y, a.y) >= Math.min(MIN_VISIBLE, height) &&
    y >= a.y && y < a.y + a.height);   // タイトルバーが画面の中にあること
  if (!visible) {
    const a = (workAreas || [])[0];
    return { width: a ? Math.min(width, a.width) : width, height: a ? Math.min(height, a.height) : height, maximized: maximized };
  }
  return { x: x, y: y, width: width, height: height, maximized: maximized };
}

/* 閉じるときに保存する値。最大化・最小化していても、元の大きさ(getNormalBounds)を覚える */
function captureBounds(normalBounds, maximized) {
  const b = normalBounds || {};
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized: !!maximized };
}

module.exports = { restoreBounds, captureBounds };
