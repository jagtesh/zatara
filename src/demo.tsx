import fs from 'node:fs';
import React, { useState } from 'react';
import { Box, Text as PixelText, TextProps, Input, createRoot } from './pixel';
const root = createRoot({ host: { socket: process.env.ZATARA_HOST!, pane: process.env.ZATARA_PANE!, name: 'Pixel Studio' }, devtools: false, onHostClosed: () => process.exit(0) });
let uiFont = 0;
function Text(props: TextProps) { return <PixelText {...props} style={{ font: uiFont, ...props.style }} />; }
function Demo() {
  const [count, setCount] = useState(0), [text, setText] = useState('Make yourself at home.'), [accent, setAccent] = useState('#a78bfa');
  return <Box style={{ width: '100%', height: '100%', background: '#131c2d', padding: 28, flexDirection: 'column', gap: 20 }}>
    <Text style={{ fontSize: 12, color: accent }}>YOUR OWN LITTLE SPACE</Text>
    <Text style={{ fontSize: 30, color: '#f0f3ff' }}>Pixel Studio</Text>
    <Text style={{ fontSize: 14, color: '#98a9c5', wrap: true }}>A real, independent Pixel app. Move this window, change its color, then detach and come back.</Text>
    <Input value={text} onChange={setText} style={{ height: 42, fontSize: 15, color: '#f0f3ff', background: '#202e46', cornerRadius: 8, padding: 10 }} />
    <Box style={{ gap: 12, alignItems: 'center' }}>
      <Box onClick={() => setCount(count + 1)} style={{ padding: { left: 18, right: 18, top: 12, bottom: 12 }, background: accent, hoverBackground: '#c4b5fd', cornerRadius: 8 }}><Text style={{ fontSize: 15, color: '#111827' }}>Count: {count}  +</Text></Box>
      {['#a78bfa', '#67e8c5', '#f9bc75', '#7cb9ff'].map(c => <Box key={c} onClick={() => setAccent(c)} style={{ width: 28, height: 28, background: c, cornerRadius: 14, border: { width: accent === c ? 3 : 0, color: '#ffffff' } }} />)}
    </Box>
    <Box style={{ flexGrow: 1 }} />
    <Text style={{ fontSize: 12, color: '#7184a3' }}>Native Pixel renderer · process {process.pid}</Text>
  </Box>;
}
if (fs.existsSync('/System/Library/Fonts/SFNS.ttf')) void root.registerFont('/System/Library/Fonts/SFNS.ttf').then(font => { uiFont = font; root.render(<Demo />); });
else root.render(<Demo />);
process.on('SIGTERM', () => { root.stop(); process.exit(0); });
