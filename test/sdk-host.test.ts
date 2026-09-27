import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostServices } from '../src/host-services';
import { parseMessagingPermissions } from '../src/apps';
import { sendCommand } from '../src/ipc';
import type net from 'node:net';
import { Harness, until } from '../scripts/harness';

test('host service authorization is instance-bound and validates exact arguments', async () => {
  const actions: unknown[] = [];
  const dispatch = hostServices({
    session: 'one',
    principal: id => id === 'app' ? { id, manageTasks: false, manageSessions: false } : undefined,
    tasks: async () => [],
    windowAction: (id, op) => { actions.push({ id, op }); },
    switchSession: () => { throw new Error('must not switch'); },
  });
  // Compare the JSON value seen by a client, not the encoder's null prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(await dispatch('app', 'context.get', {}))), { session: 'one', id: 'app' });
  await dispatch('app', 'windows.action', { id: 'app', op: 'minimize' });
  assert.deepEqual(actions, [{ id: 'app', op: 'minimize' }]);
  // This is the untrusted wire boundary, not the typed SDK API. Deliberately
  // malformed payloads must still be rejected even when TypeScript is bypassed.
  for (const [method, payload] of [
    ['tasks.list', {}], ['sessions.list', {}], ['sessions.ensure', { name: 'two' }],
    ['windows.action', { id: 'other', op: 'close' }], ['context.get', { from: 'other' }],
    ['windows.action', { id: 'app', op: 'close', session: 'two' }],
  ] as const) await assert.rejects(dispatch('app', method, payload));
  await assert.rejects(dispatch('app', 'context.gett', {}), { code: 'NOT_FOUND' });
  await assert.rejects(dispatch('app', 'toString', {}), { code: 'NOT_FOUND' });
  await assert.rejects(dispatch('unknown', 'context.get', {}));
  assert.equal(actions.length, 1);
});

test('messaging grants are explicit exact names, never wildcards or arbitrary capabilities', () => {
  assert.deepEqual(parseMessagingPermissions({ send: ['document.open', 'document.open'], receive: ['document.open'] }),
    { send: ['document.open'], receive: ['document.open'] });
  assert.deepEqual(parseMessagingPermissions({ send: ['document/open'] }), { send: ['document/open'] });
  for (const value of [null, [], { send: ['*'] }, { send: [''] }, { admin: true }, { publish: 'topic' },
    { subscribe: Array(65).fill('topic') }]) assert.throws(() => parseMessagingPermissions(value));
});

test('management writes distinguish acceptance from backpressure and unavailable attachments', () => {
  let written = 0, destroyed = false;
  const socket = {
    destroyed: false, writableLength: 0,
    write: () => { written++; return false; },
    destroy: () => { destroyed = true; },
  } as unknown as net.Socket;
  assert.equal(sendCommand(socket, { type: 'kill' }), true);
  assert.equal(written, 1);
  assert.equal(sendCommand({ ...socket, destroyed: true } as net.Socket, { type: 'switch', session: 'next' }), false);
  assert.equal(sendCommand({ ...socket, writableLength: 3 * 1024 * 1024 } as net.Socket, { type: 'switch', session: 'next' }), false);
  assert.equal(written, 1);
  assert.equal(destroyed, true);
});

test('launched SDK app uses a private process channel and cannot acquire management capabilities', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-sdk-'));
  const registrations = path.join(dir, 'apps.json');
  fs.writeFileSync(registrations, JSON.stringify([{
    id: 'sdk-probe', name: 'SDK probe', icon: 'S', command: [process.execPath, path.resolve('test/sdk-fixture.cjs')],
  }]));
  const h = new Harness({ env: { ZATARA_APPS: registrations } });
  try {
    await h.ready();
    const { id } = await h.request({ type: 'launch', app: 'sdk-probe' });
    const log = path.join(h.dir, 'test-frames', `${id}.log`);
    const result = await until(() => {
      if (!fs.existsSync(log)) return false;
      const line = fs.readFileSync(log, 'utf8').split('\n').find(line => line.startsWith('{"context":'));
      return line && JSON.parse(line);
    });
    assert.deepEqual(result.context, { id, session: 'test' });
    assert.ok(Object.values(result.rejected).every(value => value === true));
    const state = (await h.request({ type: 'inspect' })).state;
    assert.equal(state.windows.find((w: { id: string }) => w.id === id).minimized, true);
    assert.equal(fs.existsSync(path.join(h.dir, 'forbidden.sock')), false);
  } finally { await h.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('session termination checks the selected incarnation at the destination', async () => {
  const h = new Harness();
  try {
    await h.ready();
    const inspected = await h.request({ type: 'inspect' });
    await assert.rejects(h.request({ type: 'kill', expected: { pid: inspected.pid, startedAt: inspected.metrics.startedAt - 1 } }), /restarted/);
    assert.equal((await h.request({ type: 'inspect' })).pid, inspected.pid);
  } finally { await h.close(); }
});
