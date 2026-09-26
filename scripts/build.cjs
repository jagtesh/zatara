const fs = require('node:fs');
for (const file of ['dist/cli.js', 'dist/code-host.js']) fs.chmodSync(file, 0o755);
