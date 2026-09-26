import fs from 'node:fs';
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
    const after = (await h.request({ type: 'inspect' })).state;
    assert.ok(after.windows.find((w: any) => w.id === browser).title.includes('browser_kept'));
    assert.deepEqual(after.windows.map((w: any) => [w.id,w.pid]).sort(), before.windows.map((w: any) => [w.id,w.pid]).sort());
    await h.request({ type: 'action', id: code, op: 'minimize' });
    await h.request({ type: 'action', id: code, op: 'focus' });
    const report = { result: 'passed', workload: 'Static local browser page + terminal-code. 3-second idle sample after 3-second settling period.', memory, windows: after.windows, frames: h.frames, frameBytes: h.bytes, logDirectory: h.dir };
    fs.writeFileSync('.artifacts/apps-verification.json', JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await h.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
