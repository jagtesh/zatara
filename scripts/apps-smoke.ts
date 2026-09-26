import fs from 'node:fs';
import { PNG } from 'pngjs';
import { flattenGuestFrame } from '../src/pixel-frame';
import os from 'node:os';
import { processes } from './measure';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Harness, delay, until } from './harness';
async function main() {
  process.env.ZATARA_BROWSER_URL = 'file://' + path.resolve('test/browser-fixture.html');
  const h = new Harness();
  try {
    await h.ready();
    const browser = (await h.request({ type: 'launch', app: 'browser' })).id;
    await until(async () => (await h.request({ type: 'inspect' })).metrics.frames > 5, 20000);
    const code = (await h.request({ type: 'launch', app: 'code' })).id;
    await until(() => fs.existsSync(path.join(h.dir, 'test-frames', code + '.bgra')), 40000);
    await h.attach();
    await h.request({ type: 'action', id: browser, op: 'move', rect: { x: 145, y: 40, width: 690, height: 480 } });
    await h.request({ type: 'action', id: code, op: 'move', rect: { x: 420, y: 210, width: 750, height: 480 } });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === code).title.includes('tode'), 45000);
    await delay(500); h.save('.artifacts/pixel-apps.png');
    const before = (await h.request({ type: 'inspect' })).state;
    assert.ok(before.windows.every((w: any) => w.status === 'Running'));
    const backendFile = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local/state'), 'tode/server.json');
    const backend = JSON.parse(fs.readFileSync(backendFile, 'utf8'));
    const roots = [h.server.pid!, h.desktop!.pid!, backend.pid, backend.injectorPid];
    await delay(3000);
    const beforeIdle = processes(roots), idleStart = performance.now(), idleFrames = h.frames;
    await delay(3000);
    const afterIdle = processes(roots);
    const memory = { rssMiB: afterIdle.reduce((n,r)=>n+r.rssKiB,0)/1024, processCount: afterIdle.length, idleFrames: h.frames-idleFrames, idleCpuPercentOneCore: 100000*(afterIdle.reduce((n,r)=>n+r.cpuSeconds,0)-beforeIdle.reduce((n,r)=>n+r.cpuSeconds,0))/(performance.now()-idleStart) };
    await h.request({ type: 'action', id: browser, op: 'focus' });
    await h.click(300, 334);
    h.guest!.send({ type: 'paste', text: 'browser_kept' });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === browser).title.includes('browser_kept'), 5000);
    h.guest!.send({ type: 'wheel', x: 500, y: 400, deltaX: 0, deltaY: 100, mods: { shift: false, alt: false, ctrl: false, super: false } });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === browser).title.startsWith('Scrolled:'), 5000);
    await h.request({ type: 'action', id: code, op: 'focus' });
    // Code's new untitled buffer: no repository or user file is modified.
    h.guest!.send({ type: 'key', key: 'n', kind: 'press', mods: { super: true, ctrl: false, alt: false, shift: false } });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === code).title.includes('Untitled'), 5000);
    h.guest!.send({ type: 'paste', text: '// Zatara: an independent Pixel application\nconst desktop = "persistent";\n' });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === code).title.includes('Zatara'), 5000);
    await delay(250); h.save('.artifacts/pixel-apps-editing.png');
    h.desktop!.kill('SIGKILL');
    await until(async () => !(await h.request({ type: 'inspect' })).state.attached);
    await h.attach(); await delay(300); h.save('.artifacts/pixel-apps-reconnected.png');
    // Compare upstream toolbar pixels with the composite at native resolution.
    const diagnostics = await h.request({ type: 'inspect' });
    const surface = diagnostics.rendering.surfaces[browser];
    const raw = fs.readFileSync(path.join(h.dir, 'test-frames', browser + '.bgra'));
    const png = new PNG({ width: surface.width, height: surface.height });
    for (let i = 0; i < raw.length; i += 4) { png.data[i] = raw[i+2]; png.data[i+1] = raw[i+1]; png.data[i+2] = raw[i]; png.data[i+3] = raw[i+3]; }
    fs.writeFileSync('.artifacts/browser-guest.png', PNG.sync.write(png));
    flattenGuestFrame(raw);
    let best = { exactPixelFraction: 0, x: 0, y: 0 };
    // Search only around the known window origin; exclude border and right controls.
    for (let oy = 74; oy <= 80; oy++) for (let ox = 145; ox <= 150; ox++) {
      let exact = 0, total = 0;
      for (let y = 3; y < 25; y++) for (let x = 20; x < 630; x++) {
        const a = (y * surface.width + x) * 4, b = ((y + oy) * h.width + x + ox) * 4;
        if (raw[a] === h.bgra![b] && raw[a+1] === h.bgra![b+1] && raw[a+2] === h.bgra![b+2]) exact++;
        total++;
      }
      if (exact / total > best.exactPixelFraction) best = { exactPixelFraction: exact / total, x: ox, y: oy };
    }
    const rendering = { ...diagnostics.rendering, browserToolbarComparison: best };
    assert.ok(best.exactPixelFraction > 0.99, 'browser toolbar must match the alpha-composited guest at 1:1 pixels');
    const after = diagnostics.state;
    assert.ok(after.windows.find((w: any) => w.id === browser).title.includes('browser_kept'));
    assert.deepEqual(after.windows.map((w: any) => [w.id,w.pid]).sort(), before.windows.map((w: any) => [w.id,w.pid]).sort());
    await h.request({ type: 'action', id: code, op: 'minimize' });
    await h.request({ type: 'action', id: code, op: 'focus' });
    // Wait for the desktop's focus frame before sending input through its z-order.
    const focusedFrame = h.nextFrame();
    await h.request({ type: 'action', id: browser, op: 'focus' });
    await focusedFrame;
    h.guest!.send({ type: 'wheel', x: 500, y: 400, deltaX: 0, deltaY: -100, mods: { shift: false, alt: false, ctrl: false, super: false } });
    await until(async () => (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === browser).title.startsWith('Scrolled: 0'), 5000);
    await h.request({ type: 'action', id: code, op: 'focus' });
    await delay(250); h.save('.artifacts/polished-apps.png');
    const report = { rendering, result: 'passed', workload: 'Static local browser page + terminal-code. 3-second idle sample after 3-second settling period.', memory, windows: after.windows, frames: h.frames, frameBytes: h.bytes, logDirectory: h.dir };
    fs.writeFileSync('.artifacts/apps-verification.json', JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await h.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
