import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Harness, until, delay } from './harness';

(async () => {
  const legacy = process.argv.includes('--legacy');
  if (legacy) {
    const dir = '.artifacts/grid-baseline';
    fs.mkdirSync(dir, { recursive: true }); fs.cpSync('dist', `${dir}/dist`, { recursive: true });
    if (!fs.existsSync(`${dir}/node_modules`)) fs.symlinkSync(path.resolve('node_modules'), `${dir}/node_modules`);
    fs.copyFileSync('scripts/fixtures/shell-row-baseline.cjs', `${dir}/dist/shell-view.js`);
  }
  const h = new Harness({ cli: legacy ? '.artifacts/grid-baseline/dist/cli.js' : undefined, width: 2432, height: 1326, cell: { width: 16, height: 34 } });
  try {
    await h.ready(); const { id } = await h.request({ type: 'launch', app: 'shell' }); await h.attach();
    // A real PTY producer, 70 columns x 20 rows. Each input requests one complete
    // repaint; echo is disabled so receipt of an echo cannot count as a frame.
    const code = `import sys,tty
    tty.setraw(0)
    sys.stdout.write("\\x1b[2J\\x1b[HREADY");sys.stdout.flush()
    while True:
      c=sys.stdin.read(1)
      sys.stdout.write("\\x1b[H"+(c*70+"\\r\\n")*20)
      sys.stdout.flush()
    `.split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n');
    const quoted = "'" + code.replace(/'/g, "'\\''") + "'";
    await h.request({ type: 'input', id, event: { type: 'text', text: `python3 -u -c ${quoted}\r` } });
    await until(async () => (await h.request({ type: 'screen', id })).screen.rows[0][0].text === 'R'); await delay(200);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const frame = h.nextFrame(), at = performance.now();
      await h.request({ type: 'input', id, event: { type: 'text', text: i % 2 ? 'M' : 'W' } });
      await frame; samples.push(performance.now() - at); await delay(70);
    }
    const rss = execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(h.desktop!.pid)], { encoding: 'utf8' }).trim();
    fs.mkdirSync('.artifacts', { recursive: true });
    const result = { date: new Date().toISOString(), node: process.version, pixel: '0.0.15', variant: legacy ? 'legacy row text (same scaling)' : 'cell grid', host: `${os.platform()} ${os.arch()} ${os.release()}`, viewport: [h.width, h.height], cell: [16, 34], workload: '1400 changed glyphs per update, 20 updates, 70ms pause after each received frame', method: 'PTY input RPC to first compositor frame received by native harness; not physical display latency', samplesMs: samples, medianMs: [...samples].sort((a,b)=>a-b)[10], maxMs: Math.max(...samples), desktopRssMiB: Number(rss) / 1024 };
    fs.writeFileSync(legacy ? '.artifacts/shell-row-benchmark.json' : '.artifacts/shell-grid-benchmark.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await h.close(); }
})();
