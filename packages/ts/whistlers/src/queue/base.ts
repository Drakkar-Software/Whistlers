export interface QueueMessage {
  topic: string
  payload: string
  timestamp: number
  headers?: Record<string, string>
}

export type MessageHandler = (message: QueueMessage) => void | Promise<void>

export interface QueueAdapter {
  connect(): Promise<void>
  subscribe(topics: string[]): Promise<void>
  unsubscribe(topics: string[]): Promise<void>
  onMessage(handler: MessageHandler): void
  close(): Promise<void>
  /** Returns true if the given topic matches the pattern using this adapter's wildcard rules. */
  matchesTopic(pattern: string, topic: string): boolean
}
