import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Harness, delay } from '../scripts/harness';
import { BAR } from '../src/model';
import { taskLayout, menuRect } from '../src/layout';

test('overflow restores hidden windows; context menus target task entries and spare guest content', { timeout: 30000 }, async () => {
  const h = new Harness({ width: 800, height: 600 });
  try {
    await h.ready();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await h.request({ type: 'launch', app: 'shell' })).id);
    await h.attach();
    const inspect = async () => (await h.request({ type: 'inspect' })).state;
    const layout = taskLayout(h.width, h.height, ids.length);
    assert.ok(layout.overflow);
    await h.request({ type: 'action', id: ids[5], op: 'minimize' });
    await h.click(layout.overflow!.x + 20, h.height - 20);
    const r = menuRect(layout.overflow!.x, h.height - BAR, h.width, h.height, ids.length);
    await h.click(r.x + 70, r.y + 6 + 5 * 36 + 18);
    assert.equal((await inspect()).focused, ids[5]);
    assert.equal((await inspect()).windows.find((w: any) => w.id === ids[5]).minimized, false);
    // The very left edge of the first entry was missed by the old hard-coded hit test.
    const first = layout.entries[0];
    await h.click(first.x + 3, first.y + 15, 'right');
    const context = menuRect(first.x + 3, first.y + 15, h.width, h.height, 3);
    await h.click(context.x + 60, context.y + 22);
    assert.equal((await inspect()).windows.find((w: any) => w.id === ids[0]).minimized, true);
    // Right-click content, then type. An accidental desktop menu would swallow input.
    const w = (await inspect()).windows.find((w: any) => w.id === ids[5]);
    await h.click(w.x + 100, w.y + 100, 'right');
    h.guest!.send({ type: 'paste', text: "printf 'GUEST_CONTEXT_OK\\n'\n" });
    await delay(250);
    const text = (await h.request({ type: 'screen', id: ids[5] })).screen.rows.map((r: any[]) => r.map(c => c.text).join('')).join('\n');
    assert.ok(text.includes('GUEST_CONTEXT_OK'));
    h.save('.artifacts/polish-compact.png');
  } finally { await h.close(); }
});


test('long titles preserve reachable window controls at compact size', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zatara-layout-'));
  const apps = path.join(dir, 'apps.json');
  fs.writeFileSync(apps, JSON.stringify([{ id: 'fixture', name: 'An application name that exceeds a taskbar entry', icon: 'F', command: [process.execPath, path.resolve('test/fixture-app.cjs')] }]));
  const h = new Harness({ width: 800, height: 600, env: { ZATARA_APPS: apps } });
  try {
    await h.ready();
    const id = (await h.request({ type: 'launch', app: 'fixture' })).id;
    await h.attach(); await delay(200);
    await h.request({ type: 'action', id, op: 'move', rect: { x: 140, y: 50, width: 350, height: 300 } });
    await delay(200); h.save('.artifacts/polish-long-title.png');
    const w = (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === id);
    assert.ok(w.title.startsWith('A deliberately long'));
    await h.click(w.x + w.width - 50, w.y + 18);
    assert.equal((await h.request({ type: 'inspect' })).state.windows[0].maximized, true);
    await h.click(h.width - 16, 18);
    assert.equal((await h.request({ type: 'inspect' })).state.windows.length, 0);
  } finally { await h.close(); fs.rmSync(dir, { recursive: true }); }
});

test('small desktop scrolls overflow menu to the last minimized app', { timeout: 20000 }, async () => {
  const h = new Harness({ width: 320, height: 240 });
  try {
    await h.ready();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await h.request({ type: 'launch', app: 'shell' })).id);
    await h.attach();
    await h.request({ type: 'action', id: ids[9], op: 'minimize' });
    const layout = taskLayout(h.width, h.height, ids.length);
    assert.ok(layout.overflow!.x + layout.overflow!.width <= layout.detach.x);
    await h.click(layout.overflow!.x + 20, h.height - 20);
    const r = menuRect(layout.overflow!.x, h.height - BAR, h.width, h.height, ids.length);
    h.guest!.send({ type: 'wheel', x: r.x + 100, y: r.y + 70, deltaX: 0, deltaY: 1000, mods: { ctrl: false, alt: false, shift: false, super: false } });
    await delay(200); h.save('.artifacts/polish-small-menu.png');
    await h.click(r.x + 80, r.y + r.height - 24);
    const state = (await h.request({ type: 'inspect' })).state;
    assert.equal(state.focused, ids[9]);
    assert.equal(state.windows.find((w: any) => w.id === ids[9]).minimized, false);
  } finally { await h.close(); }
});
