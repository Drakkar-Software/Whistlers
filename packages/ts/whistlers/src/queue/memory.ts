import type { MessageHandler, QueueAdapter, QueueMessage, TopicSubscription } from "./base.js"

/**
 * In-memory queue adapter for use in tests and local development.
 * Call `simulate()` to inject messages as if they arrived from a real queue.
 */
export class MemoryQueueAdapter implements QueueAdapter {
  private handlers: MessageHandler[] = []
  readonly subscribed: string[] = []
  private connected = false

  async connect(): Promise<void> {
    this.connected = true
  }

  async subscribe(subscriptions: TopicSubscription[]): Promise<void> {
    for (const { topic } of subscriptions) {
      if (!this.subscribed.includes(topic)) {
        this.subscribed.push(topic)
      }
    }
  }

  async unsubscribe(subscriptions: TopicSubscription[]): Promise<void> {
    for (const { topic } of subscriptions) {
      const idx = this.subscribed.indexOf(topic)
      if (idx !== -1) this.subscribed.splice(idx, 1)
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  async close(): Promise<void> {
    this.connected = false
    this.handlers = []
    this.subscribed.length = 0
  }

  /** NATS-style wildcard matching (used for tests that use this adapter with the bridge). */
  matchesTopic(pattern: string, topic: string): boolean {
    return matchNatsTopic(pattern, topic)
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Simulate an incoming message. All registered handlers are called in order.
   */
  async simulate(message: QueueMessage): Promise<void> {
    for (const handler of this.handlers) {
      await handler(message)
    }
  }
}

/**
 * Queue adapter backed by a callback — useful when you want to plug in custom delivery logic.
 */
export class CustomQueueAdapter implements QueueAdapter {
  private handlers: MessageHandler[] = []
  readonly subscribed: string[] = []

  constructor(
    private readonly opts: {
      onSubscribe?: (subscriptions: TopicSubscription[]) => Promise<void>
      onUnsubscribe?: (subscriptions: TopicSubscription[]) => Promise<void>
      onConnect?: () => Promise<void>
      onClose?: () => Promise<void>
    } = {}
  ) {}

  async connect(): Promise<void> {
    await this.opts.onConnect?.()
  }

  async subscribe(subscriptions: TopicSubscription[]): Promise<void> {
    for (const { topic } of subscriptions) {
      if (!this.subscribed.includes(topic)) this.subscribed.push(topic)
    }
    await this.opts.onSubscribe?.(subscriptions)
  }

  async unsubscribe(subscriptions: TopicSubscription[]): Promise<void> {
    for (const { topic } of subscriptions) {
      const idx = this.subscribed.indexOf(topic)
      if (idx !== -1) this.subscribed.splice(idx, 1)
    }
    await this.opts.onUnsubscribe?.(subscriptions)
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  async close(): Promise<void> {
    await this.opts.onClose?.()
    this.handlers = []
  }

  matchesTopic(pattern: string, topic: string): boolean {
    return matchNatsTopic(pattern, topic)
  }

  async deliver(message: QueueMessage): Promise<void> {
    for (const handler of this.handlers) {
      await handler(message)
    }
  }
}

/** NATS wildcard matching: `*` = single token, `>` = all remaining tokens. */
export function matchNatsTopic(pattern: string, topic: string): boolean {
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
