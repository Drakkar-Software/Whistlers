# Whistlers

A message-queue-to-push-notification bridge. Subscribes to NATS or MQTT topics and forwards messages as Firebase Cloud Messaging (FCM) push notifications to mobile app users.

## Repository Structure

```
packages/ts/whistlers/   @drakkar.software/whistlers — core library
examples/ts/             Runnable usage examples
```

## Build & Test

```bash
# From repo root
pnpm install
pnpm build        # compile all packages
pnpm typecheck    # type-check without emit
pnpm test         # run all test suites

# From a specific package
cd packages/ts/whistlers
pnpm test
pnpm test:watch
```

## Conventions

- TypeScript strict mode everywhere (`noUncheckedIndexedAccess` enabled)
- ES modules throughout (`"type": "module"`)
- All adapters implement a named interface — never depend on concrete types across layers
- Queue adapters handle their own wildcard syntax (`matchesTopic` per adapter)
- Destination adapters receive an `OutgoingNotification`; they don't parse raw payloads
- Config can be loaded from JSON (`parseConfigJson`) or built in code (`createConfig`)
- Test utilities (`MemoryQueueAdapter`, `MemoryDestination`) live in `src/` so they can be imported by consumer test suites

## Post-Change Checklist

- [ ] `pnpm -r test` passes
- [ ] `pnpm -r typecheck` passes
- [ ] Update `CHANGELOG.md` if behaviour changes
- [ ] Update `README.md` if public API changes
