import type { EngineKeyEvent } from './pixel';

// Pixel 0.0.15's native events use null for keys that produce no text,
// although its TypeScript declaration only advertises string | undefined.
export type NativeKeyEvent = Omit<EngineKeyEvent, 'text'> & { text?: string | null };
export function normalizeKeyEvent({ text, ...event }: NativeKeyEvent): EngineKeyEvent {
  return text == null ? event : { ...event, text };
}
