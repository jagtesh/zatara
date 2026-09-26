import fs from 'node:fs';
import React, { createContext, useContext } from 'react';
import { createRoot, PixelRoot, Text, TextProps } from './pixel';
import { watchConfig } from './config';
import { applyAppearance } from './theme';

/** A guest owns content; Zatara owns decorations, geometry and process lifetime. */
export interface AppWindowDefinition {
  name: string;
  title?: string;
  appearance: 'system' | 'app';
  component: React.ComponentType;
}
export interface AppWindowContext {
  session: string;
  id: string;
  focused: boolean;
  viewport: { width: number; height: number };
  font: number;
  configError: string;
}
const WindowContext = createContext<AppWindowContext | null>(null);
export function useAppWindow(): AppWindowContext {
  const context = useContext(WindowContext);
  if (!context) throw new Error('useAppWindow must run inside runAppWindow');
  return context;
}
export function AppText(props: TextProps) {
  const { font } = useAppWindow();
  return <Text {...props} style={{ font, ...props.style }} />;
}
/** One native root, shared font setup, focus/resize updates and shutdown path. */
export function runAppWindow(definition: AppWindowDefinition) {
  const socket = process.env.ZATARA_HOST, id = process.env.ZATARA_PANE, session = process.env.ZATARA_SESSION;
  if (!socket || !id || !session) throw new Error('Launch this app through Zatara: missing window host, pane or session');
  let root: PixelRoot | undefined, focused = false, font = 0, configError = '', stopped = false;
  let stopConfig = () => {};
  const Component = definition.component;
  function render() {
    if (!root || stopped) return;
    const context: AppWindowContext = { session: session!, id: id!, focused, viewport: { width: root.info.width, height: root.info.height }, font, configError };
    root.render(<WindowContext.Provider value={context}><Component /></WindowContext.Provider>);
  }
  function stop() {
    if (stopped) return;
    stopped = true; stopConfig();
    process.off('SIGTERM', finish); process.off('SIGINT', finish);
    root?.stop();
  }
  function finish() { stop(); process.exit(0); }
  root = createRoot({ host: { socket, pane: id, name: definition.name }, devtools: false,
    onFocus(value) { focused = value; render(); }, onResize: render, onHostClosed: finish,
    onEngineExit(error) { if (stopped) return; if (error) console.error(error); stop(); process.exit(error ? 1 : 0); },
  });
  root.setTitle(definition.title ?? definition.name);
  if (definition.appearance === 'system') stopConfig = watchConfig(next => { applyAppearance(next); render(); }, error => { if (error !== configError) { configError = error; render(); } });
  render();
  const systemFont = '/System/Library/Fonts/SFNS.ttf';
  if (fs.existsSync(systemFont)) void root.registerFont(systemFont).then(value => { font = value; render(); }).catch(error => console.error('Could not load UI font:', error));
  process.on('SIGTERM', finish); process.on('SIGINT', finish);
  return { stop };
}
