import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const defaultAppearance = {
  ui: { fontSize: 13 },
  desktop: { fontSize: 12, iconTextSize: 12, iconSize: 48 },
  colors: { text: '#e7eeff', muted: '#9baac4', accent: '#bba2f5', activeBorder: '#9481ba', inactiveBorder: '#45536b', desktopStart: '#1e2441', desktopMiddle: '#111c30', desktopEnd: '#0c242a' },
};
export type Appearance = typeof defaultAppearance;
export function configPath() { return process.env.ZATARA_CONFIG ? path.resolve(process.env.ZATARA_CONFIG) : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zatara', 'config.json'); }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown setting: ${name}.${key}`);
}
export function parseConfig(value: unknown): Appearance {
  const root = object(value, 'config'); keys(root, ['appearance'], 'config');
  const result = structuredClone(defaultAppearance);
  if (root.appearance === undefined) return result;
  const appearance = object(root.appearance, 'appearance'); keys(appearance, ['ui', 'desktop', 'colors'], 'appearance');
  const ranges = { ui: { fontSize: [10, 20] }, desktop: { fontSize: [10, 28], iconTextSize: [10, 28], iconSize: [24, 112] } };
  for (const section of ['ui', 'desktop'] as const) {
    if (appearance[section] === undefined) continue;
    const values = object(appearance[section], `appearance.${section}`);
    keys(values, Object.keys(ranges[section]), `appearance.${section}`);
    for (const [key, value] of Object.entries(values)) {
      const [min, max] = (ranges[section] as Record<string, number[]>)[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`appearance.${section}.${key} must be a number from ${min} to ${max}`);
      (result[section] as Record<string, number>)[key] = value;
    }
  }
  if (appearance.colors !== undefined) {
    const colors = object(appearance.colors, 'appearance.colors'); keys(colors, Object.keys(result.colors), 'appearance.colors');
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value)) throw new Error(`appearance.colors.${key} must be a #RRGGBB color`);
      (result.colors as Record<string, string>)[key] = value;
    }
  }
  return result;
}
export function readConfig(file = configPath()): Appearance {
  try {
    if (fs.statSync(file).size > 64 * 1024) throw new Error('Configuration exceeds 64 KiB');
    return parseConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e: any) {
    if (e.code === 'ENOENT') return structuredClone(defaultAppearance);
    throw new Error(`${file}: ${e.message}`);
  }
}
export function initConfig(file = configPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ appearance: defaultAppearance }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return file;
}
/** Supports atomic editor saves and creation after startup. Invalid edits retain the last good appearance. */
export function watchConfig(onChange: (appearance: Appearance) => void, onError: (error: string) => void, file = configPath()) {
  let previous = '';
  const reload = () => { try { const next = readConfig(file), json = JSON.stringify(next); if (json !== previous) { previous = json; onChange(next); } onError(''); } catch (e) { onError(String(e)); } };
  reload();
  fs.watchFile(file, { interval: 750, persistent: false }, reload);
  return () => fs.unwatchFile(file, reload);
}
export const appearance = structuredClone(defaultAppearance);
