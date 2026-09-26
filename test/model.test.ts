import test from 'node:test';
import assert from 'node:assert/strict';
import { action, bounds, constrain, DesktopState, BAR } from '../src/model';
import { keySequence } from '../src/terminal';
test('maximize restores geometry, minimize restores focus, resizing keeps windows reachable', () => {
  const a = { id: 'a', app: 'demo', kind: 'pixel' as const, title: 'A', pid: 1, status: 'Running', minimized: false, maximized: false, x: 100, y: 100, width: 400, height: 300 };
  const s: DesktopState = { windows: [a, { ...a, id: 'b' }], focused: 'b', width: 900, height: 600, apps: [], session: 'test', attached: true };
  action(s, 'a', 'maximize'); assert.equal(s.focused, 'a'); assert.equal(bounds(a, s).height, 600 - BAR);
  action(s, 'a', 'maximize'); assert.equal(a.width, 400); assert.equal(a.x, 100);
  action(s, 'a', 'minimize'); assert.equal(s.focused, 'b'); assert.equal(a.minimized, true);
  action(s, 'a', 'focus'); assert.equal(a.minimized, false);
  const r = constrain({ x: 1000, y: 1000, width: 900, height: 800 }, 600, 400); assert.equal(r.x, 0); assert.equal(r.y, 0); assert.equal(r.height, 400 - BAR);
});
test('terminal key encoding respects application cursors, modifiers and releases', () => {
  const e = { key: 'up', kind: 'press' as const, mods: { shift: false, ctrl: false, alt: false, super: false } };
  assert.equal(keySequence(e), '\x1b[A'); assert.equal(keySequence(e, true), '\x1bOA');
  assert.equal(keySequence({ ...e, mods: { ...e.mods, ctrl: true } }), '\x1b[1;5A');
  assert.equal(keySequence({ ...e, key: 'c', mods: { ...e.mods, ctrl: true } }), '\x03');
  assert.equal(keySequence({ ...e, kind: 'release' }), '');
});


test('guest adapter preserves opaque colors and composites straight-alpha edges', async () => {
  const { flattenGuestFrame } = await import('../src/pixel-frame.js');
  const frame = Buffer.from([240, 225, 210, 17, 3, 2, 1, 255, 255, 255, 255, 0]);
  assert.equal(flattenGuestFrame(frame), frame, 'reuse the owned read buffer');
  assert.deepEqual([...frame], [58, 41, 32, 255, 3, 2, 1, 255, 45, 28, 19, 255]);
});
