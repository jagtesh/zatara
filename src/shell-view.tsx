import { memo } from 'react';
import { Box, Text, BoxProps } from './pixel';
import type { Cell, Screen } from './terminal';
import { shellViewport, terminalPoint } from './shell-viewport';

interface RowProps { cells: Cell[]; y: number; cellWidth: number; cellHeight: number; fontSize: number }
/** xterm's column is authoritative; font shaping must never accumulate cell drift. */
const Row = memo(function Row({ cells, y, cellWidth: cw, cellHeight: ch, fontSize }: RowProps) {
  return <Box style={{ position: 'absolute', inset: { left: 0, top: y * ch }, width: cells.length * cw, height: ch }}>
    {cells.map((c, x) => {
      if (!c.text || (c.text === ' ' && c.bg === '#111827' && !c.underline)) return null;
      const width = (c.width ?? (cells[x + 1]?.text === '' ? 2 : 1)) * cw;
      return <Text key={x} spans={[{ start: 0, end: Buffer.byteLength(c.text), color: c.fg, bold: c.bold, italic: c.italic, underline: c.underline }]} style={{ position: 'absolute', inset: { left: x * cw, top: 0 }, width, height: ch, background: c.bg, font: 0, fontSize, wrap: false, selectable: false, overflow: 'hidden' }}>{c.text}</Text>;
    })}
  </Box>;
}, (a, b) => a.y === b.y && a.cellWidth === b.cellWidth && a.cellHeight === b.cellHeight && a.fontSize === b.fontSize && a.cells.length === b.cells.length && a.cells.every((c, i) => {
  const d = b.cells[i]; return c.text === d.text && c.width === d.width && c.fg === d.fg && c.bg === d.bg && c.bold === d.bold && c.italic === d.italic && c.underline === d.underline;
}));
export interface ShellViewportProps {
  screen?: Screen; focused: boolean; width: number; height: number;
  cellWidth: number; cellHeight: number; fontSize: number;
  input: Pick<BoxProps, 'onPointer' | 'onMouseMove' | 'onWheel'>;
}
export function ShellViewport({ screen, focused, width, height, cellWidth, cellHeight, fontSize, input }: ShellViewportProps) {
  const { first, count, offsetY } = shellViewport(screen, height, cellHeight);
  const cursorY = (screen?.cursor.y ?? -1) - first;
  return <Box style={{ width, height, background: '#111827', overflow: 'hidden' }}
    onPointer={input.onPointer && (e => input.onPointer!(terminalPoint(e, offsetY)))}
    onMouseMove={input.onMouseMove && (e => input.onMouseMove!(terminalPoint(e, offsetY)))}
    onWheel={input.onWheel && (e => input.onWheel!(terminalPoint(e, offsetY)))}>
    {screen?.rows.slice(first, first + count).map((cells, y) => <Row key={first + y} cells={cells} y={y} cellWidth={cellWidth} cellHeight={cellHeight} fontSize={fontSize} />)}
    {screen && focused && cursorY >= 0 && cursorY < count && <Box style={{ position: 'absolute', inset: { left: screen.cursor.x * cellWidth, top: cursorY * cellHeight }, width: cellWidth, height: cellHeight, background: '#a78bfa55', border: { bottom: [2, '#c4b5fd'] } }} />}
  </Box>;
}
