/**
 * Example: Bridge NATS messages to Firebase Cloud Messaging push notifications.
 *
 * Prerequisites:
 *   - A running NATS server (e.g. `docker run -p 4222:4222 nats`)
 *   - Firebase Admin SDK initialized (service account or Application Default Credentials)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx examples/ts/nats-to-firebase.ts
 */

import admin from "firebase-admin"
import { Whistler, NatsQueueAdapter, FirebaseDestination, createConfig } from "@drakkar.software/whistlers"

// Initialize Firebase (uses Application Default Credentials when env var is set,
// or you can pass a service account explicitly)
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
})

const config = createConfig({
  subscriptions: [
    {
      name: "orders",
      // Subscribe to all sub-topics under `orders`
      topics: ["orders.*"],
      // NATS queue group — only one instance of this group processes each message
      group: "whistlers",
      // FCM topic that mobile users subscribe to
      destinationTopic: "orders",
      notification: {
        title: "Order update",
        body: "One of your orders has been updated",
      },
      // Forward these payload fields as FCM data so the app can deep-link
      dataFields: ["id", "status"],
    },
    {
      name: "announcements",
      topics: ["announcements.>"],
      destinationTopic: "announcements",
      notification: {
        title: "Announcement",
        body: "A new announcement is available",
      },
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
  onError: (err, ctx) => {
    console.error(`Failed to forward topic "${ctx.message.topic}"`, err)
  },
})

await whistler.start()
console.log("Whistler started — listening on NATS, forwarding to FCM")

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
