#!/usr/bin/env node
import { request } from './ipc';
import { configPath, initConfig, readConfig } from './config';
import { ensure, listSessions } from './sessions';
async function main() {
  const [op = 'attach', name = 'main', arg] = process.argv.slice(2);
  if (op === 'config') {
    const command = process.argv[3] ?? 'path';
    if (command === 'path') console.log(configPath());
    else if (command === 'init') console.log(initConfig());
    else if (command === 'check') { readConfig(); console.log(`Valid: ${configPath()}`); }
    else throw new Error('Use config path, config init, or config check');
    return;
  }
  if (op === '_serve') { (await import('./server.js')).serve(name); return; }
  if (op === '--help' || op === 'help') { console.log('Zatara — a desktop for Pixel apps\n\n  zatara [attach|start] [session]\n  zatara config [path|init|check]\n  zatara list\n  zatara create [session]\n  zatara detach [session]\n  zatara kill [session]\n  zatara launch <session> <shell|demo|browser|code|sessions|tasks>\n  zatara inspect [session]\n\nCtrl+Alt+D detaches. Closing a window ends its app.\nRun inside Ghostty; for SSH, install and run on the remote host.'); return; }
  if (op === 'list') {
    for (const s of await listSessions()) console.log(`${s.name}\t${s.attached ? 'attached' : 'detached'}\t${s.windows} windows\tpid ${s.pid}`); return;
  }
  if (op === 'create') { await ensure(name); console.log(`Created session ${name}. Attach with: zatara attach ${name}`); return; }
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
