import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request, runtime, sessionPath } from './ipc';
import type { DesktopState } from './model';
export async function ensure(name: string) {
  try { await request(name, { type: 'inspect' }); return; } catch {}
  const sock = sessionPath(name);
  const lock = sock + '.starting';
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (e) {
    if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); try { await request(name, { type: 'inspect' }); return; } catch {} }
    throw new Error(`Another start did not finish. Inspect ${lock} and the session log.`);
  }
  try {
  if (fs.existsSync(sock + '.pid')) {
    const pid = Number(fs.readFileSync(sock + '.pid', 'utf8'));
    try { process.kill(pid, 0); throw new Error(`Session service ${pid} exists but is not responding`); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ESRCH')) throw e; }
  }
  fs.rmSync(sock, { force: true });
  const log = fs.openSync(path.join(runtime, name + '.log'), 'a', 0o600);
  const child = spawn(process.execPath, [path.join(__dirname, 'cli.js'), '_serve', name], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ZATARA_CWD: process.cwd() } });
  fs.closeSync(log); child.unref();
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); try { await request(name, { type: 'inspect' }); return; } catch {} }
  throw new Error(`Service did not start. See ${path.join(runtime, name + '.log')}`);
  } finally { fs.rmdirSync(lock); }
}

export interface SessionInfo { name: string; pid: number; attached: boolean; windows: number; startedAt: number }
/** Use service sidecars, not guest-owner sockets; stale services are omitted. */
export async function listSessions(): Promise<SessionInfo[]> {
  if (!fs.existsSync(runtime)) return [];
  const names = fs.readdirSync(runtime).filter(f => f.endsWith('.sock.pid')).map(f => f.slice(0, -9)).sort();
  const result: SessionInfo[] = [];
  for (let i = 0; i < names.length; i += 8) {
    const batch = await Promise.all(names.slice(i, i + 8).map(async name => {
      try { const m = await request(name, { type: 'inspect' }, 500); const s: DesktopState = m.state; return { name, pid: m.pid, attached: s.attached, windows: s.windows.length, startedAt: m.metrics.startedAt }; } catch { return null; }
    }));
    for (const session of batch) if (session) result.push(session);
  }
  return result;
}
