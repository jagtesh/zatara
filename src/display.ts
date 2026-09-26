import type { Style } from '../node_modules/@zenbu-labs/pixel/dist/react';
import type { Rect, DesktopState } from './model';
import type { ClientCommand } from './protocol';

/** UI units follow terminal text size, including Retina pixels and terminal zoom. */
export function terminalScale(cellHeight: number) { return Number.isFinite(cellHeight) && cellHeight > 0 ? cellHeight / 18 : 1; }
export function scaleRect(r: Rect, scale: number): Rect { return { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale }; }
export function logicalState(state: DesktopState, scale: number): DesktopState {
  return { ...state, scale: 1, width: state.width / scale, height: state.height / scale,
    windows: state.windows.map(w => ({ ...w, ...scaleRect(w, 1 / scale), restore: w.restore && scaleRect(w.restore, 1 / scale) })) };
}
export function physicalCommand(m: ClientCommand, scale: number): ClientCommand {
  switch (m.type) {
    case 'attach': case 'resize': return { ...m, width: Math.round(m.width * scale), height: Math.round(m.height * scale), cell: m.cell && { width: m.cell.width * scale, height: m.cell.height * scale } };
    case 'action': return m.op === 'move' ? { ...m, rect: scaleRect(m.rect, scale) } : m;
    case 'input': {
      const e = m.event;
      if (e.type === 'mouse') return { ...m, event: { ...e, x: e.x * scale, y: e.y * scale } };
      if (e.type === 'wheel') return { ...m, event: { ...e, x: e.x * scale, y: e.y * scale, deltaX: e.deltaX * scale, deltaY: e.deltaY * scale } };
      return m;
    }
    default: return m;
  }
}
/** Scale lengths only: colors, font IDs, percentages and flex factors are not lengths. */
export function physicalStyle(style: Style | undefined, scale: number): Style | undefined {
  if (!style || scale === 1) return style;
  const out = { ...style };
  for (const key of ['width', 'height', 'minWidth', 'maxWidth', 'maxHeight', 'flexBasis', 'gap', 'fontSize'] as const) {
    const value = style[key]; if (typeof value === 'number') Object.assign(out, { [key]: value * scale });
  }
  for (const key of ['padding', 'margin', 'inset', 'cornerRadius'] as const) {
    const value = style[key];
    if (typeof value === 'number') Object.assign(out, { [key]: value * scale });
    else if (value) Object.assign(out, { [key]: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'number' ? v * scale : v])) });
  }
  if (style.border) out.border = 'width' in style.border ? { ...style.border, width: style.border.width * scale } : Object.fromEntries(Object.entries(style.border).map(([k, v]) => [k, [v[0] * scale, v[1]]]));
  if (style.scrollbar) {
    out.scrollbar = { ...style.scrollbar };
    for (const key of ['width', 'hoverWidth', 'margin', 'minThumb'] as const) if (typeof style.scrollbar[key] === 'number') out.scrollbar[key] = style.scrollbar[key]! * scale;
  }
  return out;
}
