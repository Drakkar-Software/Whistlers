# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
