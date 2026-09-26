import test from 'node:test';
import assert from 'node:assert/strict';
import { shellViewport, terminalPoint } from '../src/shell-viewport';
import type { Screen } from '../src/terminal';

test('viewport follows an offscreen cursor and translates mouse coordinates without changing cell size', () => {
  const screen: Screen = { rows: [[], [], [], [], []], cols: 80, rowCount: 5, cursor: { x: 4, y: 4 }, scroll: 0, alternate: false };
  const view = shellViewport(screen, 136, 34);
  assert.deepEqual(view, { first: 1, count: 4, offsetY: 34 });
  assert.deepEqual(terminalPoint({ x: 16, y: 102, button: 'left' }, view.offsetY), { x: 16, y: 136, button: 'left' });
  assert.equal(shellViewport(screen, 170, 34).first, 0, 'restores full screen when geometry catches up');
  assert.equal(shellViewport({ ...screen, cursor: { x: 0, y: 0 }, alternate: true }, 136, 34).first, 0, 'top-positioned TUI cursor remains visible');
  assert.equal(shellViewport({ ...screen, cursor: { x: 0, y: -1 }, scroll: 10 }, 136, 34).first, 0, 'scrollback retains its first row');
  assert.equal(shellViewport(screen, 18 * 4 - 1e-12, 18).count, 4, 'fractional logical dimensions retain complete rows');
});
