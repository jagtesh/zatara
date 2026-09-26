import { execFileSync } from 'node:child_process';
export function processes(roots: number[]) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,time='], { encoding: 'utf8' }).trim().split('\n').map(l => {
    const [pid, ppid, rss, cpu, time] = l.trim().split(/\s+/); const parts = time.split(':').map(Number);
    return { pid: +pid, ppid: +ppid, rssKiB: +rss, lifetimeCpuPercent: +cpu, cpuSeconds: parts.reduce((n, p) => n * 60 + p, 0) };
  });
  const pids = new Set(roots); let n = 0;
  while (n !== pids.size) { n = pids.size; for (const r of rows) if (pids.has(r.ppid)) pids.add(r.pid); }
  return rows.filter(r => pids.has(r.pid));
}
