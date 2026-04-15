import { readFileSync } from "fs"
import { initializeApp, applicationDefault } from "firebase-admin/app"
import { NatsQueueAdapter } from "../queue/nats.js"
import { MqttQueueAdapter } from "../queue/mqtt.js"
import { FirebaseDestination } from "../destination/firebase.js"
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

initializeApp({ credential: applicationDefault() })
const destination = new FirebaseDestination()

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
console.log(`[info] Whistlers started — queue: ${queueType} (${queueUrl}), config: ${configPath}`)

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
