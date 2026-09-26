import type { GuestMessage } from '../node_modules/@zenbu-labs/pixel/dist/host/server';
import type { TerminalColors } from './pixel';
import type { DesktopState, WindowAction } from './model';
import type { Screen } from './terminal';
import type { TaskInfo } from './tasks';

export interface Frame { path: string; width: number; height: number; seq: number }
export interface CellSize { width: number; height: number }
export type WindowInput = Extract<GuestMessage, { type: 'key' | 'paste' | 'mouse' | 'wheel' }> | { type: 'text'; text: string };
export type ActionCommand = { type: 'action'; id: string } & WindowAction;
export type ClientCommand =
  | { type: 'attach'; width: number; height: number; cell?: CellSize; colors?: TerminalColors }
  | { type: 'resize'; width: number; height: number }
  | { type: 'list' | 'inspect' | 'tasks' | 'detach' | 'kill' }
  | { type: 'switch'; session: string }
  | { type: 'launch'; app: string }
  | ActionCommand
  | { type: 'screen'; id: string }
  | { type: 'input'; id: string; event: WindowInput };
export interface Metrics { startedAt: number; frames: number; frameBytes: number; notifications: number; coalesced: number; inputEvents: number; frameAfterInputMs: number[] }
export interface StateMessage { type: 'state'; state: DesktopState }
export interface InspectMessage extends StateMessage {
  pid: number; metrics: Metrics;
  rendering: { cell: CellSize; surfaces: Record<string, Omit<Frame, 'path'>> };
}
export type ServerMessage = StateMessage | InspectMessage
  | { type: 'tasks'; tasks: TaskInfo[]; servicePid: number }
  | { type: 'frame'; id: string; frame: Frame }
  | { type: 'screen'; id: string; screen?: Screen }
  | { type: 'clipboard'; text: string }
  | { type: 'pointer'; shape: string }
  | { type: 'switch'; session: string }
  | { type: 'error'; error: string }
  | { type: 'ok' }
  | { type: 'launched'; id: string };
export type RpcCommand = Exclude<ClientCommand, { type: 'attach' | 'resize' }>;
interface RpcReplies {
  inspect: InspectMessage;
  list: InspectMessage;
  tasks: Extract<ServerMessage, { type: 'tasks' }>;
  screen: Extract<ServerMessage, { type: 'screen' }>;
  launch: Extract<ServerMessage, { type: 'launched' }>;
  action: Extract<ServerMessage, { type: 'ok' }>;
  input: Extract<ServerMessage, { type: 'ok' }>;
  switch: Extract<ServerMessage, { type: 'ok' }>;
  detach: Extract<ServerMessage, { type: 'ok' }>;
  kill: Extract<ServerMessage, { type: 'ok' }>;
}
export type Reply<C extends RpcCommand> = RpcReplies[C['type']];
export const replyTypes = {
  inspect: 'state', list: 'state', tasks: 'tasks', screen: 'screen', launch: 'launched',
  action: 'ok', input: 'ok', switch: 'ok', detach: 'ok', kill: 'ok',
} satisfies { [K in keyof RpcReplies]: RpcReplies[K]['type'] };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an IPC object');
  return value as Record<string, unknown>;
}
function string(value: unknown) { if (typeof value !== 'string') throw new Error('Expected IPC text'); }
function number(value: unknown) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite IPC number'); }
function dimensions(value: Record<string, unknown>) {
  for (const k of ['width', 'height']) { number(value[k]); if ((value[k] as number) <= 0 || (value[k] as number) > 8000) throw new Error('Invalid IPC dimensions'); }
}
function oneOf(value: unknown, options: readonly string[]) { if (typeof value !== 'string' || !options.includes(value)) throw new Error(`Invalid IPC value: ${String(value)}`); }
function input(value: unknown) {
  const e = record(value);
  switch (e.type) {
    case 'text': case 'paste': string(e.text); return;
    case 'key': string(e.key); oneOf(e.kind, ['press', 'repeat', 'release']); if (e.text !== undefined) string(e.text); break;
    case 'mouse': number(e.x); number(e.y); oneOf(e.kind, ['down', 'up', 'move', 'scrollup', 'scrolldown', 'scrollleft', 'scrollright']); oneOf(e.button, ['left', 'middle', 'right', 'none']); break;
    case 'wheel': for (const k of ['x', 'y', 'deltaX', 'deltaY']) number(e[k]); break;
    default: throw new Error('Unknown window input');
  }
  const mods = record(e.mods); for (const k of ['ctrl', 'alt', 'shift', 'super']) if (typeof mods[k] !== 'boolean') throw new Error('Invalid input modifiers');
}
/** JSON is unknown until checked. Keep wire assertions at this boundary. */
export function decodeCommand(value: unknown): ClientCommand {
  const m = record(value);
  switch (m.type) {
    case 'attach': {
      dimensions(m); if (m.cell !== undefined) dimensions(record(m.cell));
      if (m.colors === undefined) break;
      const colors = record(m.colors);
      const rgba = (v: unknown) => { if (v === null) return; if (!Array.isArray(v) || v.length !== 4 || !v.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error('Invalid terminal color'); };
      rgba(colors.foreground); rgba(colors.background);
      if (!Array.isArray(colors.palette)) throw new Error('Invalid terminal palette'); colors.palette.forEach(rgba);
      break;
    }
    case 'resize': dimensions(m); break;
    case 'list': case 'inspect': case 'tasks': case 'detach': case 'kill': break;
    case 'switch': string(m.session); break;
    case 'launch': string(m.app); break;
    case 'screen': string(m.id); break;
    case 'input': string(m.id); input(m.event); break;
    case 'action':
      string(m.id); oneOf(m.op, ['focus', 'move', 'maximize', 'minimize', 'close']);
      if (m.op === 'move') { const r = record(m.rect); for (const k of ['x', 'y', 'width', 'height']) number(r[k]); }
      else if (m.rect !== undefined) throw new Error('Only move accepts a rectangle');
      break;
    default: throw new Error('Unknown session command');
  }
  return m as ClientCommand;
}
/** The same-user service owns nested state/screens; verify the message envelope here. */
export function decodeMessage(value: unknown): ServerMessage {
  const m = record(value);
  switch (m.type) {
    case 'state': { const s = record(m.state); if (!Array.isArray(s.windows) || !Array.isArray(s.apps)) throw new Error('Invalid desktop state'); break; }
    case 'frame': { string(m.id); const f = record(m.frame); string(f.path); dimensions(f); number(f.seq); break; }
    case 'screen': string(m.id); if (m.screen !== undefined) record(m.screen); break;
    case 'tasks': if (!Array.isArray(m.tasks)) throw new Error('Invalid task list'); number(m.servicePid); break;
    case 'clipboard': string(m.text); break;
    case 'pointer': string(m.shape); break;
    case 'switch': string(m.session); break;
    case 'error': string(m.error); break;
    case 'launched': string(m.id); break;
    case 'ok': break;
    default: throw new Error('Unknown session response');
  }
  return m as ServerMessage;
}
