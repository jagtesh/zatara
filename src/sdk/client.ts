import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { HostCallArgs, HostMethod, HostResponse } from './contracts';
import { Transport } from './transport';
import { assertName, json, MAX_HANDLERS, MAX_PENDING, MAX_SUBSCRIPTIONS, REQUEST_TIMEOUT_MS, RuntimeError,
  type Command, type Json, type Wire } from './wire';
export { RuntimeError } from './wire';
export type { Json, ErrorCode } from './wire';
export type { HostOperations, HostMethod, HostRequest, HostResponse, HostCallArgs } from './contracts';

type EventName<Events extends object> = Extract<keyof Events, string>;
type EventArgs<Events extends object> = {
  [Name in EventName<Events>]: [name: Name, payload: Events[Name]]
}[EventName<Events>];
export type Handler<Events extends object, Name extends EventName<Events>> =
  (message: { from: string; type: Name; payload: Events[Name]; topic?: string }) => void | Promise<void>;
type WireHandler = (message: { from: string; type: string; payload: Json; topic?: string }) => void | Promise<void>;
type Pending = { resolve: (value: Json) => void; reject: (reason: RuntimeError) => void; timer: NodeJS.Timeout };
type WithoutEnvelope<C> = C extends Command ? Omit<C, 'v' | 'id'> : never;

