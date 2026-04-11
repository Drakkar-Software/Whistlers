# Whistlers

**Message-queue → push notification bridge.**

Whistlers subscribes to topics on NATS or MQTT and forwards incoming messages as Firebase Cloud Messaging (FCM) push notifications. Mobile users subscribe to FCM topics; Whistlers makes sure they hear about queue events in real time.

## Packages

| Package | Description |
|---|---|
| `@drakkar.software/whistlers` | Core library — adapters, bridge, config |

## Quick Start

```typescript
import {
  Whistler,
  NatsQueueAdapter,
  FirebaseDestination,
  createConfig,
} from "@drakkar.software/whistlers"
import admin from "firebase-admin"

admin.initializeApp({ credential: admin.credential.applicationDefault() })

const config = createConfig({
  subscriptions: [
    {
      name: "orders",
      topics: ["orders.*"],
      group: "whistlers",
      notification: { title: "New order", body: "An order just came in" },
      dataFields: ["id", "status"],
    },
  ],
})

const whistler = new Whistler({
  queue: new NatsQueueAdapter({ servers: "nats://localhost:4222" }),
  destination: new FirebaseDestination(),
  config,
  logger: {
    info: (msg, ...args) => console.log("[info]", msg, ...args),
    warn: (msg, ...args) => console.warn("[warn]", msg, ...args),
    error: (msg, ...args) => console.error("[error]", msg, ...args),
  },
  onError: (err, ctx) =>
    console.error("Failed to forward", ctx.message.topic, err),
})

await whistler.start()
// ...
await whistler.stop()
```

## Configuration

### From code

```typescript
import { createConfig } from "@drakkar.software/whistlers"

const config = createConfig({
  subscriptions: [
    {
      name: "orders",
      topics: ["orders.*"],
      group: "whistlers",
      destinationTopic: "orders",
      notification: { title: "New order", body: "An order was placed" },
      dataFields: ["id", "status"],
    },
  ],
})
```

### From JSON

```json
{
  "version": 1,
  "subscriptions": [
    {
      "name": "orders",
      "topics": ["orders.*"],
      "group": "whistlers",
      "destinationTopic": "orders",
      "notification": { "title": "New order", "body": "An order was placed" },
      "dataFields": ["id", "status"]
    }
  ]
}
```

```typescript
import { parseConfigJson } from "@drakkar.software/whistlers"

const config = parseConfigJson(jsonString)
```

Both builders run the same validation and throw descriptive errors if the config is invalid.

