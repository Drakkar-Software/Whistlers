<p align="center">
  <img src="logo.png" alt="Whistlers" width="180" />
</p>

<h1 align="center">Whistlers</h1>

<p align="center">
  <strong>Message-queue → destination bridge</strong><br/>
  Subscribe to queue topics and forward messages to Firebase, ClickHouse, PostgreSQL, or S3 — in real time.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@drakkar.software/whistlers"><img src="https://img.shields.io/npm/v/@drakkar.software/whistlers" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
</p>

---

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

`createConfig` validates the config and throws a descriptive error if it is invalid.

### Subscription fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✓ | Unique identifier for this subscription |
| `topics` | `string[]` | ✓ | Queue-native topic patterns (see [Topic Matching](#topic-matching)) |
| `group` | `string` | | Consumer group name (NATS queue group / MQTT shared subscription) |
| `destinationTopic` | `string` | | Destination topic name. Defaults to the sanitized source topic (`.` and `/` → `-`). Call `sanitizeTopic(topic)` for custom transformations. |
| `notification` | `{ title?, body? }` | | Static notification content passed through to the destination |
| `dataFields` | `string[]` | | Top-level payload fields to forward as string key/value pairs |

## Queue Adapters

| Adapter | Description |
|---|---|
| `NatsQueueAdapter` | NATS Core with queue group support |
| `MqttQueueAdapter` | MQTT v3/v5 with shared subscription support |

### NATS

```typescript
new NatsQueueAdapter({ servers: "nats://localhost:4222" })
// multiple servers
new NatsQueueAdapter({ servers: ["nats://n1:4222", "nats://n2:4222"] })
```

Wildcard syntax: `orders.*` (single token), `events.>` (all remaining tokens).

When `group` is set, Whistlers subscribes with a **queue group** so only one instance in the group processes each message — useful for running multiple Whistlers instances without duplicate deliveries.

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

When `group` is set, Whistlers uses a **shared subscription** (`$share/{group}/topic`) so the broker delivers each message to exactly one subscriber in the group.

## Destination Adapters

| Adapter | Peer dependency | What it does |
|---|---|---|
| `FirebaseDestination` | `firebase-admin` | Sends FCM push notifications |
| `ClickHouseDestination` | `@clickhouse/client` | Inserts rows into a ClickHouse table |
| `PostgresDestination` | `pg` | Inserts rows into a PostgreSQL table |
| `S3Destination` | `@aws-sdk/client-s3` | Writes notification JSON objects to S3 |

Each adapter is an optional peer dependency — install only what you use.

### Firebase

```typescript
// uses the default Firebase app (must call admin.initializeApp() first)
new FirebaseDestination()

// supply a specific app instance
new FirebaseDestination({ app: myFirebaseApp })

// custom FCM message — return any FCM fields (notification, data, android, apns, etc.)
new FirebaseDestination({
  format: (n) => ({
    notification: { title: n.notification?.title, body: String(n.rawPayload) },
    data: { id: String((n.rawPayload as Record<string, unknown>)["id"]) },
    android: { priority: "high" },
  }),
})
```

`topic` is always set from the subscription config and cannot be overridden by `format`.

```
pnpm add firebase-admin
```

### ClickHouse

Insert each notification as a row. Default schema:

```sql
CREATE TABLE notifications (
    topic         String,
    source_topic  String,
    notification  Nullable(String),
    data          Nullable(String),
    raw_payload   String,
    received_at   DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY received_at;
```

```typescript
new ClickHouseDestination({
  url: "http://localhost:8123",
  database: "default",
  table: "notifications",
  username: "default",  // optional
  password: "",         // optional
})

// custom row shape
new ClickHouseDestination({
  url: "http://localhost:8123",
  database: "default",
  table: "events",
  format: (n) => ({
    topic: n.topic,
    payload: JSON.stringify(n.rawPayload),
    received_at: new Date().toISOString(),
  }),
})
```

```
pnpm add @clickhouse/client
```

### PostgreSQL

Insert each notification as a row. Default schema:

```sql
CREATE TABLE notifications (
    id           BIGSERIAL PRIMARY KEY,
    topic        TEXT NOT NULL,
    source_topic TEXT NOT NULL,
    notification JSONB,
    data         JSONB,
    raw_payload  JSONB NOT NULL,
    received_at  TIMESTAMPTZ DEFAULT NOW()
);
```

```typescript
new PostgresDestination({
  connectionString: "postgresql://user:pass@host:5432/db",
  table: "notifications",
})

// custom row shape — keys become column names, values become query parameters
// supply your own timestamp when using format (the default query uses SQL NOW())
new PostgresDestination({
  connectionString: "postgresql://user:pass@host:5432/db",
  table: "events",
  format: (n) => ({
    topic: n.topic,
    payload: JSON.stringify(n.rawPayload),
    created_at: new Date().toISOString(),
  }),
})
```

```
pnpm add pg
```

### S3

Write each notification as a JSON object. Keys follow the pattern `{prefix}{topic}/{uuid}.json` (default prefix: `whistlers/`).

```typescript
// uses the AWS credential chain (env vars, IAM role, instance profile, etc.)
new S3Destination({ bucket: "my-bucket" })

// custom region and key prefix
new S3Destination({ bucket: "my-bucket", region: "eu-west-1", prefix: "events/" })

// pre-configured client — useful for LocalStack, MinIO, or custom endpoints
import { S3Client } from "@aws-sdk/client-s3"
new S3Destination({
  bucket: "my-bucket",
  client: new S3Client({ endpoint: "http://localhost:4566", region: "us-east-1" }),
})

// custom body — return an object (JSON-serialised, ContentType: application/json, key ends .json)
// or a string (used as-is, ContentType: text/plain, no .json extension)
new S3Destination({
  bucket: "my-bucket",
  format: (n) => ({ topic: n.topic, payload: n.rawPayload }),
})
```

```
pnpm add @aws-sdk/client-s3
```

## Topic Matching

Each adapter implements queue-native wildcard semantics:

| Adapter | Single-level wildcard | Multi-level wildcard |
|---|---|---|
| NATS | `*` | `>` (must be last token) |
| MQTT | `+` | `#` (must be last level) |

A message arriving on `orders.created` matches the pattern `orders.*` (NATS). A message on `sensors/temp/zone1` matches `sensors/#` (MQTT). Multiple subscriptions can match the same message — each fires independently.

## Error Handling

Destination errors (e.g. connection failure, quota exceeded) are caught per-message. The bridge keeps running.

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

## Deployment (Ansible)

An Ansible role is included under `infra/ansible/roles/whistlers`. It installs Node.js and pnpm, clones this repository, builds it, and runs the standalone server as a systemd service.

### Using the role from another repository

Add a `requirements.yml` to your playbook repo pointing at this repository:

```yaml
# requirements.yml
roles:
  - name: whistlers
    src: https://github.com/Herklos/Whistlers.git
    scm: git
    version: main          # pin to a tag or commit SHA in production
    src_path: infra/ansible/roles/whistlers
```

Install the role before running your playbook:

```bash
ansible-galaxy role install -r requirements.yml
```

Then reference it by name in your playbook:

```yaml
- name: Deploy Whistlers
  hosts: whistlers_servers
  become: true
  vars:
    whistlers_queue_type: nats
    whistlers_queue_url: "nats://localhost:4222"
    whistlers_subscriptions:
      - name: orders
        topics: ["orders.*"]
        notification: { title: "New order", body: "An order was placed" }
        dataFields: ["id", "status"]
  roles:
    - whistlers
```

### Running the bundled example playbook

The repository ships `infra/ansible/site.yml` as a ready-to-use example:

```bash
ansible-playbook -i inventory.ini infra/ansible/site.yml
```

### Role variables

| Variable | Default | Description |
|---|---|---|
| `whistlers_queue_type` | `nats` | `nats` or `mqtt` |
| `whistlers_queue_url` | `nats://localhost:4222` | Broker URL |
| `whistlers_firebase_credentials_path` | `/etc/whistlers/service-account.json` | Path to the Firebase service-account on the target host |
| `whistlers_subscriptions` | `[]` | List of subscription objects (same schema as the JSON config) |
| `whistlers_version` | `main` | Git branch, tag, or commit to deploy |
| `whistlers_install_dir` | `/opt/whistlers` | Where the repo is cloned |

The service-account JSON must be placed on the target host before running the playbook (or provisioned separately via Vault / a secrets manager).
