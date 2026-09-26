#!/usr/bin/env node
// terminal-code 0.3.4 still launches terminal-browser's removed --app-mode.
// Translate that small launch interface into a real Pixel WebView, retaining
// terminal-code's own code-server, theme bridge, and preload/main scripts.
import path from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] !== 'open') { console.error('Zatara code host supports only terminal-code app launches'); process.exit(2); }
const bin = path.join(path.dirname(require.resolve('@zenbu-labs/pixel/package.json')), 'dist/bin.js');
const child = spawn(process.env.ZATARA_NODE ?? process.execPath, [bin, path.join(__dirname, 'code-window.js'), '--', ...args.slice(1)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
child.on('error', e => { console.error(e); process.exit(1); });
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
