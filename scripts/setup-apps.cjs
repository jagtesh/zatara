// Optional, project-local official releases; does not replace installed apps.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This setup script is pinned for macOS arm64. Register your platform binaries via ZATARA_BROWSER and ZATARA_CODE.');
const root = path.resolve(__dirname, '../.artifacts/apps');
const releases = [
  ['browser', 'https://github.com/zenbu-labs/terminal-browser/releases/download/v0.11.1/terminal-browser-darwin-arm64.tar.gz', 'terminal-browser/bin/terminal-browser'],
  ['code', 'https://github.com/zenbu-labs/terminal-code/releases/download/v0.3.4/tode-darwin-arm64.tar.gz', 'tode/bin/tode'],
];
for (const [name, url, bin] of releases) {
  const dir = path.join(root, name);
  if (fs.existsSync(path.join(dir, bin))) { console.log(`${name}: already present`); continue; }
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(root, `${name}.tar.gz`);
  execFileSync('curl', ['-fL', '--retry', '2', url, '-o', archive], { stdio: 'inherit' });
  execFileSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
  fs.unlinkSync(archive);
  console.log(`${name}: installed in ${dir}`);
}
console.log('Restart existing Zatara sessions to pick up these launchers. terminal-code downloads its code-server on first launch.');
