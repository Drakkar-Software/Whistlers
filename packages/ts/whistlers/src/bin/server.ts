import { readFileSync } from "fs"
import { NatsQueueAdapter } from "../queue/nats.js"
import { MqttQueueAdapter } from "../queue/mqtt.js"
import { FirebaseDestination } from "../destination/firebase.js"
import { SSEDestination } from "../destination/sse.js"
import { NamespaceRoutingDestination } from "../destination/namespace-routing.js"
import type { DestinationAdapter } from "../destination/base.js"
import { Whistler } from "../bridge.js"
import { parseConfigJson } from "../config/loader.js"
import type { WhistlersConfig } from "../config/schema.js"

const configPath = process.argv[2] ?? "/etc/whistlers/config.json"

let rawConfig: WhistlersConfig
try {
  rawConfig = parseConfigJson(readFileSync(configPath, "utf8"))
} catch (err) {
  console.error(`[error] Failed to load config from "${configPath}":`, err)
  process.exit(1)
}

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
  const { initializeApp, applicationDefault, cert } = await import("firebase-admin/app")

  // Per-namespace Firebase projects: each namespace with `firebaseCredentials` gets a
  // dedicated named firebase-admin app initialized from its service-account key file.
  const namespaces = Object.entries(rawConfig.namespaces ?? {})
  const routes: Record<string, DestinationAdapter> = {}
  for (const [namespace, nsConfig] of namespaces) {
    if (nsConfig.firebaseCredentials) {
      const app = initializeApp({ credential: cert(nsConfig.firebaseCredentials) }, namespace)
      routes[namespace] = new FirebaseDestination({ app })
      console.log(
        `[info] Namespace "${namespace}" → Firebase project from ${nsConfig.firebaseCredentials}`
      )
    }
  }

  // The default app (Application Default Credentials) backstops root subscriptions and any
  // namespace without its own `firebaseCredentials`. Skip it — and avoid requiring ADC — when
  // there is nothing for it to handle (no root subscriptions and every namespace is routed).
  const needsDefaultApp =
    rawConfig.subscriptions.length > 0 ||
    namespaces.length === 0 ||
    namespaces.some(([, ns]) => !ns.firebaseCredentials)

  let defaultDestination: FirebaseDestination | undefined
  if (needsDefaultApp) {
    initializeApp({ credential: applicationDefault() })
    defaultDestination = new FirebaseDestination()
  }

  if (Object.keys(routes).length === 0) {
    // No per-namespace projects → a plain default-app destination (needsDefaultApp is true here).
    destination = defaultDestination as FirebaseDestination
  } else {
    destination = new NamespaceRoutingDestination({
      routes,
      ...(defaultDestination ? { default: defaultDestination } : {}),
    })
  }
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
