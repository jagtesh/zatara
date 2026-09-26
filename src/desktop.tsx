import React, { useEffect, useRef, useState } from 'react';
import fs from 'node:fs';
import net from 'node:net';
import { Box, Text as PixelText, TextProps, createRoot, PixelRoot, Surface, PointerEvent, DragEvent, TextSpan } from './pixel';
import { DesktopState, WindowState, Rect, bounds, constrain, BAR, TITLE, action as reduce } from './model';
import { Desktop as DesktopFrame, AppWindow as WindowFrame, TitleBar as HeaderFrame, Taskbar as BarFrame, DesktopIcon as IconFrame } from './primitives';
import { Screen } from './terminal';
import { lines, send, sessionPath } from './ipc';
const T = { bg: '#0c1220', panel: '#172236', border: '#2c3b55', text: '#e7eeff', muted: '#8c9dbb', accent: '#a78bfa', mint: '#6ee7c5' };
let uiFont = 0;
function Text(props: TextProps) { return <PixelText {...props} style={{ font: uiFont, ...props.style }} />; }
type Frame = { path: string; width: number; height: number; seq: number };
type Menu = { x: number; y: number; id?: string };
export function attach(name: string) {
  const socket = net.connect(sessionPath(name));
  let root: PixelRoot, update = () => {}, state: DesktopState | null = null, error = '', closed = false;
  const screens = new Map<string, Screen>(), frames = new Map<string, Frame>(), surfaces = new Map<string, Surface>();
  let menu: Menu | null = null;
  const command = (m: unknown) => send(socket, m);
  const act = (id: string, op: string, rect?: Rect) => {
    if (state) reduce(state, id, op, rect);
    command({ type: 'action', id, op, rect }); update();
  };
  const launch = (app: string) => { menu = null; command({ type: 'launch', app }); update(); };
  function finish(code = 0) {
    if (closed) return; closed = true;
    socket.destroy(); root?.stop(); process.exit(code);
  }
  function context(x: number, y: number, id?: string) {
    menu = { x: Math.max(0, Math.min(x, root.info.width - 216)), y: Math.max(0, Math.min(y, root.info.height - BAR - 200)), id }; update();
  }
  function present(id: string, f: Frame) {
    const surface = surfaces.get(id);
    if (!surface) return;
    try { const bgra = fs.readFileSync(f.path); if (bgra.length === f.width * f.height * 4) surface.present({ bgra, width: f.width, height: f.height }); } catch {}
  }
  socket.on('connect', () => {
    root = createRoot({
      ...(process.env.ZATARA_TEST_HOST ? { host: { socket: process.env.ZATARA_TEST_HOST, pane: 'desktop', name: 'Zatara' } } : { tty: process.env.ZATARA_TTY }),
      devtools: false, keyEventTypes: true,
      onKey(e) {
        if (e.mods.ctrl && e.mods.alt && e.key.toLowerCase() === 'd' && e.kind === 'press') { finish(); return; }
        if (e.key.toLowerCase() === 'escape' && menu) { menu = null; update(); return; }
        if (state?.focused && !menu) command({ type: 'input', id: state.focused, event: { type: 'key', ...e } });
      },
      onPaste(text) { if (state?.focused) command({ type: 'input', id: state.focused, event: { type: 'paste', text } }); },
      onRightClick({ x, y }) {
        const w = state && [...state.windows].reverse().find(w => { const r = bounds(w, state!); return !w.minimized && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + TITLE; });
        const task = y >= root.info.height - BAR && x >= 138 ? state && [...state.windows].sort((a,b) => (a.order ?? 0) - (b.order ?? 0))[Math.floor((x - 104) / 146)] : undefined;
        context(x, y, w?.id ?? task?.id);
      },
      onResize(size) { command({ type: 'resize', ...size }); update(); },
      onEngineExit(e) { if (e) process.stderr.write(e + '\n'); finish(e ? 1 : 0); },
      onHostClosed: () => finish(),
    });
    command({ type: 'attach', width: root.info.width, height: root.info.height, cell: { width: root.info.cellWidth, height: root.info.cellHeight }, colors: root.info.colors });
    root.setTitle(`Zatara · ${name}`);
    root.render(<Desktop />);
    if (fs.existsSync('/System/Library/Fonts/SFNS.ttf')) void root.registerFont('/System/Library/Fonts/SFNS.ttf').then(font => { uiFont = font; update(); });
  });
  socket.on('error', e => { process.stderr.write(e.message + '\n'); finish(1); });
  socket.on('close', () => finish());
  lines(socket, m => {
    if (m.type === 'state') {
      state = m.state;
      for (const [id, surface] of surfaces) if (!state!.windows.some(w => w.id === id)) { surface.close(); surfaces.delete(id); screens.delete(id); frames.delete(id); }
    }
    if (m.type === 'screen') screens.set(m.id, m.screen);
    if (m.type === 'frame') { frames.set(m.id, m.frame); present(m.id, m.frame); return; }
    if (m.type === 'error') error = m.error;
    if (m.type === 'clipboard') root?.setClipboard(m.text);
    if (m.type === 'pointer') root?.setPointerShape(m.shape);
    update();
  });
  process.on('SIGTERM', () => finish()); process.on('SIGHUP', () => finish());
  process.on('SIGWINCH', () => root?.nudgeResize());

  function Button({ label, onClick, accent = false }: { label: string; onClick(): void; accent?: boolean }) {
    return <Box onClick={onClick} style={{ padding: { left: 12, right: 12, top: 8, bottom: 8 }, cornerRadius: 6, background: accent ? '#352b54' : undefined, hoverBackground: '#35445e', alignItems: 'center' }}><Text style={{ fontSize: 13, color: accent ? '#d5c4ff' : T.text, selectable: false }}>{label}</Text></Box>;
  }
  function DesktopIcon({ app, index }: { app: DesktopState['apps'][number]; index: number }) {
    return <IconFrame name={app.name} icon={app.icon} available={!!app.available} index={index} font={uiFont} onLaunch={() => launch(app.id)} />;
  }

  function TitleBar({ w, r }: { w: WindowState; r: Rect }) {
    const drag = useRef<{ x: number; y: number; r: Rect } | null>(null), last = useRef(0);
    const focused = state?.focused === w.id;
    return <HeaderFrame focused={!!focused}>
      <Box style={{ flexGrow: 1, height: TITLE, alignItems: 'center', padding: { left: 13 }, gap: 8 }}
        onDrag={e => {
          if (process.env.ZATARA_TRACE) console.error('drag', w.id, e);
          if (e.phase === 'start') { drag.current = { x: e.x, y: e.y, r: { ...r } }; menu = null; act(w.id, 'focus'); }
          const d = drag.current;
          if (d && !w.maximized && e.phase !== 'start') act(w.id, 'move', { ...d.r, x: d.r.x + e.x - d.x, y: d.r.y + e.y - d.y });
          if (e.phase === 'end') {
            if (d && Math.abs(e.x - d.x) + Math.abs(e.y - d.y) < 4) { const now = Date.now(); if (now - last.current < 350) { act(w.id, 'maximize'); last.current = 0; } else last.current = now; } else last.current = 0;
            drag.current = null;
          }
        }}>
        <Text style={{ font: 0, fontSize: 12, color: focused ? T.accent : T.muted, selectable: false }}>{state?.apps.find(a => a.id === w.app)?.icon ?? '◈'}</Text>
        <Text style={{ fontSize: 12, color: focused ? T.text : T.muted, ellipsis: true, wrap: false, selectable: false }}>{w.title}</Text>
      </Box>
      <Button label="−" onClick={() => act(w.id, 'minimize')} />
      <Button label={w.maximized ? '❐' : '□'} onClick={() => act(w.id, 'maximize')} />
      <Button label="×" onClick={() => act(w.id, 'close')} />
    </HeaderFrame>;
  }
  function ShellView({ w, width, height }: { w: WindowState; width: number; height: number }) {
    const screen = screens.get(w.id), cw = root.info.cellWidth, ch = root.info.cellHeight;
    return <Box style={{ width, height, background: '#111827', overflow: 'hidden', flexDirection: 'column' }} onPointer={e => forward(w, e)} onMouseMove={e => command({ type: 'input', id: w.id, event: { type: 'mouse', kind: 'move', button: 'none', mods: { ctrl: false, alt: false, shift: false, super: false }, ...e } })} onWheel={e => command({ type: 'input', id: w.id, event: { type: 'wheel', ...e } })}>
      {screen?.rows.map((cells, y) => {
        let text = '', spans: TextSpan[] = [], byte = 0;
        for (const c of cells) {
          if (!c.text) continue;
          const n = Buffer.byteLength(c.text); spans.push({ start: byte, end: byte + n, color: c.fg, background: c.bg, bold: c.bold, italic: c.italic, underline: c.underline }); text += c.text; byte += n;
        }
        return <Text key={y} spans={spans} style={{ position: 'absolute', inset: { left: 0, top: y * ch }, height: ch, width, font: 0, fontSize: root.info.basePx, color: '#c0caf5', wrap: false, selectable: false }}>{text}</Text>;
      })}
      {screen && state?.focused === w.id && screen.cursor.y >= 0 && <Box style={{ position: 'absolute', inset: { left: screen.cursor.x * cw, top: screen.cursor.y * ch }, width: cw, height: ch, background: '#a78bfa55', border: { bottom: [2, '#c4b5fd'] } }} />}
    </Box>;
  }
  function forward(w: WindowState, e: PointerEvent) {
    if (e.kind === 'down') { menu = null; act(w.id, 'focus'); }
    command({ type: 'input', id: w.id, event: { type: 'mouse', ...e } });
  }
  function GuestView({ w, width, height }: { w: WindowState; width: number; height: number }) {
    const [surface] = useState(() => { const s = root.createSurface(); surfaces.set(w.id, s); return s; });
    useEffect(() => { const f = frames.get(w.id); if (f) present(w.id, f); return () => { surface.close(); surfaces.delete(w.id); }; }, []);
    return <Box surface={surface} style={{ width, height, background: '#131c2d' }} onPointer={e => forward(w, e)} onMouseMove={e => command({ type: 'input', id: w.id, event: { type: 'mouse', kind: 'move', button: 'none', mods: { ctrl: false, alt: false, shift: false, super: false }, ...e } })} onWheel={e => command({ type: 'input', id: w.id, event: { type: 'wheel', ...e } })} />;
  }
  function ResizeHandle({ w, r, edge }: { w: WindowState; r: Rect; edge: string }) {
    const start = useRef<{ x: number; y: number; r: Rect } | null>(null);
    const right = edge.includes('e'), bottom = edge.includes('s'), left = edge.includes('w'), top = edge.includes('n');
    const horizontal = edge === 'n' || edge === 's', vertical = edge === 'e' || edge === 'w';
    return <Box style={{ position: 'absolute', inset: { left: right ? r.width - 7 : 0, top: bottom ? r.height - 7 : 0 }, width: horizontal ? r.width - 7 : 7, height: vertical ? r.height - 7 : 7 }} onMouseEnter={() => root.setPointerShape(horizontal ? 'ns-resize' : vertical ? 'ew-resize' : 'nwse-resize')} onMouseLeave={() => root.setPointerShape('default')} onDrag={(e: DragEvent) => {
      if (e.phase === 'start') { start.current = { x: e.x, y: e.y, r: { ...r } }; act(w.id, 'focus'); }
      const d = start.current;
      if (d && e.phase !== 'start') { const dx = e.x - d.x, dy = e.y - d.y; act(w.id, 'move', { x: d.r.x + (left ? dx : 0), y: d.r.y + (top ? dy : 0), width: d.r.width + (right ? dx : left ? -dx : 0), height: d.r.height + (bottom ? dy : top ? -dy : 0) }); }
      if (e.phase === 'end') start.current = null;
    }} />;
  }
  function AppWindow({ w }: { w: WindowState }) {
    const r = bounds(w, state!), cw = Math.floor((r.width - 4) / root.info.cellWidth) * root.info.cellWidth, ch = Math.floor((r.height - TITLE - 4) / root.info.cellHeight) * root.info.cellHeight;
    return <WindowFrame rect={r} focused={state?.focused === w.id} minimized={w.minimized} maximized={w.maximized}>
      <TitleBar w={w} r={r} />
      <Box style={{ margin: { left: 2, top: 1 }, width: cw, height: ch, overflow: 'hidden' }}>
        {w.kind === 'shell' ? <ShellView w={w} width={cw} height={ch} /> : <GuestView w={w} width={cw} height={ch} />}
        {w.status !== 'Running' && <Box style={{ position: 'absolute', inset: { top: 0, left: 0 }, width: cw, padding: 14, background: '#25314b' }}><Text style={{ fontSize: 12, color: T.text, wrap: true }}>{w.status}</Text></Box>}
      </Box>
      {!w.maximized && ['n','s','e','w','se','sw','ne','nw'].map(edge => <ResizeHandle key={edge} w={w} r={r} edge={edge} />)}
    </WindowFrame>;
  }
  function Taskbar() {
    return <BarFrame>
      <Button label="Zatara" accent onClick={() => context(18, root.info.height - BAR - 210)} />
      <Box style={{ width: 1, height: 25, background: T.border, margin: { left: 4, right: 4 } }} />
      <Box style={{ flexGrow: 1, gap: 6, overflow: 'hidden' }}>
        {state && [...state.windows].sort((a,b) => (a.order ?? 0) - (b.order ?? 0)).map(w => <Box key={w.id} onClick={() => { menu = null; act(w.id, 'focus'); }} style={{ width: 140, height: 36, cornerRadius: 7, padding: { left: 10, right: 10 }, alignItems: 'center', gap: 8, background: state?.focused === w.id && !w.minimized ? '#343052' : '#1d2a40', hoverBackground: '#35445c', border: { bottom: [2, w.minimized ? '#46536c' : state?.focused === w.id ? T.accent : '#6488a9'] } }}>
          <Text style={{ font: 0, fontSize: 13, color: T.accent, selectable: false }}>{state!.apps.find(a => a.id === w.app)?.icon}</Text><Text style={{ fontSize: 12, color: w.minimized ? T.muted : T.text, ellipsis: true, wrap: false, selectable: false }}>{w.title}</Text>
        </Box>)}
      </Box>
      <Button label="Detach ↗" onClick={() => finish()} />
    </BarFrame>;
  }
  function Desktop() {
    const [, render] = useState(0); update = () => render(n => n + 1);
    const w = root.info.width, h = root.info.height;
    return <DesktopFrame width={w} height={h}>
      <Box style={{ position: 'absolute', inset: { left: 0, top: 0 }, width: w, height: h - BAR }} onClick={() => { menu = null; error = ''; update(); }} />
      <Text style={{ position: 'absolute', inset: { left: 26, top: 20 }, fontSize: 12, color: '#8292b4', selectable: false }}>Z A T A R A   /   {name}</Text>
      <Text style={{ position: 'absolute', inset: { right: 32, bottom: BAR + 56 }, fontSize: 48, color: '#35435b', selectable: false }}>Room to think.</Text>
      <Text style={{ position: 'absolute', inset: { right: 34, bottom: BAR + 30 }, fontSize: 12, color: '#7585a3', selectable: false }}>Independent apps. One persistent desktop.</Text>
      {state?.apps.map((app, index) => <DesktopIcon key={app.id} app={app} index={index} />)}
      {state?.windows.map(w => <AppWindow key={w.id} w={w} />)}
      <Taskbar />
      {error && <Box style={{ position: 'absolute', inset: { right: 20, bottom: BAR + 18 }, width: Math.min(440, w - 30), padding: 18, background: '#4b2d40', cornerRadius: 10 }} onClick={() => { error = ''; update(); }}><Text style={{ color: '#ffd8e3', fontSize: 13, wrap: true }}>{error}</Text></Box>}
      {menu && <Box onClickOutside={() => { menu = null; update(); }} style={{ position: 'absolute', inset: { left: menu.x, top: menu.y }, width: 216, padding: 6, flexDirection: 'column', background: '#25314a', border: { width: 1, color: '#516180' }, cornerRadius: 9 }}>
        {menu.id ? ['minimize', 'maximize', 'close'].map(op => <Button key={op} label={op === 'maximize' && state?.windows.find(w => w.id === menu!.id)?.maximized ? 'Restore' : op[0].toUpperCase() + op.slice(1)} onClick={() => { const id = menu!.id!; menu = null; act(id, op); }} />) : state?.apps.map(app => <Button key={app.id} label={app.name} onClick={() => launch(app.id)} />)}
      </Box>}
    </DesktopFrame>;
  }
}
