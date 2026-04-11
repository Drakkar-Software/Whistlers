export interface QueueMessage {
  topic: string
  payload: string
  timestamp: number
  headers?: Record<string, string>
}

export type MessageHandler = (message: QueueMessage) => void | Promise<void>

/**
 * A topic pattern together with its optional consumer group.
 * NATS: group becomes a queue-group name (`nc.subscribe(topic, { queue: group })`).
 * MQTT: group triggers a shared-subscription prefix (`$share/{group}/topic`).
 */
export interface TopicSubscription {
  topic: string
  group?: string
}

export interface QueueAdapter {
  connect(): Promise<void>
  subscribe(subscriptions: TopicSubscription[]): Promise<void>
  unsubscribe(subscriptions: TopicSubscription[]): Promise<void>
  onMessage(handler: MessageHandler): void
  close(): Promise<void>
  /** Returns true if the given topic matches the pattern using this adapter's wildcard rules. */
  matchesTopic(pattern: string, topic: string): boolean
}
