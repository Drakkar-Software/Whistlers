import { readFileSync } from "fs"
import { NatsQueueAdapter } from "../queue/nats.js"
import { MqttQueueAdapter } from "../queue/mqtt.js"
import { FirebaseDestination } from "../destination/firebase.js"
import { SSEDestination } from "../destination/sse.js"
import type { DestinationAdapter } from "../destination/base.js"
import { Whistler } from "../bridge.js"
import { assertValidConfig } from "../config/validate.js"

const configPath = process.argv[2] ?? "/etc/whistlers/config.json"

let rawConfig: unknown
try {
  rawConfig = JSON.parse(readFileSync(configPath, "utf8"))
} catch (err) {
  console.error(`[error] Failed to load config from "${configPath}":`, err)
  process.exit(1)
}

assertValidConfig(rawConfig)

const queueType = process.env["QUEUE_TYPE"] ?? "nats"
const queueUrl = process.env["QUEUE_URL"] ?? "nats://localhost:4222"

const queue =
  queueType === "mqtt"
    ? new MqttQueueAdapter({ url: queueUrl })
    : new NatsQueueAdapter({ servers: queueUrl })

const destinationType = process.env["DESTINATION_TYPE"] ?? "firebase"

let destination: DestinationAdapter
if (destinationType === "sse") {
  const ssePort = Number(process.env["SSE_PORT"] ?? 8080)
  const ssePath = process.env["SSE_PATH"] ?? "/events"
  const sse = new SSEDestination({ path: ssePath })
  await sse.listen(ssePort)
  console.log(`[info] SSE server listening on port ${ssePort} (path: ${ssePath})`)
  destination = sse
} else {
  // Lazy-import firebase-admin so SSE-only users don't need the optional peer dependency.
  const { initializeApp, applicationDefault } = await import("firebase-admin/app")
  initializeApp({ credential: applicationDefault() })
  destination = new FirebaseDestination()
}

const whistler = new Whistler({
  queue,
  destination,
  config: rawConfig,
  logger: {
    info: (msg, ...args) => console.log("[info]", msg, ...args),
    warn: (msg, ...args) => console.warn("[warn]", msg, ...args),
    error: (msg, ...args) => console.error("[error]", msg, ...args),
  },
  onError: (err, ctx) => {
    console.error(`[error] Failed to forward "${ctx.message.topic}"`, err)
  },
})

await whistler.start()
console.log(
  `[info] Whistlers started — queue: ${queueType} (${queueUrl}), destination: ${destinationType}, config: ${configPath}`
)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[info] Received ${signal}, shutting down…`)
    whistler
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("[error] Shutdown error", err)
        process.exit(1)
      })
  })
}
