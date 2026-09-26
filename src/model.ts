export const BAR = 44;
export const TITLE = 36;
export interface Rect { x: number; y: number; width: number; height: number }
export type WindowAction = { op: 'move'; rect: Rect } | { op: 'focus' | 'maximize' | 'minimize' | 'close'; rect?: never };
export type WindowOperation = WindowAction['op'];
interface AppMetadata { id: string; name: string; icon: string; initialSize?: Pick<Rect, 'width' | 'height'>; available?: boolean; reason?: string }
export type AppDefinition = AppMetadata & ({ kind: 'shell'; command: [] } | { kind: 'pixel'; command: [string, ...string[]] });
export interface WindowState extends Rect {
  id: string; app: string; title: string; kind: 'shell' | 'pixel'; pid: number;
  minimized: boolean; maximized: boolean; restore?: Rect; status: string;
  order?: number;
}
export interface DesktopState {
  windows: WindowState[]; focused: string | null; width: number; height: number;
  apps: AppDefinition[]; session: string; attached: boolean;
}
export function constrain(r: Rect, width: number, height: number): Rect {
  const h = Math.max(TITLE + 40, height - BAR);
  const w = Math.min(Math.max(240, r.width), Math.max(120, width));
  const rh = Math.min(Math.max(140, r.height), h);
  return { x: Math.max(0, Math.min(r.x, width - w)), y: Math.max(0, Math.min(r.y, h - rh)), width: w, height: rh };
}
export function bounds(w: WindowState, s: Pick<DesktopState, 'width' | 'height'>): Rect {
  return w.maximized ? { x: 0, y: 0, width: s.width, height: Math.max(TITLE + 40, s.height - BAR) } : w;
}
export function focus(s: DesktopState, id: string) {
  const w = s.windows.find(w => w.id === id);
  if (!w) return;
  w.minimized = false;
  s.windows = [...s.windows.filter(w => w.id !== id), w];
  s.focused = id;
}
export function action(s: DesktopState, id: string, command: WindowAction) {
  const { op, rect } = command;
  const w = s.windows.find(w => w.id === id);
  if (!w) return;
  switch (op) {
    case 'focus': focus(s, id); return;
    case 'move':
      if (!w.maximized && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) Object.assign(w, constrain(rect, s.width, s.height));
      return;
    case 'maximize':
      if (w.maximized) { Object.assign(w, constrain(w.restore ?? w, s.width, s.height)); w.maximized = false; }
      else { w.restore = { x: w.x, y: w.y, width: w.width, height: w.height }; w.maximized = true; }
      focus(s, id); return;
    case 'minimize': w.minimized = true; break;
    case 'close': s.windows = s.windows.filter(w => w.id !== id); break;
    default: { const exhaustive: never = op; throw new Error(`Unknown window action: ${exhaustive}`); }
  }
  if (s.focused === id) s.focused = [...s.windows].reverse().find(w => !w.minimized)?.id ?? null;
}

/** Pixel guests and shells share a cell-aligned viewport; decoration is outside it. */
export function contentSize(r: Rect, cell: { width: number; height: number }) {
  return { width: Math.max(cell.width, Math.floor((r.width - 4) / cell.width) * cell.width), height: Math.max(cell.height, Math.floor((r.height - TITLE - 4) / cell.height) * cell.height) };
}
