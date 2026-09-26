const fs = require('node:fs');
const path = require('node:path');
// node-pty 1.1.0's npm archive loses the executable bit on macOS helpers.
const helper = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
if (process.platform === 'darwin' && fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
