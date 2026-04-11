import type { MessageHandler, QueueAdapter, QueueMessage } from "./base.js"

export interface MqttQueueAdapterOptions {
  /** MQTT broker URL, e.g. `"mqtt://localhost:1883"` or `"mqtts://broker.example.com"`. */
  url: string
  /** Optional MQTT client options forwarded to the `mqtt` package. */
  options?: Record<string, unknown>
}

/**
 * Queue adapter backed by MQTT.
 * Uses MQTT shared subscriptions (`$share/{group}/topic`) when `group` is set on subscriptions.
 *
 * Requires the `mqtt` package to be installed.
 */
export class MqttQueueAdapter implements QueueAdapter {
  private client: import("mqtt").MqttClient | null = null
  private handlers: MessageHandler[] = []
  private readonly subscribed = new Set<string>()

  constructor(private readonly opts: MqttQueueAdapterOptions) {}

  async connect(): Promise<void> {
    const mqtt = await import("mqtt")
    const client = mqtt.connect(this.opts.url, this.opts.options)

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve())
      client.once("error", reject)
    })

    client.on("message", (topic: string, payload: Buffer) => {
      const message: QueueMessage = {
        topic,
        payload: payload.toString("utf8"),
        timestamp: Date.now(),
      }
      for (const handler of this.handlers) {
        void Promise.resolve(handler(message)).catch(() => {
          // handlers should not throw
        })
      }
    })

    this.client = client
  }

  async subscribe(topics: string[]): Promise<void> {
    if (!this.client) throw new Error("Not connected. Call connect() first.")
    for (const topic of topics) {
      if (!this.subscribed.has(topic)) {
        await new Promise<void>((resolve, reject) => {
          this.client!.subscribe(topic, (err) => (err ? reject(err) : resolve()))
        })
        this.subscribed.add(topic)
      }
    }
  }

  async unsubscribe(topics: string[]): Promise<void> {
    if (!this.client) return
    for (const topic of topics) {
      if (this.subscribed.has(topic)) {
        await new Promise<void>((resolve, reject) => {
          this.client!.unsubscribe(topic, (err) => (err ? reject(err) : resolve()))
        })
        this.subscribed.delete(topic)
      }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  async close(): Promise<void> {
    if (this.client) {
      await new Promise<void>((resolve) => this.client!.end(false, {}, () => resolve()))
      this.client = null
    }
    this.handlers = []
    this.subscribed.clear()
  }

  /**
   * MQTT wildcard matching:
   *   `+`  matches exactly one `/`-delimited level.
   *   `#`  matches all remaining levels (must be the last segment).
   */
  matchesTopic(pattern: string, topic: string): boolean {
    // Shared subscription prefix: strip `$share/{group}/`
    const normalizedPattern = pattern.replace(/^\$share\/[^/]+\//, "")
    const patternParts = normalizedPattern.split("/")
    const topicParts = topic.split("/")

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i]
      if (p === "#") return i <= topicParts.length - 1
      if (i >= topicParts.length) return false
      if (p !== "+" && p !== topicParts[i]) return false
    }

    return patternParts.length === topicParts.length
  }

  /**
   * Build the effective subscription string, applying the shared-subscription prefix when a
   * group is provided.
   */
  static buildSubscriptionTopic(topic: string, group?: string): string {
    return group ? `$share/${group}/${topic}` : topic
  }
}
