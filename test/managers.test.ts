import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Harness, until, delay, rpc } from '../scripts/harness';
import { parseProcesses, descendants } from '../src/tasks';

test('process statistics parse CPU time and count overlapping roots once', () => {
  const p = parseProcesses(' 10 1 1024 01:02.50\n11 10 512 1-02:03:04\n12 11 32 00:01\n99 1 40 00:00');
  assert.equal(p[0].cpuSeconds, 62.5);
  assert.equal(p[1].cpuSeconds, 93784);
  assert.deepEqual(descendants(p, [10, 11]).map(p => p.pid), [10, 11, 12]);
});

test('manager apps own processes, create/end sessions and close selected tasks through native UI', { timeout: 40000 }, async () => {
  const h = new Harness();
  try {
    await h.ready();
    const shell = (await h.request({ type: 'launch', app: 'shell' })).id;
    const tasks = (await h.request({ type: 'launch', app: 'tasks' })).id;
    await until(() => fs.existsSync(path.join(h.dir, 'test-frames', tasks + '.bgra')));
    await h.attach(); await delay(350);
    let state = (await h.request({ type: 'inspect' })).state;
    let w = state.windows.find((w: any) => w.id === tasks);
    assert.notEqual(w.pid, state.windows.find((w: any) => w.id === shell).pid);
    const sample = (await h.request({ type: 'tasks' })).tasks.find((t: any) => t.id === shell);
    assert.ok(sample.rssMiB > 0); assert.ok(sample.processCount > 0); assert.ok(sample.pids.includes(sample.pid));
    h.save('.artifacts/task-manager.png');
    // Task manager's first row is the oldest shell; select and end it, then confirm.
    await h.click(w.x + 100, w.y + 37 + 100);
    await h.click(w.x + 230, w.y + 37 + 18 + 30 + 8 + 20 + 8 + (486 - 202) + 8 + 34 + 8 + 17);
    await delay(100); h.save('.artifacts/task-manager-confirm.png');
    // Confirmation is in the same action row, after Cancel.
    await h.click(w.x + 140, w.y + 37 + 18 + 30 + 8 + 20 + 8 + (486 - 202) + 8 + 34 + 8 + 17);
    await until(async () => !(await h.request({ type: 'inspect' })).state.windows.some((w: any) => w.id === shell), 3000);
    const sessions = (await h.request({ type: 'launch', app: 'sessions' })).id;
    await until(() => fs.existsSync(path.join(h.dir, 'test-frames', sessions + '.bgra')));
    await delay(350);
    state = (await h.request({ type: 'inspect' })).state; w = state.windows.find((w: any) => w.id === sessions);
    await h.click(w.x + 100, w.y + 37 + 100);
    h.guest!.send({ type: 'paste', text: 'managed' });
    await h.click(w.x + 760, w.y + 37 + 100);
    await until(() => fs.existsSync(path.join(h.dir, 'managed.sock')), 6000);
    await delay(350); h.save('.artifacts/session-manager.png');
    const backgroundFrame = (await h.request({ type: 'inspect' })).rendering.surfaces[tasks].seq;
    await delay(2200);
    assert.equal((await h.request({ type: 'inspect' })).rendering.surfaces[tasks].seq, backgroundFrame, 'unfocused task manager must stop periodic repaint');
    const managerActionY = w.y + 37 + Math.floor((w.height - 40) / 18) * 18 - 58;
    await h.click(w.x + 45, managerActionY); // Switch to the newly created session.
    await until(async () => (await rpc(path.join(h.dir, 'managed.sock'), { type: 'inspect' })).state.attached);
    await until(async () => !(await h.request({ type: 'inspect' })).state.attached);
    await rpc(path.join(h.dir, 'managed.sock'), { type: 'switch', session: 'test' });
    await until(async () => (await h.request({ type: 'inspect' })).state.attached);

    const kept = (await h.request({ type: 'inspect' })).state.windows.map((w: any) => [w.id, w.pid]);
    h.desktop!.kill('SIGKILL');
    await until(async () => !(await h.request({ type: 'inspect' })).state.attached);
    await h.attach();
    assert.deepEqual((await h.request({ type: 'inspect' })).state.windows.map((w: any) => [w.id, w.pid]), kept);
    // Keep selection through reconnect, then prove ending a session ends its shell.
    await rpc(path.join(h.dir, 'managed.sock'), { type: 'launch', app: 'shell' });
    const managedPid = (await rpc(path.join(h.dir, 'managed.sock'), { type: 'inspect' })).state.windows[0].pid;
    await h.click(w.x + 760, w.y + 37 + 30);
    // The new session is selected after Create. End it and explicitly confirm.
    const contentHeight = Math.floor((w.height - 40) / 18) * 18;
    const actionY = w.y + 37 + contentHeight - 58;
    await h.click(w.x + 220, actionY);
    await h.click(w.x + 140, actionY);
    await until(() => !fs.existsSync(path.join(h.dir, 'managed.sock')), 4000);
    await until(() => { try { process.kill(managedPid, 0); return false; } catch { return true; } });
    assert.ok((await h.request({ type: 'inspect' })).state.windows.some((w: any) => w.id === sessions));
  } finally { try { await rpc(path.join(h.dir, 'managed.sock'), { type: 'kill' }); } catch {} await h.close(); }
});

test('desktop switches sessions without restarting apps and rejects an occupied destination', { timeout: 25000 }, async () => {
  const h = new Harness(); const other = h.run(['_serve', 'other']);
  const otherSocket = path.join(h.dir, 'other.sock');
  try {
    await h.ready(); await until(() => fs.existsSync(otherSocket));
    const shell = (await h.request({ type: 'launch', app: 'shell' })).id;
    const original = (await h.request({ type: 'inspect' })).state.windows[0].pid;
    await h.attach(); const attachmentPid = h.desktop!.pid;
    await h.request({ type: 'switch', session: 'other' });
    await until(async () => (await rpc(otherSocket, { type: 'inspect' })).state.attached);
    await until(async () => !(await h.request({ type: 'inspect' })).state.attached);
    assert.equal(h.desktop!.pid, attachmentPid);
    await rpc(otherSocket, { type: 'switch', session: 'test' });
    await until(async () => (await h.request({ type: 'inspect' })).state.attached);
    assert.equal((await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === shell).pid, original);
    const net = await import('node:net');
    const occupying = net.connect(otherSocket);
    try {
      // Occupy the destination without disturbing the existing desktop.
      await new Promise<void>(resolve => occupying.on('connect', () => { occupying.write(JSON.stringify({ type: 'attach', width: 1200, height: 792 }) + '\n'); resolve(); }));
      await until(async () => (await rpc(otherSocket, { type: 'inspect' })).state.attached);
      await h.request({ type: 'switch', session: 'other' }); await delay(250);
      assert.equal((await h.request({ type: 'inspect' })).state.attached, true);
      occupying.destroy();
    } finally { occupying.destroy(); }
  } finally { try { await rpc(otherSocket, { type: 'kill' }); } catch {} other.kill(); await h.close(); }
});
