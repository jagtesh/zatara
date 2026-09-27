// Compile-only SDK contracts. Every @ts-expect-error must remain an error.
import type { Duplex } from 'node:stream';
import { getRuntime, Runtime, type HostCallArgs, type HostMethod, type HostRequest, type HostResponse } from '../../src/sdk/client';

interface OpenDocument { path: string }
interface AppEvents {
  'document.open': OpenDocument;
  'document.changed': { documentId: string };
}
declare const stream: Duplex;
declare const target: string;
declare const name: keyof AppEvents;
declare const method: 'context.get' | 'sessions.ensure';
const runtime = new Runtime<AppEvents>(stream);
const singleton = getRuntime<AppEvents>();

void runtime.send(target, 'document.open', { path: '/notes' });
void runtime.publish('document.changed', { documentId: 'notes' });
void singleton.send(target, 'document.open', { path: '/notes' });
runtime.on('document.open', event => {
  const path: string = event.payload.path;
  const from: string = event.from;
  const type: 'document.open' = event.type;
  void [path, from, type];
  // @ts-expect-error document.open does not include documentId
  event.payload.documentId;
});
void runtime.subscribe('document.changed', event => {
  const id: string = event.payload.documentId;
  void id;
  // @ts-expect-error document.changed does not include path
  event.payload.path;
});

// @ts-expect-error unknown event
void runtime.send(target, 'document.unknown', { path: '/notes' });
// @ts-expect-error known event, wrong payload shape
void runtime.send(target, 'document.open', { documentId: 'notes' });
// @ts-expect-error known event, wrong publish payload
void runtime.publish('document.changed', { path: '/notes' });
// @ts-expect-error topic name typo
void runtime.publish('document.change', { documentId: 'notes' });
// @ts-expect-error handler name typo
runtime.on('document.opne', () => {});
// @ts-expect-error subscription name typo
void runtime.subscribe('document.change', () => {});
// @ts-expect-error a union event name cannot pair with one member's payload
void runtime.send(target, name, { path: '/notes' });
// @ts-expect-error same rule applies to topic publication
void runtime.publish(name, { documentId: 'notes' });

const noEvents = getRuntime();
const noEventsFromConstructor = new Runtime(stream);
// @ts-expect-error no arbitrary events without an app map
void noEvents.send(target, 'document.open', { path: '/notes' });
// @ts-expect-error no arbitrary topics without an app map
void noEvents.publish('document.changed', { documentId: 'notes' });
// @ts-expect-error no event handlers without an app map
noEventsFromConstructor.on('document.open', () => {});
// @ts-expect-error no topic handlers without an app map
void noEventsFromConstructor.subscribe('document.changed', () => {});

const context = runtime.call('context.get', {});
const ensured = runtime.call('sessions.ensure', { name: 'work' });
const contextResponse: Promise<HostResponse<'context.get'>> = context;
const ensureResponse: Promise<HostResponse<'sessions.ensure'>> = ensured;
const methodName: HostMethod = 'context.get';
const request: HostRequest<'sessions.ensure'> = { name: 'work' };
const args: HostCallArgs = ['sessions.ensure', request];
void [contextResponse, ensureResponse, methodName, args];
// @ts-expect-error host method typo
void runtime.call('context.unknown', {});
// @ts-expect-error host request payload belongs to another operation
void runtime.call('sessions.ensure', {});
// @ts-expect-error correlated tuples cannot mismatch method and request
const badArgs: HostCallArgs = ['context.get', { name: 'work' }];
void badArgs;
// @ts-expect-error a union method cannot pair with only one possible payload
void runtime.call(method, { name: 'work' });
