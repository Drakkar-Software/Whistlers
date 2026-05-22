/**
 * Example: Multi-tenant NATS → Firebase Cloud Messaging using namespaces.
 *
 * Namespaces group subscriptions by tenant. Each namespace's subscriptions
 * have their destination topics automatically prefixed with `{namespace}-`,
 * and the `namespace` field is attached to every `OutgoingNotification` so
 * destination adapters can segment traffic per tenant.
 *
 * With this config a message on `orders.created` is forwarded twice:
 *   • topic `acme-orders`,   namespace `acme`
 *   • topic `globex-orders`, namespace `globex`
 *
 * Mobile clients subscribe to the FCM topic matching their tenant:
 *   acme users   → subscribe to `acme-orders`
 *   globex users → subscribe to `globex-orders`
 *
 * Prerequisites:
 *   - A running NATS server (e.g. `docker run -p 4222:4222 nats`)
 *   - Firebase Admin SDK credentials (service account or Application Default Credentials)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx examples/ts/nats-namespaces-to-firebase.ts
 */

import admin from "firebase-admin"
import {
  Whistler,
  NatsQueueAdapter,
  FirebaseDestination,
  createConfig,
} from "@drakkar.software/whistlers"
import type { NamespaceConfig } from "@drakkar.software/whistlers"

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
})

/**
 * Factory that builds the standard set of subscriptions for a tenant namespace.
 * The namespace prefix (`{tenant}-`) is applied automatically to all destination
 * topics at runtime — you don't need to include it here.
 */
function makeTenantNamespace(tenant: string): NamespaceConfig {
  return {
    subscriptions: [
      {
        name: "orders",
        topics: ["orders.*"],
        // NATS queue group shared across all tenant workers
        group: `whistlers-${tenant}`,
        // Becomes `{tenant}-orders` at runtime
        destinationTopic: "orders",
        notification: {
          title: "Order update",
          body: "One of your orders has been updated",
        },
        dataFields: ["id", "status"],
      },
      {
        name: "announcements",
        topics: ["announcements.>"],
        // Becomes `{tenant}-announcements` at runtime
        destinationTopic: "announcements",
        notification: {
          title: "Announcement",
          body: "A new announcement is available",
        },
      },
    ],
  }
}

const config = createConfig({
  // Root subscriptions for topics shared across all tenants
  subscriptions: [
    {
      name: "system-alerts",
      topics: ["system.alerts.>"],
      destinationTopic: "system-alerts",
      notification: { title: "System alert" },
    },
  ],
  // Per-tenant namespaces — destination topics are prefixed automatically
  namespaces: {
    acme: makeTenantNamespace("acme"),
    globex: makeTenantNamespace("globex"),
  },
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
    const ns = ctx.namespace ? ` [${ctx.namespace}]` : ""
    console.error(`Failed to forward topic "${ctx.message.topic}"${ns}`, err)
  },
})

await whistler.start()
console.log("Whistler started — multi-tenant NATS → FCM with namespace routing")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
