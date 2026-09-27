import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import { Broker } from '../src/broker';

// Measure the actual inherited channel, not an in-process transport substitute.
const script = `
const { getRuntime, closeRuntime } = require(${JSON.stringify(require.resolve('../dist/sdk/client.js'))});
(async () => {
  const runtime = getRuntime();
  for (let i = 0; i < 100; i++) await runtime.call('ping', null);
  const samples = [];
  for (let i = 0; i < 1000; i++) {
    const start = performance.now();
    await runtime.call('ping', { sample: i });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const start = performance.now();
  for (let batch = 0; batch < 100; batch++)
    await Promise.all(Array.from({length: 16}, () => runtime.call('ping', null)));
  console.log(JSON.stringify({
    transport: 'inherited fd3', roundTrips: 1000,
    medianMs: samples[500], p95Ms: samples[950], p99Ms: samples[990],
    concurrentCallsPerSecond: 1600 / ((performance.now() - start) / 1000)
  }, null, 2));
  closeRuntime();
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
async function main() {
  const broker = new Broker((_id, _method, payload) => payload);
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
    env: { ...process.env, ZATARA_RUNTIME_FD: '3' },
  });
  const channel = child.stdio[3];
  if (!(channel instanceof Duplex)) throw new Error('Missing inherited runtime channel');
  broker.add('benchmark', channel);
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Runtime benchmark child exited with ${code}`);
  } finally { clearTimeout(timeout); broker.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
