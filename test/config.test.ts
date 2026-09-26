import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAppearance, initConfig, parseConfig, readConfig, watchConfig } from '../src/config';
import { Harness, delay, until } from '../scripts/harness';

test('appearance overrides merge independently and reject invalid or mistyped values', () => {
  const result = parseConfig({ appearance: { desktop: { iconTextSize: 24, iconSize: 80 } } });
  assert.equal(result.ui.fontSize, 13);
  assert.equal(result.desktop.fontSize, 12);
  assert.equal(result.desktop.iconTextSize, 24);
  assert.equal(result.desktop.iconSize, 80);
  assert.equal(defaultAppearance.desktop.iconSize, 48);
  for (const invalid of [{ appearance: { ui: { fontSize: '16' } } }, { appearance: { desktop: { iconSize: 900 } } }, { appearance: { desktop: { iconFontSize: 16 } } }, { appearance: { colors: { text: 'invalid' } } }, null]) assert.throws(() => parseConfig(invalid));
});

test('config init preserves existing files; atomic edits reload, invalid edits retain last valid settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zatara-config-')), file = path.join(dir, 'config.json');
  let value = defaultAppearance, error = '';
  const stop = watchConfig(next => { value = next; }, message => { error = message; }, file);
  try {
    initConfig(file); assert.throws(() => initConfig(file));
    fs.writeFileSync(file + '.new', JSON.stringify({ appearance: { ui: { fontSize: 18 } } })); fs.renameSync(file + '.new', file);
    await until(() => value.ui.fontSize === 18);
    fs.writeFileSync(file, '{'); await until(() => !!error);
    assert.equal(value.ui.fontSize, 18);
    fs.unlinkSync(file); await until(() => value.ui.fontSize === 13 && error === '');
    assert.deepEqual(readConfig(file), defaultAppearance);
  } finally { stop(); fs.rmSync(dir, { recursive: true }); }
});

test('desktop reloads larger independent icons and UI fonts without restarting apps', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zatara-appearance-')), file = path.join(dir, 'config.json');
  initConfig(file);
  const h = new Harness({ env: { ZATARA_CONFIG: file } });
  try {
    await h.ready(); const id = (await h.request({ type: 'launch', app: 'demo' })).id;
    await h.attach(); await delay(300);
    const before = Buffer.from(h.bgra!), pid = (await h.request({ type: 'inspect' })).state.windows[0].pid;
    fs.writeFileSync(file, JSON.stringify({ appearance: { ui: { fontSize: 18 }, desktop: { fontSize: 16, iconSize: 72, iconTextSize: 20 }, colors: { accent: '#80d9ce' } } }));
    await until(() => !h.bgra!.equals(before)); await delay(900);
    h.save('.artifacts/configured-desktop.png');
    assert.equal((await h.request({ type: 'inspect' })).state.windows[0].pid, pid);
    // The larger title text must not cover the fixed maximize control.
    const w = (await h.request({ type: 'inspect' })).state.windows.find((w: any) => w.id === id);
    await h.click(w.x + w.width - 50, w.y + 18);
    assert.equal((await h.request({ type: 'inspect' })).state.windows[0].maximized, true);
  } finally { await h.close(); fs.rmSync(dir, { recursive: true }); }
});
