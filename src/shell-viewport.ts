import type { Screen } from './terminal';

/** A resize can reach the desktop before the PTY's next snapshot. Older
 * services also use different decoration sizes. Keep the cursor in view
 * without changing xterm's cell metrics or drawing beyond the content area. */
export function shellViewport(screen: Screen | undefined, height: number, cellHeight: number) {
  const count = Math.max(0, Math.floor(height / cellHeight + 1e-8));
  const overflow = Math.max(0, (screen?.rows.length ?? 0) - count);
  const first = Math.min(overflow, Math.max(0, (screen?.cursor.y ?? -1) - count + 1));
  return { first, count, offsetY: first * cellHeight };
}

/** Pointer coordinates must address the same xterm row that is on screen. */
export function terminalPoint<E extends { y: number }>(event: E, offsetY: number): E {
  return { ...event, y: event.y + offsetY };
}
