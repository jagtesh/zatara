import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, ChildProcess } from 'node:child_process';
import { PNG } from 'pngjs';
import { OwnerServer, Guest } from '../node_modules/@zenbu-labs/pixel/dist/host/server';
export const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function until(fn: () => any | Promise<any>, timeout = 10000) {
  const start = Date.now(); while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await delay(40); } throw new Error('Timed out waiting for condition');
}
export function rpc(socket: string, message: any): Promise<any> {
  return new Promise((resolve, reject) => { const s = net.connect(socket); let b = ''; const t = setTimeout(() => s.destroy(new Error('RPC timeout')), 5000); s.on('connect', () => s.write(JSON.stringify(message) + '\n')); s.on('error', reject); s.on('close', () => clearTimeout(t)); s.on('data', d => { b += d; if (b.includes('\n')) { s.end(); const m = JSON.parse(b.split('\n')[0]); m.type === 'error' ? reject(new Error(m.error)) : resolve(m); } }); });
}
export class Harness {
  dir = fs.mkdtempSync('/tmp/zt-');
  socket = path.join(this.dir, 'test.sock');
  owner = new OwnerServer(path.join(this.dir, 'display.sock'), () => ({ width: 8, height: 18 }));
  server: ChildProcess;
  desktop?: ChildProcess;
  guest?: Guest;
  bgra?: Buffer;
  events = new EventEmitter();
  frameTimes: number[] = [];
  width = 1200; height = 800; frames = 0; bytes = 0;
  constructor(private options: { width?: number; height?: number; scale?: number; env?: NodeJS.ProcessEnv } = {}) {
    this.width = options.width ?? 1200; this.height = options.height ?? 800;
    this.owner.onJoin = guest => { this.guest = guest; guest.send({ type: 'init', width: this.width, height: this.height, cols: this.width / 8, rows: Math.floor(this.height / 18), focused: true, colors: { foreground: [220,228,245,255], background: [17,24,39,255], palette: [] } }); guest.onFrame = f => { try { this.bgra = fs.readFileSync(f.path); this.width = f.width; this.height = f.height; this.frames++; this.bytes += this.bgra.length; this.frameTimes.push(performance.now()); this.events.emit('frame'); } finally { f.ack(); } }; };
    this.server = this.run(['_serve', 'test']);
  }
  run(args: string[], extra = {}) { const fd = fs.openSync(path.join(this.dir, args[0] + '.log'), 'a'); const child = spawn(process.execPath, ['dist/cli.js', ...args], { env: { ...process.env, PIXEL_DISPLAY_SCALE: String(this.options.scale ?? 1), ZATARA_RUNTIME: this.dir, ...this.options.env, ...extra }, stdio: ['ignore', fd, fd] }); fs.closeSync(fd); return child; }
  async ready() { await until(() => fs.existsSync(this.socket)); }
  async attach() { this.guest = undefined; this.desktop = this.run(['attach', 'test'], { ZATARA_TRACE: '1', ZATARA_TEST_HOST: path.join(this.dir, 'display.sock') }); await until(() => this.guest); await until(() => this.bgra); await delay(200); }
  request(m: any) { return rpc(this.socket, m); }
  nextFrame(): Promise<void> { return new Promise((resolve, reject) => { const done = () => { clearTimeout(t); resolve(); }; const t = setTimeout(() => { this.events.off('frame', done); reject(new Error('Frame timeout')); }, 3000); this.events.once('frame', done); }); }
  async click(x: number, y: number, button: 'left' | 'right' = 'left') { this.mouse('down', x, y, button); await delay(30); this.mouse('up', x, y, button); await delay(100); }
  mouse(kind: string, x: number, y: number, button = 'left') { this.guest!.send({ type: 'mouse', kind, x, y, button, mods: { ctrl: false, alt: false, shift: false, super: false } } as any); }
  async drag(x: number, y: number, dx: number, dy: number) { this.mouse('down', x, y); await delay(40); for (let i = 1; i <= 12; i++) { this.mouse('move', x + dx * i / 12, y + dy * i / 12); await delay(20); } this.mouse('up', x + dx, y + dy); await delay(150); }
  save(file: string) { if (!this.bgra) throw new Error('No frame'); const png = new PNG({ width: this.width, height: this.height }); for (let i = 0; i < this.bgra.length; i += 4) { png.data[i] = this.bgra[i+2]; png.data[i+1] = this.bgra[i+1]; png.data[i+2] = this.bgra[i]; png.data[i+3] = this.bgra[i+3]; } fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, PNG.sync.write(png)); }
  async close() { this.desktop?.kill(); try { await this.request({ type: 'kill' }); } catch {} this.owner.stop(); this.server.kill(); }
}
