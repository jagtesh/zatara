import { Terminal } from '@xterm/headless';
import * as pty from 'node-pty';
import type { EngineKeyEvent } from './pixel';
import type { WindowInput, CellSize } from './protocol';
export interface Cell { text: string; fg: string; bg: string; bold: boolean; italic: boolean; underline: boolean }
export interface Screen { rows: Cell[][]; cursor: { x: number; y: number }; cols: number; rowCount: number; scroll: number; alternate: boolean }
const palette = ['#17202e','#f7768e','#9ece6a','#e0af68','#7aa2f7','#bb9af7','#7dcfff','#c0caf5','#565f89','#ff9eaa','#b9f27c','#ffd08a','#a3bdff','#d7b5ff','#a4e8ff','#ffffff'];
function color(mode: number, value: number, fallback: string) {
  if (mode === 0) return fallback;
  if (mode === 0x3000000) return '#' + value.toString(16).padStart(6, '0');
  if (value < 16) return palette[value];
  if (value >= 232) { const g = (8 + (value - 232) * 10).toString(16).padStart(2, '0'); return '#' + g.repeat(3); }
  const n = value - 16, c = [0,95,135,175,215,255];
  return '#' + [c[Math.floor(n / 36)], c[Math.floor(n / 6) % 6], c[n % 6]].map(v => v.toString(16).padStart(2, '0')).join('');
}
export class Shell {
  term = new Terminal({ cols: 80, rows: 24, scrollback: 2000, allowProposedApi: true });
  process: pty.IPty;
  queued = 0;
  scroll = 0;
  bytes = 0;
  constructor(cwd: string, changed: () => void, exit: (code: number) => void) {
    this.process = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], { name: 'xterm-256color', cols: 80, rows: 24, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string> });
    this.process.onData(data => {
      const size = Buffer.byteLength(data); this.bytes += size; this.queued += size;
      if (this.queued > 256 * 1024) this.process.pause();
      this.term.write(data, () => { this.queued -= size; if (this.queued < 64 * 1024) this.process.resume(); changed(); });
    });
    this.term.onData(data => this.process.write(data));
    this.term.onBinary(data => this.process.write(Buffer.from(data, 'binary')));
    this.process.onExit(({ exitCode }) => exit(exitCode));
  }
  resize(cols: number, rows: number) {
    cols = Math.max(2, Math.min(500, cols)); rows = Math.max(1, Math.min(200, rows));
    if (cols === this.term.cols && rows === this.term.rows) return;
    this.term.resize(cols, rows); this.process.resize(cols, rows);
  }
  input(data: string) { this.scroll = 0; this.process.write(data); }
  paste(data: string) { this.input(this.term.modes.bracketedPasteMode ? '\x1b[200~' + data + '\x1b[201~' : data); }
  snapshot(): Screen {
    const b = this.term.buffer.active;
    this.scroll = Math.max(0, Math.min(this.scroll, b.baseY));
    const start = b.baseY - this.scroll;
    const rows: Cell[][] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const line = b.getLine(start + y), cells: Cell[] = [];
      for (let x = 0; x < this.term.cols; x++) {
        const c = line?.getCell(x); if (!c || c.getWidth() === 0) { cells.push({ text: '', fg: '#c0caf5', bg: '#111827', bold: false, italic: false, underline: false }); continue; }
        let fg = color(c.getFgColorMode(), c.getFgColor(), '#c0caf5'), bg = color(c.getBgColorMode(), c.getBgColor(), '#111827');
        if (c.isInverse()) [fg, bg] = [bg, fg];
        cells.push({ text: c.isInvisible() ? ' ' : c.getChars() || ' ', fg, bg, bold: !!c.isBold(), italic: !!c.isItalic(), underline: !!c.isUnderline() });
      }
      rows.push(cells);
    }
    return { rows, cursor: { x: b.cursorX, y: this.scroll ? -1 : b.cursorY }, cols: this.term.cols, rowCount: this.term.rows, scroll: this.scroll, alternate: b.type === 'alternate' };
  }
  mouse(e: Extract<WindowInput, { type: 'mouse' | 'wheel' }>, cell: CellSize): boolean {
    // xterm 6 has no public headless mouse API. Keep this pinned adapter here.
    const mouse = (this.term as unknown as { _core: { coreMouseService: {
      areMouseEventsActive: boolean;
      triggerMouseEvent(event: { col: number; row: number; x: number; y: number; button: number; action: number; ctrl: boolean; alt: boolean; shift: boolean }): boolean;
    } } })._core.coreMouseService;
    if (!mouse.areMouseEventsActive || e.mods?.shift) return false;
    const wheel = e.type === 'wheel';
    mouse.triggerMouseEvent({ col: Math.floor(e.x / cell.width), row: Math.floor(e.y / cell.height), x: e.x + 1, y: e.y + 1,
      button: wheel ? 4 : e.button === 'right' ? 2 : e.button === 'middle' ? 1 : e.button === 'none' ? 3 : 0,
      action: wheel ? (e.deltaY < 0 ? 0 : 1) : e.kind === 'up' ? 0 : e.kind === 'move' ? 32 : 1,
      ctrl: !!e.mods?.ctrl, alt: !!e.mods?.alt, shift: !!e.mods?.shift });
    return true;
  }
  close() { this.process.kill(); this.term.dispose(); }
}
export function keySequence(e: EngineKeyEvent, applicationCursor = false): string {
  if (e.kind === 'release') return '';
  const key = e.key.toLowerCase(), mods = e.mods;
  const arrows: Record<string,string> = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F', arrowup: 'A', arrowdown: 'B', arrowright: 'C', arrowleft: 'D' };
  if (arrows[key]) {
    const m = 1 + Number(mods.shift) + 2 * Number(mods.alt) + 4 * Number(mods.ctrl);
    return m > 1 ? `\x1b[1;${m}${arrows[key]}` : `\x1b${applicationCursor ? 'O' : '['}${arrows[key]}`;
  }
  const special: Record<string,string> = { enter: '\r', return: '\r', backspace: '\x7f', tab: mods.shift ? '\x1b[Z' : '\t', escape: '\x1b', esc: '\x1b', delete: '\x1b[3~', insert: '\x1b[2~', pageup: '\x1b[5~', pagedown: '\x1b[6~', f1: '\x1bOP', f2: '\x1bOQ', f3: '\x1bOR', f4: '\x1bOS', f5: '\x1b[15~', f6: '\x1b[17~', f7: '\x1b[18~', f8: '\x1b[19~', f9: '\x1b[20~', f10: '\x1b[21~', f11: '\x1b[23~', f12: '\x1b[24~' };
  let value = special[key] ?? e.text ?? (e.key.length === 1 ? e.key : '');
  if (mods.ctrl && key.length === 1 && key.charCodeAt(0) >= 97 && key.charCodeAt(0) <= 122) value = String.fromCharCode(key.charCodeAt(0) - 96);
  if (mods.ctrl && (key === ' ' || key === '@')) value = '\0';
  return mods.alt && value ? '\x1b' + value : value;
}
