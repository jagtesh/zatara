import fs from 'node:fs';
import path from 'node:path';
import type { AppDefinition, MessagingPermissions } from './model';
import { validName } from './sdk/wire';
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
    { id: 'sessions', name: 'Sessions', icon: '▤', kind: 'pixel', command: [process.execPath, path.join(__dirname, 'manager.js'), 'sessions'], initialSize: { width: 820, height: 540 }, available: true },
    { id: 'tasks', name: 'Task Manager', icon: '▥', kind: 'pixel', command: [process.execPath, path.join(__dirname, 'manager.js'), 'tasks'], initialSize: { width: 820, height: 540 }, available: true },
  ];
  if (process.env.ZATARA_APPS) {
    for (const app of parseAppRegistrations(JSON.parse(fs.readFileSync(process.env.ZATARA_APPS, 'utf8')))) {
      if (apps.some(a => a.id === app.id)) throw new Error(`Duplicate app registration: ${app.id}`);
      apps.push(app);
    }
  }
  for (const a of apps) if (a.kind === 'pixel' && a.available === undefined) { a.available = !!executable(a.command[0]); if (!a.available) a.reason = `${a.command[0]} is not installed. Set ZATARA_${a.id.toUpperCase()} or register a compatible Pixel app.`; }
  return apps;
}

/** Custom registrations describe launch metadata, never window lifecycle behavior. */
export function parseAppRegistrations(value: unknown): AppDefinition[] {
  if (!Array.isArray(value)) throw new Error('ZATARA_APPS must contain an array');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid app registration');
    const a = item as Record<string, unknown>;
    const { id, name, icon, command } = a;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || typeof name !== 'string' || !name.trim() || typeof icon !== 'string' || !icon.trim() || !Array.isArray(command) || !command.length || !command.every((s: unknown) => typeof s === 'string') || !command[0]) throw new Error('Invalid or duplicate app registration');
    ids.add(id);
    let initialSize: AppDefinition['initialSize'];
    if (a.initialSize !== undefined) {
      if (!a.initialSize || typeof a.initialSize !== 'object') throw new Error('Invalid app initialSize');
      const { width, height } = a.initialSize as Record<string, unknown>;
      if (typeof width !== 'number' || !Number.isFinite(width) || width < 120 || width > 8000 || typeof height !== 'number' || !Number.isFinite(height) || height < 140 || height > 8000) throw new Error('Invalid app initialSize');
      initialSize = { width, height };
    }
    const messaging = parseMessagingPermissions(a.messaging);
    return { id, name, icon, command: command as [string, ...string[]], kind: 'pixel', initialSize, messaging };
  });
}

/** These grants come from the host's registration file, never the child process. */
export function parseMessagingPermissions(value: unknown): MessagingPermissions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid messaging permissions');
  const result: MessagingPermissions = {};
  for (const [key, names] of Object.entries(value)) {
    if (!['send', 'receive', 'publish', 'subscribe'].includes(key) || !Array.isArray(names) ||
        names.length > 64 || !names.every(validName)) {
      throw new Error('Invalid messaging permissions');
    }
    result[key as keyof MessagingPermissions] = [...new Set(names as string[])];
  }
  return result;
}
