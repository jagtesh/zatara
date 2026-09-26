#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request, runtime, sessionPath } from './ipc';
async function ensure(name: string) {
  try { await request(name, { type: 'inspect' }); return; } catch {}
  const sock = sessionPath(name);
  const lock = sock + '.starting';
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (e: any) {
    if (e.code !== 'EEXIST') throw e;
    for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); try { await request(name, { type: 'inspect' }); return; } catch {} }
    throw new Error(`Another start did not finish. Inspect ${lock} and the session log.`);
  }
  try {
  if (fs.existsSync(sock + '.pid')) {
    const pid = Number(fs.readFileSync(sock + '.pid', 'utf8'));
    try { process.kill(pid, 0); throw new Error(`Session service ${pid} exists but is not responding`); } catch (e: any) { if (e.code !== 'ESRCH') throw e; }
  }
  fs.rmSync(sock, { force: true });
  const log = fs.openSync(path.join(runtime, name + '.log'), 'a', 0o600);
  const child = spawn(process.execPath, [__filename, '_serve', name], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ZATARA_CWD: process.cwd() } });
  fs.closeSync(log); child.unref();
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); try { await request(name, { type: 'inspect' }); return; } catch {} }
  throw new Error(`Service did not start. See ${path.join(runtime, name + '.log')}`);
  } finally { fs.rmdirSync(lock); }
}
async function main() {
  const [op = 'attach', name = 'main', arg] = process.argv.slice(2);
  if (op === '_serve') { (await import('./server.js')).serve(name); return; }
  if (op === '--help' || op === 'help') { console.log('Zatara — a desktop for Pixel apps\n\n  zatara [attach|start] [session]\n  zatara list\n  zatara detach [session]\n  zatara kill [session]\n  zatara launch <session> <shell|demo|browser|code>\n  zatara inspect [session]\n\nCtrl+Alt+D detaches. Closing a window ends its app.\nRun inside Ghostty; for SSH, install and run on the remote host.'); return; }
  if (op === 'list') {
    if (!fs.existsSync(runtime)) return;
    for (const file of fs.readdirSync(runtime).filter(f => f.endsWith('.sock') && !f.endsWith('-pixel.sock'))) { try { const { state, pid } = await request(file.slice(0,-5), { type: 'inspect' }); console.log(`${state.session}\t${state.attached ? 'attached' : 'detached'}\t${state.windows.length} windows\tpid ${pid}`); } catch {} } return;
  }
  if (op === 'attach' || op === 'start') {
    if (!process.stdout.isTTY && !process.env.ZATARA_TEST_HOST) throw new Error('Attach from an interactive Ghostty terminal. Use launch/inspect for non-interactive control.');
    if (!process.env.ZATARA_TEST_HOST) {
      const { detect, probeGraphics } = await import('@zenbu-labs/pixel/terminal');
      if (await probeGraphics(detect()) !== 'supported') throw new Error('This terminal did not confirm Kitty graphics support. Use Ghostty or Kitty, directly or over SSH.');
    }
    await ensure(name);
    if ((await request(name, { type: 'inspect' })).state.attached) throw new Error('Session already attached. Use zatara detach first.');
    (await import('./desktop.js')).attach(name); return;
  }
  if (op === 'launch') { await ensure(name); console.log(JSON.stringify(await request(name, { type: 'launch', app: arg || 'demo' }))); return; }
  if (['detach', 'kill', 'inspect'].includes(op)) { console.log(JSON.stringify(await request(name, { type: op }), null, 2)); return; }
  throw new Error(`Unknown command: ${op}. Use --help.`);
}
main().catch(e => { console.error(`zatara: ${e.message}`); process.exitCode = 1; });
