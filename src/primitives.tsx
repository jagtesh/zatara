import React, { useRef } from 'react';
import { Box, Text, Path } from './pixel';
import { theme as T, verticalGradient } from './theme';
import { Rect, BAR, TITLE } from './model';

export function AppGlyph({ icon, size = 20, color = T.accent }: { icon: string; size?: number; color?: string }) {
  if (icon === '▤' || icon === '▥') return <Box style={{ width: size, height: size, flexShrink: 0, border: { width: 1, color }, cornerRadius: 3, padding: 3, gap: 2, flexDirection: icon === '▤' ? 'column' : 'row', alignItems: icon === '▤' ? 'stretch' : 'end', justifyContent: 'center' }}>{[0, 1, 2].map(i => <Box key={i} style={{ width: icon === '▤' ? '100%' : Math.max(1, size / 7), height: icon === '▤' ? Math.max(1, size / 12) : size * (0.25 + i * 0.15), background: color }} />)}</Box>;
  if (icon === '◎') return <Box style={{ width: size, height: size, flexShrink: 0, cornerRadius: size / 2, border: { width: 1, color }, alignItems: 'center', justifyContent: 'center' }}>
    <Box style={{ width: size * 0.4, height: size, cornerRadius: size / 2, border: { width: 1, color } }} />
    <Box style={{ position: 'absolute', inset: { left: 0, top: size / 2 }, width: size, height: 1, background: color }} />
  </Box>;
  if (icon === '</>') return <Path style={{ width: size, height: size, flexShrink: 0 }} viewBox={24} d="M 7 5 L 1 12 L 7 19 M 17 5 L 23 12 L 17 19 M 14 3 L 10 21" stroke={{ width: 1.5, color, cap: 'round', join: 'round' }} />;
  return <Text style={{ fontSize: icon.length > 1 ? size * 0.8 : size, color, wrap: false, selectable: false }}>{icon}</Text>;
}

/** Presentation primitives deliberately do not own processes or session state. */
export function Desktop({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  return <Box style={{ width, height, background: { from: [0, 0], to: [1, 1], stops: [{ at: 0, color: '#1e2441' }, { at: 0.55, color: '#111c30' }, { at: 1, color: '#0c242a' }] } }}>{children}</Box>;
}
export function AppWindow({ rect, focused, minimized, maximized, children }: { rect: Rect; focused: boolean; minimized: boolean; maximized: boolean; children: React.ReactNode }) {
  return <Box hidden={minimized} style={{ position: 'absolute', inset: { left: rect.x, top: rect.y }, width: rect.width, height: rect.height }}>
    <Box style={{ width: rect.width, height: rect.height, background: '#111827', cornerRadius: maximized ? 0 : T.radius, border: { width: 1, color: focused ? T.activeBorder : T.inactiveBorder }, overflow: 'hidden', flexDirection: 'column' }}>{children}</Box>
  </Box>;
}
export function TitleBar({ focused, maximized, width, children }: { focused: boolean; maximized: boolean; width: number; children: React.ReactNode }) {
  return <Box style={{ height: TITLE, width: width - 2, flexShrink: 0, background: verticalGradient(focused ? '#39445f' : '#27334a', focused ? '#29354d' : '#202b3e'), cornerRadius: { topLeft: maximized ? 0 : 9, topRight: maximized ? 0 : 9 }, overflow: 'hidden', alignItems: 'center', border: { width: 1, color: focused ? '#8a7ca6' : '#4c5b74' } }}>{children}</Box>;
}
export function Taskbar({ children }: { children: React.ReactNode }) {
  return <Box style={{ position: 'absolute', inset: { left: 0, bottom: 0 }, width: '100%', height: BAR, background: verticalGradient('#29354a', '#152034'), border: { top: [1, '#52617b'], bottom: [1, '#0b1220'] } }}>{children}</Box>;
}
export function DesktopIcon({ name, icon, index, desktopHeight, available, font, selected, onSelect, onLaunch }: { name: string; icon: string; index: number; desktopHeight: number; available: boolean; font: number; selected: boolean; onSelect(): void; onLaunch(): void }) {
  const last = useRef(0), rows = Math.max(1, Math.floor((desktopHeight - BAR - 58) / 106));
  return <Box onClick={() => { onSelect(); const now = Date.now(); if (now - last.current < 450) { last.current = 0; onLaunch(); } else last.current = now; }} style={{ position: 'absolute', inset: { left: 22 + Math.floor(index / rows) * 118, top: 58 + (index % rows) * 106 }, width: 106, height: 92, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cornerRadius: 12, background: selected ? '#2d3a54' : undefined, border: selected ? { width: 1, color: '#7181a4' } : undefined, hoverBackground: '#24304b' }}>
    <Box style={{ width: 48, height: 48, cornerRadius: 13, background: icon === '>_' ? '#233d42' : '#302948', alignItems: 'center', justifyContent: 'center', border: { width: 1, color: icon === '>_' ? '#375a5a' : '#51416f' } }}><AppGlyph size={26} icon={icon} color={available ? icon === '>_' ? '#6ee7c5' : '#c4b5fd' : '#8c9dbb'} /></Box>
    <Text style={{ font, maxWidth: 102, fontSize: 12, wrap: false, ellipsis: true, color: '#e7eeff', selectable: false }}>{name}</Text>
  </Box>;
}