### Subscription fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✓ | Unique identifier for this subscription |
| `topics` | `string[]` | ✓ | Queue-native topic patterns (see [Topic Matching](#topic-matching)) |
| `group` | `string` | | Consumer group name (NATS queue group / MQTT shared subscription) |
| `destinationTopic` | `string` | | FCM topic to publish to. Defaults to the sanitized source topic |
| `notification` | `{ title?, body? }` | | Static notification content sent to FCM |
| `dataFields` | `string[]` | | Top-level payload fields to forward as FCM data key/value pairs |

## Queue Adapters

### NATS

```typescript
new NatsQueueAdapter({ servers: "nats://localhost:4222" })
// multiple servers
new NatsQueueAdapter({ servers: ["nats://n1:4222", "nats://n2:4222"] })
```

Wildcard syntax: `orders.*` (single token), `events.>` (all remaining tokens).

When `group` is set on a subscription, Whistlers subscribes with a NATS **queue group** (`nc.subscribe(subject, { queue: group })`). Only one instance in the group processes each message — useful for running multiple Whistlers instances without duplicate notifications.

### MQTT

```typescript
new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
// with client options
new MqttQueueAdapter({
  url: "mqtts://broker.example.com",
  options: { clientId: "whistlers-1", username: "user", password: "pass" },
})
```

Wildcard syntax: `orders/+` (single level), `events/#` (all levels).

When `group` is set, Whistlers uses an MQTT **shared subscription** (`$share/{group}/topic`). The broker delivers each message to exactly one subscriber in the group.

## Destination Adapters

### Firebase (FCM)

```typescript
// uses the default Firebase app (must call admin.initializeApp() first)
new FirebaseDestination()

// supply a specific app instance
new FirebaseDestination({ app: myFirebaseApp })
```

`firebase-admin` is a peer dependency — install it separately:

```
pnpm add firebase-admin
```

FCM topic names must match `[a-zA-Z0-9-_.~%]+`. When `destinationTopic` is not set, Whistlers sanitizes the source topic automatically (`.` and `/` → `-`). You can also call `sanitizeTopic(topic)` directly for custom transformations.

## Topic Matching

Each adapter implements queue-native wildcard semantics:

| Adapter | Single-level wildcard | Multi-level wildcard |
|---|---|---|
| NATS | `*` | `>` (must be last token) |
| MQTT | `+` | `#` (must be last level) |

A message arriving on `orders.created` matches the pattern `orders.*` (NATS). A message on `sensors/temp/zone1` matches `sensors/#` (MQTT). Multiple subscriptions can match the same message — each fires independently and forwards to its own FCM topic.

## Error Handling

Destination errors (e.g. FCM quota exceeded, network failure) are caught per-message. The bridge keeps running.

```typescript
const whistler = new Whistler({
  // ...
  logger: {
    info: console.log,
    warn: console.warn,
    error: console.error,
  },
  onError: (err, { message, subscription }) => {
    // called after the logger, with the raw error and context
    metrics.increment("whistlers.forward_error", { topic: message.topic })
  },
})
```

If `onError` is omitted, errors are only logged (when a logger is provided).

## Testing

The package exports `MemoryQueueAdapter`, `MemoryDestination`, and `CustomQueueAdapter` for use in your own test suites.

### MemoryQueueAdapter

Inject messages directly with `simulate()`:

```typescript
import {
  MemoryQueueAdapter,
  MemoryDestination,
  Whistler,
  createConfig,
} from "@drakkar.software/whistlers"

const queue = new MemoryQueueAdapter()
const dest = new MemoryDestination()
const whistler = new Whistler({ queue, destination: dest, config })

await whistler.start()
await queue.simulate({ topic: "orders.created", payload: '{"id":"1"}', timestamp: Date.now() })

console.log(dest.sent[0]) // OutgoingNotification
```

### CustomQueueAdapter

Plug in callbacks to observe or control what the bridge subscribes to:

```typescript
import { CustomQueueAdapter } from "@drakkar.software/whistlers"
import type { TopicSubscription } from "@drakkar.software/whistlers"

const queue = new CustomQueueAdapter({
  onSubscribe: async (subs: TopicSubscription[]) => {
    console.log("subscribed to", subs)
  },
})
```

## Standalone Server

For deployments that don't embed Whistlers in a larger application, the package ships a compiled server entry point:

```bash
QUEUE_TYPE=nats \
QUEUE_URL=nats://localhost:4222 \
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node packages/ts/whistlers/dist/bin/server.js /etc/whistlers/config.json
```

| Environment variable | Description |
|---|---|
| `QUEUE_TYPE` | `nats` or `mqtt` |
| `QUEUE_URL` | Broker URL |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the Firebase service-account JSON |

The config argument is a path to a standard Whistlers JSON config file.

## Deployment (Ansible)

An Ansible role is included under `infra/ansible/roles/whistlers`. It installs Node.js and pnpm, clones this repository, builds it, and runs the standalone server as a systemd service.

```bash
ansible-playbook -i inventory.ini infra/ansible/site.yml
```

Key variables (set in your playbook or `host_vars`):

| Variable | Default | Description |
|---|---|---|
| `whistlers_queue_type` | `nats` | `nats` or `mqtt` |
| `whistlers_queue_url` | `nats://localhost:4222` | Broker URL |
| `whistlers_firebase_credentials_path` | `/etc/whistlers/service-account.json` | Path to the Firebase service-account on the target host |
| `whistlers_subscriptions` | `[]` | List of subscription objects (same schema as the JSON config) |
| `whistlers_version` | `main` | Git branch, tag, or commit to deploy |
| `whistlers_install_dir` | `/opt/whistlers` | Where the repo is cloned |

The service-account JSON must be placed on the target host before running the playbook (or provisioned separately via Vault / a secrets manager).

See `infra/ansible/site.yml` for a full example playbook.
