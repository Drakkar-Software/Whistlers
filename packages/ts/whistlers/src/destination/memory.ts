import type { DestinationAdapter, OutgoingNotification } from "./base.js"

/**
 * In-memory destination that records every notification it receives.
 * Use in tests to assert what Whistler would have sent.
 */
export class MemoryDestination implements DestinationAdapter {
  readonly sent: OutgoingNotification[] = []

  async send(notification: OutgoingNotification): Promise<void> {
    this.sent.push(notification)
  }

  async close(): Promise<void> {
    this.sent.length = 0
  }

  /** Reset recorded notifications without closing. */
  clear(): void {
    this.sent.length = 0
  }
}
