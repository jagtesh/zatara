import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCommand } from '../src/protocol';
import { parseAppRegistrations } from '../src/apps';
import { Harness } from '../scripts/harness';

test('IPC accepts Pixel nullable colors and rejects invalid input and action shapes', () => {
  const attach = { type: 'attach', width: 1200, height: 792, cell: { width: 8, height: 18 }, colors: { foreground: null, background: null, palette: [null, [0, 1, 2, 255]] } };
  assert.deepEqual(decodeCommand(attach), attach);
  assert.throws(() => decodeCommand({ ...attach, cell: { width: 0, height: 18 } }));
  for (const value of [null, { type: 'invented' }, { type: 'action', id: 'a', op: 'maximise' }, { type: 'action', id: 'a', op: 'move' }, { type: 'input', id: 'a', event: { type: 'focus', focused: true } }, { type: 'input', id: 'a', event: { type: 'key', key: 'a', kind: 'press', mods: {} } }]) assert.throws(() => decodeCommand(value));
  // Overshooting the opposite resize edge is valid; the shared model constrains it.
  assert.equal(decodeCommand({ type: 'action', id: 'a', op: 'move', rect: { x: 0, y: 0, width: -5, height: 200 } }).type, 'action');
});

test('custom apps have validated launch commands and optional initial geometry', () => {
  const app = { id: 'sample', name: 'Sample', icon: 'S', command: ['node', 'app.js'], initialSize: { width: 720, height: 500 } };
  assert.equal(parseAppRegistrations([app])[0].initialSize?.width, 720);
  for (const value of [[{ ...app, command: [] }], [{ ...app, id: 123 }], [{ ...app, initialSize: { width: '720', height: 500 } }], [app, app]]) assert.throws(() => parseAppRegistrations(value));
});

test('invalid wire commands cannot mutate windows or stop the session service', async () => {
  const h = new Harness();
  try {
    await h.ready(); const { id } = await h.request({ type: 'launch', app: 'demo' });
    await assert.rejects(h.request({ type: 'action', id, op: 'move' }), /IPC object/);
    await assert.rejects(h.request({ type: 'action', id, op: 'maximise' }), /Invalid IPC value/);
    await assert.rejects(h.request({ type: 'action', id, op: 'close', rect: {} }), /Only move/);
    const before = (await h.request({ type: 'inspect' })).state.windows[0];
    await h.request({ type: 'action', id, op: 'maximize' });
    const after = (await h.request({ type: 'inspect' })).state.windows[0];
    assert.equal(after.pid, before.pid); assert.equal(after.maximized, true);
  } finally { await h.close(); }
});
