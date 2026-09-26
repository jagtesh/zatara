import fs from 'node:fs';
import path from 'node:path';
import type { AppDefinition } from './model';
export function executable(name: string): string | null {
  if (name.includes('/')) return fs.existsSync(name) ? name : null;
  return (process.env.PATH ?? '').split(path.delimiter).map(p => path.join(p, name)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;
}
export function applications(): AppDefinition[] {
  const bundledBrowser = path.resolve(__dirname, '../.artifacts/apps/browser/terminal-browser/bin/terminal-browser');
  const bundledCode = path.resolve(__dirname, '../.artifacts/apps/code/tode/bin/tode');
  const apps: AppDefinition[] = [
    { id: 'shell', name: 'Terminal', icon: '>_', kind: 'shell', command: [], available: true },
    { id: 'demo', name: 'Pixel Studio', icon: '◈', kind: 'pixel', command: [process.execPath, path.join(__dirname, 'demo.js')], available: true },
    { id: 'browser', name: 'Browser', icon: '◎', kind: 'pixel', command: [process.env.ZATARA_BROWSER ?? (fs.existsSync(bundledBrowser) ? bundledBrowser : 'terminal-browser'), 'open', process.env.ZATARA_BROWSER_URL ?? 'https://terminal-browser.com'] },
    { id: 'code', name: 'Code', icon: '</>', kind: 'pixel', command: [process.env.ZATARA_CODE ?? (fs.existsSync(bundledCode) ? bundledCode : executable('tode') ?? 'terminal-code')] },
    { id: 'sessions', name: 'Sessions', icon: '▤', kind: 'pixel', command: [process.execPath, path.join(__dirname, 'manager.js'), 'sessions'], available: true },
    { id: 'tasks', name: 'Task Manager', icon: '▥', kind: 'pixel', command: [process.execPath, path.join(__dirname, 'manager.js'), 'tasks'], available: true },
  ];
  if (process.env.ZATARA_APPS) {
    const custom = JSON.parse(fs.readFileSync(process.env.ZATARA_APPS, 'utf8'));
    if (!Array.isArray(custom)) throw new Error('ZATARA_APPS must contain an array');
    for (const a of custom) {
      if (!a.id || !a.name || !a.icon || !Array.isArray(a.command) || !a.command.length || !a.command.every((s: unknown) => typeof s === 'string') || apps.some(x => x.id === a.id)) throw new Error('Invalid or duplicate app registration');
      apps.push({ ...a, kind: 'pixel' });
    }
  }
  for (const a of apps) if (a.available === undefined) { a.available = !!executable(a.command[0]); if (!a.available) a.reason = `${a.command[0]} is not installed. Set ZATARA_${a.id.toUpperCase()} or register a compatible Pixel app.`; }
  return apps;
}
