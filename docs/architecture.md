# Implementation notes

## Process ownership

The Node session service owns PTYs, xterm parser state, window geometry, and
Pixel's `OwnerServer`. A native Pixel desktop process attaches over a Unix
socket. Each GUI guest has its own process and connects to the persistent owner,
not the desktop process. Disconnecting the desktop only clears the attachment.

The service retains one atomically replaced BGRA frame per GUI app. It copies a
guest frame before acknowledging it, because the upstream guest can reuse that
memory immediately after ACK. Notifications coalesce at a 16 ms cadence; the
desktop opens complete frame files. Reconnecting receives the latest frame and
shell viewport. Hidden windows stay mounted and keep their processes.

PTY output is parsed by pinned xterm/headless, with 2,000 lines of scrollback.
node-pty pauses above 256 KiB of pending parser input and resumes below 64 KiB.
Only visible viewports are sent to the desktop. IPC buffers have size limits;
a stalled attachment disconnects instead of retaining unlimited output.

## Pixel integration boundaries

Pixel is pinned to npm **0.0.15** with lockfile integrity. `src/pixel.ts` exposes
its internal native React entrypoint, avoiding Electron in the desktop. The
service imports its private `host/server` and `instances` modules. We do not
modify Pixel's installed files. These imports need review on dependency updates.

Zatara replaces Pixel's tab-oriented host view with its own surfaces. Focus and
visibility are independent. Window move/resize capture uses Pixel drag events;
content uses pointer events translated into guest-local coordinates. Pixel
pointer capture consumes clicks/drags, so title-bar gestures intentionally use
the drag API rather than combining pointer and click handlers.

`src/code-host.ts` translates terminal-code's legacy app-mode launch into
`src/code-window.ts`. The wrapper retains the real preload/main scripts, bridges
`terminalBrowser` to Pixel's preload API, and gives each process a separate
Chromium profile. Sharing one profile caused blank editor windows and database
errors during testing. The optional test checks the real editor title changes
after typing, not merely that a process or graphics socket exists.

`Shell.mouse` is a small version-pinned adapter to xterm 6's internal mouse
service, because its headless API does not expose mouse reporting publicly.
`scripts/postinstall.cjs` restores the execute bit missing from node-pty 1.1.0's
packaged macOS spawn helper.

## Current tradeoffs

Frames are copied through local files and complete surfaces are composited.
Dirty-region graphics transport and zero-copy forwarding are future optimization
opportunities; no performance claim assumes they already exist. Minimized apps
receive focus loss, but arbitrary guests may continue animating internally.

App launch metadata and geometry are held in memory. The service deliberately
does not claim disk-persistent session recovery. Apps are trusted local programs;
this is a same-user desktop, not an application sandbox or multi-user server.


## Rendering polish adapter

`src/pixel-frame.ts` handles the pinned Pixel guest/readback alpha boundary.
Browser toolbar pixels arrive as straight-alpha BGRA. Uploading them directly
through the native Surface path overbrightened partially transparent edges;
one measured pixel went from RGBA (210,225,240,17) to (255,255,255,17).
Zatara now composites guest pixels onto its opaque viewport background before
upload, in the already-owned read buffer. Fully opaque pixels are untouched.
No installed Pixel files are changed. Re-evaluate this adapter on Pixel upgrades.
The real-app test compares the toolbar crop against the expected composited
pixels and records the matched origin and fraction in its report.

`contentSize` shares cell-aligned content geometry between the host and desktop.
`inspect` includes cell size and latest guest frame dimensions for diagnosis.
Taskbar layout and context hit tests share rectangles from `src/layout.ts`.
Decoration uses static gradients and borders, with no shadows or animation loop.
