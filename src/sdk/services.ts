import { getRuntime } from './client';
import type { SessionIdentity, WindowOperation } from './contracts';
export type { TaskInfo, SessionInfo, WindowOperation, HostContext, SessionIdentity } from './contracts';

export const getContext = () => getRuntime().call('context.get', {});
export const listTasks = () => getRuntime().call('tasks.list', {});
export const windowAction = (id: string, op: WindowOperation) =>
  getRuntime().call('windows.action', { id, op }).then(() => {});
export const listSessions = () => getRuntime().call('sessions.list', {});
export const ensureSession = (name: string) =>
  getRuntime().call('sessions.ensure', { name }).then(() => {});
export const switchSession = (name: string) =>
  getRuntime().call('sessions.switch', { name }).then(() => {});
export const detachSession = (name: string) =>
  getRuntime().call('sessions.detach', { name }).then(() => {});
/** The host checks both process identity fields before ending a session. */
export const endSession = ({ name, pid, startedAt }: SessionIdentity) =>
  getRuntime().call('sessions.end', { name, pid, startedAt }).then(() => {});
