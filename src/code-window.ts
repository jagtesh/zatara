import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRoot } from '@zenbu-labs/pixel';
const args = process.argv.slice(2);
const option = (name: string) => args.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const url = args.find(a => !a.startsWith('--'));
if (!url) throw new Error('terminal-code did not supply its code-server URL');
const main = option('--main-script'), preload = option('--preload');
if (main) require(path.resolve(main));
let bridged: string | undefined;
if (preload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zatara-code-'));
  bridged = path.join(dir, 'preload.js');
  fs.writeFileSync(bridged, 'globalThis.terminalBrowser = globalThis.pixel;\n' + fs.readFileSync(preload, 'utf8'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
const electron = require('electron');
const profile = path.join(os.tmpdir(), 'zatara-code-profile-' + (process.env.ZATARA_PANE ?? process.pid));
fs.mkdirSync(profile, { recursive: true });
electron.app.setPath('userData', profile);
const root = createRoot({ name: 'terminal-code', devtools: false });
// Separate Chromium profiles prevent concurrent independent code windows from
// corrupting or locking the same IndexedDB/service-worker stores.
const view = root.loadURL(url, { preload: bridged, onChange: state => {
  if (state.title) root.setTitle(state.title);
  if (process.env.ZATARA_TRACE) console.error('Code state', state.title, state.loading);
} });
view.webContents.on('did-fail-load', (_: unknown, code: number, description: string) => console.error('Code load failed', code, description));
root.setTitle('terminal-code');
