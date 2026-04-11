/**
 * Whistlers standalone server entry point.
 *
 * Reads a Whistlers JSON config file and starts the bridge, forwarding
 * messages from the configured queue to Firebase Cloud Messaging.
 *
 * Environment variables:
 *   QUEUE_TYPE                       "nats" or "mqtt" (required)
 *   QUEUE_URL                        broker URL, e.g. nats://localhost:4222 (required)
 *   GOOGLE_APPLICATION_CREDENTIALS   path to a Firebase service-account JSON (required)
 *
 * Usage:
 *   QUEUE_TYPE=nats QUEUE_URL=nats://localhost:4222 \
 *     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node dist/bin/server.js /etc/whistlers/config.json
 */

import { readFileSync } from "node:fs"
import { Whistler } from "../bridge.js"
import { NatsQueueAdapter } from "../queue/nats.js"
import { MqttQueueAdapter } from "../queue/mqtt.js"
import { FirebaseDestination } from "../destination/firebase.js"
import { parseConfigJson } from "../config/loader.js"

const configPath = process.argv[2]
if (!configPath) {
  console.error("Usage: node server.js <config.json>")
  process.exit(1)
}

const queueType = process.env["QUEUE_TYPE"]
const queueUrl = process.env["QUEUE_URL"]

if (!queueType || !queueUrl) {
  console.error("Required environment variables: QUEUE_TYPE, QUEUE_URL")
  process.exit(1)
}

const config = parseConfigJson(readFileSync(configPath, "utf8"))

const queue =
  queueType === "nats"
    ? new NatsQueueAdapter({ servers: queueUrl })
    : queueType === "mqtt"
      ? new MqttQueueAdapter({ url: queueUrl })
      : null

if (!queue) {
  console.error(`Unknown QUEUE_TYPE "${queueType}". Expected "nats" or "mqtt".`)
  process.exit(1)
}

// Initialize Firebase (uses GOOGLE_APPLICATION_CREDENTIALS automatically)
const { default: admin } = await import("firebase-admin")
admin.initializeApp({ credential: admin.credential.applicationDefault() })

const whistler = new Whistler({
  queue,
  destination: new FirebaseDestination(),
  config,
  logger: {
    info: (msg, ...args) => console.log("[info]", msg, ...args),
    warn: (msg, ...args) => console.warn("[warn]", msg, ...args),
    error: (msg, ...args) => console.error("[error]", msg, ...args),
  },
  onError: (err, ctx) => {
    console.error(`[error] Failed to forward topic "${ctx.message.topic}"`, err)
  },
})

await whistler.start()
console.log(`Whistler started — ${queueType.toUpperCase()} → FCM`)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
