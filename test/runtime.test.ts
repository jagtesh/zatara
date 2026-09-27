import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { Duplex } from 'node:stream';
import { Broker } from '../src/broker';
import { Runtime, RuntimeError } from '../src/sdk/client';
import { MAX_HANDLERS, MAX_MESSAGE_BYTES, MAX_SUBSCRIPTIONS, type Json } from '../src/sdk/wire';
import { Transport } from '../src/sdk/transport';

type TestEvents = {
  ping: Json; other: null; news: Json; updates: null; overflow: null; closed: null;
} & { [Name in `type${number}`]: null };

async function pair(): Promise<[Duplex, Duplex]> {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  const accepting = once(server, 'connection');
  const client = net.connect(port, '127.0.0.1');
  const [host] = await accepting;
  server.close();
  return [host as Duplex, client];
}
async function connected(broker: Broker, id: string, grants: Parameters<Broker['add']>[2] = {}): Promise<Runtime<TestEvents>> {
  const [host, client] = await pair();
  broker.add(id, host, grants);
  return new Runtime<TestEvents>(client);
}

test('direct message, publish and host call use host-bound identities and explicit grants', async () => {
  const broker = new Broker(async (id, method, payload) => {
    if (method !== 'context.get') throw new RuntimeError('DENIED', 'Unknown method');
    assert.deepEqual(payload, {});
    return { id, session: 'test' };
  });
  const a = await connected(broker, 'sender', { send: ['ping'], publish: ['news'] });
  const b = await connected(broker, 'receiver', { receive: ['ping'], subscribe: ['news'] });
  try {
    let off = () => Promise.resolve();
    const direct = new Promise<{ from: string; payload: unknown }>(resolve => {
      off = b.on('ping', message => resolve(message));
    });
    await a.send('receiver', 'ping', { value: 1 });
    assert.deepEqual(await direct, { from: 'sender', type: 'ping', payload: { value: 1 } });
    await off();
    await assert.rejects(b.send('sender', 'ping', null), { code: 'DENIED' });
    await assert.rejects(a.send('receiver', 'other', null), { code: 'DENIED' });
    await assert.rejects(a.send('absent', 'ping', null), { code: 'NOT_FOUND' });
    await assert.rejects(a.send('receiver', 'ping', { bytes: 'x'.repeat(65_536) }), { code: 'LIMIT' });
    await assert.rejects(a.send('receiver', 'ping', { invalid: undefined } as never), { code: 'INVALID' });
    assert.deepEqual(await a.call('context.get', {}), { id: 'sender', session: 'test' });
    await assert.rejects(a.call('tasks.list', {}), { code: 'DENIED' });
    let notify!: (message: { from: string; topic?: string }) => void;
    const event = new Promise<{ from: string; topic?: string }>(resolve => { notify = resolve; });
    const unsubscribe = await b.subscribe('news', message => notify(message));
    await a.publish('news', { headline: 'hi' });
    assert.equal((await event).from, 'sender');
    await unsubscribe();
    await assert.rejects(a.subscribe('news', () => {}), { code: 'DENIED' });
    await assert.rejects(b.publish('news', null), { code: 'DENIED' });
  } finally { a.close(); b.close(); broker.close(); }
});

test('concurrent subscriptions share one remote grant and retain remaining handlers', async () => {
  const broker = new Broker(() => null);
  const publisher = await connected(broker, 'publisher', { publish: ['updates'] });
  const subscriber = await connected(broker, 'subscriber', { subscribe: ['updates'] });
  try {
    let first = 0, second = 0;
    const [offFirst, offSecond] = await Promise.all([
      subscriber.subscribe('updates', () => { first++; }),
      subscriber.subscribe('updates', () => { second++; }),
    ]);
    await offFirst();
    await publisher.publish('updates', null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(first, 0);
    assert.equal(second, 1);
    await offSecond();
  } finally { publisher.close(); subscriber.close(); broker.close(); }
});

test('disconnect reports unknown outcome and refuses subsequent operations', async () => {
  let begin!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const broker = new Broker(async () => { begin(); await new Promise(() => {}); return null; });
  const runtime = await connected(broker, 'app');
  const call = runtime.call('tasks.list', {});
  await started;
  broker.remove('app');
  await assert.rejects(call, { code: 'UNKNOWN_OUTCOME' });
  await assert.rejects(runtime.call('tasks.list', {}), { code: 'DISCONNECTED' });
  broker.close();
});

test('malformed and forged envelopes terminate only their connection', async () => {
  const broker = new Broker(() => null);
  const [host, client] = await pair();
  broker.add('app', host);
  const close = once(client, 'close');
  const payload = Buffer.from(JSON.stringify({ v: 1, op: 'send', id: '1', to: 'app', type: 'ping', payload: null, from: 'forged' }));
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length);
  payload.copy(frame, 4);
  client.write(frame);
  await close;
  broker.close();
});

