# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] — 2026-05-22

### Added
- **Namespace-based config** — `WhistlersConfig` now accepts an optional `namespaces` record (`namespaces?: Record<string, NamespaceConfig>`). Each namespace is a named group of `SubscriptionConfig` entries that:
  - Prefixes their destination topics with `{namespace}-` at runtime (applied even when `destinationTopic` is set explicitly, and to the source-derived default).
  - Attaches the namespace name as `namespace` on every `OutgoingNotification`, letting destination adapters segment traffic by namespace.
  - Scopes subscription-name uniqueness (the same name may appear in different namespaces or in root without conflict).
- **`parseConfigJson(raw: string): WhistlersConfig`** — parses and validates a JSON config string, throwing a descriptive error for bad JSON or an invalid config. Exported from the package; used internally by `bin/server.ts` (replaces the inline `JSON.parse` + `assertValidConfig` that was there before).
- `NamespaceConfig` type exported from the package.
- `CreateConfigOptions.namespaces?` — pass namespaces directly to `createConfig`.
- `OutgoingNotification.namespace?: string` — the namespace of the matched subscription, when present.
- `WhistlerOptions.onError` context now includes `namespace?: string`.
- Example `examples/ts/nats-namespaces-to-firebase.ts` — demonstrates per-tenant namespacing with a `makeTenantNamespace` factory.

## [0.4.1] — 2026-05-21

### Changed
- **NATS adapter migrated off the deprecated `nats` v2 package to `@nats-io/transport-node` v3** (the nats.js v3 package split). `NatsQueueAdapter`'s public API is unchanged — same `servers` option and `nats://` URLs — so no consumer code changes are required. Message decoding now uses the built-in `Msg.string()` method (the `StringCodec`/`JSONCodec` helpers were removed in v3).
- Bumped `mqtt` (`^5.10.1` → `^5.15.1`).
- Bumped build/test tooling: `typescript` `5.x` → `6.x`, `vitest` `2.x` → `4.x` (now requires `vite`, pinned to `8.x`), `@types/node` `20.x` → `22.x` (aligned with the Node 22 runtime), `firebase-admin` dev dependency `13.4` → `13.10`. Refreshed `@aws-sdk/client-s3`, `@clickhouse/client`, `pg`, and `@types/pg` to their latest in-range versions. `peerDependencies` ranges are unchanged, so consumers are not forced to upgrade.

## [0.4.0] — 2026-05-21

