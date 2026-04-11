/**
 * Example: Bridge MQTT messages to Firebase Cloud Messaging push notifications.
 *
 * Prerequisites:
 *   - A running MQTT broker (e.g. `docker run -p 1883:1883 eclipse-mosquitto`)
 *   - Firebase Admin SDK initialized
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx examples/ts/mqtt-to-firebase.ts
 */

import admin from "firebase-admin"
import { Whistler, MqttQueueAdapter, FirebaseDestination, createConfig } from "@drakkar.software/whistlers"

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
})

// Build config from code — allows type checking and IDE autocompletion
const config = createConfig({
  subscriptions: [
    {
      name: "sensor-alerts",
      // Subscribe to all topics under `sensors/alerts/`
      topics: ["sensors/alerts/+"],
      // MQTT shared subscription — load-balanced across multiple Whistler instances
      group: "whistlers",
      destinationTopic: "sensor-alerts",
      notification: {
        title: "Sensor alert",
        body: "A sensor has triggered an alert",
      },
      dataFields: ["sensorId", "level", "value"],
    },
    {
      name: "device-status",
      topics: ["devices/#"],
      destinationTopic: "device-status",
      notification: {
        title: "Device status changed",
      },
      dataFields: ["deviceId", "status"],
    },
  ],
})

const whistler = new Whistler({
  queue: new MqttQueueAdapter({
    url: "mqtt://localhost:1883",
    options: {
      clientId: `whistlers-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
    },
  }),
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
console.log("Whistler started — listening on MQTT, forwarding to FCM")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
