# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- **Consumer groups now work end-to-end.** The `group` field in `SubscriptionConfig` was documented and validated but never reached the queue adapters. The bridge now collects `(topic, group)` pairs and passes them through:
  - `NatsQueueAdapter`: calls `nc.subscribe(topic, { queue: group })` when a group is set.
  - `MqttQueueAdapter`: applies the `$share/{group}/topic` shared-subscription prefix when a group is set.
- `Whistler.stop()` and `start()` now share the same subscription-collection logic via a private `collectSubscriptions()` helper, eliminating the risk of them going out of sync.

### Added
- `TopicSubscription` interface (`{ topic: string; group?: string }`) exported from the package. `QueueAdapter.subscribe` and `unsubscribe` now accept `TopicSubscription[]` instead of `string[]`.
- `bin/server.ts` — standalone entry point for running Whistlers as a daemon. Reads a config JSON file and selects the queue adapter via `QUEUE_TYPE` / `QUEUE_URL` environment variables.
- `infra/ansible/roles/whistlers` — Ansible role to deploy the Whistlers server on Debian/Ubuntu. Installs Node.js, pnpm, clones the repo, builds, and manages a systemd service.
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
