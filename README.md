# Zatara

A persistent, mouse-driven desktop for Pixel apps, inside your terminal.

Floating windows, independent shells, desktop launch icons, a taskbar, and real
graphical applications. The desktop and Pixel Studio use Pixel's native Rust
renderer through React; they do not start Chromium. Browser/editor windows do.

## Run

Requires Node 22+, macOS arm64, and a Kitty-graphics terminal such as Ghostty.

```sh
npm ci
npm run build
npm start
```

Double-click a desktop icon. Drag a title bar or resize an edge. Double-click a
title bar to maximize/restore. Right-click a title bar or taskbar item for window
actions. Click a taskbar item to restore/focus it. **Detach** or **Ctrl+Alt+D**
leaves applications alive; closing a window ends that application.

```sh
node dist/cli.js attach main
node dist/cli.js list
node dist/cli.js detach main
node dist/cli.js launch main shell
node dist/cli.js launch main demo
node dist/cli.js inspect main
node dist/cli.js kill main
```

One attachment per session. A second attachment reports an error; detach the
first explicitly before switching. Sessions survive attachment crashes and
terminal hangup, but not service crashes or machine restarts.

## Browser and editor

```sh
npm run setup:apps
node dist/cli.js launch main browser
node dist/cli.js launch main code
```

The optional setup downloads **terminal-browser 0.11.1** and **terminal-code/tode
0.3.4** from their official releases into `.artifacts/apps`, without replacing
installed binaries. These copies are already present in this working directory.
Start a new session after installation. Tode downloads code-server on first use
and keeps its own data under the standard XDG directories.

Terminal-code 0.3.4 uses a browser app-mode API removed in browser 0.11.1. Zatara's
small launch adapter hosts the actual editor in a Pixel WebView, retaining its
code-server and preload/theme bridge. Each editor window has an independent
Chromium profile. This is not a substitute editor or screenshot mock.

Override launchers with `ZATARA_BROWSER` and `ZATARA_CODE`. Browser 0.8.1, which
was installed on this machine, does not support this hosting arrangement.
Tode's shared code-server outlives individual windows; its `--shutdown` command
stops that upstream service when no editor windows need it.

## Remote operation

Install the project on the remote host and run `node dist/cli.js attach main`
inside an ordinary interactive SSH session. Only the graphics-capable terminal
is required locally. The persistent service and guest connections stay on the
remote host. Reconnect with the same command after an SSH disconnect.

Direct SSH transmits encoded graphics, so active dragging and scrolling can be
bandwidth-intensive. There is no optional local-rendering client yet. Linux,
tmux nesting, Sixel, and arbitrary graphics applications inside the shell window
are outside the verified target. Shell ANSI/TUI applications and Pixel guests
use different rendering paths.

## Application API

Set `ZATARA_APPS` to an absolute path to a JSON array:

```json
[
  { "id": "my-app", "name": "My App", "icon": "M", "command": ["/absolute/path/to/pixel", "/absolute/path/to/app"] }
]
```

Applications run as separate processes. Zatara supplies `PIXEL_TTY`, registers a
Pixel pane owner, and owns the guest connection until the window closes. Native
apps can also use `ZATARA_HOST`/`ZATARA_PANE`, as the Pixel Studio example does.
Commands are argument arrays, not shell strings. The reusable presentation
components are exported from `src/primitives.tsx`.

## Verification

```sh
npm test                  # real PTYs, native rendering and mouse integration
npm run check
npm run test:apps         # optional official browser/editor releases required
npm run bench             # native process CPU/RSS and input-to-frame timings
npm run bench:transport   # actual Kitty stream through a simulated terminal PTY
```

See [verification and measurements](docs/verification.md) for tested behavior,
measured costs, and unverified boundaries. Screenshots and raw measurement JSON
are written to `.artifacts/`. Runtime sockets and logs live in the private
`zatara-<uid>` directory beneath the OS temporary directory; `ZATARA_RUNTIME`
overrides it for tests. No network listener is opened by Zatara's session service.
