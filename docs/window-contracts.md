# Window and app contracts

Zatara owns the window frame and lifecycle. Native Pixel applications supply a
React component through `runAppWindow`; they do not recreate host connections,
font loading, focus/resize subscriptions, or shutdown handlers.

```tsx
import { Box } from './pixel';
import { AppText, runAppWindow, useAppWindow } from './app-window';

function Example() {
  const { focused, viewport } = useAppWindow();
  return <Box style={{ width: '100%', height: '100%' }}>
    <AppText>{focused ? 'Active' : 'Background'} · {viewport.width}px</AppText>
  </Box>;
}

runAppWindow({ name: 'Example', appearance: 'system', component: Example });
```

`AppWindowDefinition` requires a name, component, and explicit appearance policy.
`system` loads Zatara's live appearance settings; use theme values in component
styles to honor them. `app` keeps application-specific typography/colors.
`AppText` provides the shared font. `useAppWindow()` supplies session/window IDs,
focus, content viewport, font handle, and configuration errors. Focus and resize
updates rerender the same component, preserving React state. Managers pause
polling when unfocused. Detaching only changes focus; it does not stop the root.
Closing the host connection or explicitly closing the window ends the guest.

The demo and both manager modes use this path. External Pixel guests and the
Chromium-based editor keep their own upstream root implementations; their
processes still receive the same Zatara frame and input routing.

## Registration and desktop frame

`AppDefinition` separates shell and Pixel launch metadata. A Pixel command is a
nonempty tuple, and optional `initialSize: { width, height }` selects initial
window dimensions. The service constrains those dimensions to the desktop.
There are no app-ID-specific size checks. Custom JSON registration uses the
same metadata, validated at load time; custom apps always use the Pixel kind.

`WindowFrameProps` is the desktop-side contract. It takes window state, desktop
size/focus, cell dimensions, icon/font, and typed action/pointer callbacks.
Its content callback receives the computed, cell-aligned viewport. The frame
owns title controls, drag/double-click behavior, resize edges, and clipping.
Shell and Pixel content share input event mapping in the desktop; neither draws
or manages its own outer decorations.

`WindowState` is service-owned serializable state. Keep visibility (`minimized`)
separate from the desktop's single `focused` window ID. Apps do not mutate these
fields; they request lifecycle actions through the service.

## Typed actions and IPC

`WindowAction` is a discriminated union:

```ts
{ op: 'move', rect: { x: 80, y: 60, width: 680, height: 450 } }
{ op: 'focus' } // also maximize (toggle), minimize, close
```

A move requires geometry. Other operations reject geometry at compile time.
The model reducer handles operations exhaustively; adding an operation requires
updating that reducer. `Frame` is shared by the service and desktop, including
its sequence number. It is distinct from window geometry and shell screens.

`ClientCommand`, `ServerMessage`, and `WindowInput` define protocol payloads.
`sendCommand` and `sendEvent` enforce direction; `request` infers the reply from
the command, so a task list cannot silently be treated as desktop state.
Raw JSON enters as `unknown`. The service validates command payloads before
routing them. Client-side decoding validates response envelopes; nested state
and screen content come from the trusted same-user service, not a sandboxed or
independently versioned network API. Wire assertions stay in `protocol.ts` and
the RPC response boundary; ordinary callers use typed values.

The message format remains compatible with the previous service for valid
commands. Updated native app setup and desktop frames load when their processes
next start. Existing apps and sessions are not terminated by this refactor.

## Checks

`npm run check` compiles production code and `test/types/contracts.ts`. Negative
examples use `@ts-expect-error`: compilation fails if an invalid action, missing
field, empty launch command, or wrong RPC result becomes accepted. Unused locals,
unused parameters, and switch fallthrough are compiler errors too.

`npm test` runs those compiler checks, builds, and exercises native desktop
interaction, process persistence, manager behavior, config reload, registration,
and malformed IPC. The tests use isolated services; they do not modify a running
user session. Compiler checks cannot prove mouse hit targets or runtime process
behavior, so those remain integration tests.