### Added
- `SSEDestination` — runs an HTTP server (built-in `node:http`, no extra dependency) and streams each notification to connected Server-Sent Events clients. Start it with `listen(port, host?)` (returns the bound `AddressInfo`; use `0` for an ephemeral port) before `whistler.start()`, or inject an existing `http.Server` via the `server` option (its lifecycle stays the caller's — `close()` detaches the handler and ends client streams but never closes an injected server). Clients filter per-connection with the `?topic=` query parameter (repeatable; omitted = all topics). A configurable heartbeat (`heartbeatMs`, default `15000`, `0` disables) keeps idle connections alive. The `format` callback returns a `string` (used as the `data:` payload as-is), a `Record<string, unknown>` (JSON-serialised into `data:`), or an `SSEEventInit` for full control of `data`/`event`/`id`/`retry`; defaults are `event` = topic, `id` = random UUID, `data` = the JSON notification.
- `bin/server.ts` standalone server re-introduced. Reads a JSON config file (path from first CLI argument, default `/etc/whistlers/config.json`), initialises a NATS or MQTT queue adapter (controlled by `QUEUE_TYPE` / `QUEUE_URL` env vars), and starts a `FirebaseDestination` bridge. Handles `SIGINT` / `SIGTERM` for graceful shutdown.
- `bin/server.ts` now selects the destination via the `DESTINATION_TYPE` env var (`firebase` default, or `sse` using `SSE_PORT` / `SSE_PATH`). `firebase-admin` is imported lazily, so the `sse` path runs without the optional `firebase-admin` peer dependency installed.

### Fixed
- Ansible role `defaults/main.yml`: Node.js version updated from 20 to 22 to match the Docker image and CI.
- Ansible role `defaults/main.yml`: repo URL updated to `Drakkar-Software/Whistlers`.
- Ansible role `whistlers.service.j2`: systemd unit description and documentation URL updated to reflect the current project location and generic destination support.
- `README.md`: Ansible requirements example URL updated to `Drakkar-Software/Whistlers`.

## [0.3.0] — 2026-04-11

### Added
- `format` callback option on all destination adapters — override the default content sent to each destination:
  - `FirebaseDestination`: returns FCM message fields (`notification`, `data`, `android`, `apns`, etc.) merged with the mandatory `topic` (which cannot be overridden).
  - `ClickHouseDestination`: returns a `Record<string, unknown>` inserted as a JSONEachRow row.
  - `PostgresDestination`: returns a `Record<string, unknown>`; keys become double-quoted column names in a dynamic `INSERT`.
  - `S3Destination`: returns a `string` (`ContentType: text/plain`, no `.json` key extension) or a `Record<string, unknown>` (JSON-serialised, `ContentType: application/json`, `.json` key extension).

### Removed
- **Breaking:** `parseConfigJson` removed. Use `createConfig` to build config from code.
- `bin/server.ts` standalone server removed (it depended on JSON config).

## [0.2.0] — 2026-04-11

### Added
- `ClickHouseDestination` — inserts each notification as a row into a ClickHouse table (`@clickhouse/client` peer dependency).
- `PostgresDestination` — inserts each notification as a row into a PostgreSQL table (`pg` peer dependency). Queries use parameterized placeholders.
- `S3Destination` — writes each notification as a JSON object to S3. Keys follow `{prefix}{topic}/{uuid}.json`. Accepts a pre-configured `S3Client` for custom endpoints. (`@aws-sdk/client-s3` peer dependency).
- All three new destinations are optional peer dependencies; install only what you use.

### Changed
- README and code comments no longer refer to Firebase / FCM specifically — Whistlers is now presented as a generic queue-to-destination bridge.
- `OutgoingNotification.topic` doc comment updated from "FCM-safe" to "destination topic name".
- `SubscriptionConfig.destinationTopic` / `notification` / `dataFields` comments made destination-agnostic.
- Log message in `Whistler` updated: "→ FCM topic" → "→".

### Fixed
- **Consumer groups now work end-to-end.** The `group` field in `SubscriptionConfig` was documented and validated but never reached the queue adapters. The bridge now collects `(topic, group)` pairs and passes them through:
  - `NatsQueueAdapter`: calls `nc.subscribe(topic, { queue: group })` when a group is set.
  - `MqttQueueAdapter`: applies the `$share/{group}/topic` shared-subscription prefix when a group is set.
- `Whistler.stop()` and `start()` now share the same subscription-collection logic via a private `collectSubscriptions()` helper, eliminating the risk of them going out of sync.

### Added
- `TopicSubscription` interface (`{ topic: string; group?: string }`) exported from the package. `QueueAdapter.subscribe` and `unsubscribe` now accept `TopicSubscription[]` instead of `string[]`.
- `infra/ansible/roles/whistlers` — Ansible role to deploy Whistlers on Debian/Ubuntu. Installs Node.js, pnpm, clones the repo, builds, and manages a systemd service.
- `CustomQueueAdapter` callbacks (`onSubscribe`, `onUnsubscribe`) now receive `TopicSubscription[]` instead of `string[]`, carrying group information to test code.

## [0.1.0] — 2026-04-11

### Added
- Initial release.
- `QueueAdapter` interface with `NatsQueueAdapter`, `MqttQueueAdapter`, and `MemoryQueueAdapter` implementations.
- `DestinationAdapter` interface with `FirebaseDestination` and `MemoryDestination` implementations.
- `Whistler` bridge class: connects queue to destination, topic-pattern matching, `dataFields` extraction, `onError` callback, graceful start/stop.
- JSON config (`parseConfigJson`) and code config (`createConfig`) with full validation.
- `sanitizeTopic` utility exported for custom topic name transformations.
- `CustomQueueAdapter` for pluggable test delivery logic.
