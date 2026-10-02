# Display scale and terminal cell alignment

The session's reported 16×34 terminal cells exposed two independent problems:
fixed 13px desktop labels stayed tiny in a 2432×1326 framebuffer, and terminal
rows used the renderer's font advances while the cursor used xterm columns.
Those advances need not match the terminal cell width.

`pixel.ts` now adapts UI lengths and pointer coordinates between logical units
and physical pixels. Scale is terminal cell height / 18 (about 1.89 at 34px).
This follows terminal text sizing rather than querying the local monitor, which
would be wrong over SSH. It is not a measurement of physical monitor DPI.
Colors, font IDs, flex factors and percentages are unchanged. Input caret and
scroll coordinates are converted too. Native surface buffers stay physical;
there is no lower-resolution desktop bitmap being enlarged.

`display.ts` handles the session boundary. The service owns physical window
rectangles and scaled decoration dimensions. The desktop consumes logical
rectangles and emits physical commands. New windows, maximize, constrain,
restore, and cell-aligned guest sizes use the same scale. Built-in app roots
use the adapter; upstream browser/editor rendering remains unchanged.

On a native resize, pinned Pixel 0.0.15 updates `basePx` but not its exposed cell
fields. The adapter follows that font-size ratio for subsequent cell metrics.
This assumes a stable cell aspect ratio within an attachment. Live font zoom,
monitor changes, and authenticated SSH graphics remain unverified on Ghostty;
reattaching obtains fresh cell metrics.

`ShellViewport` positions glyphs at xterm's exact columns. Wide glyphs occupy
two cells and combining characters stay with their base character. Unchanged
rows are memoized and blank default cells create no text nodes. Backgrounds
fill cells rather than the font's narrower advance. This costs more nodes than
one text node per row; it prevents font shaping from moving the visual insertion
point away from the actual cursor and mouse-reporting grid.

When a snapshot has more rows than the content area can show, the shell view
keeps the cursor's row visible and translates pointer/wheel coordinates back
to the corresponding xterm row. Only complete visible rows are drawn. This
handles resize-in-flight snapshots and older persistent services that still
budget unscaled title bars. Detach and reattach to load this attachment fix;
shell processes and state survive. This is a compatibility viewport, not a
hot upgrade of the service: an older service can still report more PTY rows
than are visible, so full-screen TUIs need a fresh session for exact sizing.

## Validation

At viewport-fix revision `e94d1d3` (2026-09-26), `npm test` passed 22 runtime
tests plus compiler contract checks. This records that revision, not the
current suite count. Native
readback tests use real 16×34 cells, not merely `PIXEL_DISPLAY_SCALE=2` (that
variable controls upstream web rendering, not the native UI). Coverage includes
scaled guest input, dragging, maximize/restore, geometry, and reconnect PID
survival. A 60-character line has exactly 16px between every glyph; the cursor
immediately follows. The same shell checks wide and combining character cells.
The existing 8×18 tests and sustained 50,000-line output test also pass.
Short-window tests read back cursor pixels at 16×34 cell size, with both current
geometry and a simulated legacy service decoration budget. Pointer translation,
scrollback, and a TUI cursor at the top of the buffer have unit coverage.

This verifies the native harness. A live Ghostty visual confirmation is still
needed. Start a fresh session so the updated service and guests are loaded:

```sh
npm start -- attach dpi-test
```

Existing sessions are preserved and keep their old service code. Reattaching
alone cannot upgrade their geometry calculations. No shell environment variables
are removed or changed by this fix.

## Dense-output cost

2026-09-26, macOS arm64 Darwin 27.2.0, Node 22.23.2, Pixel 0.0.15.
Viewport 2432×1326, cells 16×34. A real PTY updates 70 columns × 20 rows
(1,400 glyphs) per input, with 20 updates and a 70ms pause after each received
frame. Echo is disabled. Both variants use the same display-scaling code; the
baseline fixture recreates the previous row renderer with its alignment bug.

| Renderer | Median input-to-frame | Maximum | Desktop RSS |
| --- | ---: | ---: | ---: |
| Previous row layout | 46.1 ms | 50.4 ms | 208.2 MiB |
| Exact cell grid | 53.8 ms | 68.9 ms | 238.1 MiB |

Timing runs from issuing the input RPC until the first compositor frame arrives
at the harness. It includes IPC, PTY parsing, rendering and framebuffer copying;
it is **not physical display latency**. RSS is the desktop process alone,
measured once after the sample; it is not a process-tree memory sum or a leak
measurement. These short samples show the tradeoff for dense repainting, not a
universal benchmark. The grid remains bounded by the visible viewport; it does
not render scrollback as UI nodes.

Reproduce after `npm run build`:

```sh
npx tsx scripts/bench-shell-grid.ts
npx tsx scripts/bench-shell-grid.ts --legacy
```

Raw samples: [cell grid](display-grid-measurement.json),
[row baseline](display-row-measurement.json). The legacy build lives only in
ignored `.artifacts/grid-baseline`; it does not replace the production build.
