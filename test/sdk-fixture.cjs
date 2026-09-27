// A real independent app process: only the public headless SDK is imported.
const { getRuntime } = require('../dist/sdk/client.js');
async function main() {
  const runtime = getRuntime();
  const context = await runtime.call('context.get', {});
  const rejected = {};
  for (const [method, payload] of [
    ['tasks.list', {}],
    ['sessions.list', {}],
    ['sessions.ensure', { name: 'forbidden' }],
    ['windows.action', { id: 'another-instance', op: 'close' }],
    ['context.get', { session: 'forged' }],
  ]) {
    try { await runtime.call(method, payload); rejected[method] = false; }
    catch { rejected[method] = true; }
  }
  await runtime.call('windows.action', { id: context.id, op: 'minimize' });
  console.log(JSON.stringify({ context, rejected }));
  runtime.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
