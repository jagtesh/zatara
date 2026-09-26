import React, { createContext, useContext, useRef, useState } from 'react';
import { Box, Text, DragEvent } from './pixel';
import { AppWindow, TitleBar as HeaderFrame, AppGlyph, MaximizeGlyph } from './primitives';
import { DesktopState, WindowState, WindowAction, Rect, TITLE, bounds, contentSize } from './model';
import type { CellSize } from './protocol';
import { theme as T } from './theme';

const resizeEdges = ['n', 's', 'e', 'w', 'se', 'sw', 'ne', 'nw'] as const;
type ResizeEdge = typeof resizeEdges[number];
/** One contract for decorations, gestures, clipping, focus and content geometry. */
export interface WindowFrameProps {
  window: WindowState;
  desktop: Pick<DesktopState, 'width' | 'height' | 'focused'>;
  cell: CellSize;
  icon: string;
  font: number;
  onAction(action: WindowAction): void;
  onInteract(): void;
  onPointerShape(shape: string): void;
  children(viewport: CellSize): React.ReactNode;
}
export function WindowFrame({ window: w, desktop, cell, icon, font, onAction, onInteract, onPointerShape, children }: WindowFrameProps) {
  const r = bounds(w, desktop), viewport = contentSize(r, cell), focused = desktop.focused === w.id;
  return <FrameContext.Provider value={{ focused, icon, font, onAction, onInteract, onPointerShape }}><AppWindow rect={r} focused={focused} minimized={w.minimized} maximized={w.maximized}>
    <TitleBar w={w} r={r} />
    <Box style={{ margin: { left: 2, top: 1 }, ...viewport, overflow: 'hidden' }}>{children(viewport)}</Box>
    {!w.maximized && resizeEdges.map(edge => <ResizeHandle key={edge} r={r} edge={edge} />)}
  </AppWindow></FrameContext.Provider>;
}
type FrameContextValue = Pick<WindowFrameProps, 'icon' | 'font' | 'onAction' | 'onInteract' | 'onPointerShape'> & { focused: boolean };
const FrameContext = createContext<FrameContextValue | null>(null);
function useFrame() { const frame = useContext(FrameContext); if (!frame) throw new Error('Window decoration requires a WindowFrame'); return frame; }
function Control({ label, children, onClick, danger = false }: { label?: string; children?: React.ReactNode; onClick(): void; danger?: boolean }) {
  const { onPointerShape, font } = useFrame();
  const [pressed, setPressed] = useState(false), armed = useRef(false);
  return <Box onPointer={e => { if (e.button !== 'left') return; if (e.kind === 'down') { armed.current = true; setPressed(true); } if (e.kind === 'up') { setPressed(false); if (armed.current) onClick(); armed.current = false; } }} onMouseEnter={() => onPointerShape('pointer')} onMouseLeave={() => { armed.current = false; setPressed(false); onPointerShape('default'); }} style={{ width: T.controlSize, height: T.controlSize, flexShrink: 0, cornerRadius: 6, background: pressed ? '#52617c' : undefined, hoverBackground: danger ? '#873e51' : '#40516d', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{children ?? <Text style={{ font, fontSize: 17, color: T.text, selectable: false }}>{label}</Text>}</Box>;
}
function TitleBar({ w, r }: { w: WindowState; r: Rect }) {
  const { focused, icon, font, onInteract, onAction } = useFrame();
  const drag = useRef<{ x: number; y: number; r: Rect } | null>(null), last = useRef(0);
  return <HeaderFrame focused={!!focused} maximized={w.maximized} width={r.width}>
    <Box style={{ width: Math.max(0, r.width - 2 - T.controlSize * 3), flexShrink: 0, overflow: 'hidden', height: TITLE, alignItems: 'center', padding: { left: 13 }, gap: 8 }}
      onDrag={e => {
        if (process.env.ZATARA_TRACE) console.error('drag', w.id, e);
        if (e.phase === 'start') { drag.current = { x: e.x, y: e.y, r: { ...r } }; onInteract(); onAction({ op: 'focus' }); }
        const d = drag.current;
        if (d && !w.maximized && e.phase !== 'start') onAction({ op: 'move', rect: { ...d.r, x: d.r.x + e.x - d.x, y: d.r.y + e.y - d.y } });
        if (e.phase === 'end') {
          if (d && Math.abs(e.x - d.x) + Math.abs(e.y - d.y) < 4) { const now = Date.now(); if (now - last.current < 350) { onAction({ op: 'maximize' }); last.current = 0; } else last.current = now; } else last.current = 0;
          drag.current = null;
        }
      }}>
      <AppGlyph icon={icon} size={14} color={focused ? T.accent : T.muted} />
      <Text style={{ font, width: Math.max(0, r.width - 2 - T.controlSize * 3 - 48), fontSize: T.labelSize, color: focused ? T.text : T.muted, ellipsis: true, wrap: false, selectable: false }}>{w.title}</Text>
    </Box>
    <Control label="−" onClick={() => onAction({ op: 'minimize' })} />
    <Control onClick={() => onAction({ op: 'maximize' })}><MaximizeGlyph maximized={w.maximized} /></Control>
    <Control danger label="×" onClick={() => onAction({ op: 'close' })} />
  </HeaderFrame>;
}
function ResizeHandle({ r, edge }: { r: Rect; edge: ResizeEdge }) {
  const { onPointerShape, onAction } = useFrame();
  const start = useRef<{ x: number; y: number; r: Rect } | null>(null);
  const right = edge.includes('e'), bottom = edge.includes('s'), left = edge.includes('w'), top = edge.includes('n');
  const horizontal = edge === 'n' || edge === 's', vertical = edge === 'e' || edge === 'w';
  return <Box style={{ position: 'absolute', inset: { left: right ? r.width - 7 : 0, top: bottom ? r.height - 7 : 0 }, width: horizontal ? r.width - 7 : 7, height: vertical ? r.height - 7 : 7 }} onMouseEnter={() => onPointerShape(horizontal ? 'ns-resize' : vertical ? 'ew-resize' : edge === 'ne' || edge === 'sw' ? 'nesw-resize' : 'nwse-resize')} onMouseLeave={() => onPointerShape('default')} onDrag={(e: DragEvent) => {
    if (e.phase === 'start') { start.current = { x: e.x, y: e.y, r: { ...r } }; onAction({ op: 'focus' }); }
    const d = start.current;
    if (d && e.phase !== 'start') { const dx = e.x - d.x, dy = e.y - d.y; onAction({ op: 'move', rect: { x: d.r.x + (left ? dx : 0), y: d.r.y + (top ? dy : 0), width: d.r.width + (right ? dx : left ? -dx : 0), height: d.r.height + (bottom ? dy : top ? -dy : 0) } }); }
    if (e.phase === 'end') start.current = null;
  }} />;
}
