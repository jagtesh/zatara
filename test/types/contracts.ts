// Compiled by npm run check; never executed. An unused @ts-expect-error fails CI.
import { action, DesktopState, AppDefinition } from '../../src/model';
import { ClientCommand, ServerMessage } from '../../src/protocol';
import { request, sendCommand, sendEvent } from '../../src/ipc';
import { AppWindowDefinition, AppWindowContext } from '../../src/app-window';
import { WindowFrameProps } from '../../src/window-frame';
declare const state: DesktopState;
declare function command(value: ClientCommand): void;
declare function event(value: ServerMessage): void;
declare function app(value: AppDefinition): void;
declare function native(value: AppWindowDefinition): void;
declare const context: AppWindowContext;
declare function frame(value: WindowFrameProps): void;
command({ type: 'action', id: 'a', op: 'move', rect: { x: 0, y: 0, width: 400, height: 300 } });
action(state, 'a', { op: 'focus' });
// @ts-expect-error move must carry a rectangle
command({ type: 'action', id: 'a', op: 'move' });
// @ts-expect-error typo in operation
command({ type: 'action', id: 'a', op: 'maximise' });
// @ts-expect-error lifecycle actions cannot accidentally carry geometry
action(state, 'a', { op: 'close', rect: { x: 0, y: 0, width: 400, height: 300 } });
// @ts-expect-error messages have required fields
command({ type: 'input', id: 'a' });
// @ts-expect-error resize is a host event, not app keyboard/pointer input
command({ type: 'input', id: 'a', event: { type: 'size', width: 400, height: 300, cols: 50, rows: 16 } });
// @ts-expect-error frame notifications require a sequence number
event({ type: 'frame', id: 'a', frame: { path: '/frame', width: 400, height: 300 } });
// @ts-expect-error a Pixel app must provide a nonempty launch command
app({ id: 'demo', name: 'Demo', icon: 'D', kind: 'pixel', command: [] });
// @ts-expect-error native apps explicitly choose whether system appearance applies
native({ name: 'Demo', component: () => null });
// @ts-expect-error a viewport is not a boolean focus state
const focused: boolean = context.viewport;
// @ts-expect-error a frame requires typed actions, geometry, focus source and content
frame({ window: state.windows[0] });
void request('main', { type: 'tasks' }).then(reply => {
  reply.tasks[0]?.cpuPercent?.toFixed(1);
  // @ts-expect-error typed RPC replies cannot be mistaken for desktop snapshots
  return reply.state;
});
// @ts-expect-error IPC commands do not accept arbitrary routes
void request('main', { type: 'do-something' });

// @ts-expect-error server snapshots cannot travel through the command sender
sendCommand(null, { type: 'state', state });
// @ts-expect-error window actions cannot travel through the event sender
sendEvent(null, { type: 'action', id: 'a', op: 'focus' });
