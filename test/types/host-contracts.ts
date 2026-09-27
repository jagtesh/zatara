// Compiled by npm run check; never executed.
import { getRuntime } from '../../src/sdk/client';
import { getContext, listTasks, listSessions } from '../../src/sdk/services';
import type { HostCallArgs, HostDecoders, HostHandlers, HostContext, TaskInfo, SessionInfo } from '../../src/sdk/contracts';

const runtime = getRuntime();
void runtime.call('windows.action', { id: 'window', op: 'close' });
void runtime.call('sessions.end', { name: 'main', pid: 1, startedAt: 100 });
// @ts-expect-error unknown standard operation
void runtime.call('window.action', { id: 'window', op: 'close' });
// @ts-expect-error invalid window operation
void runtime.call('windows.action', { id: 'window', op: 'maximise' });
// @ts-expect-error context requests do not accept sender overrides
void runtime.call('context.get', { from: 'other' });
// @ts-expect-error session termination requires the selected incarnation
void runtime.call('sessions.end', { name: 'main' });
// @ts-expect-error mismatched payload for this method
void runtime.call('sessions.ensure', { id: 'window', op: 'close' });
// @ts-expect-error the caller cannot pick an unrelated response type
void runtime.call<boolean>('tasks.list', {});

declare const uncorrelated: 'windows.action' | 'sessions.end';
// @ts-expect-error this payload is not valid for both possible methods
void runtime.call(uncorrelated, { id: 'window', op: 'close' });
declare const correlated: HostCallArgs;
void runtime.call(...correlated);

declare function context(value: HostContext): void;
declare function tasks(value: TaskInfo[]): void;
declare function sessions(value: SessionInfo[]): void;
void runtime.call('context.get', {}).then(context);
void runtime.call('tasks.list', {}).then(tasks);
void getContext().then(context);
void listTasks().then(tasks);
void listSessions().then(sessions);
// @ts-expect-error response types come from the method, not a generic assertion
void runtime.call('tasks.list', {}).then(context);
// @ts-expect-error facade also preserves the response type
void listSessions().then(tasks);

declare function contextHandler(value: HostHandlers<void>['context.get']): void;
contextHandler(() => ({ id: 'window', session: 'main' }));
// @ts-expect-error host implementations must return the operation's response shape
contextHandler(() => ({ id: 'window' }));
// @ts-expect-error asynchronous host responses have the same contract
contextHandler(async () => false);

declare function windowHandler(value: HostHandlers<void>['windows.action']): void;
windowHandler((_context, payload) => {
  payload.op.toUpperCase();
  // @ts-expect-error window handlers receive window arguments, not session arguments
  payload.name;
  return null;
});
declare function endDecoder(value: HostDecoders['sessions.end']): void;
// @ts-expect-error decoders must produce the complete validated request
endDecoder(() => ({ name: 'main', pid: 1 }));
declare function allHandlers(value: HostHandlers<void>): void;
// @ts-expect-error implementations cannot silently omit a standard operation
allHandlers({ 'context.get': () => ({ id: 'window', session: 'main' }) });
