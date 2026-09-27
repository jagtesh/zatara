import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Duplex } from 'node:stream';
import { OwnerServer, Guest } from '../node_modules/@zenbu-labs/pixel/dist/host/server';
import { InstanceRecord, PROTOCOL } from '../node_modules/@zenbu-labs/pixel/dist/instances';
import { applications } from './apps';
import { DesktopState, WindowState, action, bounds, contentSize, constrain, focus } from './model';
import { lines, sendEvent as send, sessionPath, runtime } from './ipc';
import { TaskSampler } from './tasks';
import { Shell, keySequence } from './terminal';
import { terminalScale, scaleRect } from './display';
import { Frame, decodeCommand } from './protocol';
import type { TerminalColors } from './pixel';
import { Broker } from './broker';
import { hostServices, AppPrincipal } from './host-services';
import { RuntimeError } from './sdk/wire';
export function serve(name: string) {
  process.umask(0o077);
  const socketPath = sessionPath(name), frameDir = path.join(runtime, `${name}-frames`), guestSocket = path.join(runtime, `${name}-pixel.sock`);
  fs.mkdirSync(frameDir, { recursive: true, mode: 0o700 });
  let client: net.Socket | null = null, stopping = false, nextOrder = 0;
  let cell = { width: 8, height: 18 };
  let colors: TerminalColors = { foreground: [220,228,245,255], background: [17,24,39,255], palette: [] };
  const state: DesktopState = { windows: [], focused: null, width: 1200, height: 800, apps: applications(), session: name, attached: false, scale: 1 };
  const shells = new Map<string, Shell>(), guests = new Map<string, Guest>(), children = new Map<string, ChildProcess>(), records = new Map<string, InstanceRecord>();
  const frames = new Map<string, Frame>(), dirtyFrames = new Set<string>(), dirtyShells = new Set<string>();
  const metrics = { startedAt: Date.now(), frames: 0, frameBytes: 0, notifications: 0, coalesced: 0, inputEvents: 0, frameAfterInputMs: [] as number[] };
  const inputAt = new Map<string, number>();
  const taskSampler = new TaskSampler();
  const principals = new Map<string, AppPrincipal>();
  const broker = new Broker(hostServices({
    session: name,
    principal: id => principals.get(id),
    tasks: sampleTasks,
    windowAction,
    switchSession,
  }));
  const owner = new OwnerServer(guestSocket, () => cell);
  let timer: NodeJS.Timeout | null = null;
  function sampleTasks() {
    return taskSampler.sample(state.windows.map(w => {
      const child = children.get(w.id), guestPid = guests.get(w.id)?.pid;
      return { ...w, guestPid, rootPids: [w.kind === 'shell' && w.status === 'Running' ? w.pid : 0,
        child && child.exitCode === null && child.signalCode === null ? child.pid ?? 0 : 0, guestPid ?? 0] };
    }));
  }
  function windowAction(id: string, op: 'focus' | 'maximize' | 'minimize' | 'close') {
    const w = state.windows.find(w => w.id === id);
    if (!w) throw new Error('App instance is no longer available');
    if (op === 'close') closeWindow(id);
    else {
      action(state, id, { op });
      if (op === 'maximize' || op === 'focus') syncWindow(w);
      syncFocus(); changed();
    }
  }
  function switchSession(session: string) {
    sessionPath(session);
    if (!client) throw new RuntimeError('NOT_FOUND', 'This session has no desktop attachment to switch');
    if (!send(client, { type: 'switch', session })) throw new RuntimeError('DISCONNECTED', 'Desktop attachment is unavailable');
  }
  function schedule() { if (!timer && client) timer = setTimeout(flush, 16); }
  function flush() {
    timer = null;
    if (!client) return;
    for (const id of dirtyFrames) { const w = state.windows.find(w => w.id === id); const frame = frames.get(id); if (w && !w.minimized && frame) { send(client, { type: 'frame', id, frame }); metrics.notifications++; } }
    dirtyFrames.clear();
    for (const id of dirtyShells) { const w = state.windows.find(w => w.id === id); if (w && !w.minimized) send(client, { type: 'screen', id, screen: shells.get(id)?.snapshot() }); }
    dirtyShells.clear();
  }
  function changed() { send(client, { type: 'state', state }); }
  function setCell(next: { width: number; height: number }) {
    const nextScale = terminalScale(next.height), ratio = nextScale / (state.scale ?? 1);
    if (ratio !== 1) for (const w of state.windows) { Object.assign(w, scaleRect(w, ratio)); if (w.restore) w.restore = scaleRect(w.restore, ratio); }
    state.scale = nextScale; cell = next;
  }
  function syncWindow(w: WindowState) {
    const r = bounds(w, state), { width, height } = contentSize(r, cell, state.scale);
    shells.get(w.id)?.resize(Math.floor(width / cell.width), Math.floor(height / cell.height));
    guests.get(w.id)?.send({ type: 'size', width, height, cols: width / cell.width, rows: height / cell.height });
    dirtyShells.add(w.id); dirtyFrames.add(w.id); schedule();
  }
  function syncFocus() { for (const [id, guest] of guests) guest.send({ type: 'focus', focused: !!client && state.focused === id && !state.windows.find(w => w.id === id)?.minimized }); }
  owner.onJoin = guest => {
    const w = state.windows.find(w => w.id === guest.pane) ?? state.windows.find(w => w.pid === guest.pid) ?? state.windows.find(w => w.kind === 'pixel' && !guests.has(w.id) && w.status === 'Starting');
    if (!w) { guest.close(); return; }
    guests.set(w.id, guest); w.status = 'Running';
    const r = bounds(w, state), { width, height } = contentSize(r, cell, state.scale);
    guest.send({ type: 'init', width, height, cols: width / cell.width, rows: height / cell.height, colors, focused: !!client && state.focused === w.id });
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
    const id = randomUUID(), n = state.windows.length;
    const w: WindowState = { id, app: app.id, title: app.name, kind: app.kind, pid: 0, minimized: false, maximized: false, status: 'Starting', ...constrain(scaleRect({ x: 160 + n % 6 * 32, y: 60 + n % 6 * 30, width: app.initialSize?.width ?? 680, height: app.initialSize?.height ?? 450 }, state.scale ?? 1), state.width, state.height, state.scale) };
    w.order = nextOrder++;
    state.windows.push(w); focus(state, id);
    if (app.kind === 'shell') {
      let shell: Shell;
      try { shell = new Shell(process.env.ZATARA_CWD || process.cwd(), () => { dirtyShells.add(id); schedule(); }, code => { w.status = `Exited (${code})`; changed(); }); } catch (e) { action(state, id, { op: 'close' }); changed(); throw e; }
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
      const child = spawn(app.command[0], app.command.slice(1), { detached: true, stdio: ['ignore', log, log, 'pipe'], env: { ...process.env, ...appEnv, ZATARA_NODE: process.execPath, ZATARA_SESSION: name, PIXEL_TTY: tty, PIXEL_PANE: id, ZATARA_HOST: guestSocket, ZATARA_PANE: id, ZATARA_RUNTIME_FD: '3', NODE_ENV: 'production' } });
      fs.closeSync(log); children.set(id, child); w.pid = child.pid ?? 0;
      // Only host-owned built-ins receive administrative capabilities.
      // Custom registrations cannot shadow these IDs.
      principals.set(id, { id, manageTasks: app.id === 'tasks', manageSessions: app.id === 'sessions' });
      const channel = child.stdio[3];
      if (channel instanceof Duplex) broker.add(id, channel, app.messaging);
      const revoke = () => { principals.delete(id); broker.remove(id); };
      child.on('error', e => { revoke(); w.status = e.message; changed(); });
      child.on('exit', code => { revoke(); if (!guests.has(id)) { w.status = `Launcher exited (${code}); no compatible Pixel guest`; changed(); } });
      setTimeout(() => { if (w.status === 'Starting') { w.status = 'No Pixel guest connected. Check app compatibility and session logs.'; changed(); } }, 15000).unref();
    }
    syncFocus(); changed(); return id;
  }
  function closeWindow(id: string) {
    principals.delete(id); broker.remove(id);
    shells.get(id)?.close(); shells.delete(id);
    guests.get(id)?.close(); guests.delete(id);
    const child = children.get(id); if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } children.delete(id);
    records.get(id)?.withdraw(); records.delete(id);
    frames.delete(id); dirtyFrames.delete(id); dirtyShells.delete(id); inputAt.delete(id);
    fs.rmSync(path.join(frameDir, id + '.bgra'), { force: true });
    action(state, id, { op: 'close' }); syncFocus(); changed();
  }
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    lines(socket, decodeCommand, m => {
      if (m.type === 'attach') {
        if (client && client !== socket) { send(socket, { type: 'error', error: 'Session already attached. Use zatara detach first.' }); socket.end(); return; }
        client = socket; state.attached = true;
        if (m.width && m.height) { state.width = m.width; state.height = m.height; }
        if (m.cell) setCell(m.cell);
        if (m.colors) colors = m.colors;
        for (const w of state.windows) { Object.assign(w, constrain(w, state.width, state.height, state.scale)); syncWindow(w); }
        syncFocus(); changed(); schedule(); return;
      }
      if (m.type === 'list' || m.type === 'inspect') { send(socket, { type: 'state', state, metrics, pid: process.pid, rendering: { cell, surfaces: Object.fromEntries([...frames].map(([id, f]) => [id, { width: f.width, height: f.height, seq: f.seq }])) } }); return; }
      if (m.type === 'tasks') {
        void sampleTasks().then(tasks => send(socket, { type: 'tasks', tasks, servicePid: process.pid }), e => send(socket, { type: 'error', error: String(e) })); return;
      }
      if (m.type === 'switch') {
        switchSession(m.session); send(socket, { type: 'ok' }); return;
      }
      if (m.type === 'detach') { client?.end(); client = null; state.attached = false; syncFocus(); send(socket, { type: 'ok' }); return; }
      if (m.type === 'kill') {
        if (m.expected && (m.expected.pid !== process.pid || m.expected.startedAt !== metrics.startedAt)) throw new Error('This session restarted. Refresh before ending it.');
        send(socket, { type: 'ok' }); setTimeout(stop, 30); return;
      }
      if (m.type === 'launch') { send(socket, { type: 'launched', id: launch(m.app) }); return; }
      if (m.type === 'action') {
        const w = state.windows.find(w => w.id === m.id);
        if (m.op === 'close') closeWindow(m.id);
        else { action(state, m.id, m); if (w && (m.op === 'move' || m.op === 'maximize' || m.op === 'focus')) syncWindow(w); syncFocus(); changed(); }
        if (socket !== client) send(socket, { type: 'ok' }); return;
      }
      if (m.type === 'resize') {
        if (socket !== client) return;
        if (m.cell) setCell(m.cell);
        state.width = Math.max(120, Math.min(8000, m.width)); state.height = Math.max(140, Math.min(8000, m.height));
        for (const w of state.windows) { Object.assign(w, constrain(w, state.width, state.height, state.scale)); syncWindow(w); } changed(); return;
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
        } else if (guest) guest.send(e.type === 'text' ? { type: 'paste', text: e.text } : e);
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
    broker.close();
    owner.stop(); client?.destroy(); server.close();
    if (timer) clearTimeout(timer);
    fs.rmSync(socketPath, { force: true }); fs.rmSync(socketPath + '.pid', { force: true });
    setTimeout(() => process.exit(0), 100).unref();
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  // Deliberately ignore terminal hangup: only explicit kill ends the session.
  process.on('SIGHUP', () => {});
}
