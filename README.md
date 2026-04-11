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
  onError: (err, ctx) =>
    console.error("Failed to forward", ctx.message.topic, err),
})

await whistler.start()
// ...
await whistler.stop()
```

## Configuration from JSON

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
import { parseConfigJson, Whistler, NatsQueueAdapter, FirebaseDestination } from "@drakkar.software/whistlers"

const config = parseConfigJson(jsonString)
```

## Queue Adapters

### NATS

```typescript
new NatsQueueAdapter({ servers: "nats://localhost:4222" })
```

Wildcard syntax: `orders.*` (single token), `events.>` (all remaining tokens).  
Set `group` on a subscription to use NATS queue groups (load-balanced delivery).

### MQTT

```typescript
new MqttQueueAdapter({ url: "mqtt://localhost:1883" })
```

Wildcard syntax: `orders/+` (single level), `events/#` (all levels).  
Set `group` on a subscription to use MQTT shared subscriptions (`$share/{group}/topic`).

## Destination Adapters

### Firebase (FCM)

```typescript
// uses default app
new FirebaseDestination()

// or supply a specific app
new FirebaseDestination({ app: myFirebaseApp })
```

FCM topic names must match `[a-zA-Z0-9-_.~%]+`. When `destinationTopic` is not set, Whistlers sanitizes the source topic automatically (`.` and `/` become `-`).

## Topic Matching

Each adapter implements queue-native wildcard semantics. A message arriving on `orders.created` matches the subscription pattern `orders.*` (NATS) or `orders/+` (MQTT). Multiple subscriptions can match the same message — each fires independently.

## Testing

The package exports `MemoryQueueAdapter` and `MemoryDestination` for use in your own test suites:

```typescript
import { MemoryQueueAdapter, MemoryDestination, Whistler, createConfig } from "@drakkar.software/whistlers"

const queue = new MemoryQueueAdapter()
const dest = new MemoryDestination()
const whistler = new Whistler({ queue, destination: dest, config })

await whistler.start()
await queue.simulate({ topic: "orders.created", payload: '{"id":"1"}', timestamp: Date.now() })

console.log(dest.sent[0]) // OutgoingNotification
```
