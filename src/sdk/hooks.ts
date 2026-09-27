import { useCallback, useEffect, useRef, useState } from 'react';
import { listSessions, listTasks, type SessionInfo, type TaskInfo } from './services';

export interface PollingList<T> {
  data: T[];
  error: string;
  loading: boolean;
  refresh(): Promise<void>;
}

/** Load once on mount, poll only while focused, and discard obsolete responses. */
function usePollingList<T>(load: () => Promise<T[]>, enabled: boolean, focused: boolean): PollingList<T> {
  const [data, setData] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    if (inFlight.current) return inFlight.current;
    const current = generation.current;
    const work = async () => {
      setLoading(true);
      try {
        const next = await load();
        if (mounted.current && current === generation.current) {
          setData(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
          setError('');
        }
      } catch (e) {
        if (mounted.current && current === generation.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current && current === generation.current) setLoading(false);
        inFlight.current = undefined;
      }
    };
    inFlight.current = work();
    return inFlight.current;
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = focused ? setInterval(() => void refresh(), 2000) : undefined;
    return () => { if (timer) clearInterval(timer); };
  }, [enabled, focused, refresh]);
  return { data, error, loading, refresh };
}

export function useTasks(focused: boolean, enabled = true): PollingList<TaskInfo> {
  return usePollingList(listTasks, enabled, focused);
}

export function useSessions(focused: boolean, enabled = true): PollingList<SessionInfo> {
  return usePollingList(listSessions, enabled, focused);
}
