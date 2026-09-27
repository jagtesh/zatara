export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ErrorCode = 'INVALID' | 'DENIED' | 'NOT_FOUND' | 'LIMIT' | 'DISCONNECTED' | 'TIMEOUT' | 'REMOTE' | 'UNKNOWN_OUTCOME';
export class RuntimeError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); this.name = 'RuntimeError'; }
}

export const MAX_MESSAGE_BYTES = 64 * 1024;
export const VERSION = 1;
export const MAX_PENDING = 128;
export const MAX_SUBSCRIPTIONS = 64;
export const MAX_HANDLERS = 32;
export const REQUEST_TIMEOUT_MS = 15000;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export function validName(value: unknown): value is string { return typeof value === 'string' && namePattern.test(value); }
export function assertName(value: unknown, label: string): asserts value is string {
  if (!validName(value)) throw new RuntimeError('INVALID', `Invalid ${label}`);
}
export function json(value: unknown): Json {
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): Json {
    if (depth > 32) throw new RuntimeError('INVALID', 'JSON nesting limit exceeded');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || seen.has(v)) throw new RuntimeError('INVALID', 'Expected JSON payload');
    seen.add(v);
    let result: Json;
    if (Array.isArray(v)) result = v.map(x => visit(x, depth + 1));
    else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new RuntimeError('INVALID', 'Expected plain JSON object');
      const out: { [key: string]: Json } = Object.create(null);
      for (const [key, entry] of Object.entries(v)) out[key] = visit(entry, depth + 1);
      result = out;
    }
    seen.delete(v);
    return result;
  }
  return visit(value, 0);
}

export type Command =
  | { v: 1; op: 'send'; id: string; to: string; type: string; payload: Json }
  | { v: 1; op: 'publish'; id: string; topic: string; payload: Json }
  | { v: 1; op: 'subscribe' | 'unsubscribe'; id: string; topic: string }
  | { v: 1; op: 'call'; id: string; method: string; payload: Json };
export type Response = { v: 1; op: 'response'; id: string; ok: true; value: Json }
  | { v: 1; op: 'response'; id: string; ok: false; code: ErrorCode; message: string };
export type Event = { v: 1; op: 'event'; from: string; type: string; payload: Json; topic?: string };
export type Wire = Command | Response | Event;
const codes: readonly string[] = ['INVALID', 'DENIED', 'NOT_FOUND', 'LIMIT', 'DISCONNECTED', 'TIMEOUT', 'REMOTE', 'UNKNOWN_OUTCOME'];
function fields(m: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(m, k)) || Object.keys(m).some(k => !required.includes(k) && !optional.includes(k)))
    throw new RuntimeError('INVALID', 'Invalid envelope fields');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeError('INVALID', 'Expected message object');
  return value as Record<string, unknown>;
}
export function decode(value: unknown, direction: 'client' | 'host'): Wire {
  const m = object(value);
  if (m.v !== VERSION) throw new RuntimeError('INVALID', 'Unsupported runtime protocol version');
  if (direction === 'client') {
    assertName(m.id, 'request ID');
    switch (m.op) {
      case 'send': fields(m, ['v', 'op', 'id', 'to', 'type', 'payload']); assertName(m.to, 'destination'); assertName(m.type, 'message type'); break;
      case 'publish': fields(m, ['v', 'op', 'id', 'topic', 'payload']); assertName(m.topic, 'topic'); break;
      case 'subscribe': case 'unsubscribe': fields(m, ['v', 'op', 'id', 'topic']); assertName(m.topic, 'topic'); break;
      case 'call': fields(m, ['v', 'op', 'id', 'method', 'payload']); assertName(m.method, 'method'); break;
      default: throw new RuntimeError('INVALID', 'Unknown client operation');
    }
  } else if (m.op === 'response') {
    assertName(m.id, 'request ID');
    if (m.ok === true) fields(m, ['v', 'op', 'id', 'ok', 'value']);
    else if (m.ok === false) {
      fields(m, ['v', 'op', 'id', 'ok', 'code', 'message']);
      if (!codes.includes(m.code as string) || typeof m.message !== 'string' || m.message.length > 256)
        throw new RuntimeError('INVALID', 'Invalid response error');
    } else throw new RuntimeError('INVALID', 'Invalid response status');
  } else if (m.op === 'event') {
    fields(m, ['v', 'op', 'from', 'type', 'payload'], ['topic']);
    assertName(m.from, 'sender'); assertName(m.type, 'message type');
    if (m.topic !== undefined) assertName(m.topic, 'topic');
  } else throw new RuntimeError('INVALID', 'Unknown host operation');
  if (Object.hasOwn(m, 'payload')) json(m.payload);
  if (Object.hasOwn(m, 'value')) json(m.value);
  return m as Wire;
}
