/**
 * Example: send TWO FCM messages per event — a notification "placeholder" the OS shows
 * immediately, plus a `data`-only message that wakes a background handler to replace it
 * with richer (e.g. decrypted) content. If the background handler can't run (the app is
 * force-quit, throttled, or in Doze), the placeholder simply stays.
 *
 * This works because `FirebaseDestination`'s `format` callback may return an ARRAY of
 * message bodies (v0.8.0+): each element is sent as its own FCM message and addressed
 * independently. Here both messages carry the same exclusion `condition` so the event's
 * author never gets pushed on their own devices.
 *
 * Prerequisites:
 *   - A running NATS server (e.g. `docker run -p 4222:4222 nats`)
 *   - Firebase Admin SDK initialized (service account or Application Default Credentials)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx examples/ts/nats-firebase-placeholder-upgrade.ts
 */

import admin from "firebase-admin"
import { Whistler, NatsQueueAdapter, FirebaseDestination, createConfig } from "@drakkar.software/whistlers"

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
})

const config = createConfig({
  subscriptions: [
    {
      name: "chat",
      topics: ["chat.changed.*"],
      group: "whistlers",
      destinationTopic: "chat",
    },
  ],
})

const whistler = new Whistler({
  queue: new NatsQueueAdapter({ servers: "nats://localhost:4222" }),
  destination: new FirebaseDestination({
    // Don't reject the whole event if only the upgrade fails — keep the placeholder.
    multiSendFailure: "resolve",
    format: (n) => {
      const payload = n.rawPayload as { roomId?: string; identity?: string }
      const roomId = String(payload.roomId ?? "")
      // Exclude the author's own devices from their own message's push.
      const condition = payload.identity
        ? `'${n.topic}' in topics && !('user-${payload.identity}' in topics)`
        : undefined

      return [
        // 1. Placeholder — a visible notification, rendered by the OS even when the
        //    app can't run. `tag` lets the client's replacement collapse onto it.
        {
          notification: { title: "New message", body: "New message in another room" },
          android: { notification: { tag: roomId } },
          apns: {
            headers: { "apns-push-type": "alert", "apns-priority": "10" },
            payload: { aps: { alert: { title: "New message", body: "New message in another room" } } },
          },
          ...(condition ? { condition } : {}),
        },
        // 2. Data-only upgrade — high priority so it wakes the Android background
        //    handler, which decrypts and replaces the placeholder with the real text.
        {
          data: { type: "chat.changed", roomId },
          android: { priority: "high" },
          ...(condition ? { condition } : {}),
        },
      ]
    },
  }),
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
console.log("Whistler started — listening on NATS, fanning out placeholder + upgrade to FCM")

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`)
    await whistler.stop()
    process.exit(0)
  })
}
