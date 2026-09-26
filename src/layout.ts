import { appearance } from './config';
import { BAR, Rect } from './model';
export const TASK_START = 104, TASK_WIDTH = 140, TASK_GAP = 6;
/** Rendering and hit testing use the same geometry, including reserved controls. */
export function taskLayout(width: number, height: number, count: number) {
  const scale = Math.max(1, appearance.ui.fontSize / 13), itemWidth = Math.ceil(TASK_WIDTH * scale);
  const compact = width < 330 * scale, launcherWidth = Math.ceil(80 * scale), detachWidth = Math.ceil(90 * scale);
  const start = compact ? Math.min(72, Math.floor(width / 3)) : launcherWidth + 24;
  const reserve = compact ? 50 : detachWidth + 20, overflowWidth = compact ? Math.min(44, Math.max(24, width - start - 42)) : Math.ceil(56 * scale);
  const available = Math.max(0, width - start - reserve);
  const allFit = count * (itemWidth + TASK_GAP) <= available;
  const capacity = Math.max(0, Math.floor((available - (allFit ? 0 : overflowWidth + TASK_GAP)) / (itemWidth + TASK_GAP)));
  const visible = Math.min(count, capacity);
  return {
    entries: Array.from({ length: visible }, (_, i): Rect => ({ x: start + i * (itemWidth + TASK_GAP), y: height - BAR + 5, width: itemWidth, height: 34 })),
    overflow: visible < count ? { x: start + visible * (itemWidth + TASK_GAP), y: height - BAR + 5, width: overflowWidth, height: 34 } : undefined,
    visible, compact,
    launcher: { x: compact ? 6 : 12, width: compact ? start - 12 : launcherWidth },
    detach: { x: width - (compact ? 40 : detachWidth + 10), width: compact ? 32 : detachWidth },
  };
}
export function contains(r: Rect, x: number, y: number) { return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height; }
export function menuRect(x: number, y: number, width: number, height: number, rows: number): Rect {
  const w = Math.min(248, width), h = Math.min(rows * 36 + 12, Math.max(36, height - BAR - 8));
  return { x: Math.max(0, Math.min(x, width - w)), y: Math.max(0, Math.min(y, height - BAR - h)), width: w, height: h };
}
