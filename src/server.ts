import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { OwnerServer, Guest } from '../node_modules/@zenbu-labs/pixel/dist/host/server';
import { InstanceRecord, PROTOCOL } from '../node_modules/@zenbu-labs/pixel/dist/instances';
import { applications } from './apps';
import { DesktopState, WindowState, action, bounds, constrain, focus, TITLE } from './model';
import { lines, send, sessionPath, runtime } from './ipc';
import { Shell, keySequence } from './terminal';
type Frame = { path: string; width: number; height: number; seq: number };
export function serve(name: string) {
  process.umask(0o077);
  const socketPath = sessionPath(name), frameDir = path.join(runtime, `${name}-frames`), guestSocket = path.join(runtime, `${name}-pixel.sock`);
  fs.mkdirSync(frameDir, { recursive: true, mode: 0o700 });
  let client: net.Socket | null = null, stopping = false, nextOrder = 0;
  let cell = { width: 8, height: 18 }, colors = { foreground: [220,228,245,255], background: [17,24,39,255], palette: [] };
  const state: DesktopState = { windows: [], focused: null, width: 1200, height: 800, apps: applications(), session: name, attached: false };
  const shells = new Map<string, Shell>(), guests = new Map<string, Guest>(), children = new Map<string, ChildProcess>(), records = new Map<string, InstanceRecord>();
  const frames = new Map<string, Frame>(), dirtyFrames = new Set<string>(), dirtyShells = new Set<string>();
  const metrics = { startedAt: Date.now(), frames: 0, frameBytes: 0, notifications: 0, coalesced: 0, inputEvents: 0, frameAfterInputMs: [] as number[] };
  const inputAt = new Map<string, number>();
  const owner = new OwnerServer(guestSocket, () => cell);
  let timer: NodeJS.Timeout | null = null;
  function schedule() { if (!timer && client) timer = setTimeout(flush, 16); }
  function flush() {
    timer = null;
    if (!client) return;
    for (const id of dirtyFrames) { const w = state.windows.find(w => w.id === id); if (w && !w.minimized) { send(client, { type: 'frame', id, frame: frames.get(id) }); metrics.notifications++; } }
    dirtyFrames.clear();
    for (const id of dirtyShells) { const w = state.windows.find(w => w.id === id); if (w && !w.minimized) send(client, { type: 'screen', id, screen: shells.get(id)?.snapshot() }); }
    dirtyShells.clear();
  }
  function changed() { send(client, { type: 'state', state }); }
  function syncWindow(w: WindowState) {
    const r = bounds(w, state), width = Math.max(8, Math.floor((r.width - 4) / cell.width) * cell.width), height = Math.max(cell.height, Math.floor((r.height - TITLE - 4) / cell.height) * cell.height);
    shells.get(w.id)?.resize(Math.floor(width / cell.width), Math.floor(height / cell.height));
    guests.get(w.id)?.send({ type: 'size', width, height, cols: width / cell.width, rows: height / cell.height });
    dirtyShells.add(w.id); dirtyFrames.add(w.id); schedule();
  }
  function syncFocus() { for (const [id, guest] of guests) guest.send({ type: 'focus', focused: !!client && state.focused === id && !state.windows.find(w => w.id === id)?.minimized }); }
  owner.onJoin = guest => {
    const w = state.windows.find(w => w.id === guest.pane) ?? state.windows.find(w => w.pid === guest.pid) ?? state.windows.find(w => w.kind === 'pixel' && !guests.has(w.id) && w.status === 'Starting');
    if (!w) { guest.close(); return; }
    guests.set(w.id, guest); w.status = 'Running';
    const r = bounds(w, state), width = Math.max(cell.width, Math.floor((r.width - 4) / cell.width) * cell.width), height = Math.max(cell.height, Math.floor((r.height - TITLE - 4) / cell.height) * cell.height);
    guest.send({ type: 'init', width, height, cols: width / cell.width, rows: height / cell.height, colors: colors as any, focused: !!client && state.focused === w.id });
    guest.onFrame = frame => {
      try {
        if (frame.width * frame.height > 16_000_000 || frame.width <= 0 || frame.height <= 0) return;
        const dest = path.join(frameDir, w.id + '.bgra'), tmp = dest + '.tmp';
        // Copy before ACK: the guest can reuse its shared-memory file immediately.
        // Atomic rename means the client always opens a complete immutable frame.
        fs.copyFileSync(frame.path, tmp); fs.renameSync(tmp, dest);
        const previous = frames.get(w.id);
        frames.set(w.id, { path: dest, width: frame.width, height: frame.height, seq: (previous?.seq ?? 0) + 1 });
        if (dirtyFrames.has(w.id)) metrics.coalesced++;
        dirtyFrames.add(w.id); metrics.frames++; metrics.frameBytes += frame.width * frame.height * 4;
        const at = inputAt.get(w.id); if (at) { metrics.frameAfterInputMs.push(performance.now() - at); if (metrics.frameAfterInputMs.length > 1000) metrics.frameAfterInputMs.shift(); inputAt.delete(w.id); }
        schedule();
      } catch (e) { w.status = `Frame error: ${e}`; changed(); }
      finally { frame.ack(); }
    };
    guest.onTitle = title => { w.title = title.slice(0, 160); changed(); };
    guest.onClipboard = text => send(client, { type: 'clipboard', text });
    guest.onPointer = shape => { if (state.focused === w.id) send(client, { type: 'pointer', shape }); };
    guest.onClose = () => { guests.delete(w.id); w.status = 'App exited'; changed(); };
    changed();
  };
  function launch(appId: string) {
    const app = state.apps.find(a => a.id === appId);
    if (!app) throw new Error('Unknown app');
    if (!app.available) throw new Error(app.reason);
    if (state.windows.length >= 24) throw new Error('This proof of concept supports up to 24 windows');
    const id = randomUUID().slice(0, 8), n = state.windows.length;
    const w: WindowState = { id, app: app.id, title: app.name, kind: app.kind, pid: 0, minimized: false, maximized: false, status: 'Starting', ...constrain({ x: 160 + n % 6 * 32, y: 60 + n % 6 * 30, width: 680, height: 450 }, state.width, state.height) };
    w.order = nextOrder++;
    state.windows.push(w); focus(state, id);
    if (app.kind === 'shell') {
      let shell: Shell;
      try { shell = new Shell(process.env.ZATARA_CWD || process.cwd(), () => { dirtyShells.add(id); schedule(); }, code => { w.status = `Exited (${code})`; changed(); }); } catch (e) { action(state, id, 'close'); changed(); throw e; }
      shells.set(id, shell); w.pid = shell.process.pid; w.status = 'Running'; syncWindow(w);
    } else {
      // Publish a synthetic pane only to this app's environment. Its owner is
      // the persistent service, never the short-lived desktop attachment.
      const tty = `/zatara/${name}/${id}`;
      records.set(id, new InstanceRecord({ tty, pid: process.pid, socket: guestSocket, protocol: PROTOCOL, name: 'Zatara', title: app.name, cwd: process.cwd(), startedAt: Date.now() }));
      const log = fs.openSync(path.join(frameDir, id + '.log'), 'a', 0o600);
      const codeRoot = path.resolve(app.command[0], '../..');
      const appEnv = app.id === 'code' ? { TODE_TERMINAL_BROWSER_BIN: path.join(__dirname, 'code-host.js'),
        ...(fs.existsSync(path.join(codeRoot, 'dist/main.js')) ? { TODE_INSTALL_ROOT: codeRoot } : {}) } : {};
      const child = spawn(app.command[0], app.command.slice(1), { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...appEnv, ZATARA_NODE: process.execPath, PIXEL_TTY: tty, PIXEL_PANE: id, ZATARA_HOST: guestSocket, ZATARA_PANE: id, NODE_ENV: 'production' } });
      fs.closeSync(log); children.set(id, child); w.pid = child.pid ?? 0;
      child.on('error', e => { w.status = e.message; changed(); });
      child.on('exit', code => { if (!guests.has(id)) { w.status = `Launcher exited (${code}); no compatible Pixel guest`; changed(); } });
      setTimeout(() => { if (w.status === 'Starting') { w.status = 'No Pixel guest connected. Check app compatibility and session logs.'; changed(); } }, 15000).unref();
    }
    syncFocus(); changed(); return id;
  }
  function closeWindow(id: string) {
    shells.get(id)?.close(); shells.delete(id);
    guests.get(id)?.close(); guests.delete(id);
    const child = children.get(id); if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } children.delete(id);
    records.get(id)?.withdraw(); records.delete(id);
    frames.delete(id); dirtyFrames.delete(id); dirtyShells.delete(id); inputAt.delete(id);
    fs.rmSync(path.join(frameDir, id + '.bgra'), { force: true });
    action(state, id, 'close'); syncFocus(); changed();
  }
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    lines(socket, m => {
      if (m.type === 'attach') {
        if (client && client !== socket) { send(socket, { type: 'error', error: 'Session already attached. Use zatara detach first.' }); socket.end(); return; }
        client = socket; state.attached = true;
        if (m.width && m.height) { state.width = m.width; state.height = m.height; }
        if (m.cell) cell = m.cell;
        if (m.colors) colors = m.colors;
        for (const w of state.windows) { Object.assign(w, constrain(w, state.width, state.height)); syncWindow(w); }
        syncFocus(); changed(); schedule(); return;
      }
      if (m.type === 'list' || m.type === 'inspect') { send(socket, { type: 'state', state, metrics, pid: process.pid }); return; }
      if (m.type === 'detach') { client?.end(); client = null; state.attached = false; syncFocus(); send(socket, { type: 'ok' }); return; }
      if (m.type === 'kill') { send(socket, { type: 'ok' }); setTimeout(stop, 30); return; }
      if (m.type === 'launch') { send(socket, { type: 'launched', id: launch(m.app) }); return; }
      if (m.type === 'action') {
        const w = state.windows.find(w => w.id === m.id);
        if (m.op === 'close') closeWindow(m.id);
        else { action(state, m.id, m.op, m.rect); if (w && (m.op === 'move' || m.op === 'maximize' || m.op === 'focus')) syncWindow(w); syncFocus(); changed(); }
        if (socket !== client) send(socket, { type: 'ok' }); return;
      }
      if (m.type === 'resize' && socket === client) {
        state.width = Math.max(120, Math.min(8000, m.width)); state.height = Math.max(140, Math.min(8000, m.height));
        for (const w of state.windows) { Object.assign(w, constrain(w, state.width, state.height)); syncWindow(w); } changed(); return;
      }
      if (m.type === 'screen') { send(socket, { type: 'screen', id: m.id, screen: shells.get(m.id)?.snapshot() }); return; }
      if (m.type === 'input') {
        if (socket === client && state.focused !== m.id) return;
        metrics.inputEvents++; inputAt.set(m.id, performance.now());
        const shell = shells.get(m.id), guest = guests.get(m.id), e = m.event;
        if (shell) {
          if (e.type === 'key') shell.input(keySequence(e, shell.term.modes.applicationCursorKeysMode));
          if (e.type === 'paste') shell.paste(e.text);
          if (e.type === 'text') shell.input(e.text);
          if (e.type === 'wheel' && !shell.mouse(e, cell)) { shell.scroll += Math.sign(e.deltaY) * -3; dirtyShells.add(m.id); schedule(); }
          if (e.type === 'mouse') shell.mouse(e, cell);
        } else if (guest) guest.send(e);
        if (socket !== client) send(socket, { type: 'ok' });
        return;
      }
    });
    socket.on('close', () => { if (client === socket) { client = null; state.attached = false; syncFocus(); } });
  });
  server.on('error', e => { console.error(e); stop(); });
  server.listen(socketPath, () => fs.writeFileSync(socketPath + '.pid', String(process.pid)));
  function stop() {
    if (stopping) return; stopping = true;
    for (const w of [...state.windows]) closeWindow(w.id);
    owner.stop(); client?.destroy(); server.close();
    if (timer) clearTimeout(timer);
    fs.rmSync(socketPath, { force: true }); fs.rmSync(socketPath + '.pid', { force: true });
    setTimeout(() => process.exit(0), 100).unref();
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  // Deliberately ignore terminal hangup: only explicit kill ends the session.
  process.on('SIGHUP', () => {});
}
