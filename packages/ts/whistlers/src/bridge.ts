import type { QueueAdapter, QueueMessage, TopicSubscription } from "./queue/base.js"
import type { DestinationAdapter, OutgoingNotification } from "./destination/base.js"
import type { SubscriptionConfig, WhistlersConfig } from "./config/schema.js"

export interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface WhistlerOptions {
  queue: QueueAdapter
  destination: DestinationAdapter
  config: WhistlersConfig
  logger?: Logger
  /**
   * Called when `destination.send()` throws. The bridge continues after the error.
   * If omitted, errors are only logged (when a logger is provided).
   */
  onError?: (
    err: unknown,
    context: { message: QueueMessage; subscription: SubscriptionConfig; namespace?: string }
  ) => void
}

/**
 * Convert a queue topic into a safe destination topic name.
 * Queue separators (`.` for NATS, `/` for MQTT) and any other characters
 * outside `[a-zA-Z0-9-_~%]` are replaced with `-`.
 * Dots are intentionally normalized because they carry structural meaning
 * in NATS and produce ambiguous topic names.
 */
export function sanitizeTopic(topic: string): string {
  return topic.replace(/[^a-zA-Z0-9\-_~%]/g, "-")
}

/**
 * Extract `dataFields` from a parsed payload into a `Record<string, string>`.
 * Only top-level fields with primitive values are included.
 */
function extractData(
  payload: unknown,
  dataFields: string[]
): Record<string, string> | undefined {
  if (typeof payload !== "object" || payload === null || dataFields.length === 0) return undefined
  const obj = payload as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const field of dataFields) {
    const val = obj[field]
    if (val !== undefined && val !== null && typeof val !== "object") {
      result[field] = String(val)
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * The main orchestrator. Connects to the queue, subscribes to configured topics,
 * and forwards every received message to the destination adapter.
 */
export class Whistler {
  private readonly queue: QueueAdapter
  private readonly destination: DestinationAdapter
  private readonly config: WhistlersConfig
  private readonly logger: Logger | undefined
  private readonly onError: WhistlerOptions["onError"]
  private started = false

  constructor(opts: WhistlerOptions) {
    this.queue = opts.queue
    this.destination = opts.destination
    this.config = opts.config
    this.logger = opts.logger
    this.onError = opts.onError
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("Whistler is already started")
    this.started = true

    await this.queue.connect()
    await this.queue.subscribe(this.collectSubscriptions())

    this.queue.onMessage(async (message) => {
      for (const { sub, namespace } of this.allSubscriptions()) {
        const matched = sub.topics.some((pattern) =>
          this.queue.matchesTopic(pattern, message.topic)
        )
        if (!matched) continue

        const rawPayload = tryParseJson(message.payload)
        const baseTopic = sub.destinationTopic ?? sanitizeTopic(message.topic)
        const destTopic = namespace !== undefined ? `${namespace}-${baseTopic}` : baseTopic
        const data = sub.dataFields ? extractData(rawPayload, sub.dataFields) : undefined

        const notification: OutgoingNotification = {
          topic: destTopic,
          sourceTopic: message.topic,
          ...(namespace !== undefined ? { namespace } : {}),
          notification: sub.notification,
          rawPayload,
          ...(data ? { data } : {}),
        }

        try {
          await this.destination.send(notification)
          this.logger?.info(`Forwarded message on "${message.topic}" → "${destTopic}"`)
        } catch (err) {
          this.logger?.error(`Failed to forward "${message.topic}" → "${destTopic}"`, err)
          this.onError?.(err, { message, subscription: sub, namespace })
        }
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    await this.queue.unsubscribe(this.collectSubscriptions())
    await this.queue.close()
    await this.destination.close?.()
    this.started = false
  }

  /**
   * Flatten root subscriptions and all namespaced subscriptions into a single list,
   * each tagged with its namespace (if any). Used by both the message loop and
   * `collectSubscriptions` so both always see the full set.
   */
  private allSubscriptions(): { sub: SubscriptionConfig; namespace?: string }[] {
    const result: { sub: SubscriptionConfig; namespace?: string }[] =
      this.config.subscriptions.map((sub) => ({ sub }))
    for (const [ns, nsConfig] of Object.entries(this.config.namespaces ?? {})) {
      for (const sub of nsConfig.subscriptions) {
        result.push({ sub, namespace: ns })
      }
    }
    return result
  }

  /**
   * Collect the unique set of (topic, group) pairs across all subscriptions
   * (root and namespaced). Deduplicates by the effective subscription key so
   * the same topic+group is only subscribed once even if it appears in multiple
   * `SubscriptionConfig` entries across scopes.
   */
  private collectSubscriptions(): TopicSubscription[] {
    const seen = new Set<string>()
    const result: TopicSubscription[] = []
    for (const { sub } of this.allSubscriptions()) {
      for (const topic of sub.topics) {
        const key = sub.group ? `${sub.group}:${topic}` : topic
        if (!seen.has(key)) {
          seen.add(key)
          result.push(sub.group ? { topic, group: sub.group } : { topic })
        }
      }
    }
    return result
  }
}

function tryParseJson(payload: string): unknown {
  try {
    return JSON.parse(payload)
  } catch {
    return payload
  }
}
