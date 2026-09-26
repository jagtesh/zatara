import fs from 'node:fs';
import path from 'node:path';
import { Harness, delay, until } from './harness';

async function main() {
  const h = new Harness({ width: 1800, height: 1188, cell: { width: 12, height: 27 }, env: { ZATARA_CONFIG: path.resolve('.artifacts/readme-defaults.json') } });
  const scale = 1.5;
  const launch = async (app: string) => (await h.request({ type: 'launch', app })).id as string;
  const move = (id: string, x: number, y: number, width: number, height: number) => h.request({ type: 'action', id, op: 'move', rect: { x: x * scale, y: y * scale, width: width * scale, height: height * scale } });
  try {
    fs.writeFileSync('.artifacts/readme-defaults.json', '{}');
    await h.ready(); await h.attach();
    const demo = await launch('demo');
    await move(demo, 160, 58, 650, 430);
    await until(async () => (await h.request({ type: 'inspect' })).rendering.surfaces[demo]);
    await h.click(235 * scale, 325 * scale); await h.click(235 * scale, 325 * scale);
    const shell = await launch('shell');
    await move(shell, 365, 340, 775, 350);
    const command = `PROMPT=$'%F{magenta}zatara%f %F{cyan}❯%f '; printf '\\033[2J\\033[H\\033[1;35mZ A T A R A\\033[0m\\n\\033[36mA desktop. In your terminal.\\033[0m\\n\\n'; printf '  Independent shells    Native Pixel apps\\n  Floating windows      Persistent sessions\\n\\n'; git log -3 --format='%h  %s'; printf '\\n'\r`;
    await h.request({ type: 'input', id: shell, event: { type: 'text', text: command } });
    await until(async () => (await h.request({ type: 'screen', id: shell })).screen.rows.some((r: { text: string }[]) => r.map(c => c.text).join('').trim() === 'A desktop. In your terminal.'));
    await delay(400); h.save('docs/images/desktop.png');

    await h.request({ type: 'action', id: shell, op: 'minimize' });
    await h.request({ type: 'action', id: demo, op: 'minimize' });
    const sessions = await launch('sessions'); await move(sessions, 150, 48, 820, 440);
    const tasks = await launch('tasks'); await move(tasks, 325, 285, 820, 430);
    await until(async () => { const m = await h.request({ type: 'inspect' }); return m.rendering.surfaces[tasks] && m.rendering.surfaces[sessions]; });
    await h.request({ type: 'action', id: sessions, op: 'focus' });
    await delay(100);
    await h.request({ type: 'action', id: tasks, op: 'focus' });
    await delay(2300); h.save('docs/images/managers.png');
    console.log('Saved native desktop and manager screenshots.');
  } finally { await h.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