export class Runtime<Events extends object = {}> {
  private transport: Transport;
  private pending = new Map<string, Pending>();
  private topics = new Map<string, Set<WireHandler>>();
  private subscribing = new Map<string, Promise<Json>>();
  private direct = new Map<string, Set<WireHandler>>();
  private serial = 0;
  private activeHandlers = 0;
  private queued: Array<() => void | Promise<void>> = [];
  private closed = false;
  constructor(stream: Duplex) {
    this.transport = new Transport(stream, 'host', message => this.receive(message), () => this.disconnect());
  }
  private receive(message: Wire) {
    if (message.op === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return; // A timed-out operation may still complete remotely; never retry.
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new RuntimeError(message.code, message.message));
    } else if (message.op === 'event') {
      const handlers = [...(message.topic ? this.topics.get(message.topic) : this.direct.get(message.type)) ?? []];
      if (this.queued.length + handlers.length > 128) { this.close(); return; }
      const { from, type, payload, topic } = message;
      const event = topic === undefined ? { from, type, payload } : { from, type, payload, topic };
      for (const handler of handlers) this.queued.push(() => handler(event));
      this.drain();
    }
  }
  private drain() {
    while (!this.closed && this.activeHandlers < MAX_HANDLERS && this.queued.length) {
      const handler = this.queued.shift()!;
      this.activeHandlers++;
      Promise.resolve().then(handler).catch(() => { /* application handler failure is isolated */ })
        .finally(() => { this.activeHandlers--; this.drain(); });
    }
  }
  private disconnect() {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RuntimeError('UNKNOWN_OUTCOME', 'Connection lost after request submission'));
    }
    this.pending.clear();
    this.queued.length = 0;
    this.topics.clear();
    this.direct.clear();
    this.subscribing.clear();
  }
  private request(command: WithoutEnvelope<Command>): Promise<Json> {
    if (this.closed) return Promise.reject(new RuntimeError('DISCONNECTED', 'Runtime disconnected'));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new RuntimeError('LIMIT', 'Too many outstanding requests'));
    const id = String(++this.serial);
    // Validate unknown app payloads with json() before submitting. The public
    // event interfaces need no Json index signature; casts stay at this boundary.
    // Write failures are local, not unknown outcomes.
    let envelope: Command;
    try { envelope = { ...command, v: 1, id }; json(envelope); }
    catch (error) { return Promise.reject(error); }
    return new Promise<Json>((resolve, reject) => {
      try { this.transport.send(envelope); }
      catch (error) { reject(error); return; }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RuntimeError('UNKNOWN_OUTCOME', 'Request timed out after submission'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  async send(to: string, ...[type, payload]: EventArgs<Events>): Promise<void> {
    assertName(to, 'destination'); assertName(type, 'message type');
    await this.request({ op: 'send', to, type, payload: json(payload) });
  }
  async publish(...[topic, payload]: EventArgs<Events>): Promise<void> {
    assertName(topic, 'topic');
    await this.request({ op: 'publish', topic, payload: json(payload) });
  }
  async call<M extends HostMethod>(...[method, payload]: Extract<HostCallArgs, [M, unknown]>): Promise<HostResponse<M>> {
    assertName(method, 'method');
    // request() validates the full envelope with json(unknown) before transport submission.
    return this.request({ op: 'call', method, payload: json(payload) }) as Promise<HostResponse<M>>;
  }
  async subscribe<Name extends EventName<Events>>(topic: Name, handler: Handler<Events, Name>): Promise<() => Promise<void>> {
    if (this.closed) throw new RuntimeError('DISCONNECTED', 'Runtime disconnected');
    assertName(topic, 'topic');
    if (typeof handler !== 'function') throw new RuntimeError('INVALID', 'Expected handler');
    let handlers = this.topics.get(topic);
    if (!handlers) {
      if (this.topics.size >= MAX_SUBSCRIPTIONS) throw new RuntimeError('LIMIT', 'Too many subscriptions');
      handlers = new Set();
      this.topics.set(topic, handlers);
      this.subscribing.set(topic, this.request({ op: 'subscribe', topic }));
    }
    if (handlers.size >= MAX_HANDLERS) throw new RuntimeError('LIMIT', 'Too many handlers for topic');
    // The wire checks JSON shape, not an app's event schema. The app agrees on Events.
    const wireHandler = handler as WireHandler;
    handlers.add(wireHandler);
    try { await this.subscribing.get(topic); }
    catch (error) {
      handlers.delete(wireHandler);
      if (this.topics.get(topic) === handlers) this.topics.delete(topic);
      throw error;
    } finally { this.subscribing.delete(topic); }
    let removed = false;
    return async () => {
      if (removed) return;
      removed = true;
      handlers!.delete(wireHandler);
      if (handlers!.size) return;
      this.topics.delete(topic);
      await this.request({ op: 'unsubscribe', topic });
    };
  }
  on<Name extends EventName<Events>>(type: Name, handler: Handler<Events, Name>): () => Promise<void> {
    if (this.closed) throw new RuntimeError('DISCONNECTED', 'Runtime disconnected');
    assertName(type, 'message type');
    if (typeof handler !== 'function') throw new RuntimeError('INVALID', 'Expected handler');
    let handlers = this.direct.get(type);
    if (!handlers) {
      if (this.direct.size >= MAX_SUBSCRIPTIONS) throw new RuntimeError('LIMIT', 'Too many message types');
      handlers = new Set(); this.direct.set(type, handlers);
    }
    if (handlers.size >= MAX_HANDLERS) throw new RuntimeError('LIMIT', 'Too many handlers for type');
    const wireHandler = handler as WireHandler;
    handlers.add(wireHandler);
    let removed = false;
    return async () => { if (removed) return; removed = true; handlers!.delete(wireHandler); if (!handlers!.size) this.direct.delete(type); };
  }
  close(): void { this.transport.close(); }
}

/** Only explicitly inherited fd 3 is accepted; no discoverable socket or bearer token. */
let defaultRuntime: Runtime<object> | null = null;
let defaultClosed = false;
/** A typed view of the singleton; all participants in an app must agree on its event map. */
export function getRuntime<Events extends object = {}>(): Runtime<Events> {
  if (defaultClosed) throw new RuntimeError('DISCONNECTED', 'Runtime already closed');
  if (defaultRuntime) return defaultRuntime as Runtime<Events>;
  if (process.env.ZATARA_RUNTIME_FD !== '3') throw new RuntimeError('DISCONNECTED', 'Runtime fd 3 was not provided');
  defaultRuntime = new Runtime(new net.Socket({ fd: 3, readable: true, writable: true }));
  return defaultRuntime as Runtime<Events>;
}
/** Cleanup never initializes an absent fd; subsequent getRuntime calls cannot reopen fd 3. */
export function closeRuntime(): void {
  defaultClosed = true;
  defaultRuntime?.close();
  defaultRuntime = null;
}
