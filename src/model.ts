export const BAR = 58;
export const TITLE = 36;
export interface Rect { x: number; y: number; width: number; height: number }
export interface AppDefinition { id: string; name: string; icon: string; command: string[]; kind: 'shell' | 'pixel'; available?: boolean; reason?: string }
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
export function action(s: DesktopState, id: string, op: string, rect?: Rect) {
  const w = s.windows.find(w => w.id === id);
  if (!w) return;
  if (op === 'focus') focus(s, id);
  if (op === 'move' && rect && !w.maximized && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) Object.assign(w, constrain(rect, s.width, s.height));
  if (op === 'maximize') {
    if (w.maximized) { Object.assign(w, constrain(w.restore ?? w, s.width, s.height)); w.maximized = false; }
    else { w.restore = { x: w.x, y: w.y, width: w.width, height: w.height }; w.maximized = true; }
    focus(s, id);
  }
  if (op === 'minimize') { w.minimized = true; if (s.focused === id) s.focused = [...s.windows].reverse().find(w => !w.minimized)?.id ?? null; }
  if (op === 'close') { s.windows = s.windows.filter(w => w.id !== id); if (s.focused === id) s.focused = [...s.windows].reverse().find(w => !w.minimized)?.id ?? null; }
}
