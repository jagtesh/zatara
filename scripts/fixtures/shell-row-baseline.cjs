// Benchmark only: the pre-grid row renderer, hosted by the current scaled build.
// Copied beside dist/pixel.js in an isolated artifact directory; never shipped.
const { createElement: h } = require('react');
const { Box, Text } = require('./pixel');
exports.ShellViewport = ({ screen, focused, width, height, cellWidth: cw, cellHeight: ch, fontSize, input }) => h(Box,
  { style: { width, height, background: '#111827', overflow: 'hidden', flexDirection: 'column' }, ...input },
  screen?.rows.map((cells, y) => {
    let text = '', spans = [], byte = 0;
    for (const c of cells) {
      if (!c.text) continue;
      const n = Buffer.byteLength(c.text);
      spans.push({ start: byte, end: byte + n, color: c.fg, background: c.bg, bold: c.bold, italic: c.italic, underline: c.underline });
      text += c.text; byte += n;
    }
    return h(Text, { key: y, spans, style: { position: 'absolute', inset: { left: 0, top: y * ch }, height: ch, width, font: 0, fontSize, color: '#c0caf5', wrap: false, selectable: false } }, text);
  }),
  screen && focused && screen.cursor.y >= 0 && h(Box, { style: { position: 'absolute', inset: { left: screen.cursor.x * cw, top: screen.cursor.y * ch }, width: cw, height: ch, background: '#a78bfa55', border: { bottom: [2, '#c4b5fd'] } } }),
);
