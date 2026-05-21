/**
 * Example: Bridge NATS messages to a Server-Sent Events (SSE) HTTP endpoint.
 *
 * Connected clients receive each forwarded notification as a live SSE stream — no Firebase,
 * no database, no polling. Clients may filter by topic via the `?topic=` query parameter.
 *
 * Prerequisites:
 *   - A running NATS server (e.g. `docker run -p 4222:4222 nats`)
 *
 * Usage:
 *   npx tsx examples/ts/nats-to-sse.ts
 *
 * Then connect a client (receives every topic):
 *   curl -N http://localhost:8080/events
 *
 * Or only the `orders` topic:
 *   curl -N "http://localhost:8080/events?topic=orders"
 */

import { Whistler, NatsQueueAdapter, SSEDestination, createConfig } from "@drakkar.software/whistlers"

const config = createConfig({
  subscriptions: [
    {
      name: "orders",
      topics: ["orders.*"],
      group: "whistlers",
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
      destinationTopic: "announcements",
      notification: {
        title: "Announcement",
        body: "A new announcement is available",
      },
    },
  ],
})

// Start the SSE HTTP server before the bridge so clients can connect before messages arrive.
const destination = new SSEDestination({ path: "/events" })
const { port } = await destination.listen(8080)
console.log(`[info] SSE server listening on http://localhost:${port}/events`)

const whistler = new Whistler({
  queue: new NatsQueueAdapter({ servers: "nats://localhost:4222" }),
  destination,
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
console.log("Whistler started — listening on NATS, streaming to SSE clients")

// Graceful shutdown — whistler.stop() calls destination.close(), which ends every open
// client stream and shuts down the SSE server.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
