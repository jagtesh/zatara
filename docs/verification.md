# Verification — 2026-09-26

This is the initial proof-of-concept record at revision `2fd50e9`. Later
validation is recorded in [display scaling](display-scaling.md) and the current
test suite; the platform limitations below describe this historical run.

## Exercised successfully

- Independent native Pixel guests and real node-pty shell processes.
- Native mouse events: window dragging, edge resizing, maximize/restore,
  title-bar context menu, minimize, and taskbar restore.
- An overlapping app does not receive a click intended for the foreground app.
- Abruptly killing the desktop attachment preserves shell/guest PIDs, shell
  environment variables, GUI counter state, and the latest app frame.
- Two shell windows have different PIDs and independent environments.
- Alternate-screen entry/exit and 50,000 lines of shell output, without losing
  the desktop attachment.
- terminal-browser 0.11.1 and terminal-code 0.3.4 hosted simultaneously. Browser typing and scrolling are checked through page-title assertions. The
  editor creates an untitled buffer, accepts two lines of text, and retains it
  after reconnect. Screenshots show actual native frames, not HTML mockups.
- The actual inline Kitty output path runs through a PTY; terminal hangup leaves
  the app running. Unsupported graphics terminals receive an explanatory error.
- TypeScript build and typecheck pass. `npm test` exercises the core behavior;
  `npm run test:apps` exercises the optional full applications.

## Measurements

Apple M5 Pro, macOS kernel 27.2.0, arm64, Node 22.23.2, Pixel 0.0.15. Native
capture viewport: 1200 × 792 pixels. Single-run exploratory measurements, not a
cross-machine benchmark or a performance guarantee.

| Native desktop workload | Process-tree RSS | CPU, one core = 100% | Frames during sample |
| --- | ---: | ---: | ---: |
| Shell + Pixel Studio, initial idle (~3 s) | 305 MiB | 2.0% | 2 |
| Repeated dragging (~1.84 s) | 318 MiB | 42.9% | 48 |
| Counter clicks (~0.88 s) | 320 MiB | 34.0% | 10 |
| 50,000 output lines (~0.15 s) | 332 MiB | 130.2% | 7 |
| Idle after output (~3 s) | 331 MiB | 1.0% | 0 |

Input to captured desktop frame: **24.9 ms median**, **25.6 ms p95**, 10 counter
clicks. The endpoint is the native host's frame callback; this does not include
physical display presentation. Backend input-to-guest-frame times were about
2–4 ms. Do not compare those two latency definitions interchangeably.

Actual encoded inline Kitty output through a simulated terminal PTY:

- Idle for 2 seconds: **0 bytes**.
- 50 geometry updates over ~1.30 seconds: **3,278,829 bytes**, **20 emitted
  frames** (~2.5 MB/s, roughly 20 Mbit/s before SSH/network overhead).

The native host's raw BGRA byte counts are local surface traffic, **not** network
bandwidth. The PTY test uses real encoded terminal output, but emulates terminal
capability replies and does not simulate network latency or backpressure.

Browser plus editor costs are much larger: the static-page run measured about
**2.6 GiB summed RSS** across the desktop, app launchers, Chromium processes,
code-server, and extension hosts. The short post-startup CPU sample was around
**14% of one core**, with zero desktop frames during the idle sample. An earlier
run with an autoplay-media webpage produced continuous frames and much higher
CPU; it is not an idle baseline. These results support keeping the desktop and
simple apps native, while treating browser/editor costs separately.

RSS sums may count shared pages multiple times. CPU is the difference in `ps`
accumulated process CPU time across each interval. The upstream editor shares
a code-server across windows; unrelated editor sessions can affect a rerun.

The committed measurement summary is [measurements.json](measurements.json).
Original raw reports and rendered screenshots were generated in ignored
`.artifacts/` and are not included in a fresh clone:
`benchmark.json`, `terminal-bandwidth.json`, `apps-verification.json`,
`desktop.png`, and `pixel-apps-reconnected.png`.

## Not verified

- Live Ghostty interaction: the computer-use tool denied access to Ghostty.
  Testing instead drives the real Pixel engine via its native guest protocol.
- An authenticated SSH session: localhost SSH rejected the available
  authentication. The PTY hangup and reconnect tests verify process lifetime,
  not real network behavior.
- High-DPI/terminal-zoom variations, extended clipboard/IME behavior, Linux,
  Sixel, and nested tmux compatibility.

The direct-SSH architecture is implemented; physical-terminal and real-network
acceptance remain follow-up validation, not claimed successes.
