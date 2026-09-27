import type { Duplex } from 'node:stream';
import { Transport } from './sdk/transport';
import { assertName, json, MAX_HANDLERS, MAX_SUBSCRIPTIONS, RuntimeError,
  type Command, type Event, type Json, type Response, type Wire } from './sdk/wire';

export interface Permissions {
  send?: string[];
  receive?: string[];
  publish?: string[];
  subscribe?: string[];
}
type Peer = { id: string; transport: Transport; grants: Required<Permissions>; topics: Set<string>; pending: Set<string> };
export type HostCall = (id: string, method: string, payload: Json) => Json | Promise<Json>;
const allowed = (list: string[], key: string) => list.includes(key);

/** One broker per desktop session. The host, never the child, assigns peer identity and grants. */
export class Broker {
  private peers = new Map<string, Peer>();
  private closed = false;
  constructor(private readonly hostCall: HostCall) {}
  add(id: string, stream: Duplex, permissions: Permissions = {}): void {
    assertName(id, 'app ID');
    if (this.closed) throw new RuntimeError('DISCONNECTED', 'Broker closed');
    if (this.peers.has(id)) throw new RuntimeError('INVALID', 'Duplicate app ID');
    const grants = {
      send: [...permissions.send ?? []], receive: [...permissions.receive ?? []],
      publish: [...permissions.publish ?? []], subscribe: [...permissions.subscribe ?? []],
    };
    for (const list of Object.values(grants)) for (const key of list) assertName(key, 'permission');
    const peer: Peer = { id, grants, topics: new Set(), pending: new Set(), transport: undefined! };
    peer.transport = new Transport(stream, 'client', message => this.receive(peer, message), () => this.removeIfCurrent(peer));
    this.peers.set(id, peer);
  }
  private removeIfCurrent(peer: Peer) {
    if (this.peers.get(peer.id) === peer) this.peers.delete(peer.id);
    peer.topics.clear();
    peer.pending.clear();
  }
  remove(id: string): void {
    const peer = this.peers.get(id);
    if (peer) { this.peers.delete(id); peer.transport.close(); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.remove(id);
  }
  private receive(peer: Peer, message: Wire) {
    if (!this.peers.has(peer.id) || this.peers.get(peer.id) !== peer || !('id' in message)) return;
    const command = message as Command;
    if (peer.pending.has(command.id)) {
      // A rejection using the same correlation ID would falsely report failure
      // for the original operation, which may already be executing.
      peer.transport.close();
      return;
    }
    if (peer.pending.size >= MAX_HANDLERS) {
      this.reply(peer, command.id, new RuntimeError('LIMIT', 'Too many requests'));
      return;
    }
    peer.pending.add(command.id);
    void this.execute(peer, command).then(value => this.reply(peer, command.id, null, value),
      error => this.reply(peer, command.id, error)).finally(() => peer.pending.delete(command.id));
  }
  private async execute(peer: Peer, command: Command): Promise<Json> {
    switch (command.op) {
      case 'send': {
        if (!allowed(peer.grants.send, command.type)) throw new RuntimeError('DENIED', 'Send not permitted');
        const recipient = this.peers.get(command.to);
        if (!recipient) throw new RuntimeError('NOT_FOUND', 'Destination unavailable');
        if (!allowed(recipient.grants.receive, command.type)) throw new RuntimeError('DENIED', 'Destination does not accept this type');
        this.deliver(recipient, { v: 1, op: 'event', from: peer.id, type: command.type, payload: command.payload });
        return null;
      }
      case 'publish': {
        if (!allowed(peer.grants.publish, command.topic)) throw new RuntimeError('DENIED', 'Publish not permitted');
        let delivered = 0;
        for (const recipient of this.peers.values()) {
          if (!recipient.topics.has(command.topic)) continue;
          try {
            this.deliver(recipient, { v: 1, op: 'event', from: peer.id, type: command.topic, topic: command.topic, payload: command.payload });
          } catch (error) {
            if (delivered) throw new RuntimeError('UNKNOWN_OUTCOME', 'Publish partially accepted');
            throw error;
          }
          delivered++;
        }
        return null;
      }
      case 'subscribe':
        if (!allowed(peer.grants.subscribe, command.topic)) throw new RuntimeError('DENIED', 'Subscribe not permitted');
        if (!peer.topics.has(command.topic) && peer.topics.size >= MAX_SUBSCRIPTIONS) throw new RuntimeError('LIMIT', 'Too many subscriptions');
        peer.topics.add(command.topic);
        return null;
      case 'unsubscribe': peer.topics.delete(command.topic); return null;
      case 'call':
        // Host callback must check service method permissions against its own trusted app policy.
        return json(await this.hostCall(peer.id, command.method, command.payload));
    }
  }
  private deliver(peer: Peer, event: Event): void { peer.transport.send(event); }
  private reply(peer: Peer, id: string, error: unknown, value?: Json) {
    if (this.peers.get(peer.id) !== peer) return;
    const response: Response = error
      ? { v: 1, op: 'response', id, ok: false,
        code: error instanceof RuntimeError ? error.code : 'REMOTE',
        message: error instanceof RuntimeError ? error.message.slice(0, 256) : 'Host method failed' }
      : { v: 1, op: 'response', id, ok: true, value: value ?? null };
    try { peer.transport.send(response); }
    catch { peer.transport.close(); } // A lost reply leaves the caller with an unknown outcome.
  }
}
