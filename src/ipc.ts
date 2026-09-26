import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const runtime = process.env.ZATARA_RUNTIME ?? path.join(os.tmpdir(), `zatara-${process.getuid?.() ?? 'user'}`);
export function sessionPath(name: string) {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) throw new Error('Session names must be 1–32 letters, digits, underscores or hyphens');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  return path.join(runtime, name + '.sock');
}
export function lines(socket: net.Socket, onMessage: (message: any) => void) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data;
    if (buffer.length > 4 * 1024 * 1024) { socket.destroy(new Error('IPC message limit exceeded')); return; }
    let n: number;
    while ((n = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, n); buffer = buffer.slice(n + 1);
      try { onMessage(JSON.parse(line)); } catch (e) { send(socket, { type: 'error', error: String(e) }); }
    }
  });
}
export function send(socket: net.Socket | null, message: unknown) {
  if (!socket || socket.destroyed) return false;
  if (socket.writableLength > 2 * 1024 * 1024) { socket.destroy(); return false; }
  return socket.write(JSON.stringify(message) + '\n');
}
export function request(name: string, message: unknown, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sessionPath(name));
    const timeout = setTimeout(() => socket.destroy(new Error('Session request timed out')), timeoutMs);
    socket.on('connect', () => send(socket, message));
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timeout); reject(new Error('Session connection closed')); });
    lines(socket, response => { socket.end(); response.type === 'error' ? reject(new Error(response.error)) : resolve(response); });
  });
}
