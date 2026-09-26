import fs from 'node:fs';
import path from 'node:path';
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text as PixelText, TextProps, Input, createRoot, NodeHandle } from './pixel';
import { request } from './ipc';
import { ensure, listSessions, SessionInfo } from './sessions';
import { TaskInfo } from './tasks';
import { theme as T, verticalGradient, applyAppearance } from './theme';
import { watchConfig } from './config';
let configError = '';
const mode = process.argv[2] === 'sessions' ? 'sessions' : 'tasks';
const session = process.env.ZATARA_SESSION ?? path.basename(process.env.ZATARA_HOST ?? '').replace(/-pixel\.sock$/, '');
let focused = false, notifyFocus = (_: boolean) => {}, font = 0;
const root = createRoot({ host: { socket: process.env.ZATARA_HOST!, pane: process.env.ZATARA_PANE!, name: mode === 'sessions' ? 'Sessions' : 'Task Manager' }, devtools: false,
  onFocus(value) { focused = value; notifyFocus(value); }, onResize() { root.render(<Manager />); }, onHostClosed: () => process.exit(0),
});
root.setTitle(mode === 'sessions' ? 'Session Manager' : `Task Manager · ${session}`);
function Text(props: TextProps) { return <PixelText {...props} style={{ font, fontSize: T.labelSize, color: T.text, wrap: false, ellipsis: true, selectable: false, ...props.style }} />; }
function Button({ label, action, danger = false, disabled = false }: { label: string; action(): void; danger?: boolean; disabled?: boolean }) {
  return <Box onClick={() => { if (!disabled) action(); }} style={{ height: 34, padding: { left: 10, right: 10 }, alignItems: 'center', cornerRadius: 6, background: disabled ? '#242e3e' : verticalGradient(danger ? '#733c51' : '#39465f', danger ? '#4c2b3b' : '#26344b'), hoverBackground: disabled ? '#242e3e' : danger ? '#93465c' : '#4b5b78', flexShrink: 0 }}><Text style={{ color: disabled ? '#697a95' : T.text }}>{label}</Text></Box>;
}
function Manager() {
  const [active, setActive] = useState(focused), [sessions, setSessions] = useState<SessionInfo[]>([]), [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [selected, select] = useState(mode === 'sessions' ? session : ''), [newName, setNewName] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmation, confirm] = useState<{ label: string; run(): Promise<void> } | null>(null);
  const [working, setWorking] = useState(false), refreshing = useRef(false), acting = useRef(false), scroll = useRef<NodeHandle>(null), offset = useRef(0);
  notifyFocus = setActive;
  async function refresh() {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      if (mode === 'sessions') { const next = await listSessions(); setSessions(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); }
      else { const m = await request(session, { type: 'tasks' }); setTasks(m.tasks); }
    } catch (e) { setError(String(e)); }
    finally { refreshing.current = false; }
  }
  useEffect(() => { void refresh(); if (active) { const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer); } }, [active]);
  async function perform(work: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true; setWorking(true); setError(''); setNotice(''); confirm(null);
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { acting.current = false; setWorking(false); }
  }
  const selectedSession = sessions.find(s => s.name === selected), selectedTask = tasks.find(t => t.id === selected);
  const width = root.info.width, compact = width < 570;
  const listHeight = Math.max(44, root.info.height - (mode === 'sessions' ? 230 : 202));
  const rows = mode === 'sessions' ? sessions : tasks;
  async function taskAction(op: string) { if (!selectedTask) return; await request(session, { type: 'action', id: selectedTask.id, op }); }
  function terminateSession() {
    if (!selectedSession) return;
    const chosen = selectedSession;
    confirm({ label: `End ${chosen.name} and all ${chosen.windows} apps?`, run: async () => {
      const current = await request(chosen.name, { type: 'inspect' });
      if (current.pid !== chosen.pid) throw new Error('This session restarted. Refresh before ending it.');
      await request(chosen.name, { type: 'kill' });
      setNotice(`Ended ${chosen.name}`);
    } });
  }
  return <Box style={{ width: '100%', height: '100%', background: '#131c2d', padding: 18, flexDirection: 'column', gap: 8, overflow: 'scroll' }}>
    <Box style={{ height: 30, alignItems: 'center', flexShrink: 0 }}><Text style={{ fontSize: T.labelSize + 9, flexGrow: 1 }}>{mode === 'sessions' ? 'Sessions' : 'Task Manager'}</Text><Button label="Refresh" action={() => void refresh()} /></Box>
    <Text style={{ height: 20, color: T.muted }}>{session} · {working ? 'Working…' : active ? 'Updates every 2 seconds' : 'Updates paused while unfocused'}</Text>
    {mode === 'sessions' && <Box style={{ gap: 8, height: 36, flexShrink: 0 }}>
      <Box style={{ height: 34, alignItems: 'center' }}><Text>Name</Text></Box>
      <Input value={newName} onChange={setNewName} style={{ flexGrow: 1, flexBasis: 0, minWidth: 60, height: 34, padding: 8, fontSize: T.labelSize, color: T.text, background: '#233149', cornerRadius: 6 }} />
      <Button label="Create" action={() => void perform(async () => { if (!newName.trim()) throw new Error('Enter a session name.'); await ensure(newName.trim()); select(newName.trim()); setNotice(`Ready: ${newName.trim()}`); setNewName(''); })} />
    </Box>}
    <Box ref={scroll} contentHeight={rows.length * 44} onScroll={e => { offset.current = e.offset; }} onWheel={e => { offset.current = Math.max(0, Math.min(offset.current + e.deltaY, rows.length * 44 - listHeight)); scroll.current?.scrollTo(offset.current, false); }} style={{ height: listHeight, flexShrink: 0, overflow: 'scroll', flexDirection: 'column', background: '#19263a', cornerRadius: 7 }}>
      {mode === 'sessions' ? sessions.map(s => <Box key={s.name} onClick={() => { select(s.name); confirm(null); }} style={{ height: 44, flexShrink: 0, padding: 10, gap: 10, alignItems: 'center', background: selected === s.name ? '#39415d' : undefined, hoverBackground: '#2d3c55' }}>
        <Text style={{ width: Math.max(70, width - (compact ? 200 : 370)) }}>{s.name}{s.name === session ? ' · current' : ''}</Text>
        <Text style={{ width: 84, color: s.attached ? T.mint : T.muted }}>{s.attached ? 'Attached' : 'Detached'}</Text>
        {!compact && <Text style={{ width: 74, color: T.muted }}>{s.windows} apps</Text>}
        {!compact && <Text style={{ color: T.muted }}>PID {s.pid}</Text>}
      </Box>) : tasks.map(t => <Box key={t.id} onClick={() => { select(t.id); confirm(null); }} style={{ height: 44, flexShrink: 0, padding: 10, gap: 10, alignItems: 'center', background: selected === t.id ? '#39415d' : undefined, hoverBackground: '#2d3c55' }}>
        <Text style={{ width: Math.max(70, width - (compact ? 200 : 366)) }}>{t.title}</Text>
        <Text style={{ width: 80, color: T.muted }}>{t.rssMiB.toFixed(1)} MiB</Text>
        {!compact && <Text style={{ width: 75, color: T.mint }}>{t.cpuPercent === null ? '— CPU' : `${t.cpuPercent.toFixed(1)}% CPU`}</Text>}
        {!compact && <Text style={{ width: 100, color: T.muted }}>{t.minimized ? 'Minimized' : t.status}</Text>}
      </Box>)}
    </Box>
    <Text style={{ height: 34, color: T.muted, wrap: true, fontSize: Math.max(10, T.labelSize - 1) }}>{mode === 'sessions' ? selectedSession ? `PID ${selectedSession.pid} · ${selectedSession.windows} apps · ${selectedSession.name === session ? 'Ending this session also closes this manager.' : 'Switch keeps the current session alive.'}` : 'Select a session. Detached sessions keep their applications running.' : selectedTask ? `Launcher ${selectedTask.pid}${selectedTask.guestPid ? ` · guest ${selectedTask.guestPid}` : ''} · ${selectedTask.processCount} processes · ${selectedTask.status}` : 'Select an app to restore, minimize, or end it.'}</Text>
    <Box style={{ gap: 8, height: 34, flexShrink: 0 }}>
      {confirmation ? <><Button label="Cancel" action={() => confirm(null)} /><Button label="Confirm end" danger action={() => void perform(confirmation.run)} /></> : mode === 'sessions' ? <>
        <Button disabled={!selectedSession || selectedSession.name === session || working} label="Switch" action={() => void perform(async () => { if (!selectedSession) throw new Error('Select a session.'); if (selectedSession.name === session) return; if (selectedSession.attached) throw new Error('Detach that session first; it already has an attachment.'); await request(session, { type: 'switch', session: selectedSession.name }); })} />
        <Button disabled={!selectedSession?.attached || working} label="Detach" action={() => void perform(async () => { if (!selectedSession) throw new Error('Select a session.'); await request(selectedSession.name, { type: 'detach' }); })} />
        <Button disabled={!selectedSession || working} label="End session" danger action={terminateSession} />
      </> : <>
        <Button disabled={!selectedTask || working} label="Restore" action={() => void perform(() => taskAction('focus'))} />
        <Button disabled={!selectedTask || working} label="Minimize" action={() => void perform(() => taskAction('minimize'))} />
        <Button disabled={!selectedTask || working} label="End app" danger action={() => { if (selectedTask) { const chosen = selectedTask; confirm({ label: `End ${chosen.title}?`, run: async () => { await request(session, { type: 'action', id: chosen.id, op: 'close' }); select(''); } }); } }} />
      </>}
    </Box>
    <Text style={{ fontSize: Math.max(10, T.labelSize - 1), color: (configError || error) ? '#ffb7c7' : confirmation ? '#f9bc75' : T.muted, wrap: true }}>{configError || error || confirmation?.label || notice || (mode === 'tasks' ? 'CPU: one core = 100%. RSS: process-tree sum; shared backends outside the tree are excluded.' : 'End session terminates its apps. Detach preserves them.')}</Text>
  </Box>;
}
root.render(<Manager />);
if (fs.existsSync('/System/Library/Fonts/SFNS.ttf')) void root.registerFont('/System/Library/Fonts/SFNS.ttf').then(value => { font = value; root.render(<Manager />); });
const stopConfig = watchConfig(next => { applyAppearance(next); root.render(<Manager />); }, message => { if (configError !== message) { configError = message; root.render(<Manager />); } });
process.on('SIGTERM', () => { stopConfig(); root.stop(); process.exit(0); });
