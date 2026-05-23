/**
 * Example: One Firebase project PER namespace.
 *
 * Each namespace (tenant) is routed to its own Firebase project, using a
 * separate service-account key. This is the multi-project counterpart to
 * `nats-namespaces-to-firebase.ts` (which sends every namespace through a
 * single project).
 *
 * How it works:
 *   1. Initialize one firebase-admin *named* app per namespace, each with its
 *      own service-account credential (= its own Firebase project).
 *   2. Wrap one `FirebaseDestination` per app in a `NamespaceRoutingDestination`,
 *      which dispatches each notification by its `namespace`.
 *   3. Root (non-namespaced) subscriptions fall through to `default`.
 *
 * With this config a message on `orders.created` is forwarded to:
 *   • the `acme`   Firebase project, topic `acme-orders`
 *   • the `globex` Firebase project, topic `globex-orders`
 * and `system.alerts.*` goes to the default project as `system-alerts`.
 *
 * Prerequisites:
 *   - A running NATS server (e.g. `docker run -p 4222:4222 nats`)
 *   - One Firebase service-account JSON key per tenant project, plus a default
 *     credential for root subscriptions (Application Default Credentials).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./default-sa.json \
 *   ACME_SA=./acme-sa.json GLOBEX_SA=./globex-sa.json \
 *   npx tsx examples/ts/nats-namespaces-multi-firebase.ts
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app"
import {
  Whistler,
  NatsQueueAdapter,
  FirebaseDestination,
  NamespaceRoutingDestination,
  createConfig,
} from "@drakkar.software/whistlers"
import type { NamespaceConfig } from "@drakkar.software/whistlers"

// Default app — handles root subscriptions (and any namespace without its own project).
initializeApp({ credential: applicationDefault() })

// One named app per tenant, each pointing at that tenant's Firebase project.
const acmeApp = initializeApp({ credential: cert(process.env["ACME_SA"]!) }, "acme")
const globexApp = initializeApp({ credential: cert(process.env["GLOBEX_SA"]!) }, "globex")

function makeTenantNamespace(tenant: string): NamespaceConfig {
  return {
    subscriptions: [
      {
        name: "orders",
        topics: ["orders.*"],
        group: `whistlers-${tenant}`,
        destinationTopic: "orders", // becomes `{tenant}-orders` at runtime
        notification: { title: "Order update", body: "One of your orders has been updated" },
        dataFields: ["id", "status"],
      },
    ],
  }
}

const config = createConfig({
  // Root subscriptions — delivered through the default Firebase project.
  subscriptions: [
    {
      name: "system-alerts",
      topics: ["system.alerts.>"],
      destinationTopic: "system-alerts",
      notification: { title: "System alert" },
    },
  ],
  namespaces: {
    acme: makeTenantNamespace("acme"),
    globex: makeTenantNamespace("globex"),
  },
})

const whistler = new Whistler({
  queue: new NatsQueueAdapter({ servers: "nats://localhost:4222" }),
  destination: new NamespaceRoutingDestination({
    routes: {
      acme: new FirebaseDestination({ app: acmeApp }),
      globex: new FirebaseDestination({ app: globexApp }),
    },
    // Root + any unrouted namespace use the default Firebase app.
    default: new FirebaseDestination(),
  }),
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
console.log("Whistler started — per-namespace Firebase projects")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
