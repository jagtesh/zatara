// Independent native guest used for long-title and clipping regression coverage.
const React = require('react');
const { createRoot, Box, Text } = require('../node_modules/@zenbu-labs/pixel/dist/react');
const root = createRoot({ host: { socket: process.env.ZATARA_HOST, pane: process.env.ZATARA_PANE, name: 'Layout fixture' }, onHostClosed: () => process.exit(0), devtools: false });
root.setTitle('A deliberately long document title — ' + 'readable content '.repeat(15));
root.render(React.createElement(Box, { style: { width: '100%', height: '100%', background: '#1b2b3e', padding: 24 } }, React.createElement(Text, { style: { fontSize: 18, color: '#c4b5fd' } }, 'Independent guest · long title')));
