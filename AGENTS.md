# Zatara: working preferences and project boundaries

These instructions summarize Jagtesh Chadha's preferences stated in this
project's conversation. Distinguish established requirements from proposed
future work; do not describe a plan as an implemented capability.

## Code quality and architecture

- Standardize interfaces across the codebase. Use TypeScript types and
  interfaces to catch invalid states, missing fields, and inconsistent behavior
  at compile time wherever practical.
- Reduce repetitive boilerplate by putting shared behavior behind reusable
  components and explicit contracts. Window creation, app hosting, frames,
  focus, geometry, input routing, and lifecycle should follow common patterns.
- Window lifecycle belongs to Zatara. Apps should not reimplement desktop
  decorations, dragging, resizing, minimize/maximize, or process management.
- Text editing and selection belong to shared Pixel controls/framework code.
  Backspace, Shift+Arrow selection, copy, and replacement should not need
  separate implementations in every app.
- Validate external/runtime data at boundaries as well as typing it. Native
  events and IPC can differ from library declarations; investigate those
  mismatches rather than weakening validation throughout the application.
- Keep necessary changes to pinned Pixel hosting internals in a small,
  documented adapter or patch. Pin dependency versions/revisions.
- Keep visibility separate from keyboard focus: overlapping apps can remain
  visible, but only the focused app receives keyboard input.
- A package boundary and a process boundary are different decisions. Built-in
  apps currently share the desktop npm package while running independently.
  Separate app/SDK packages have not been requested as an immediate migration.

## Debugging and validation

- Find the cause of a failure; do not simply remove the mechanism exposing it.
  In particular, do not strip `HERDR_ENV` to bypass Herdr's nesting protection.
  Trace why it was inherited, including persistent service ancestry and the
  npm launch environment.
- Verify the complete interaction, not only compilation or process startup.
  For example, test that selection identifies the correct substring and that
  editing replaces exactly that selection.
- Use real independent processes and real apps for acceptance. Do not replace
  an incompatible browser/editor integration with a mock and call it working.
- Treat screenshots as evidence for visual review and polish. Check DPI/scale,
  readable sizing, correct state icons, cursor alignment, and viewport clipping.
- State verification boundaries honestly: native-harness results are not live
  Ghostty, SSH, Linux, or physical-display latency results.
- Preserve user sessions during development. Distinguish an old persistent
  service from newly built code; rebuilding or reattaching does not hot-upgrade
  every running process. Explain compatibility workarounds and their limits.

## Product and visual priorities

- Beautiful, responsive, robust, and mouse-first. Terminal performance and
  memory constraints matter, but should not automatically sacrifice visual
  quality.
- This is a desktop: floating overlapping windows, desktop icons, and a bottom
  taskbar are fundamental, not incidental styling around tiled terminals.
- Use a polished dark theme, restrained gradients, rounded corners, clear focus
  states, readable typography, and generous mouse targets. Shadows were
  explicitly set aside; do not spend effort on them unless requested again.
- Appearance must be configurable. Keep UI font size, desktop icon size, and
  desktop icon label size independently adjustable.
- Desktop icons launch on double-click; taskbar entries and controls use
  single-click. Support title-bar dragging, edge resizing, title-bar
  double-click maximize/restore, and contextual window actions.
- Minimize preserves the application process. Close ends that window's app.
  Detach preserves the whole session. Keep windows reachable after resizing.
- Session management and task management should be usable as apps. Explicit
  session termination must also be available through the CLI.

## Scope and persistence

- GUI applications are **Pixel-only**. Compatibility with arbitrary non-Pixel
  GUI apps is an explicit non-goal. Do not add X11/Wayland application hosting
  or generic GUI compatibility as an unsolicited roadmap item.
- Shell windows remain supported, each with its own PTY and an established
  terminal parser, including scrollback, resize, alternate screen, keyboard,
  paste, and terminal mouse reporting.
- The persistent session service owns application/shell processes, geometry,
  and guest connections. A terminal/display attachment must not own their
  lifetime. Default to one active attachment per session.
- Reconnection must preserve app state, shell state, and process IDs, including
  after abrupt attachment loss. Persistence does not promise recovery from
  machine reboot or service crashes.
- Keep guest connections alive without an attachment. Bound output/frame
  queues, acknowledge discarded frames, coalesce obsolete work, and repaint on
  changes. Sustained shell output must not freeze interaction or grow memory
  without bound.
- Ghostty/macOS is the original acceptance target. Direct SSH is the first
  remote path, with execution/rendering remote and graphics sent to the client.
- Linux support is desired. A direct Linux display backend has been planned,
  not implemented. Plain text terminals, Apple Terminal, and Proxmox serial or
  container consoles must not be described as supporting the graphical desktop.

## Experiments and performance

- Do not pretend the architecture is settled without evidence. The user is
  open to multiple prototypes following different conventions: let measured
  results guide the choice. The current agreed starting point is one working
  Pixel desktop, with later experiments informed by it.
- Measure idle CPU, process-tree memory, frame timing, input-to-frame latency,
  and transmitted bytes across idle, dragging, shell output, and web scrolling.
- Record host, viewport, versions, and method. Distinguish frame submission or
  compositor receipt from actual display latency. Do not declare an
  architectural winner before comparing implementations.

## Repository, release, and communication

- When asked to implement, carry the work through to a usable, verified result;
  when asked for a plan, keep planned capabilities distinct from shipped ones.
- When asked to commit everything or publish, include the relevant project
  work, validate it, and report actual commit/push/publication status. Do not
  claim success based solely on an upload attempt or an authentication prompt.
- Include attractive, genuine screenshots in project presentation. Label
  harness captures accurately; do not present them as live terminal captures.
- GitHub is intended to be public. The npm package is
  `@zatara-dev/desktop`; its CLI command is `zatara`.
- License: **BSD-3-Clause**. Copyright holder: **Jagtesh Chadha**. Preserve
  third-party dependency licenses separately.
- Keep explanations concrete: what changed, why, what was tested, and what
  remains incomplete or unverified.
