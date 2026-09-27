# Headless app runtime

The session service owns a `Broker` and registers each spawned app with
`broker.add(windowId, child.stdio[3], permissions)`. Spawn with stdio index 3
set to `'pipe'` and `ZATARA_RUNTIME_FD=3` in the child's environment. Do not
pass a socket path or token. The child's `getRuntime()` memoizes the inherited
fd 3; `closeRuntime()` closes it without opening it if unused. For embedding
and tests, `new Runtime(duplex)` accepts any binary duplex stream.

`Broker` binds the app identity to the host registration. Grants default to
empty lists: `send` and `receive` contain direct message types, while
`publish` and `subscribe` contain topics. A direct delivery requires both
the sender's `send` and recipient's `receive` grant; a publication requires
the sender's `publish` and each recipient's active, granted subscription.
Permissions are exact matches (no wildcard). The broker's host callback is
`(id, method, payload) => Json | Promise<Json>` and **must** authorize each
host method using trusted host policy. Throw `RuntimeError('DENIED', ...)` for
expected denial. Other host errors become generic `REMOTE` errors, avoiding
accidental leakage of exception details to children.

`send()` and `publish()` acknowledge acceptance into the broker's outgoing
stream, not execution by recipient handlers. There is no durable delivery,
retry, offline queue, app-to-app request/reply, or cross-session routing.
`publish` can partially deliver if a recipient fails partway through fanout;
it then rejects with `UNKNOWN_OUTCOME`. Disconnects or timeouts after a
request was submitted also reject with `UNKNOWN_OUTCOME`; callers must not
blindly retry non-idempotent operations. Event handlers run concurrently
with a cap of 32; errors thrown by handlers are isolated, not reported to
senders. If the handler queue overflows, the runtime disconnects.

App events are typed by a shared, app-defined map (not standardized by the
host). For example:

```ts
import { getRuntime } from './client';

interface AppEvents {
  'document.open': { path: string };
  'document.changed': { documentId: string };
}

const runtime = getRuntime<AppEvents>();
runtime.on('document.open', ({ payload }) => { console.log(payload.path); });
await runtime.send(editorId, 'document.open', { path: '/notes.txt' });
await runtime.publish('document.changed', { documentId: 'notes' });
```

`subscribe()` infers the same payload shape for topics. `getRuntime()` and
`new Runtime(stream)` without a map allow no application event names. A generic
argument gives a typed view of the singleton, so all modules in an app must
agree on the same map. Types do not validate received payloads: validate the
application schema at the boundary before using untrusted data. Serialization
still checks outgoing values as JSON. The distinct host operations contract
(`HostOperations`, `HostMethod`, `HostRequest`, `HostResponse`, `HostCallArgs`)
is re-exported from `client.ts`; `call()` only accepts those correlated
method/request pairs. Prefer `services.ts` for named host operations.

Frames are 4-byte big-endian lengths followed by UTF-8 JSON. Version is 1;
malformed or oversized frames close that peer. Individual messages are
limited to 64 KiB, buffered output to 256 KiB per stream, 128 pending SDK
requests, 64 topic subscriptions, and 32 host requests in flight per peer.
Requests time out after 15 seconds. No child-supplied `from` field is
accepted; the broker stamps `from` from its own registration.
