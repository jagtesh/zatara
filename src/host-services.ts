import type { Json } from './sdk/wire';
import { json, RuntimeError } from './sdk/wire';
import type { HostDecoders, HostHandlers, HostMethod, HostRequest, HostResponse, TaskInfo, WindowOperation } from './sdk/contracts';
import { ensure, listSessions } from './sessions';
import { request, RequestError } from './ipc';

export interface AppPrincipal {
  id: string;
  /** Granted by host policy, never taken from an app message. */
  manageTasks: boolean;
  manageSessions: boolean;
}
export interface HostServices {
  session: string;
  principal(id: string): AppPrincipal | undefined;
  tasks(): Promise<TaskInfo[]>;
  windowAction(id: string, op: WindowOperation): void;
  switchSession(name: string): void;
}

function argumentsFor(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) throw new RuntimeError('INVALID', 'Invalid service arguments');
  return value as Record<string, unknown>;
}
function sessionName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(value)) throw new RuntimeError('INVALID', 'Invalid session name');
  return value;
}
function emptyArguments(value: unknown): HostRequest<'context.get'> {
  argumentsFor(value, []);
  return {};
}
function sessionArguments(value: unknown): HostRequest<'sessions.ensure'> {
  return { name: sessionName(argumentsFor(value, ['name']).name) };
}
const decoders: HostDecoders = {
  'context.get': emptyArguments,
  'tasks.list': emptyArguments,
  'windows.action': value => {
    const args = argumentsFor(value, ['id', 'op']);
    if (typeof args.id !== 'string' ||
        (args.op !== 'focus' && args.op !== 'maximize' && args.op !== 'minimize' && args.op !== 'close')) {
      throw new RuntimeError('INVALID', 'Invalid window action');
    }
    return { id: args.id, op: args.op };
  },
  'sessions.list': emptyArguments,
  'sessions.ensure': sessionArguments,
  'sessions.switch': sessionArguments,
  'sessions.detach': sessionArguments,
  'sessions.end': value => {
    const args = argumentsFor(value, ['name', 'pid', 'startedAt']);
    if (typeof args.pid !== 'number' || !Number.isSafeInteger(args.pid) || args.pid <= 0 ||
        typeof args.startedAt !== 'number' || !Number.isFinite(args.startedAt)) {
      throw new RuntimeError('INVALID', 'Invalid session identity');
    }
    return { name: sessionName(args.name), pid: args.pid, startedAt: args.startedAt };
  },
};
function isHostMethod(value: string): value is HostMethod {
  return Object.hasOwn(decoders, value);
}
function requireSessionManager(principal: AppPrincipal) {
  if (!principal.manageSessions) throw new RuntimeError('DENIED', 'Permission denied: session management');
}

/** Host-only dispatch. Apps get named SDK operations, not access to management RPC. */
export function hostServices(host: HostServices) {
  // These mapped types require every contract operation and check each handler's
  // payload and response. Adding a method cannot silently omit its implementation.
  const handlers: HostHandlers<AppPrincipal> = {
    'context.get': principal => ({ id: principal.id, session: host.session }),
    'tasks.list': principal => {
      if (!principal.manageTasks) throw new RuntimeError('DENIED', 'Permission denied: tasks.list');
      return host.tasks();
    },
    'windows.action': (principal, args) => {
      if (args.id !== principal.id && !principal.manageTasks) throw new RuntimeError('DENIED', 'Permission denied: windows.action');
      host.windowAction(args.id, args.op);
      return null;
    },
    'sessions.list': principal => {
      requireSessionManager(principal);
      return listSessions();
    },
    'sessions.ensure': async (principal, { name }) => {
      requireSessionManager(principal);
      await ensure(name);
      return null;
    },
    'sessions.switch': async (principal, { name }) => {
      requireSessionManager(principal);
      const target = await request(name, { type: 'inspect' });
      if (target.state.attached) throw new RuntimeError('DENIED', 'Detach that session first; it already has an attachment.');
      // The caller could have exited while inspecting the destination.
      if (!host.principal(principal.id)) throw new RuntimeError('NOT_FOUND', 'App instance is no longer available');
      host.switchSession(name);
      return null;
    },
    'sessions.detach': async (principal, { name }) => {
      requireSessionManager(principal);
      await request(name, { type: 'detach' });
      return null;
    },
    'sessions.end': async (principal, { name, pid, startedAt }) => {
      requireSessionManager(principal);
      await request(name, { type: 'kill', expected: { pid, startedAt } });
      return null;
    },
  };
  const dispatch = async <M extends HostMethod>(principal: AppPrincipal, method: M, payload: unknown): Promise<HostResponse<M>> => {
    const args = decoders[method](payload);
    return handlers[method](principal, args);
  };
  // Wire data deliberately enters untyped; validation produces the contract
  // payload before any typed handler runs. TypeScript is not wire validation.
  return async (id: string, method: string, payload: Json): Promise<Json> => {
    const principal = host.principal(id);
    if (!principal) throw new RuntimeError('NOT_FOUND', 'App instance is no longer available');
    if (!isHostMethod(method)) throw new RuntimeError('NOT_FOUND', 'Unknown host service');
    try {
      const result = await dispatch(principal, method, payload);
      // Optional public fields are omitted by JSON rather than sent as undefined.
      return json(JSON.parse(JSON.stringify(result)));
    }
    catch (error) {
      if (error instanceof RequestError) {
        if (error.outcome === 'unknown') throw new RuntimeError('UNKNOWN_OUTCOME', 'The destination session did not confirm completion. Do not retry automatically.');
        if (error.outcome === 'not-sent') throw new RuntimeError('NOT_FOUND', 'The destination session is unavailable.');
        throw new RuntimeError('REMOTE', error.message);
      }
      throw error;
    }
  };
}