test('child uses inherited private fd3 rather than a discovered socket', async () => {
  const broker = new Broker(async (id, method) => {
    assert.equal(method, 'context.get');
    return { id, session: 'test' };
  });
  const script = `const {getRuntime, closeRuntime} = require(${JSON.stringify(require.resolve('../dist/sdk/client.js'))});
    const runtime = getRuntime(); if (runtime !== getRuntime()) process.exit(2);
    runtime.call('context.get', {}).then(value => { process.stdout.write(value.id); closeRuntime(); process.exit(0); },
      error => { process.stderr.write(String(error)); process.exit(1); });`;
  const child = spawn(process.execPath, ['-e', script], {
    env: { ...process.env, ZATARA_RUNTIME_FD: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  broker.add('child', child.stdio[3] as Duplex);
  let output = '', errors = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { errors += chunk; });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, errors);
    assert.equal(output, 'child');
  } finally { broker.close(); }
});

test('brokers isolate sessions and dead instance addresses never redirect', async () => {
  const first = new Broker(() => null), second = new Broker(() => null);
  const sender = await connected(first, 'sender', { send: ['ping'] });
  const remote = await connected(second, 'remote', { receive: ['ping'] });
  const old = await connected(first, 'old', { receive: ['ping'] });
  try {
    await assert.rejects(sender.send('remote', 'ping', null), { code: 'NOT_FOUND' });
    first.remove('old');
    const replacement = await connected(first, 'new', { receive: ['ping'] });
    try { await assert.rejects(sender.send('old', 'ping', null), { code: 'NOT_FOUND' }); }
    finally { replacement.close(); }
  } finally { sender.close(); remote.close(); old.close(); first.close(); second.close(); }
});

test('host concurrency is bounded and overload leaves other peers responsive', async () => {
  let release!: () => void;
  const held = new Promise<[]>(resolve => { release = () => resolve([]); });
  let started = 0;
  const broker = new Broker((id, method) => method === 'tasks.list' ? (started++, held) : { id, session: 'test' });
  const busy = await connected(broker, 'busy'), other = await connected(broker, 'other');
  const calls = Array.from({ length: MAX_HANDLERS }, () => busy.call('tasks.list', {}));
  try {
    while (started < MAX_HANDLERS) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(busy.call('tasks.list', {}), { code: 'LIMIT' });
    assert.deepEqual(await other.call('context.get', {}), { id: 'other', session: 'test' });
  } finally { release(); await Promise.all(calls); busy.close(); other.close(); broker.close(); }
});

test('oversized incoming frames close only the offending peer', async () => {
  const broker = new Broker(id => ({ id, session: 'test' }));
  const [host, client] = await pair();
  broker.add('bad', host);
  const healthy = await connected(broker, 'healthy');
  try {
    const closed = once(client, 'close');
    const header = Buffer.alloc(4); header.writeUInt32BE(MAX_MESSAGE_BYTES + 1);
    client.write(header);
    await closed;
    assert.deepEqual(await healthy.call('context.get', {}), { id: 'healthy', session: 'test' });
  } finally { client.destroy(); healthy.close(); broker.close(); }
});

test('duplicate in-flight correlation IDs disconnect instead of falsely rejecting the original operation', async () => {
  let calls = 0;
  const broker = new Broker(() => { calls++; return new Promise(() => {}); });
  const [host, client] = await pair();
  broker.add('app', host);
  const replies: unknown[] = [];
  const transport = new Transport(client, 'host', message => replies.push(message), () => {});
  try {
    const closed = once(client, 'close');
    const message = { v: 1, op: 'call', id: 'same', method: 'slow', payload: null } as const;
    transport.send(message); transport.send(message);
    await closed;
    assert.equal(calls, 1);
    assert.deepEqual(replies, []);
  } finally { transport.close(); broker.close(); }
});

test('local handler registrations are bounded and closed runtimes reject registrations', async () => {
  const broker = new Broker(() => null);
  const runtime = await connected(broker, 'app');
  try {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) runtime.on(`type${i}`, () => {});
    assert.throws(() => runtime.on('overflow', () => {}), { code: 'LIMIT' });
    runtime.close();
    assert.throws(() => runtime.on('closed', () => {}), { code: 'DISCONNECTED' });
    await assert.rejects(runtime.subscribe('closed', () => {}), { code: 'DISCONNECTED' });
  } finally { runtime.close(); broker.close(); }
});

test('slow transport has a bounded outgoing buffer and rejects before accepting excess data', () => {
  const sink = new Duplex({
    read() {},
    write(_chunk, _encoding, _callback) { /* Deliberately never drain. */ },
  });
  const transport = new Transport(sink, 'client', () => {}, () => {});
  const event = { v: 1, op: 'event', from: 'sender', type: 'data', payload: 'x'.repeat(60 * 1024) } as const;
  try {
    for (let i = 0; i < 4; i++) transport.send(event);
    const queued = sink.writableLength;
    assert.ok(queued < 256 * 1024);
    assert.throws(() => transport.send(event), { code: 'LIMIT' });
    assert.equal(sink.writableLength, queued);
  } finally { transport.close(); }
});

test('submitted request timeout reports unknown outcome without retrying', { timeout: 20000 }, async () => {
  let calls = 0;
  const broker = new Broker(() => { calls++; return new Promise(() => {}); });
  const runtime = await connected(broker, 'app');
  try {
    await assert.rejects(runtime.call('tasks.list', {}), { code: 'UNKNOWN_OUTCOME' });
    assert.equal(calls, 1);
  } finally { runtime.close(); broker.close(); }
});
