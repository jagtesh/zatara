# App SDK and session-local messaging

This is the initial **in-tree SDK boundary**, not a published npm package. App
packaging follows after the runtime and API have been exercised by the built-in
apps. Studio and both manager modes import supported SDK APIs rather than host
implementation modules.

## Entry points

- `src/sdk/index.ts`: native app bootstrap, window context, and UI exports.
- `src/sdk/ui.ts`: supported Pixel UI wrappers, types, and appearance helpers.
- `src/sdk/client.ts`: framework-independent messaging runtime.
- `src/sdk/services.ts`: named window, task, and session operations.
- `src/sdk/hooks.ts`: React task/session lists with focus-aware refresh.

React is a UI dependency, not a requirement of the headless communication
runtime. Themes, fonts, host connections, display units, configuration watching,
and shutdown remain bootstrap concerns, not per-app setup.

An app declares its own event names and payload interfaces once, and uses the
typed view without handling connections:

```ts
import { getRuntime } from './sdk/client';

interface AppEvents {
  'document.open': { path: string };
  'document.changed': { documentId: string };
}

const runtime = getRuntime<AppEvents>();
const stopReceiving = runtime.on('document.open', async ({ from, payload }) => {
  // payload.path is a string. Validate incoming data before using it.
  // `from` was assigned by the host, not supplied by the sending app.
});
const unsubscribe = await runtime.subscribe('document.changed', event => {
  // event.payload.documentId is a string.
});
await runtime.send(editorInstanceId, 'document.open', { path: '/project/readme.md' });
await runtime.publish('document.changed', { documentId: 'readme' });
await unsubscribe();
await stopReceiving();
```

The same map applies to direct messages and topics; it is application-owned,
not a generated list of host events. Share that interface among participants
in the app protocol. `getRuntime<AppEvents>()` is a typed view of one singleton:
different callers must agree on its map. The type checker rejects unknown names
and mismatched payloads, including calls with union-typed names. The wire
validates JSON serialization and host permissions, **not** the app's event
schema; receiving apps must validate payloads at runtime before trusting them.
Without a map, `getRuntime()` and `new Runtime(stream)` expose no application
events.

Host calls use the SDK-owned `HostOperations` interface, exported by `sdk/client`.
Each operation pairs its request and response types; `runtime.call('tasks.list',
{})` therefore returns `Promise<TaskInfo[]>` without a caller-supplied cast.
The host's decoder and handler maps use this same contract, so adding an
operation requires its validator and correctly typed implementation too.
Use named operations from `sdk/services` for normal host functionality instead
of constructing wire messages. Only callers granted the relevant
host capabilities can use task and session administration. Recipient addresses
must come from an explicit application workflow; this first version does not
provide a global application directory.

## Transport is private

The host creates a dedicated duplex channel for each launched Pixel app. Its SDK
bootstraps from an inherited descriptor; app code does not discover sockets,
present credentials, or choose a transport. The host binds the connection to a
fresh full UUID identifying that running instance. Wire payloads cannot choose
the sender or session.

Pixel 0.0.15's guest protocol provides rendering/input/lifecycle messages, not a
general application bus. Its graphics path remains separate from this control
channel. Large frames and files should not be sent as message payloads.

The current launch integration requires direct inheritance from the host. A
launcher that re-spawns the application must preserve the channel deliberately;
there is no public listener or unauthenticated reconnect fallback for this bus.

## Addressing and permissions

Each session owns a separate broker. Direct messages address a running instance,
not an app type or a PID. Instances in another session cannot be addressed.
Restarting an app produces a new address; messages are never redirected from a
dead instance to its replacement.

Host-controlled custom registrations may grant exact message names:

```json
{
  "id": "editor",
  "name": "Editor",
  "icon": "E",
  "command": ["/absolute/path/to/node", "/absolute/path/to/editor.js"],
  "messaging": {
    "receive": ["document.open"],
    "publish": ["document.changed"]
  }
}
```

Direct delivery requires both the sender's `send` grant and the recipient's
`receive` grant. Topic publication and subscription have separate grants.
No grant means no permission; wildcards are not supported. Registrations are
host policy, not permissions that an app may request over its connection.

All apps may inspect their own SDK context and operate their own window. The
built-in Task Manager can inspect and operate other windows in its session.
Only the built-in Session Manager gets the narrow cross-session management
interface. Custom registrations cannot acquire those administrative privileges
through the SDK.

## Delivery semantics

- Direct-message acknowledgement means acceptance for delivery, not completion
  of the recipient's handler.
- Host calls correlate requests and replies over the persistent connection.
- Messages are transient. There is no offline mailbox, replay, or automatic retry.
- A submitted call whose reply is lost or times out has an **unknown outcome**.
  The operation may have happened. Do not turn that error into an automatic retry.
- Request timeouts do not undo work or cancel a host operation already executing.
- Message envelopes and payload sizes are checked before dispatch. Queues,
  subscriptions, pending calls, and handler concurrency are bounded.
- Recipients must validate application-specific payload schemas; valid JSON is
  not proof that a document command is meaningful.

Session termination carries the selected PID and service start time. The
destination service checks them before scheduling termination, avoiding the old
inspect-then-kill identity race.

## Scope and verification

The private SDK bus is a new channel. Existing CLI/desktop management sockets and
Pixel rendering connections retain their existing protocols; this change does
not claim to retrofit them with the SDK's capability model. They must not be
described as authenticated SDK endpoints.

`npm test` includes native manager workflows, host service authorization,
registration validation, real child-process SDK bootstrap, and broker/transport
tests. Review message limits and delivery semantics before replacing the private
transport; preserving method names alone is not sufficient compatibility.

Run `npm run bench:runtime` for a child-process round-trip microbenchmark over
the actual inherited channel. An initial local run of 1,000 small sequential
calls measured 0.040 ms median, 0.063 ms p95, and 0.115 ms p99; batches of 16
reached approximately 124,000 calls/second. These measure the broker and
transport, not graphics load, application work, or a cross-machine guarantee.
