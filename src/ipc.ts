import net from 'node:net';
import { ClientCommand, ServerMessage, RpcCommand, Reply, replyTypes, decodeMessage } from './protocol';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const runtime = process.env.ZATARA_RUNTIME ?? path.join(os.tmpdir(), `zatara-${process.getuid?.() ?? 'user'}`);
export function sessionPath(name: string) {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) throw new Error('Session names must be 1–32 letters, digits, underscores or hyphens');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  return path.join(runtime, name + '.sock');
}
export function lines<T>(socket: net.Socket, decode: (value: unknown) => T, onMessage: (message: T) => void) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data;
    if (buffer.length > 4 * 1024 * 1024) { socket.destroy(new Error('IPC message limit exceeded')); return; }
    let n: number;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
      try { onMessage(decode(JSON.parse(line))); } catch (e) { sendEvent(socket, { type: 'error', error: String(e) }); }
    }
  });
}
function send(socket: net.Socket | null, message: ClientCommand | ServerMessage) {
  if (!socket || socket.destroyed) return false;
  if (socket.writableLength > 2 * 1024 * 1024) { socket.destroy(); return false; }
  // write(false) means accepted with backpressure, not "not sent".
  socket.write(JSON.stringify(message) + '\n');
  return true;
}
export const sendCommand = (socket: net.Socket | null, message: ClientCommand) => send(socket, message);
export const sendEvent = (socket: net.Socket | null, message: ServerMessage) => send(socket, message);
export class RequestError extends Error {
  constructor(public readonly outcome: 'rejected' | 'unknown' | 'not-sent', message: string) { super(message); }
}
export function request<C extends RpcCommand>(name: string, message: C, timeoutMs = 4000): Promise<Reply<C>> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sessionPath(name));
    let submitted = false;
    const timeout = setTimeout(() => socket.destroy(new Error('Session request timed out')), timeoutMs);
    socket.on('connect', () => { submitted = sendCommand(socket, message); });
    socket.on('error', error => reject(new RequestError(submitted ? 'unknown' : 'not-sent', error.message)));
    socket.on('close', () => { clearTimeout(timeout); reject(new RequestError(submitted ? 'unknown' : 'not-sent', 'Session connection closed')); });
    lines(socket, decodeMessage, response => {
      socket.end();
      if (response.type === 'error') { reject(new RequestError('rejected', response.error)); return; }
      const expected = replyTypes[message.type];
      if (response.type !== expected || (expected === 'state' && (!('pid' in response) || !('metrics' in response)))) { reject(new RequestError('unknown', 'Unexpected session response')); return; }
      resolve(response as Reply<C>);
    });
  });
}
