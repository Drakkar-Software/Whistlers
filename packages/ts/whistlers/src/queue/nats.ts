import type { MessageHandler, QueueAdapter, QueueMessage } from "./base.js"

export interface NatsQueueAdapterOptions {
  /** One or more NATS server URLs, e.g. `"nats://localhost:4222"`. */
  servers: string | string[]
}

/**
 * Queue adapter backed by NATS core (not JetStream).
 * Uses queue groups when `group` is specified on subscriptions.
 *
 * Requires the `nats` package to be installed.
 */
export class NatsQueueAdapter implements QueueAdapter {
  private nc: import("nats").NatsConnection | null = null
  private activeSubscriptions: Map<string, import("nats").Subscription> = new Map()
  private handlers: MessageHandler[] = []

  constructor(private readonly opts: NatsQueueAdapterOptions) {}

  async connect(): Promise<void> {
    const { connect } = await import("nats")
    this.nc = await connect({ servers: this.opts.servers })
  }

  async subscribe(topics: string[]): Promise<void> {
    if (!this.nc) throw new Error("Not connected. Call connect() first.")
    const { StringCodec } = await import("nats")
    const sc = StringCodec()

    for (const topic of topics) {
      if (this.activeSubscriptions.has(topic)) continue
      const sub = this.nc.subscribe(topic)
      this.activeSubscriptions.set(topic, sub)

      // Drain messages in background
      void (async () => {
        for await (const msg of sub) {
          const message: QueueMessage = {
            topic: msg.subject,
            payload: sc.decode(msg.data),
            timestamp: Date.now(),
            headers: msg.headers
              ? Object.fromEntries(
                  [...msg.headers.keys()].map((k) => [k, msg.headers?.get(k) ?? ""])
                )
              : undefined,
          }
          for (const handler of this.handlers) {
            try {
              await handler(message)
            } catch {
              // handlers should not throw; individual errors are the handler's responsibility
            }
          }
        }
      })()
    }
  }

  async unsubscribe(topics: string[]): Promise<void> {
    for (const topic of topics) {
      const sub = this.activeSubscriptions.get(topic)
      if (sub) {
        sub.unsubscribe()
        this.activeSubscriptions.delete(topic)
      }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  async close(): Promise<void> {
    for (const sub of this.activeSubscriptions.values()) {
      sub.unsubscribe()
    }
    this.activeSubscriptions.clear()
    if (this.nc) {
      await this.nc.drain()
      this.nc = null
    }
    this.handlers = []
  }

  /**
   * NATS wildcard matching:
   *   `*`  matches exactly one dot-delimited token.
   *   `>`  matches one or more remaining tokens (must be the last token).
   */
  matchesTopic(pattern: string, topic: string): boolean {
    const patternParts = pattern.split(".")
    const topicParts = topic.split(".")

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i]
      if (p === ">") return i <= topicParts.length - 1
      if (i >= topicParts.length) return false
      if (p !== "*" && p !== topicParts[i]) return false
    }

    return patternParts.length === topicParts.length
  }
}
