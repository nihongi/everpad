'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { restoreBounds, captureBounds } = require('../windowstate');

const D = { width: 1120, height: 780, minWidth: 560, minHeight: 420 };
const one = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const two = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1920, height: 1040 }];

test('ウィンドウ: 覚えた値がなければ、既定の大きさで位置はOSに任せる', () => {
  assert.deepStrictEqual(restoreBounds(undefined, one, D), { width: 1120, height: 780, maximized: false });
  assert.deepStrictEqual(restoreBounds({ x: 'a', y: 0, width: 800, height: 600 }, one, D), { width: 1120, height: 780, maximized: false });
});

test('ウィンドウ: 画面の中にあれば、前回の位置と大きさ・最大化をそのまま戻す', () => {
  assert.deepStrictEqual(restoreBounds({ x: 100, y: 50, width: 900, height: 700, maximized: false }, one, D), { x: 100, y: 50, width: 900, height: 700, maximized: false });
  assert.deepStrictEqual(restoreBounds({ x: 2100, y: 80, width: 900, height: 700, maximized: true }, two, D), { x: 2100, y: 80, width: 900, height: 700, maximized: true });
});

test('ウィンドウ: 外したディスプレイの上にあった場合は、位置を捨てて画面に収まる大きさにする', () => {
  assert.deepStrictEqual(restoreBounds({ x: 2100, y: 80, width: 900, height: 700 }, one, D), { width: 900, height: 700, maximized: false });
  assert.deepStrictEqual(restoreBounds({ x: 2100, y: 80, width: 2500, height: 1400, maximized: true }, one, D), { width: 1920, height: 1040, maximized: true });
});

test('ウィンドウ: タイトルバーが画面の上にはみ出していたら位置を捨て、小さすぎる大きさは最小値にする', () => {
  assert.strictEqual(restoreBounds({ x: 100, y: -300, width: 900, height: 700 }, one, D).x, undefined);
  assert.deepStrictEqual(restoreBounds({ x: 10, y: 10, width: 100, height: 100 }, one, D), { x: 10, y: 10, width: 560, height: 420, maximized: false });
});

test('ウィンドウ: 保存する値は元の大きさと最大化の有無', () => {
  assert.deepStrictEqual(captureBounds({ x: 5, y: 6, width: 700, height: 500 }, true), { x: 5, y: 6, width: 700, height: 500, maximized: true });
});
