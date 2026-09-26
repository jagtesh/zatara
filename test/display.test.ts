import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { terminalScale, physicalStyle, physicalCommand } from '../src/display';
import { Harness, until, delay } from '../scripts/harness';

test('display scaling converts lengths and input coordinates without scaling colors or flex factors', () => {
  assert.equal(terminalScale(34), 34 / 18);
  const style = physicalStyle({ width: '100%', height: 36, padding: { left: 2 }, fontSize: 13, font: 7, flexGrow: 1, background: [1, 2, 3, 255], border: { bottom: [2, '#ffffff'] } }, 2)!;
  assert.equal(style.height, 72); assert.equal(style.fontSize, 26); assert.equal(style.font, 7); assert.equal(style.flexGrow, 1); assert.equal(style.width, '100%');
  assert.deepEqual(style.background, [1, 2, 3, 255]); assert.deepEqual(style.border, { bottom: [4, '#ffffff'] });
  assert.deepEqual(physicalCommand({ type: 'action', id: 'a', op: 'move', rect: { x: 20, y: 30, width: 400, height: 300 } }, 2), { type: 'action', id: 'a', op: 'move', rect: { x: 40, y: 60, width: 800, height: 600 } });
});

test('16x34 terminal cells scale desktop controls, retain sharp guests, and route pointer coordinates', { timeout: 20000 }, async () => {
  const h = new Harness({ width: 2432, height: 1326, cell: { width: 16, height: 34 } }), scale = 34 / 18;
  try {
    await h.ready(); const { id } = await h.request({ type: 'launch', app: 'demo' }); await h.attach();
    const inspect = () => h.request({ type: 'inspect' });
    await until(async () => (await inspect()).rendering.surfaces[id]);
    let m = await inspect(), w = m.state.windows[0];
    assert.equal(m.state.scale, scale); assert.ok(Math.abs(w.width - 680 * scale) < 1);
    assert.equal(m.rendering.surfaces[id].width, Math.floor((w.width - 4 * scale) / 16) * 16);
    const frame = () => createHash('sha256').update(fs.readFileSync(`${h.dir}/test-frames/${id}.bgra`)).digest('hex');
    const before = frame(), pid = w.pid;
    await h.click(w.x + 75 * scale, w.y + 270 * scale); await until(() => frame() !== before);
    await h.drag(w.x + 140 * scale, w.y + 18 * scale, 80, 45);
    m = await inspect(); assert.ok(Math.abs(m.state.windows[0].x - w.x - 80) < 2);
    w = m.state.windows[0];
    await h.click(w.x + w.width - 50 * scale, w.y + 18 * scale);
    assert.equal((await inspect()).state.windows[0].maximized, true);
    await h.click(h.width - 50 * scale, 18 * scale);
    assert.equal((await inspect()).state.windows[0].maximized, false);
    h.save('.artifacts/dpi-desktop.png');
    h.desktop!.kill('SIGKILL'); await until(async () => !(await inspect()).state.attached); await h.attach();
    assert.equal((await inspect()).state.windows[0].pid, pid);
  } finally { await h.close(); }
});

test('shell glyph columns and cursor remain aligned after a long line at high DPI', { timeout: 15000 }, async () => {
  const h = new Harness({ width: 2432, height: 1326, cell: { width: 16, height: 34 } });
  try {
    await h.ready(); const { id } = await h.request({ type: 'launch', app: 'shell' }); await h.attach();
    await h.request({ type: 'input', id, event: { type: 'text', text: `python3 -c "import sys,time;sys.stdout.write('\\x1b[2J\\x1b[H'+'M'*60+'\\x1b[2;1H界éM\\x1b[1;61H');sys.stdout.flush();time.sleep(30)"\r` } });
    await until(async () => { const m = await h.request({ type: 'screen', id }); return m.screen.cursor.x === 60 && m.screen.cursor.y === 0; });
    const screen = (await h.request({ type: 'screen', id })).screen;
    assert.equal(screen.rows[1][0].width, 2); assert.equal(screen.rows[1][1].width, 0);
    assert.equal(screen.rows[1][2].text, 'é'); assert.equal(screen.rows[1][3].text, 'M');
    await delay(200);
    const w = (await h.request({ type: 'inspect' })).state.windows[0], s = 34 / 18;
    // Read back the real native frame. Each M must begin exactly one 16px cell
    // after the previous one; the final bright run is the cursor underline.
    const runs: number[][] = []; let active = false;
    for (let x = Math.ceil(w.x + 2 * s); x < w.x + 64 * 16; x++) {
      let bright = false;
      for (let y = Math.ceil(w.y + 37 * s); y < w.y + 37 * s + 34; y++) {
        const i = (y * h.width + x) * 4, b = h.bgra!;
        if (b[i] > 180 && b[i + 1] > 140 && b[i + 2] > 140) bright = true;
      }
      if (bright && !active) runs.push([x]); if (!bright && active) runs.at(-1)!.push(x - 1); active = bright;
    }
    assert.equal(runs.length, 61);
    for (let i = 1; i < 60; i++) assert.equal(runs[i][0] - runs[i - 1][0], 16, `glyph column ${i}`);
    assert.ok(runs[60][0] - runs[59][1] <= 16, 'cursor immediately follows the final cell');
    h.save('.artifacts/dpi-shell.png');
  } finally { await h.close(); }
});
