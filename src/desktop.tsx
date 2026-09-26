import React, { useEffect, useRef, useState } from 'react';
import fs from 'node:fs';
import net from 'node:net';
import { Box, Text as PixelText, TextProps, createRoot, PixelRoot, Surface, PointerEvent, DragEvent, TextSpan, NodeHandle } from './pixel';
import { DesktopState, WindowState, Rect, bounds, contentSize, BAR, TITLE, action as reduce } from './model';
import { Desktop as DesktopFrame, AppWindow as WindowFrame, TitleBar as HeaderFrame, Taskbar as BarFrame, DesktopIcon as IconFrame, AppGlyph } from './primitives';
import { flattenGuestFrame } from './pixel-frame';
import { Screen } from './terminal';
import { lines, send, sessionPath } from './ipc';
import { theme as T, verticalGradient, applyAppearance } from './theme';
import { appearance, watchConfig } from './config';
import { contains, menuRect, taskLayout } from './layout';
let uiFont = 0;
function Text(props: TextProps) { return <PixelText {...props} style={{ font: uiFont, ...props.style }} />; }
type Frame = { path: string; width: number; height: number; seq: number };
type Menu = { x: number; y: number; id?: string; overflow?: boolean };
export function attach(name: string) {
  let socket = net.connect(sessionPath(name));
  const initialSocket = socket;
  let switching = false;
  let root: PixelRoot, update = () => {}, state: DesktopState | null = null, error = '', closed = false, configError = '';
  let stopConfig = () => {};
  const screens = new Map<string, Screen>(), frames = new Map<string, Frame>(), surfaces = new Map<string, Surface>();
  let menu: Menu | null = null, selectedIcon: string | null = null;
  let tooltip: { x: number; title: string } | null = null;
  const ordered = () => [...(state?.windows ?? [])].sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
  const taskName = (w: WindowState) => { const peers = ordered().filter(p => p.app === w.app); return (state?.apps.find(a => a.id === w.app)?.name ?? w.app) + (peers.length > 1 ? ` ${peers.findIndex(p => p.id === w.id) + 1}` : ''); };
  const command = (m: unknown) => send(socket, m);
  const act = (id: string, op: string, rect?: Rect) => {
    if (state) reduce(state, id, op, rect);
    command({ type: 'action', id, op, rect }); update();
  };
  const launch = (app: string) => { menu = null; tooltip = null; command({ type: 'launch', app }); update(); };
  function finish(code = 0) {
    if (closed) return; closed = true;
    stopConfig(); socket.destroy(); root?.stop(); process.exit(code);
  }
  function context(x: number, y: number, id?: string, overflow = false) {
    tooltip = null; menu = { x, y, id, overflow }; update();
  }
  function present(id: string, f: Frame) {
    const surface = surfaces.get(id);
    if (!surface) return;
    try { const bgra = fs.readFileSync(f.path); if (bgra.length === f.width * f.height * 4) surface.present({ bgra: flattenGuestFrame(bgra), width: f.width, height: f.height }); } catch {}
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
      onPaste(text) { if (state?.focused && !menu) command({ type: 'input', id: state.focused, event: { type: 'paste', text } }); },
      onRightClick({ x, y }) {
        if (!state) return;
        const tasks = ordered(), layout = taskLayout(root.info.width, root.info.height, tasks.length);
        if (y >= root.info.height - BAR) {
          const i = layout.entries.findIndex(r => contains(r, x, y));
          if (i >= 0) context(x, y, tasks[i].id);
          else if (layout.overflow && contains(layout.overflow, x, y)) context(x, y, undefined, true);
          return;
        }
        // Test the entire topmost window first: covered title bars and guest
        // context menus must never open the desktop launcher.
        const w = [...state.windows].reverse().find(w => !w.minimized && contains(bounds(w, state!), x, y));
        if (w) { if (y < bounds(w, state).y + TITLE) context(x, y, w.id); return; }
        context(x, y);
      },
      onResize(size) { tooltip = null; command({ type: 'resize', ...size }); update(); },
      onEngineExit(e) { if (e) process.stderr.write(e + '\n'); finish(e ? 1 : 0); },
      onHostClosed: () => finish(),
    });
    command({ type: 'attach', width: root.info.width, height: root.info.height, cell: { width: root.info.cellWidth, height: root.info.cellHeight }, colors: root.info.colors });
    root.setTitle(`Zatara · ${name}`);
    root.render(<Desktop />);
    stopConfig = watchConfig(next => { applyAppearance(next); update(); }, message => { if (message !== configError) { configError = message; update(); } });
    if (fs.existsSync('/System/Library/Fonts/SFNS.ttf')) void root.registerFont('/System/Library/Fonts/SFNS.ttf').then(font => { uiFont = font; update(); });
  });
  initialSocket.on('error', e => { if (socket === initialSocket) { process.stderr.write(e.message + '\n'); finish(1); } });
  initialSocket.on('close', () => { if (socket === initialSocket) finish(); });
  lines(initialSocket, m => { if (socket === initialSocket) receive(m); });
  function receive(m: any) {
    if (m.type === 'switch') { void switchSession(m.session); return; }
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
  }
  async function switchSession(target: string) {
    if (switching || target === name) return;
    switching = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const candidate = net.connect(sessionPath(target));
        let adopted = false;
        const timeout = setTimeout(() => { candidate.destroy(); reject(new Error('Session switch timed out')); }, 4000);
        candidate.on('connect', () => send(candidate, { type: 'attach', width: root.info.width, height: root.info.height, cell: { width: root.info.cellWidth, height: root.info.cellHeight }, colors: root.info.colors }));
        candidate.on('error', e => { if (!adopted) { clearTimeout(timeout); reject(e); } });
        candidate.on('close', () => { clearTimeout(timeout); if (adopted && socket === candidate) finish(); else if (!adopted) reject(new Error('Session connection closed')); });
        lines(candidate, m => {
          if (!adopted) {
            if (m.type === 'error') { candidate.destroy(); reject(new Error(m.error)); return; }
            if (m.type !== 'state') return;
            clearTimeout(timeout); adopted = true;
            const previous = socket; socket = candidate; name = target;
            menu = null; tooltip = null; error = ''; selectedIcon = null;
            screens.clear(); frames.clear();
            root.setTitle(`Zatara · ${name}`);
            previous.end(); resolve();
          }
          if (socket === candidate) receive(m);
        });
      });
    } catch (e) { error = `Cannot switch to ${target}: ${e instanceof Error ? e.message : String(e)}`; update(); }
    finally { switching = false; }
  }
  process.on('SIGTERM', () => finish()); process.on('SIGHUP', () => finish());
  process.on('SIGWINCH', () => root?.nudgeResize());

  function Button({ label, onClick, accent = false, control = false, danger = false }: { label: string; onClick(): void; accent?: boolean; control?: boolean; danger?: boolean }) {
    const [pressed, setPressed] = useState(false), armed = useRef(false);
    return <Box onPointer={e => { if (e.button !== 'left') return; if (e.kind === 'down') { armed.current = true; setPressed(true); } if (e.kind === 'up') { setPressed(false); if (armed.current) onClick(); armed.current = false; } }} onMouseEnter={() => root.setPointerShape('pointer')} onMouseLeave={() => { armed.current = false; setPressed(false); root.setPointerShape('default'); }} style={{ width: control ? T.controlSize : '100%', height: control ? T.controlSize : 36, flexShrink: 0, padding: { left: control ? 0 : 10, right: control ? 0 : 10 }, cornerRadius: 6, background: pressed ? '#52617c' : accent ? verticalGradient('#52436e', '#352d4f') : undefined, hoverBackground: danger ? '#873e51' : '#40516d', alignItems: 'center', justifyContent: control ? 'center' : 'start', overflow: 'hidden' }}><Text style={{ fontSize: control ? 17 : T.labelSize, color: accent ? '#e0d3ff' : T.text, wrap: false, ellipsis: true, selectable: false }}>{label}</Text></Box>;
  }
  function DesktopIcon({ app, index }: { app: DesktopState['apps'][number]; index: number }) {
    return <IconFrame name={app.name} icon={app.icon} available={!!app.available} index={index} desktopHeight={root.info.height} font={uiFont} selected={selectedIcon === app.id} onSelect={() => { selectedIcon = app.id; menu = null; update(); }} onLaunch={() => launch(app.id)} />;
  }

  function TitleBar({ w, r }: { w: WindowState; r: Rect }) {
    const drag = useRef<{ x: number; y: number; r: Rect } | null>(null), last = useRef(0);
    const focused = state?.focused === w.id;
    return <HeaderFrame focused={!!focused} maximized={w.maximized} width={r.width}>
      <Box style={{ width: Math.max(0, r.width - 2 - T.controlSize * 3), flexShrink: 0, overflow: 'hidden', height: TITLE, alignItems: 'center', padding: { left: 13 }, gap: 8 }}
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
        <AppGlyph icon={state?.apps.find(a => a.id === w.app)?.icon ?? '◈'} size={14} color={focused ? T.accent : T.muted} />
        <Text style={{ width: Math.max(0, r.width - 2 - T.controlSize * 3 - 48), fontSize: T.labelSize, color: focused ? T.text : T.muted, ellipsis: true, wrap: false, selectable: false }}>{w.title}</Text>
      </Box>
      <Button control label="−" onClick={() => act(w.id, 'minimize')} />
      <Button control label={w.maximized ? '▣' : '□'} onClick={() => act(w.id, 'maximize')} />
      <Button control danger label="×" onClick={() => act(w.id, 'close')} />
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
    return <Box style={{ position: 'absolute', inset: { left: right ? r.width - 7 : 0, top: bottom ? r.height - 7 : 0 }, width: horizontal ? r.width - 7 : 7, height: vertical ? r.height - 7 : 7 }} onMouseEnter={() => root.setPointerShape(horizontal ? 'ns-resize' : vertical ? 'ew-resize' : edge === 'ne' || edge === 'sw' ? 'nesw-resize' : 'nwse-resize')} onMouseLeave={() => root.setPointerShape('default')} onDrag={(e: DragEvent) => {
      if (e.phase === 'start') { start.current = { x: e.x, y: e.y, r: { ...r } }; act(w.id, 'focus'); }
      const d = start.current;
      if (d && e.phase !== 'start') { const dx = e.x - d.x, dy = e.y - d.y; act(w.id, 'move', { x: d.r.x + (left ? dx : 0), y: d.r.y + (top ? dy : 0), width: d.r.width + (right ? dx : left ? -dx : 0), height: d.r.height + (bottom ? dy : top ? -dy : 0) }); }
      if (e.phase === 'end') start.current = null;
    }} />;
  }
  function AppWindow({ w }: { w: WindowState }) {
    const r = bounds(w, state!), { width: cw, height: ch } = contentSize(r, { width: root.info.cellWidth, height: root.info.cellHeight });
    return <WindowFrame rect={r} focused={state?.focused === w.id} minimized={w.minimized} maximized={w.maximized}>
      <TitleBar w={w} r={r} />
      <Box style={{ margin: { left: 2, top: 1 }, width: cw, height: ch, overflow: 'hidden' }}>
        {w.kind === 'shell' ? <ShellView w={w} width={cw} height={ch} /> : <GuestView w={w} width={cw} height={ch} />}
        {w.status !== 'Running' && <Box style={{ position: 'absolute', inset: { top: 0, left: 0 }, width: cw, padding: 14, background: '#25314b' }}><Text style={{ fontSize: T.labelSize, color: T.text, wrap: true }}>{w.status}</Text></Box>}
      </Box>
      {!w.maximized && ['n','s','e','w','se','sw','ne','nw'].map(edge => <ResizeHandle key={edge} w={w} r={r} edge={edge} />)}
    </WindowFrame>;
  }
  function Taskbar() {
    const tasks = ordered(), layout = taskLayout(root.info.width, root.info.height, tasks.length);
    return <BarFrame>
      <Box style={{ position: 'absolute', inset: { left: layout.launcher.x, top: 4 }, width: layout.launcher.width, height: 36 }}><Button label={layout.compact ? "Z" : "Zatara"} accent onClick={() => context(12, root.info.height - BAR)} /></Box>
      {layout.entries.map((r, i) => { const w = tasks[i], active = state?.focused === w.id && !w.minimized; return <Box key={w.id} onClick={() => { menu = null; tooltip = null; act(w.id, 'focus'); }} onMouseEnter={() => { tooltip = { x: r.x, title: w.title }; root.setPointerShape('pointer'); update(); }} onMouseLeave={() => { tooltip = null; root.setPointerShape('default'); update(); }} style={{ position: 'absolute', inset: { left: r.x, top: 4 }, width: r.width, height: r.height, flexShrink: 0, cornerRadius: 6, padding: { left: 9, right: 9 }, alignItems: 'center', gap: 7, overflow: 'hidden', background: verticalGradient(active ? '#4a4263' : '#30405a', active ? '#302b48' : '#1f2c40'), hoverBackground: '#435470', border: { top: [1, active ? '#847499' : '#4a5b76'], bottom: [2, w.minimized ? '#40506b' : active ? T.accent : '#6886a8'] } }}>
        <Box style={{ width: 20, flexShrink: 0 }}><AppGlyph size={14} icon={state!.apps.find(a => a.id === w.app)?.icon ?? '◈'} /></Box>
        <Text style={{ width: r.width - 46, fontSize: T.labelSize, color: w.minimized ? T.muted : T.text, ellipsis: true, wrap: false, selectable: false }}>{taskName(w)}</Text>
      </Box>; })}
      {layout.overflow && <Box style={{ position: 'absolute', inset: { left: layout.overflow.x, top: 4 }, width: layout.overflow.width }}><Button label={`+${tasks.length - layout.visible}`} onClick={() => context(layout.overflow!.x, root.info.height - BAR, undefined, true)} /></Box>}
      <Box style={{ position: 'absolute', inset: { left: layout.detach.x, top: 4 }, width: layout.detach.width }}><Button label={layout.compact ? "↗" : "Detach ↗"} onClick={() => finish()} /></Box>
    </BarFrame>;
  }
  function ContextMenu() {
    const list = useRef<NodeHandle>(null), offset = useRef(0);
    useEffect(() => { offset.current = 0; list.current?.scrollTo(0, false); }, [menu]);
    if (!menu) return null;
    const current = menu, tasks = ordered();
    const rows = current.id ? 3 : current.overflow ? tasks.length : state?.apps.length ?? 0;
    const r = menuRect(current.x, current.y, root.info.width, root.info.height, rows);
    return <Box ref={list} contentHeight={rows * 36 + 12} onScroll={e => { offset.current = e.offset; }} onWheel={e => { offset.current = Math.max(0, Math.min(offset.current + e.deltaY, rows * 36 + 12 - r.height)); list.current?.scrollTo(offset.current, false); }} onClickOutside={() => { menu = null; update(); }} style={{ position: 'absolute', inset: { left: r.x, top: r.y }, width: r.width, height: r.height, padding: 6, flexDirection: 'column', overflow: 'scroll', background: '#28364e', border: { width: 1, color: '#637493' }, cornerRadius: 9 }}>
      {current.id ? ['minimize', 'maximize', 'close'].map(op => <Button key={op} danger={op === 'close'} label={op === 'maximize' && state?.windows.find(w => w.id === current.id)?.maximized ? 'Restore' : op[0].toUpperCase() + op.slice(1)} onClick={() => { menu = null; act(current.id!, op); }} />) : current.overflow ? tasks.map(w => <Button key={w.id} label={`${taskName(w)}${w.minimized ? ' · minimized' : ''}`} onClick={() => { menu = null; act(w.id, 'focus'); }} />) : state?.apps.map(app => <Button key={app.id} label={`${app.name}${app.available ? '' : ' · unavailable'}`} onClick={() => launch(app.id)} />)}
    </Box>;
  }
  function Desktop() {
    const [, render] = useState(0); update = () => render(n => n + 1);
    const w = root.info.width, h = root.info.height;
    return <DesktopFrame width={w} height={h}>
      <Box style={{ position: 'absolute', inset: { left: 0, top: 0 }, width: w, height: h - BAR }} onClick={() => { menu = null; tooltip = null; selectedIcon = null; error = ''; update(); }} />
      <Text style={{ position: 'absolute', inset: { left: 26, top: 20 }, fontSize: appearance.desktop.fontSize, color: T.muted, selectable: false }}>Z A T A R A   /   {name}</Text>
      {state?.apps.map((app, index) => <DesktopIcon key={app.id} app={app} index={index} />)}
      {state?.windows.map(w => <AppWindow key={w.id} w={w} />)}
      <Taskbar />
      {(error || configError) && <Box style={{ position: 'absolute', inset: { right: 20, bottom: BAR + 18 }, width: Math.min(440, w - 30), padding: 18, background: '#4b2d40', cornerRadius: 10 }} onClick={() => { error = ''; update(); }}><Text style={{ color: '#ffd8e3', fontSize: 13, wrap: true }}>{error || configError}</Text></Box>}
      {tooltip && !menu && <Box style={{ position: 'absolute', inset: { left: Math.max(0, Math.min(tooltip.x, w - 360)), bottom: BAR + 8 }, width: Math.min(360, w), padding: 10, background: '#2c3952', border: { width: 1, color: '#62718c' }, cornerRadius: 6, overflow: 'hidden' }}><Text style={{ width: Math.min(338, w - 22), fontSize: T.labelSize, color: T.text, wrap: true }}>{tooltip.title}</Text></Box>}
      <ContextMenu />
    </DesktopFrame>;
  }
}
