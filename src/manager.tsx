import { useRef, useState } from 'react';
import { Box, type TextProps, Input, type NodeHandle, theme as T, verticalGradient, AppText, runAppWindow, useAppWindow } from './sdk';
import { ensureSession, switchSession, detachSession, endSession, windowAction, type WindowOperation } from './sdk/services';
import { useSessions, useTasks } from './sdk/hooks';
const mode = process.argv[2] === 'sessions' ? 'sessions' : 'tasks';
function Text(props: TextProps) { return <AppText {...props} style={{ fontSize: T.labelSize, color: T.text, wrap: false, ellipsis: true, selectable: false, ...props.style }} />; }
function Button({ label, action, danger = false, disabled = false }: { label: string; action(): void; danger?: boolean; disabled?: boolean }) {
  return <Box onClick={() => { if (!disabled) action(); }} style={{ height: 34, padding: { left: 10, right: 10 }, alignItems: 'center', cornerRadius: 6, background: disabled ? '#242e3e' : verticalGradient(danger ? '#733c51' : '#39465f', danger ? '#4c2b3b' : '#26344b'), hoverBackground: disabled ? '#242e3e' : danger ? '#93465c' : '#4b5b78', flexShrink: 0 }}><Text style={{ color: disabled ? '#697a95' : T.text }}>{label}</Text></Box>;
}
function Manager() {
  const { session, focused: active, viewport, configError } = useAppWindow();
  const sessionList = useSessions(active, mode === 'sessions'), taskList = useTasks(active, mode === 'tasks');
  const sessions = sessionList.data, tasks = taskList.data, list = mode === 'sessions' ? sessionList : taskList;
  const [selected, select] = useState(mode === 'sessions' ? session : ''), [newName, setNewName] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmation, confirm] = useState<{ label: string; run(): Promise<void> } | null>(null);
  const [working, setWorking] = useState(false), acting = useRef(false), scroll = useRef<NodeHandle>(null), offset = useRef(0);
  const refresh = list.refresh;
  async function perform(work: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true; setWorking(true); setError(''); setNotice(''); confirm(null);
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { acting.current = false; setWorking(false); }
  }
  const selectedSession = sessions.find(s => s.name === selected), selectedTask = tasks.find(t => t.id === selected);
  const width = viewport.width, compact = width < 570;
  const listHeight = Math.max(44, viewport.height - (mode === 'sessions' ? 230 : 202));
  const rows = mode === 'sessions' ? sessions : tasks;
  async function taskAction(op: WindowOperation) { if (!selectedTask) return; await windowAction(selectedTask.id, op); }
  function terminateSession() {
    if (!selectedSession) return;
    const chosen = selectedSession;
    confirm({ label: `End ${chosen.name} and all ${chosen.windows} apps?`, run: async () => {
      await endSession(chosen);
      setNotice(`Ended ${chosen.name}`);
    } });
  }
  return <Box style={{ width: '100%', height: '100%', background: '#131c2d', padding: 18, flexDirection: 'column', gap: 8, overflow: 'scroll' }}>
    <Box style={{ height: 30, alignItems: 'center', flexShrink: 0 }}><Text style={{ fontSize: T.labelSize + 9, flexGrow: 1 }}>{mode === 'sessions' ? 'Sessions' : 'Task Manager'}</Text><Button label="Refresh" action={() => void refresh()} /></Box>
    <Text style={{ height: 20, color: T.muted }}>{session} · {working ? 'Working…' : active ? 'Updates every 2 seconds' : 'Updates paused while unfocused'}</Text>
    {mode === 'sessions' && <Box style={{ gap: 8, height: 36, flexShrink: 0 }}>
      <Box style={{ height: 34, alignItems: 'center' }}><Text>Name</Text></Box>
      <Input value={newName} onChange={setNewName} style={{ flexGrow: 1, flexBasis: 0, minWidth: 60, height: 34, padding: 8, fontSize: T.labelSize, color: T.text, background: '#233149', cornerRadius: 6 }} />
      <Button label="Create" action={() => void perform(async () => { if (!newName.trim()) throw new Error('Enter a session name.'); await ensureSession(newName.trim()); select(newName.trim()); setNotice(`Ready: ${newName.trim()}`); setNewName(''); })} />
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
        <Button disabled={!selectedSession || selectedSession.name === session || working} label="Switch" action={() => void perform(async () => { if (!selectedSession) throw new Error('Select a session.'); if (selectedSession.name === session) return; if (selectedSession.attached) throw new Error('Detach that session first; it already has an attachment.'); await switchSession(selectedSession.name); })} />
        <Button disabled={!selectedSession?.attached || working} label="Detach" action={() => void perform(async () => { if (!selectedSession) throw new Error('Select a session.'); await detachSession(selectedSession.name); })} />
        <Button disabled={!selectedSession || working} label="End session" danger action={terminateSession} />
      </> : <>
        <Button disabled={!selectedTask || working} label="Restore" action={() => void perform(() => taskAction('focus'))} />
        <Button disabled={!selectedTask || working} label="Minimize" action={() => void perform(() => taskAction('minimize'))} />
        <Button disabled={!selectedTask || working} label="End app" danger action={() => { if (selectedTask) { const chosen = selectedTask; confirm({ label: `End ${chosen.title}?`, run: async () => { await windowAction(chosen.id, 'close'); select(''); } }); } }} />
      </>}
    </Box>
    <Text style={{ fontSize: Math.max(10, T.labelSize - 1), color: (configError || error || list.error) ? '#ffb7c7' : confirmation ? '#f9bc75' : T.muted, wrap: true }}>{configError || error || list.error || confirmation?.label || notice || (mode === 'tasks' ? 'CPU: one core = 100%. RSS: process-tree sum; shared backends outside the tree are excluded.' : 'End session terminates its apps. Detach preserves them.')}</Text>
  </Box>;
}
runAppWindow({ name: mode === 'sessions' ? 'Sessions' : 'Task Manager', title: mode === 'sessions' ? 'Session Manager' : 'Task Manager', appearance: 'system', component: Manager });
