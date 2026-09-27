import type { TaskInfo } from '../tasks';
import type { SessionInfo } from '../sessions';

export type { TaskInfo, SessionInfo };
export type WindowOperation = 'focus' | 'maximize' | 'minimize' | 'close';
export interface HostContext { session: string; id: string }
export interface SessionIdentity { name: string; pid: number; startedAt: number }
export type EmptyRequest = Record<string, never>;

/** The shared source of truth for SDK calls, host handlers, and their replies. */
export interface HostOperations {
  'context.get': { request: EmptyRequest; response: HostContext };
  'tasks.list': { request: EmptyRequest; response: TaskInfo[] };
  'windows.action': { request: { id: string; op: WindowOperation }; response: null };
  'sessions.list': { request: EmptyRequest; response: SessionInfo[] };
  'sessions.ensure': { request: { name: string }; response: null };
  'sessions.switch': { request: { name: string }; response: null };
  'sessions.detach': { request: { name: string }; response: null };
  'sessions.end': { request: SessionIdentity; response: null };
}

export type HostMethod = keyof HostOperations;
export type HostRequest<M extends HostMethod> = HostOperations[M]['request'];
export type HostResponse<M extends HostMethod> = HostOperations[M]['response'];
/** Keep the name and payload correlated, including when callers use unions. */
export type HostCallArgs = {
  [M in HostMethod]: [method: M, payload: HostRequest<M>];
}[HostMethod];

export type HostHandlers<Context> = {
  [M in HostMethod]: (context: Context, payload: HostRequest<M>) => HostResponse<M> | Promise<HostResponse<M>>;
};
export type HostDecoders = {
  [M in HostMethod]: (payload: unknown) => HostRequest<M>;
};
