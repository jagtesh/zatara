import React, { useRef } from 'react';
import { Box, Text, BoxProps } from './pixel';
import { Rect, BAR, TITLE } from './model';

/** Presentation primitives deliberately do not own processes or session state. */
export function Desktop({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  return <Box style={{ width, height, background: { from: [0, 0], to: [1, 1], stops: [{ at: 0, color: '#1e2441' }, { at: 0.55, color: '#111c30' }, { at: 1, color: '#0c242a' }] } }}>{children}</Box>;
}
export function AppWindow({ rect, focused, minimized, maximized, children }: { rect: Rect; focused: boolean; minimized: boolean; maximized: boolean; children: React.ReactNode }) {
  return <Box hidden={minimized} style={{ position: 'absolute', inset: { left: rect.x, top: rect.y }, width: rect.width, height: rect.height, background: '#111827', cornerRadius: maximized ? 0 : 10, border: { width: 1, color: focused ? '#8a6bbe' : '#34435c' }, overflow: 'hidden', flexDirection: 'column' }}>{children}</Box>;
}
export function TitleBar({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  return <Box style={{ height: TITLE, width: '100%', flexShrink: 0, background: focused ? '#26334e' : '#1c2940', alignItems: 'center', border: { bottom: [1, focused ? '#6c5895' : '#2c3b55'] } }}>{children}</Box>;
}
export function Taskbar({ children }: { children: React.ReactNode }) {
  return <Box style={{ position: 'absolute', inset: { left: 0, bottom: 0 }, width: '100%', height: BAR, background: '#131e30', border: { top: [1, '#33405a'] }, alignItems: 'center', padding: { left: 18, right: 14 }, gap: 8 }}>{children}</Box>;
}
export function DesktopIcon({ name, icon, index, available, font, onLaunch }: { name: string; icon: string; index: number; available: boolean; font: number; onLaunch(): void }) {
  const last = useRef(0);
  return <Box onClick={() => { const now = Date.now(); if (now - last.current < 450) { last.current = 0; onLaunch(); } else last.current = now; }} style={{ position: 'absolute', inset: { left: 22, top: 58 + index * 106 }, width: 106, height: 92, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cornerRadius: 12, hoverBackground: '#24304b' }}>
    <Box style={{ width: 48, height: 48, cornerRadius: 13, background: icon === '>_' ? '#233d42' : '#302948', alignItems: 'center', justifyContent: 'center', border: { width: 1, color: icon === '>_' ? '#375a5a' : '#51416f' } }}><Text style={{ fontSize: 23, color: available ? icon === '>_' ? '#6ee7c5' : '#c4b5fd' : '#8c9dbb', selectable: false }}>{icon}</Text></Box>
    <Text style={{ font, fontSize: 12, color: '#e7eeff', selectable: false }}>{name}</Text>
  </Box>;
}
