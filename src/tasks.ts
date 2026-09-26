import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WindowState } from './model';
const exec = promisify(execFile);
export interface ProcessInfo { pid: number; parent: number; rssKiB: number; cpuSeconds: number }
export interface TaskInfo extends WindowState { guestPid?: number; processCount: number; rssMiB: number; cpuPercent: number | null; pids: number[] }
export function parseProcesses(text: string): ProcessInfo[] {
  return text.trim().split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.\-]+)\s*$/.exec(line);
    if (!m) return [];
    const [day, clock] = m[4].includes('-') ? m[4].split('-') : ['0', m[4]];
    const parts = clock.split(':').map(Number);
    const seconds = parts.reduce((total, value) => total * 60 + value, 0) + Number(day) * 86400;
    return [{ pid: +m[1], parent: +m[2], rssKiB: +m[3], cpuSeconds: seconds }];
  });
}
export function descendants(processes: ProcessInfo[], roots: number[]) {
  const ids = new Set(roots.filter(pid => pid > 0));
  for (let changed = true; changed;) { changed = false; for (const p of processes) if (!ids.has(p.pid) && ids.has(p.parent)) { ids.add(p.pid); changed = true; } }
  return processes.filter(p => ids.has(p.pid));
}
export class TaskSampler {
  private previous = new Map<number, number>();
  private at = 0;
  private pending?: Promise<TaskInfo[]>;
  sample(windows: (WindowState & { guestPid?: number; rootPids?: number[] })[]): Promise<TaskInfo[]> {
    // Several manager windows share one in-flight process scan.
    if (this.pending) return this.pending;
    this.pending = this.read(windows).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(windows: (WindowState & { guestPid?: number; rootPids?: number[] })[]) {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time='], { maxBuffer: 4 * 1024 * 1024, timeout: 2000 });
    const processes = parseProcesses(stdout), now = performance.now(), elapsed = (now - this.at) / 1000, next = new Map<number, number>();
    const tasks = windows.map(w => {
      const owned = descendants(processes, w.rootPids ?? [w.pid, w.guestPid ?? 0]);
      let delta = 0, comparable = false;
      for (const p of owned) { const previous = this.previous.get(p.pid); if (previous !== undefined) { comparable = true; delta += Math.max(0, p.cpuSeconds - previous); } next.set(p.pid, p.cpuSeconds); }
      return { ...w, processCount: owned.length, rssMiB: owned.reduce((n, p) => n + p.rssKiB, 0) / 1024, cpuPercent: comparable && elapsed > 0 ? delta / elapsed * 100 : null, pids: owned.map(p => p.pid) };
    });
    this.previous = next; this.at = now;
    return tasks;
  }
}
