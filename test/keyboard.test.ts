import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeyEvent } from '../src/key-event';
import { decodeCommand } from '../src/protocol';
import { Harness, delay, until } from '../scripts/harness';
const mods = { ctrl: false, alt: false, shift: false, super: false };

test('native null key text becomes absent while malformed text is rejected', () => {
  for (const key of ['backspace', 'left', 'right', 'delete', 'enter']) {
    const e = { key, kind: 'press' as const, mods, text: null };
    assert.deepEqual(normalizeKeyEvent(e), { key, kind: 'press', mods });
    const m = decodeCommand({ type: 'input', id: 'a', event: { type: 'key', ...e } });
    assert.ok(m.type === 'input' && m.event.type === 'key' && m.event.text === undefined);
  }
  assert.equal(normalizeKeyEvent({ key: 'a', kind: 'press', mods, text: 'a' }).text, 'a');
  assert.throws(() => decodeCommand({ type: 'input', id: 'a', event: { type: 'key', key: 'a', kind: 'press', mods, text: 5 } }));
});

test('Pixel Studio supports shared backspace and Shift+Arrow selection through desktop IPC', { timeout: 15000 }, async () => {
  const h = new Harness();
  try {
    await h.ready(); const { id } = await h.request({ type: 'launch', app: 'demo' }); await h.attach();
    await until(async () => (await h.request({ type: 'inspect' })).rendering.surfaces[id]);
    const w = (await h.request({ type: 'inspect' })).state.windows[0];
    await h.click(w.x + 100, w.y + 36 + 174);
    let clipboard = '';
    h.guest!.onClipboard = text => { clipboard = text; };
    const key = async (key: string, extra = {}) => { h.guest!.send({ type: 'key', key, kind: 'press', text: null, mods: { ...mods, ...extra } } as any); await delay(60); };
    await key('a', { super: true });
    h.guest!.send({ type: 'paste', text: 'abcdef' }); await delay(100);
    await key('backspace');
    await key('left', { shift: true }); await key('left', { shift: true });
    await key('c', { super: true });
    await until(() => clipboard === 'de');
    h.guest!.send({ type: 'paste', text: 'XY' }); await delay(100);
    await key('a', { super: true }); await key('c', { super: true });
    await until(() => clipboard === 'abcXY');
    h.save('.artifacts/keyboard-selection.png');
  } finally { await h.close(); }
});
