const fs = require('node:fs');
// Pixel's pinned internal entrypoints are not exported. Resolve its package
// location at runtime so npm hoisting does not break our hosting adapter.
for (const file of fs.readdirSync('dist').filter(file => file.endsWith('.js'))) {
  const path = `dist/${file}`;
  fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace(
    /require\("\.\.\/node_modules\/@zenbu-labs\/pixel\/([^"\n]+)"\)/g,
    (_, entry) => `require(require("node:path").join(require.resolve("@zenbu-labs/pixel/package.json"), "..", ${JSON.stringify(entry)}))`,
  ));
}
for (const file of ['dist/cli.js', 'dist/code-host.js']) fs.chmodSync(file, 0o755);
