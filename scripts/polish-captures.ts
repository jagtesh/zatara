import fs from 'node:fs';
import { Harness, delay } from './harness';
async function main() {
  const captures = [];
  for (const [width, height, scale] of [[800, 600, 1], [1200, 792, 1], [1600, 1000, 1], [1200, 792, 2]]) {
    const h = new Harness({ width, height, scale });
    try {
      await h.ready();
      const first = (await h.request({ type: 'launch', app: 'demo' })).id;
      const second = (await h.request({ type: 'launch', app: 'demo' })).id;
      await h.attach();
      await h.request({ type: 'action', id: first, op: 'move', rect: { x: 140, y: 45, width: Math.min(680, width - 180), height: Math.min(450, height - 110) } });
      await h.request({ type: 'action', id: second, op: 'move', rect: { x: Math.min(350, width - 560), y: 150, width: Math.min(680, width - 180), height: Math.min(450, height - 180) } });
      await delay(500);
      const file = `.artifacts/polish-${width}x${height}-${scale}x.png`;
      h.save(file);
      captures.push({ requested: { width, height, scale }, captured: { width: h.width, height: h.height }, rendering: (await h.request({ type: 'inspect' })).rendering, file });
    } finally { await h.close(); }
  }
  fs.writeFileSync('.artifacts/polish-captures.json', JSON.stringify(captures, null, 2) + '\n');
  console.log(JSON.stringify(captures, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
